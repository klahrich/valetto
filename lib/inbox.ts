import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb, type Db } from '@/db';
import { agents, messages, type MessageRow } from '@/db/schema';
import { authenticateAgentKey, type AgentPrincipal } from './agents';
import { keyedHash, safeEqualHex } from './crypto';
import { EXTERNAL_GUEST_DENIED } from './external-guest';
import { HttpError } from './errors';
import { bearerToken } from './http';
import { TELEGRAM_SENDER_ROLE, telegramSendersFor, type ExternalSender } from './telegram';

/** Default page size for list_messages. */
export const MESSAGE_LIST_DEFAULT = 50;
/** Most messages one list or mark call accepts. */
export const MESSAGE_LIST_MAX = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Identity values are positive and written without leading zeros, so the sealed cursor is stable. */
const SEQ_RE = /^[1-9]\d*$/;
const CURSOR_PURPOSE = 'message-inbox-cursor';

type PageCursor = { a: string; s: string; id: string; u: 0 | 1 };

export type InboxMessage = {
  id: string;
  from: string;
  to: string;
  from_agent_id: string;
  to_agent_id: string;
  body: string;
  task_id: null;
  in_reply_to: string | null;
  created_at: string;
  unread: boolean;
  read_at: string | null;
  /** Present only when a person outside Valetto sent it, for example through Telegram. */
  external_sender?: ExternalSender;
};

function invalidCursor(): HttpError {
  return new HttpError(
    400,
    'validation_error',
    'cursor is not valid. Pass next_cursor from the previous page unchanged, with the same unread flag. unread_cursor is the read watermark, not a page cursor.',
    { fields: { cursor: 'Invalid cursor.' } },
  );
}

