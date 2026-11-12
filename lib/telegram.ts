import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import {
  agents,
  telegramChats,
  telegramLinks,
  telegramMessages,
  telegramPending,
  telegramSent,
  telegramUpdates,
  type AgentRow,
  type MessageRow,
  type TelegramLinkRow,
} from '@/db/schema';
import type { AgentPrincipal } from './agents';
import { authenticateAgentKey, getAgent } from './agents';
import { requireHumanOwner, requireUser } from './auth';
import { safeEqualString, sha256, tokenPrefix } from './crypto';
import { HttpError, isUniqueViolation } from './errors';
import { bearerToken } from './http';
import { insertMessageWithWake } from './message-insert';
import { consumeKeyedRateLimit } from './rate-limit';
import { answerTelegramCallback, sendTelegramText, type InlineButton } from './telegram-api';
import { afterWakeDelivery } from './wake-after';

/**
 * Telegram channel. One shared Valetto bot; each agent gets a connect link https://t.me/<bot>?start=<code>.
 *
 * - The owner issues the link from the dashboard. Only sha256(code) is stored. Revoking (or replacing) a link
 *   disconnects every chat that joined through it.
 * - Telegram allows one private chat per user per bot, so a private chat links many agents: /start <code> adds one,
 *   /stop <name> removes one, /stop removes all, /agents lists them. A group links exactly one agent (/start or
 *   /link <code>) and everything the bot sees there goes to it.
 * - Private-chat routing: a Telegram reply to an agent's message goes to that agent (in_reply_to set); else a leading
 *   @name; else the only agent; else the last one used; else inline buttons to pick.
 * - Text becomes a normal Valetto message to the agent (insertMessageWithWake, the same path as
 *   send_message), sent by the workspace's hidden `telegram` agent. The Telegram sender (display name and user id,
 *   never a phone number) is kept in telegram_messages and shown as external_sender.
 * - A send_message whose in_reply_to names one of those messages is sent to the chat as "<agent>: <text>".
 *
 * Off unless TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and TELEGRAM_BOT_USERNAME are all set: the webhook and the
 * link routes answer 404.
 */

export const TELEGRAM_LINK_CODE_PREFIX = 'vtg_';
/** Telegram start parameters: at most 64 of A-Z a-z 0-9 _ -. vtg_ + 43 base64url characters (256 bits). */
const LINK_CODE_RE = /^vtg_[A-Za-z0-9_-]{43}$/;
export const TELEGRAM_SENDER_NAME = 'telegram';
export const TELEGRAM_SENDER_ROLE = 'telegram_sender';
/** Updates per chat per window. Above it the chat gets one short "slow down" reply per update and nothing is passed on. */
export const TELEGRAM_CHAT_RATE = { limit: 20, windowMs: 60_000 } as const;
const RATE_KIND = 'telegramChat';
/** update_ids are kept this long. Telegram retries for far less. */
const UPDATE_RETENTION = '7 days';

export type TelegramConfig = { token: string; secret: string; username: string };

/** The three env vars, or null when any is missing (the feature is off). */
export function telegramConfig(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '');
  if (!token || !secret || !username) return null;
  return { token, secret, username };
}

export function telegramEnabled(): boolean {
  return telegramConfig() !== null;
}

function requireTelegramConfig(): TelegramConfig {
  const config = telegramConfig();
  if (!config) throw new HttpError(404, 'not_found', 'Not found.');
  return config;
}