function seal(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${keyedHash(CURSOR_PURPOSE, body)}`;
}

function open(token: string): unknown {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) throw invalidCursor();
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!safeEqualHex(mac, keyedHash(CURSOR_PURPOSE, body))) throw invalidCursor();
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw invalidCursor();
  }
}

function encodePage(cursor: PageCursor): string {
  return seal({ v: 1, k: 'page', a: cursor.a, s: cursor.s, id: cursor.id, u: cursor.u });
}

function encodeUnread(cursor: { a: string; s: string; id: string }): string {
  return seal({ v: 1, k: 'unread', a: cursor.a, s: cursor.s, id: cursor.id });
}

/**
 * Page cursor only. A token sealed as the unread watermark, a cursor for another agent, or any edited byte
 * is rejected. The unread flag is part of the seal so a page of all messages cannot be resumed as unread-only,
 * which would skip rows the first page already passed.
 */
function parsePageCursor(value: string, caller: AgentPrincipal, unread: boolean): PageCursor {
  const parsed = open(value);
  if (!parsed || typeof parsed !== 'object') throw invalidCursor();
  const row = parsed as Record<string, unknown>;
  if (
    row.v !== 1 ||
    row.k !== 'page' ||
    row.a !== caller.agentId ||
    typeof row.s !== 'string' ||
    !SEQ_RE.test(row.s) ||
    typeof row.id !== 'string' ||
    !UUID_RE.test(row.id) ||
    (row.u !== 0 && row.u !== 1) ||
    (row.u === 1) !== unread
  ) {
    throw invalidCursor();
  }
  return { a: caller.agentId, s: row.s, id: row.id.toLowerCase(), u: row.u };
}

function assertInboxCaller(caller: AgentPrincipal): void {
  // Invite-link guests see only the tasks the grant allows. The owner's inbox, and any standalone message,
  // stays behind the same fence as send_message. A normal agent in another workspace is a different principal.
  if (caller.externalGuest) throw new HttpError(403, 'insufficient_scope', EXTERNAL_GUEST_DENIED);
}

function pageLimit(value: number | undefined): number {
  if (value === undefined) return MESSAGE_LIST_DEFAULT;
  if (!Number.isInteger(value) || value < 1 || value > MESSAGE_LIST_MAX) {
    throw new HttpError(400, 'validation_error', `limit must be an integer from 1 to ${MESSAGE_LIST_MAX}.`, {
      fields: { limit: 'Invalid limit.' },
    });
  }
  return value;
}

function seqText(value: unknown): string {
  const text = typeof value === 'bigint' || typeof value === 'number' ? value.toString() : value;
  if (typeof text === 'string' && SEQ_RE.test(text)) return text;
  throw new HttpError(500, 'internal_error', 'Something went wrong.');
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(500, 'internal_error', 'Something went wrong.');
  return date.toISOString();
}

type InboxRow = { message: MessageRow; fromName: string; fromRole: string; toName: string };

/** Rows as InboxMessage, with external_sender for messages relayed from Telegram (looked up only when there are any). */
async function presentAll(db: Db, rows: InboxRow[]): Promise<InboxMessage[]> {
  const external = rows.filter((row) => row.fromRole === TELEGRAM_SENDER_ROLE).map((row) => row.message.id);
  const senders = external.length ? await telegramSendersFor(db, external) : new Map<string, ExternalSender>();
  return rows.map((row) => {
    const presented = present(row.message, row.fromName, row.toName);
    const sender = senders.get(row.message.id);
    return sender ? { ...presented, external_sender: sender } : presented;
  });
}

function present(message: MessageRow, fromName: string, toName: string): InboxMessage {
  const readAt = iso(message.readAt);
  return {
    id: message.id,
    from: fromName,
    to: toName,
    from_agent_id: message.fromAgentId,
    to_agent_id: message.toAgentId,
    body: message.body,
    task_id: null,
    in_reply_to: message.inReplyTo ?? null,
    created_at: iso(message.createdAt) ?? '',
    unread: readAt === null,
    read_at: readAt,
  };
}

const inboxWhere = (caller: AgentPrincipal) =>
  and(eq(messages.workspaceId, caller.workspaceId), eq(messages.toAgentId, caller.agentId), isNull(messages.taskId));

/** Oldest unread standalone message for this agent, or null when the inbox has none. Independent of the page. */
async function unreadCursor(db: Db, caller: AgentPrincipal): Promise<string | null> {
  const [row] = await db
    .select({ seq: sql<string>`${messages.inboxSeq}::text`, id: messages.id })
    .from(messages)
    .where(and(inboxWhere(caller), isNull(messages.readAt)))
    .orderBy(asc(messages.inboxSeq), asc(messages.id))
    .limit(1);
  if (!row) return null;
  return encodeUnread({ a: caller.agentId, s: seqText(row.seq), id: row.id });
}

/**
 * Inbox for the caller: standalone messages addressed to them, oldest arrival first.
 * `next_cursor` continues the page. `unread_cursor` is the read watermark (oldest unread), not a page token.
 * Listing does not mark anything and does not wake anyone.
 */
export async function listMessages(
  caller: AgentPrincipal,
  input: { cursor?: string | null; limit?: number; unread?: boolean } = {},
): Promise<{ messages: InboxMessage[]; next_cursor: string | null; unread_cursor: string | null }> {
  assertInboxCaller(caller);
  const unread = input.unread === true;
  const limit = pageLimit(input.limit);
  const cursor =
    input.cursor === undefined || input.cursor === null || input.cursor === ''
      ? undefined
      : parsePageCursor(input.cursor, caller, unread);
  const fromAgent = alias(agents, 'inbox_from');
  const toAgent = alias(agents, 'inbox_to');
  const conditions = [inboxWhere(caller)];
  if (unread) conditions.push(isNull(messages.readAt));
  if (cursor) {
    // Strictly after the last returned row. inbox_seq is taken under a lock held until the insert commits
    // (messages_assign_inbox_seq), so a higher number cannot be visible while a lower one is still uncommitted.
    conditions.push(sql`(${messages.inboxSeq}, ${messages.id}) > (${cursor.s}::bigint, ${cursor.id}::uuid)`);
  }
  const db = getDb();
  const fetched = await db
    .select({
      message: messages,
      fromName: fromAgent.name,
      fromRole: fromAgent.role,
      toName: toAgent.name,
      seq: sql<string>`${messages.inboxSeq}::text`,
    })
    .from(messages)
    .innerJoin(fromAgent, eq(fromAgent.id, messages.fromAgentId))
    .innerJoin(toAgent, eq(toAgent.id, messages.toAgentId))
    .where(and(...conditions))
    .orderBy(asc(messages.inboxSeq), asc(messages.id))
    .limit(limit + 1);
  const rows = fetched.slice(0, limit);
  const last = rows.at(-1);
  const nextCursor =
    fetched.length > limit && last
      ? encodePage({ a: caller.agentId, s: seqText(last.seq), id: last.message.id, u: unread ? 1 : 0 })
      : null;
  return {
    messages: await presentAll(db, rows),
    next_cursor: nextCursor,
    unread_cursor: await unreadCursor(db, caller),
  };
}

function uniqueIds(ids: string[]): string[] {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MESSAGE_LIST_MAX) {
    throw new HttpError(400, 'validation_error', `message_ids must be 1 to ${MESSAGE_LIST_MAX} ids.`, {
      fields: { message_ids: 'Invalid message ids.' },
    });
  }
  if (ids.some((id) => typeof id !== 'string' || !UUID_RE.test(id))) {
    throw new HttpError(400, 'validation_error', 'message_ids must be uuids from list_messages.', {
      fields: { message_ids: 'Invalid message ids.' },
    });
  }
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

/**
 * Mark only the named standalone messages addressed to the caller. One unknown, foreign, sent, or task-thread id
 * marks nothing. Already-read rows keep their original read_at. Does not accept a cursor, so a page token cannot
 * mark messages that were not named. Does not wake anyone.
 */
export async function markMessagesRead(
  caller: AgentPrincipal,
  ids: string[],
): Promise<{ messages: InboxMessage[]; unread_cursor: string | null }> {
  assertInboxCaller(caller);
  const wanted = uniqueIds(ids);
  const fromAgent = alias(agents, 'inbox_from');
  const toAgent = alias(agents, 'inbox_to');
  const written = await getDb().transaction(async (tx) => {
    const locked = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(inboxWhere(caller), inArray(messages.id, wanted)))
      .for('update');
    if (locked.length !== wanted.length) {
      throw new HttpError(404, 'not_found', 'No message was found.');
    }
    await tx
      .update(messages)
      .set({ readAt: sql`coalesce(${messages.readAt}, now())` })
      .where(and(inboxWhere(caller), inArray(messages.id, wanted)));
    const rows = await tx
      .select({
        message: messages,
        fromName: fromAgent.name,
        fromRole: fromAgent.role,
        toName: toAgent.name,
      })
      .from(messages)
      .innerJoin(fromAgent, eq(fromAgent.id, messages.fromAgentId))
      .innerJoin(toAgent, eq(toAgent.id, messages.toAgentId))
      .where(and(inboxWhere(caller), inArray(messages.id, wanted)))
      .orderBy(asc(messages.inboxSeq), asc(messages.id));
    if (rows.length !== wanted.length) throw new HttpError(404, 'not_found', 'No message was found.');
    return {
      messages: await presentAll(tx, rows),
      unread_cursor: await unreadCursor(tx, caller),
    };
  });
  return written;
}

/** Agent key only, same credential as the answer route. OAuth tokens use the MCP tools. */
export async function requireInboxKey(req: Request): Promise<AgentPrincipal> {
  const token = bearerToken(req);
  const caller = token?.startsWith('rsk_') ? await authenticateAgentKey(token) : null;
  if (!caller) throw new HttpError(401, 'unauthorized', 'Send an agent key as Authorization: Bearer <api_key>.');
  return caller;
}

export function parseInboxListQuery(url: URL): { cursor?: string; limit?: number; unread: boolean } {
  const limitRaw = url.searchParams.get('limit');
  let limit: number | undefined;
  if (limitRaw !== null && limitRaw !== '') {
    if (!/^\d+$/.test(limitRaw)) {
      throw new HttpError(400, 'validation_error', `limit must be an integer from 1 to ${MESSAGE_LIST_MAX}.`, {
        fields: { limit: 'Invalid limit.' },
      });
    }
    limit = Number(limitRaw);
  }
  const unreadRaw = url.searchParams.get('unread');
  if (unreadRaw !== null && unreadRaw !== '' && unreadRaw !== 'true' && unreadRaw !== 'false') {
    throw new HttpError(400, 'validation_error', 'unread must be true or false.', {
      fields: { unread: 'Invalid unread flag.' },
    });
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor && cursor.length > 2_000) throw invalidCursor();
  return {
    cursor: cursor ?? undefined,
    limit,
    unread: unreadRaw === 'true',
  };
}