export function telegramConnectUrl(username: string, code: string): string {
  return `https://t.me/${encodeURIComponent(username)}?start=${code}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Connect links (dashboard)

export type TelegramSubject = { workspaceId: string; agentId: string };

export function serializeTelegramLink(row: TelegramLinkRow, chats?: number) {
  return {
    id: row.id,
    agent_id: row.agentId,
    prefix: row.codePrefix,
    created_at: row.createdAt.toISOString(),
    revoked_at: row.revokedAt?.toISOString() ?? null,
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
    status: row.revokedAt ? ('revoked' as const) : ('active' as const),
    ...(chats !== undefined ? { connected_chats: chats } : {}),
  };
}

function newCode(): string {
  return `${TELEGRAM_LINK_CODE_PREFIX}${randomBytes(32).toString('base64url')}`;
}

async function insertLink(tx: Db, subject: TelegramSubject, code: string): Promise<TelegramLinkRow> {
  const [row] = await tx
    .insert(telegramLinks)
    .values({ workspaceId: subject.workspaceId, agentId: subject.agentId, codeHash: sha256(code), codePrefix: tokenPrefix(code) })
    .returning();
  if (!row) throw new HttpError(500, 'internal_error', 'Something went wrong.');
  return row;
}

/** A new active link. 409 telegram_link_exists while one is active: replace or revoke it first. */
export async function issueTelegramLink(subject: TelegramSubject): Promise<{ row: TelegramLinkRow; url: string }> {
  const config = requireTelegramConfig();
  const code = newCode();
  try {
    const row = await insertLink(getDb(), subject, code);
    return { row, url: telegramConnectUrl(config.username, code) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, 'telegram_link_exists', 'This agent already has a Telegram link. Get a new one or turn it off first.');
    }
    throw err;
  }
}

export async function listTelegramLinks(subject: TelegramSubject) {
  requireTelegramConfig();
  const db = getDb();
  const rows = await db
    .select()
    .from(telegramLinks)
    .where(and(eq(telegramLinks.workspaceId, subject.workspaceId), eq(telegramLinks.agentId, subject.agentId)))
    .orderBy(desc(telegramLinks.createdAt))
    .limit(50);
  const active = rows.find((row) => !row.revokedAt);
  const chats = active ? await countChats(db, active.id) : 0;
  return rows.map((row) => serializeTelegramLink(row, row === active ? chats : 0));
}

async function countChats(db: Db, linkId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(telegramChats)
    .where(eq(telegramChats.linkId, linkId));
  return Number(row?.n ?? 0);
}

function linkWhere(subject: TelegramSubject, linkId: string) {
  return and(eq(telegramLinks.id, linkId), eq(telegramLinks.workspaceId, subject.workspaceId), eq(telegramLinks.agentId, subject.agentId));
}

/** Revokes a link and disconnects its chats. Idempotent. 404 when it is not the subject's. */
export async function revokeTelegramLink(subject: TelegramSubject, linkId: string): Promise<TelegramLinkRow> {
  requireTelegramConfig();
  return getDb().transaction(async (tx) => {
    const [existing] = await tx.select().from(telegramLinks).where(linkWhere(subject, linkId)).limit(1).for('update');
    if (!existing) throw new HttpError(404, 'not_found', 'No Telegram link was found.');
    await tx.delete(telegramChats).where(eq(telegramChats.linkId, existing.id));
    if (existing.revokedAt) return existing;
    const [revoked] = await tx.update(telegramLinks).set({ revokedAt: new Date() }).where(eq(telegramLinks.id, existing.id)).returning();
    return revoked ?? existing;
  });
}

/** Revokes an active link (disconnecting its chats) and issues its replacement in one transaction. */
export async function rotateTelegramLink(
  subject: TelegramSubject,
  linkId: string,
): Promise<{ row: TelegramLinkRow; url: string; revoked: TelegramLinkRow }> {
  const config = requireTelegramConfig();
  const code = newCode();
  return getDb().transaction(async (tx) => {
    const [existing] = await tx.select().from(telegramLinks).where(linkWhere(subject, linkId)).limit(1).for('update');
    if (!existing) throw new HttpError(404, 'not_found', 'No Telegram link was found.');
    if (existing.revokedAt) throw new HttpError(409, 'telegram_link_not_active', 'Only an active Telegram link can be replaced.');
    await tx.delete(telegramChats).where(eq(telegramChats.linkId, existing.id));
    const [revoked] = await tx.update(telegramLinks).set({ revokedAt: new Date() }).where(eq(telegramLinks.id, existing.id)).returning();
    const row = await insertLink(tx, subject, code);
    return { row, url: telegramConnectUrl(config.username, code), revoked: revoked ?? existing };
  });
}

/**
 * Who may manage an agent's Telegram link. Issuing or replacing one makes a new way for anyone to message the agent,
 * so only a signed-in owner may (dashboard session); an agent key or connected app gets 403 human_required. Listing
 * and revoking also accept the agent's own rsk_ key, so an agent can turn off a leaked link without a human.
 */
export async function requireTelegramLinkOwner(req: Request, agentId: string, options: { issue: boolean }): Promise<TelegramSubject> {
  requireTelegramConfig();
  const token = bearerToken(req);
  let workspaceId: string;
  if (options.issue) {
    workspaceId = (await requireHumanOwner(req, 'Only the owner can create a Telegram link, from the dashboard.')).workspace.id;
  } else if (token?.startsWith('rsoa_')) {
    throw new HttpError(403, 'human_required', 'Connected apps cannot manage Telegram links. Use the agent key or the dashboard.');
  } else if (token?.startsWith('rsk_')) {
    const principal = await authenticateAgentKey(token);
    if (!principal) throw new HttpError(401, 'unauthorized', 'Agent key rejected.');
    if (principal.externalGuest || principal.agentId !== agentId) throw new HttpError(404, 'not_found', 'No agent was found.');
    workspaceId = principal.workspaceId;
  } else {
    workspaceId = (await requireUser(req)).workspace.id;
  }
  const agent = await getAgent(workspaceId, agentId);
  if (options.issue && agent.revokedAt) throw new HttpError(409, 'agent_revoked', 'This agent has been revoked.');
  return { workspaceId, agentId: agent.id };
}

// ---------------------------------------------------------------------------------------------------------------
// Hidden sender agent

/** The workspace's hidden keyless `telegram` agent. Locks the workspace only when it has to create it. */
export async function ensureTelegramSender(tx: Db, workspaceId: string): Promise<AgentRow> {
  const find = async () => {
    const [row] = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.workspaceId, workspaceId), eq(agents.role, TELEGRAM_SENDER_ROLE), isNull(agents.revokedAt)))
      .limit(1);
    return row ?? null;
  };
  const existing = await find();
  if (existing) return existing;
  await tx.execute(sql`select id from workspaces where id = ${workspaceId} for update`);
  const again = await find();
  if (again) return again;
  let name = TELEGRAM_SENDER_NAME;
  const [taken] = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.name, name)))
    .limit(1);
  if (taken) name = `${TELEGRAM_SENDER_NAME}-${randomBytes(4).toString('hex')}`;
  const [created] = await tx
    .insert(agents)
    .values({ workspaceId, name, role: TELEGRAM_SENDER_ROLE, deliveryMode: 'none' })
    .returning();
  if (!created) throw new HttpError(500, 'internal_error', 'Something went wrong.');
  return created;
}

// ---------------------------------------------------------------------------------------------------------------
// External sender shown on inbox messages

export type ExternalSender = { channel: 'telegram'; name: string; telegram_user_id: number | null };

/** external_sender for the given messages that came in from Telegram. Call only for rows sent by a telegram_sender. */
export async function telegramSendersFor(db: Db, messageIds: string[]): Promise<Map<string, ExternalSender>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select({ id: telegramMessages.messageId, name: telegramMessages.displayName, userId: telegramMessages.telegramUserId })
    .from(telegramMessages)
    .where(and(inArray(telegramMessages.messageId, messageIds), eq(telegramMessages.direction, 'in')));
  return new Map(
    rows.map((row) => [row.id, { channel: 'telegram' as const, name: row.name ?? 'Telegram user', telegram_user_id: row.userId ?? null }]),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Outbound: an agent's reply to a Telegram message

export type TelegramReplyTarget = { chatId: number; senderAgent: AgentRow };

const DISCONNECTED_MESSAGE = 'That Telegram chat is no longer connected to you, so the reply was not sent.';

/**
 * When `original` came in from Telegram, the chat a reply to it goes to. Null for any other message. 409 when the chat
 * no longer links the caller (or the feature is off), so the reply is never stored as sent.
 */
export async function telegramReplyTarget(tx: Db, caller: AgentPrincipal, original: MessageRow): Promise<TelegramReplyTarget | null> {
  const [sender] = await tx.select().from(agents).where(eq(agents.id, original.fromAgentId)).limit(1);
  if (!sender || sender.role !== TELEGRAM_SENDER_ROLE) return null;
  const disconnected = new HttpError(409, 'telegram_chat_disconnected', DISCONNECTED_MESSAGE);
  if (!telegramEnabled()) throw disconnected;
  const [origin] = await tx
    .select({ chatId: telegramMessages.chatId })
    .from(telegramMessages)
    .where(and(eq(telegramMessages.messageId, original.id), eq(telegramMessages.direction, 'in')))
    .limit(1);
  if (!origin) throw disconnected;
  const [binding] = await tx
    .select({ chatId: telegramChats.chatId })
    .from(telegramChats)
    .innerJoin(telegramLinks, eq(telegramLinks.id, telegramChats.linkId))
    .where(and(eq(telegramChats.chatId, origin.chatId), eq(telegramChats.agentId, caller.agentId), isNull(telegramLinks.revokedAt)))
    .limit(1);
  if (!binding) throw disconnected;
  return { chatId: origin.chatId, senderAgent: sender };
}

/** Stores the agent's reply (from the agent to the hidden telegram agent) and marks it outbound to the chat. */
export async function recordTelegramReply(
  tx: Db,
  caller: AgentPrincipal,
  target: TelegramReplyTarget,
  input: { body: string; inReplyTo: string },
): Promise<MessageRow> {
  const { message } = await insertMessageWithWake(tx, {
    workspaceId: caller.workspaceId,
    fromAgentId: caller.agentId,
    toAgentId: target.senderAgent.id,
    body: input.body,
    inReplyTo: input.inReplyTo,
  });
  await tx.insert(telegramMessages).values({ messageId: message.id, chatId: target.chatId, direction: 'out' });
  return message;
}

/**
 * After commit: send the reply to the chat as "<agent>: <text>", split to Telegram's limit, and remember each Telegram
 * message id the bot sent, so a Telegram reply to any part goes back to this agent. Never throws.
 */
export async function deliverTelegramReply(input: {
  chatId: number;
  agentId: string;
  agentName: string;
  messageId: string;
  body: string;
}): Promise<{ delivered: boolean; parts: number }> {
  const config = telegramConfig();
  if (!config) return { delivered: false, parts: 0 };
  try {
    const result = await sendTelegramText(config.token, input.chatId, input.body, { prefix: `${input.agentName}: ` });
    await rememberSent(input.chatId, input.agentId, input.messageId, result.messageIds);
    return { delivered: result.ok, parts: result.total };
  } catch (err) {
    console.error('telegram reply failed', err instanceof Error ? err.name : 'error');
    return { delivered: false, parts: 0 };
  }
}

async function rememberSent(chatId: number, agentId: string, messageId: string, telegramIds: number[]): Promise<void> {
  if (telegramIds.length === 0) return;
  await getDb()
    .insert(telegramSent)
    .values(telegramIds.map((telegramMessageId) => ({ chatId, telegramMessageId, agentId, messageId })))
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------------------------------------------
// Inbound: the webhook

type TelegramUser = { id?: unknown; is_bot?: unknown; first_name?: unknown; last_name?: unknown };
type TelegramChat = { id?: unknown; type?: unknown };
type TelegramMessage = {
  message_id?: unknown;
  from?: TelegramUser;
  chat?: TelegramChat;
  text?: unknown;
  reply_to_message?: { message_id?: unknown; from?: TelegramUser };
};
type TelegramCallbackQuery = { id?: unknown; from?: TelegramUser; data?: unknown; message?: TelegramMessage };
export type TelegramUpdate = { update_id?: unknown; message?: TelegramMessage; callback_query?: TelegramCallbackQuery };

const list = (names: string[]) => names.join(', ');
const NOT_CONNECTED = 'No agents are linked to this chat. Open the Telegram link that an agent’s owner gave you.';

export const TELEGRAM_COPY = {
  help: 'Hi! This bot passes your messages to AI agents on Valetto. To start, open the Telegram link that an agent’s owner gave you.',
  helpLinked: (names: string[]) =>
    `You can talk to: ${list(names)}. Start a message with @name to pick one, or reply to one of its messages. Send /agents to see them and /stop name to remove one.`,
  badLink: 'That link no longer works. Ask the agent’s owner for a new one.',
  added: (name: string, names: string[]) => `Added ${name}. You can now talk to: ${list(names)}.`,
  groupBound: (name: string) =>
    `This group is now connected to ${name}. Messages the bot can see here go to ${name}. Send /stop to disconnect.`,
  agents: (names: string[]) => `You can talk to: ${list(names)}.`,
  removed: (name: string, names: string[]) =>
    names.length ? `Removed ${name}. You can still talk to: ${list(names)}.` : `Removed ${name}. No agents are linked to this chat now.`,
  removedAll: 'Disconnected. Your messages no longer go to any agent here.',
  noSuchAgent: (name: string, names: string[]) =>
    names.length ? `No linked agent is called ${name}. You can talk to: ${list(names)}.` : NOT_CONNECTED,
  notConnected: NOT_CONNECTED,
  unavailable: 'The agent for this group is no longer available, so the group has been disconnected.',
  pick: 'Who should get this message?',
  emptyAfterName: (name: string) => `Add your message after @${name}.`,
  textOnly: 'Only text messages are passed on. Please send your message as text.',
  slowDown: 'You’re sending messages too fast. Wait a minute, then try again.',
  expired: 'That message has expired. Please send it again.',
  sentTo: (name: string) => `Sent to ${name}.`,
} as const;

function intOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function displayNameOf(user: TelegramUser | undefined): string | null {
  if (!user) return null;
  const parts = [user.first_name, user.last_name].filter((part): part is string => typeof part === 'string' && part.trim() !== '');
  const name = parts.join(' ').trim().slice(0, 128);
  return name || null;
}

/** "/start abc", "/start@ValettoBot abc" → { command: "start", bot: "ValettoBot", arg: "abc" }. Null for plain text. */
export function parseCommand(text: string): { command: string; bot: string | null; arg: string } | null {
  const match = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{1,64}))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  return { command: match[1]!.toLowerCase(), bot: match[2] ?? null, arg: (match[3] ?? '').trim() };
}

/** "@karim-codex: hi" → { name: "karim-codex", rest: "hi" }. */
export function parseMention(text: string): { name: string; rest: string } | null {
  const match = /^\s*@([A-Za-z][A-Za-z0-9_-]{0,63})(?:[\s:,]+|$)([\s\S]*)$/.exec(text);
  if (!match) return null;
  return { name: match[1]!, rest: match[2]!.trim() };
}

function uuidToB64(id: string): string {
  return Buffer.from(id.replace(/-/g, ''), 'hex').toString('base64url');
}

function b64ToUuid(value: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) return null;
  const hex = Buffer.from(value, 'base64url').toString('hex');
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Inline button payload: p:<pending id>:<agent id>, both base64url, 47 bytes (Telegram allows 64). */
export function pickerData(pendingId: string, agentId: string): string {
  return `p:${uuidToB64(pendingId)}:${uuidToB64(agentId)}`;
}

function parsePickerData(data: string): { pendingId: string; agentId: string } | null {
  const match = /^p:([A-Za-z0-9_-]{22}):([A-Za-z0-9_-]{22})$/.exec(data);
  if (!match) return null;
  const pendingId = b64ToUuid(match[1]!);
  const agentId = b64ToUuid(match[2]!);
  return pendingId && agentId ? { pendingId, agentId } : null;
}

type ChatKind = 'private' | 'group';
type Send = { text: string; buttons?: InlineButton[][] };
export type TelegramOutcome = {
  status: string;
  chatId: number | null;
  sends: Send[];
  wakeIds: string[];
  messageId?: string;
  callback?: { id: string; text?: string };
};

type Linked = { agent: AgentRow; linkId: string; lastUsedAt: Date | null; boundAt: Date };

/** Agents this chat can use, oldest link first. Rows whose agent or link was revoked are deleted on the way. */
async function linkedAgents(tx: Db, chatId: number): Promise<Linked[]> {
  const rows = await tx
    .select({ chat: telegramChats, agent: agents, linkRevokedAt: telegramLinks.revokedAt })
    .from(telegramChats)
    .innerJoin(agents, eq(agents.id, telegramChats.agentId))
    .innerJoin(telegramLinks, eq(telegramLinks.id, telegramChats.linkId))
    .where(eq(telegramChats.chatId, chatId))
    .orderBy(telegramChats.boundAt);
  const stale = rows.filter((row) => row.agent.revokedAt || row.agent.role !== 'agent' || row.linkRevokedAt);
  if (stale.length) {
    await tx.delete(telegramChats).where(
      and(
        eq(telegramChats.chatId, chatId),
        inArray(
          telegramChats.agentId,
          stale.map((row) => row.agent.id),
        ),
      ),
    );
  }
  return rows
    .filter((row) => !stale.includes(row))
    .map((row) => ({ agent: row.agent, linkId: row.chat.linkId, lastUsedAt: row.chat.lastUsedAt, boundAt: row.chat.boundAt }));
}

const names = (linked: Linked[]) => linked.map((row) => row.agent.name);

async function linkAgent(tx: Db, chatId: number, kind: ChatKind, code: string, user: TelegramUser | undefined): Promise<Send> {
  if (!LINK_CODE_RE.test(code)) return { text: TELEGRAM_COPY.badLink };
  const [hit] = await tx
    .select({ link: telegramLinks, agent: agents })
    .from(telegramLinks)
    .innerJoin(agents, eq(agents.id, telegramLinks.agentId))
    .where(eq(telegramLinks.codeHash, sha256(code)))
    .limit(1);
  if (!hit || hit.link.revokedAt || hit.agent.revokedAt || hit.agent.role !== 'agent') return { text: TELEGRAM_COPY.badLink };
  // A group talks to exactly one agent: linking another replaces it.
  if (kind === 'group') await tx.delete(telegramChats).where(eq(telegramChats.chatId, chatId));
  const values = {
    chatId,
    agentId: hit.agent.id,
    workspaceId: hit.agent.workspaceId,
    linkId: hit.link.id,
    chatType: kind,
    telegramUserId: intOf(user?.id),
    displayName: displayNameOf(user),
    boundAt: new Date(),
  };
  await tx
    .insert(telegramChats)
    .values(values)
    .onConflictDoUpdate({
      target: [telegramChats.chatId, telegramChats.agentId],
      set: { linkId: values.linkId, chatType: kind, telegramUserId: values.telegramUserId, displayName: values.displayName },
    });
  await tx.update(telegramLinks).set({ lastUsedAt: new Date() }).where(eq(telegramLinks.id, hit.link.id));
  if (kind === 'group') return { text: TELEGRAM_COPY.groupBound(hit.agent.name) };
  return { text: TELEGRAM_COPY.added(hit.agent.name, names(await linkedAgents(tx, chatId))) };
}

/** Passes text to one agent: the same message write as send_message, from the workspace's hidden telegram agent. */
async function relay(
  tx: Db,
  chatId: number,
  target: AgentRow,
  body: string,
  sender: { userId: number | null; name: string | null },
  inReplyTo: string | null,
): Promise<{ messageId: string; wakeId: string | null }> {
  const from = await ensureTelegramSender(tx, target.workspaceId);
  const { message, wakeId } = await insertMessageWithWake(tx, {
    workspaceId: target.workspaceId,
    fromAgentId: from.id,
    toAgentId: target.id,
    body,
    inReplyTo,
  });
  await tx.insert(telegramMessages).values({
    messageId: message.id,
    chatId,
    direction: 'in',
    telegramUserId: sender.userId,
    displayName: sender.name,
  });
  await tx
    .update(telegramChats)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(telegramChats.chatId, chatId), eq(telegramChats.agentId, target.id)));
  return { messageId: message.id, wakeId };
}

/** The bot message a Telegram reply points at, when it carried an agent's reply in this chat. */
async function repliedTo(tx: Db, chatId: number, message: TelegramMessage): Promise<{ agentId: string; messageId: string } | null> {
  const replyId = intOf(message.reply_to_message?.message_id);
  if (replyId === null || message.reply_to_message?.from?.is_bot !== true) return null;
  const [row] = await tx
    .select({ agentId: telegramSent.agentId, messageId: telegramSent.messageId })
    .from(telegramSent)
    .where(and(eq(telegramSent.chatId, chatId), eq(telegramSent.telegramMessageId, replyId)))
    .limit(1);
  return row ?? null;
}

function pickerButtons(pendingId: string, linked: Linked[]): InlineButton[][] {
  return linked.map((row) => [{ text: row.agent.name, callback_data: pickerData(pendingId, row.agent.id) }]);
}

async function routeText(
  tx: Db,
  chatId: number,
  kind: ChatKind,
  message: TelegramMessage,
  text: string,
  botUsername: string,
): Promise<TelegramOutcome> {
  const out = (status: string, sends: Send[] = []): TelegramOutcome => ({ status, chatId, sends, wakeIds: [] });
  const linked = await linkedAgents(tx, chatId);
  const sender = { userId: intOf(message.from?.id), name: displayNameOf(message.from) };
  const reply = await repliedTo(tx, chatId, message);

  if (kind === 'group') {
    const target = linked[0];
    if (!target) return out('not_connected');
    let body = text;
    const mention = parseMention(body);
    if (mention && mention.name.toLowerCase() === botUsername.toLowerCase()) body = mention.rest;
    if (!body) return out('empty');
    const inReplyTo = reply && reply.agentId === target.agent.id ? reply.messageId : null;
    const sent = await relay(tx, chatId, target.agent, body, sender, inReplyTo);
    return { ...out('relayed'), messageId: sent.messageId, wakeIds: [sent.wakeId].filter((id): id is string => !!id) };
  }

  if (linked.length === 0) return out('not_connected', [{ text: TELEGRAM_COPY.notConnected }]);
  const send = async (target: Linked, body: string, inReplyTo: string | null): Promise<TelegramOutcome> => {
    const sent = await relay(tx, chatId, target.agent, body, sender, inReplyTo);
    return { ...out('relayed'), messageId: sent.messageId, wakeIds: [sent.wakeId].filter((id): id is string => !!id) };
  };

  // 1. A Telegram reply to an agent's message goes back to that agent, linked to that Valetto message.
  if (reply) {
    const target = linked.find((row) => row.agent.id === reply.agentId);
    if (target) return send(target, text, reply.messageId);
  }
  // 2. @name at the start picks a linked agent; the prefix is removed.
  const mention = parseMention(text);
  if (mention) {
    const target = linked.find((row) => row.agent.name.toLowerCase() === mention.name.toLowerCase());
    if (target) {
      if (!mention.rest) return out('empty', [{ text: TELEGRAM_COPY.emptyAfterName(target.agent.name) }]);
      return send(target, mention.rest, null);
    }
  }
  // 3. Only one agent: it.
  if (linked.length === 1) return send(linked[0]!, text, null);
  // 4. The agent this chat used last.
  const last = linked
    .filter((row) => row.lastUsedAt)
    .sort((a, b) => b.lastUsedAt!.getTime() - a.lastUsedAt!.getTime())[0];
  if (last) return send(last, text, null);
  // 5. Ask, with a button per agent. The text waits in telegram_pending.
  await tx.delete(telegramPending).where(sql`${telegramPending.createdAt} < now() - ${PENDING_RETENTION}::interval`);
  const [pending] = await tx
    .insert(telegramPending)
    .values({ chatId, body: text, telegramUserId: sender.userId, displayName: sender.name })
    .returning();
  if (!pending) throw new HttpError(500, 'internal_error', 'Something went wrong.');
  return out('pick', [{ text: TELEGRAM_COPY.pick, buttons: pickerButtons(pending.id, linked) }]);
}

const PENDING_RETENTION = '1 day';

async function handleCallback(tx: Db, query: TelegramCallbackQuery): Promise<TelegramOutcome> {
  const callbackId = typeof query.id === 'string' ? query.id : null;
  const chatId = intOf(query.message?.chat?.id);
  const base: TelegramOutcome = { status: 'ignored', chatId, sends: [], wakeIds: [] };
  if (!callbackId) return base;
  const done = (status: string, text?: string): TelegramOutcome => ({ ...base, status, callback: { id: callbackId, text } });
  const parsed = typeof query.data === 'string' ? parsePickerData(query.data) : null;
  if (!parsed || chatId === null) return done('ignored');
  const [pending] = await tx
    .select()
    .from(telegramPending)
    .where(and(eq(telegramPending.id, parsed.pendingId), eq(telegramPending.chatId, chatId)))
    .limit(1)
    .for('update');
  if (!pending) return done('expired', TELEGRAM_COPY.expired);
  const target = (await linkedAgents(tx, chatId)).find((row) => row.agent.id === parsed.agentId);
  if (!target) return done('expired', TELEGRAM_COPY.expired);
  const sent = await relay(
    tx,
    chatId,
    target.agent,
    pending.body,
    { userId: pending.telegramUserId, name: pending.displayName },
    null,
  );
  await tx.delete(telegramPending).where(eq(telegramPending.id, pending.id));
  return {
    ...done('relayed', TELEGRAM_COPY.sentTo(target.agent.name)),
    messageId: sent.messageId,
    wakeIds: [sent.wakeId].filter((id): id is string => !!id),
  };
}

async function handleCommand(
  tx: Db,
  chatId: number,
  kind: ChatKind,
  command: { command: string; arg: string },
  message: TelegramMessage,
): Promise<TelegramOutcome | null> {
  const out = (status: string, text: string): TelegramOutcome => ({ status, chatId, sends: [{ text }], wakeIds: [] });
  switch (command.command) {
    case 'start':
    case 'link': {
      if (command.arg) {
        const sent = await linkAgent(tx, chatId, kind, command.arg, message.from);
        return { status: 'link', chatId, sends: [sent], wakeIds: [] };
      }
      const linked = await linkedAgents(tx, chatId);
      return out('help', linked.length ? TELEGRAM_COPY.helpLinked(names(linked)) : TELEGRAM_COPY.help);
    }
    case 'help': {
      const linked = await linkedAgents(tx, chatId);
      return out('help', linked.length ? TELEGRAM_COPY.helpLinked(names(linked)) : TELEGRAM_COPY.help);
    }
    case 'agents': {
      const linked = await linkedAgents(tx, chatId);
      return out('agents', linked.length ? TELEGRAM_COPY.agents(names(linked)) : TELEGRAM_COPY.notConnected);
    }
    case 'stop': {
      const linked = await linkedAgents(tx, chatId);
      if (!linked.length) return out('not_connected', TELEGRAM_COPY.notConnected);
      const wanted = command.arg.replace(/^@/, '').trim();
      if (!wanted || kind === 'group') {
        await tx.delete(telegramChats).where(eq(telegramChats.chatId, chatId));
        return out('unbound', TELEGRAM_COPY.removedAll);
      }
      const target = linked.find((row) => row.agent.name.toLowerCase() === wanted.toLowerCase());
      if (!target) return out('not_found', TELEGRAM_COPY.noSuchAgent(wanted, names(linked)));
      await tx.delete(telegramChats).where(and(eq(telegramChats.chatId, chatId), eq(telegramChats.agentId, target.agent.id)));
      return out(
        'unbound',
        TELEGRAM_COPY.removed(
          target.agent.name,
          names(linked.filter((row) => row !== target)),
        ),
      );
    }
    default:
      return null;
  }
}

/** Handles one update inside a transaction that also records its update_id. Exported for tests. */
export async function processTelegramUpdate(update: TelegramUpdate, botUsername = telegramConfig()?.username ?? ''): Promise<TelegramOutcome> {
  const none = (status: string): TelegramOutcome => ({ status, chatId: null, sends: [], wakeIds: [] });
  const updateId = intOf(update.update_id);
  if (updateId === null) return none('ignored');
  return getDb().transaction(async (tx) => {
    await tx.delete(telegramUpdates).where(sql`${telegramUpdates.receivedAt} < now() - ${UPDATE_RETENTION}::interval`);
    const fresh = await tx.insert(telegramUpdates).values({ updateId }).onConflictDoNothing().returning({ id: telegramUpdates.updateId });
    if (fresh.length === 0) return none('duplicate');

    const rateLimited = async (chatId: number) =>
      (
        await consumeKeyedRateLimit(tx, {
          kind: RATE_KIND,
          key: String(chatId),
          limit: TELEGRAM_CHAT_RATE.limit,
          windowMs: TELEGRAM_CHAT_RATE.windowMs,
        })
      ).limited;

    if (update.callback_query) {
      const chatId = intOf(update.callback_query.message?.chat?.id);
      if (chatId !== null && (await rateLimited(chatId))) {
        const id = typeof update.callback_query.id === 'string' ? update.callback_query.id : null;
        return { status: 'rate_limited', chatId, sends: [], wakeIds: [], ...(id ? { callback: { id, text: TELEGRAM_COPY.slowDown } } : {}) };
      }
      return handleCallback(tx, update.callback_query);
    }

    const message = update.message;
    const chatId = intOf(message?.chat?.id);
    if (!message || chatId === null || message.from?.is_bot === true) return none('ignored');
    const type = message.chat?.type;
    const kind: ChatKind | null = type === 'private' ? 'private' : type === 'group' || type === 'supergroup' ? 'group' : null;
    if (!kind) return none('ignored');
    const text = typeof message.text === 'string' ? message.text : '';
    const command = text ? parseCommand(text) : null;
    // In a group, a command for another bot is not ours.
    if (command?.bot && command.bot.toLowerCase() !== botUsername.toLowerCase()) return none('ignored');

    if (kind === 'group' && !command) {
      // With privacy mode off the bot sees every group message. An unlinked group's chatter writes nothing.
      const [any] = await tx.select({ id: telegramChats.agentId }).from(telegramChats).where(eq(telegramChats.chatId, chatId)).limit(1);
      if (!any) return none('ignored');
    }
    const reply = (status: string, value: string): TelegramOutcome => ({ status, chatId, sends: [{ text: value }], wakeIds: [] });
    if (await rateLimited(chatId)) return reply('rate_limited', TELEGRAM_COPY.slowDown);
    if (!text.trim()) return kind === 'private' ? reply('not_text', TELEGRAM_COPY.textOnly) : none('ignored');

    if (command) {
      const handled = await handleCommand(tx, chatId, kind, command, message);
      if (handled) return handled;
    }
    const routed = await routeText(tx, chatId, kind, message, text, botUsername);
    if (kind === 'group' && routed.status === 'not_connected') {
      // The group's agent was revoked since it was linked.
      return reply('unavailable', TELEGRAM_COPY.unavailable);
    }
    return routed;
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * POST /api/telegram/webhook. 404 while the feature is off. 401 without the right X-Telegram-Bot-Api-Secret-Token
 * (constant-time compare). Anything we do not act on still gets 200, so Telegram does not retry it. A database error
 * gives 500 and nothing is recorded, so Telegram's retry is processed.
 */
export async function handleTelegramWebhook(req: Request): Promise<Response> {
  const config = telegramConfig();
  if (!config) return jsonResponse(404, { error: { code: 'not_found', message: 'Not found.' } });
  const given = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!safeEqualString(given, config.secret)) {
    return jsonResponse(401, { error: { code: 'unauthorized', message: 'Unauthorized.' } });
  }
  let update: TelegramUpdate;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return jsonResponse(200, { ok: true, status: 'ignored' });
    update = parsed as TelegramUpdate;
  } catch {
    return jsonResponse(200, { ok: true, status: 'ignored' });
  }
  const outcome = await processTelegramUpdate(update, config.username);
  if (outcome.callback) await answerTelegramCallback(config.token, outcome.callback.id, outcome.callback.text);
  if (outcome.chatId !== null) {
    for (const send of outcome.sends) await sendTelegramText(config.token, outcome.chatId, send.text, { buttons: send.buttons });
  }
  for (const wakeId of outcome.wakeIds) await afterWakeDelivery(wakeId);
  return jsonResponse(200, { ok: true, status: outcome.status });
}
