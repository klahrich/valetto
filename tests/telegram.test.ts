import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { agents, messages, telegramChats, telegramLinks, telegramSent, wakes } from '@/db/schema';
import { POST as webhookRoute } from '@/app/api/telegram/webhook/route';
import { GET as listLinksRoute, POST as issueLinkRoute } from '@/app/api/v1/agents/[id]/telegram-links/route';
import { POST as revokeLinkRoute } from '@/app/api/v1/agents/[id]/telegram-links/[linkId]/revoke/route';
import { POST as rotateLinkRoute } from '@/app/api/v1/agents/[id]/telegram-links/[linkId]/rotate/route';
import { sha256 } from '@/lib/crypto';
import { workspacePlanUsage } from '@/lib/plans';
import { TELEGRAM_CHAT_RATE, TELEGRAM_COPY } from '@/lib/telegram';
import { splitTelegramText, TELEGRAM_TEXT_MAX } from '@/lib/telegram-api';
import { issueWakeUrl } from '@/lib/wake-urls';
import { call, createAgent, createKey, mcpTool, signIn } from './helpers';

const SECRET = 'test-telegram-secret_123';
const BOT = 'ValettoTestBot';

type TgCall = { method: string; body: any };
let tgCalls: TgCall[] = [];
let nextTelegramMessageId = 1000;
let failTelegram = false;
const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '123456:test-token');
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', SECRET);
  vi.stubEnv('TELEGRAM_BOT_USERNAME', BOT);
  tgCalls = [];
  failTelegram = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.telegram.org/')) return realFetch(input, init);
    const method = url.slice(url.lastIndexOf('/') + 1);
    const body = JSON.parse(String(init?.body ?? '{}'));
    tgCalls.push({ method, body });
    if (failTelegram) return new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }), { status: 403 });
    nextTelegramMessageId += 1;
    return new Response(JSON.stringify({ ok: true, result: method === 'sendMessage' ? { message_id: nextTelegramMessageId } : true }), {
      status: 200,
    });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

let counter = Math.floor(Math.random() * 1_000_000) * 1000;
const nextId = () => ++counter;

const sends = () => tgCalls.filter((c) => c.method === 'sendMessage');
const lastText = () => sends().at(-1)?.body.text as string | undefined;

async function hook(update: Record<string, unknown>, secret: string | null = SECRET) {
  return call(webhookRoute, 'http://localhost/api/telegram/webhook', {
    method: 'POST',
    body: { update_id: nextId(), ...update },
    headers: secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret },
  });
}

function privateMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return {
    message: {
      message_id: nextId(),
      from: { id: chatId, is_bot: false, first_name: 'Dana', last_name: 'Tester' },
      chat: { id: chatId, type: 'private' },
      text,
      ...extra,
    },
  };
}

function groupMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return {
    message: {
      message_id: nextId(),
      from: { id: 77, is_bot: false, first_name: 'Gus' },
      chat: { id: chatId, type: 'supergroup' },
      text,
      ...extra,
    },
  };
}

async function issueLink(cookie: string, agentId: string): Promise<{ id: string; url: string; code: string }> {
  const res = await call(issueLinkRoute, `http://localhost/api/v1/agents/${agentId}/telegram-links`, {
    method: 'POST',
    cookie,
    params: { id: agentId },
  });
  expect(res.status, res.text).toBe(201);
  const url = res.data.telegram_link.url as string;
  return { id: res.data.telegram_link.id, url, code: new URL(url).searchParams.get('start')! };
}

async function setup(names: string[] = ['alpha', 'beta']) {
  const session = await signIn();
  const list = [];
  for (const name of names) {
    const agent = await createAgent(session.cookie, name);
    const key = await createKey(session.cookie, agent.id);
    const link = await issueLink(session.cookie, agent.id);
    list.push({ ...agent, key, link });
  }
  return { session, agents: list };
}

async function inbox(key: string) {
  const res = await mcpTool(key, 'list_messages', {});
  expect(res.isError, res.text).toBe(false);
  return res.payload.messages as any[];
}

describe('telegram: feature off', () => {
  it('answers 404 on the webhook and the link routes when any env var is missing', async () => {
    const session = await signIn();
    const agent = await createAgent(session.cookie, 'offagent');
    for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_BOT_USERNAME']) {
      vi.stubEnv(name, '');
      const res = await hook(privateMessage(nextId(), 'hi'));
      expect(res.status).toBe(404);
      const list = await call(listLinksRoute, `http://localhost/api/v1/agents/${agent.id}/telegram-links`, {
        cookie: session.cookie,
        params: { id: agent.id },
      });
      expect(list.status).toBe(404);
      const issue = await call(issueLinkRoute, `http://localhost/api/v1/agents/${agent.id}/telegram-links`, {
        method: 'POST',
        cookie: session.cookie,
        params: { id: agent.id },
      });
      expect(issue.status).toBe(404);
      vi.stubEnv(name, name === 'TELEGRAM_BOT_USERNAME' ? BOT : name === 'TELEGRAM_WEBHOOK_SECRET' ? SECRET : '1:t');
    }
    expect(tgCalls).toHaveLength(0);
  });
});

describe('telegram: webhook secret', () => {
  it('rejects a missing or wrong secret and accepts the right one', async () => {
    const chat = nextId();
    expect((await hook(privateMessage(chat, '/help'), null)).status).toBe(401);
    expect((await hook(privateMessage(chat, '/help'), 'wrong')).status).toBe(401);
    expect((await hook(privateMessage(chat, '/help'), `${SECRET}x`)).status).toBe(401);
    expect(tgCalls).toHaveLength(0);
    const ok = await hook(privateMessage(chat, '/help'));
    expect(ok.status).toBe(200);
    expect(lastText()).toBe(TELEGRAM_COPY.help);
  });
});

describe('telegram: links', () => {
  it('stores only the hash, needs a human to create one, and an agent key can list and revoke', async () => {
    const { session, agents: [a] } = await setup(['linkowner']);
    expect(a!.link.url).toBe(`https://t.me/${BOT}?start=${a!.link.code}`);
    expect(a!.link.code).toMatch(/^vtg_[A-Za-z0-9_-]{43}$/);
    const [row] = await getDb().select().from(telegramLinks).where(eq(telegramLinks.id, a!.link.id));
    expect(row?.codeHash).toBe(sha256(a!.link.code));
    expect(JSON.stringify(row)).not.toContain(a!.link.code);

    const byKey = await call(issueLinkRoute, `http://localhost/api/v1/agents/${a!.id}/telegram-links`, {
      method: 'POST',
      bearer: a!.key,
      params: { id: a!.id },
    });
    expect(byKey.status).toBe(403);
    const again = await call(issueLinkRoute, `http://localhost/api/v1/agents/${a!.id}/telegram-links`, {
      method: 'POST',
      cookie: session.cookie,
      params: { id: a!.id },
    });
    expect(again.status).toBe(409);
    const list = await call(listLinksRoute, `http://localhost/api/v1/agents/${a!.id}/telegram-links`, {
      bearer: a!.key,
      params: { id: a!.id },
    });
    expect(list.status).toBe(200);
    expect(list.text).not.toContain(a!.link.code);
    expect(list.data.telegram_links[0]).toMatchObject({ status: 'active', connected_chats: 0 });
  });

  it('/start <code> links the agent; a bad or revoked code does not', async () => {
    const { session, agents: [a] } = await setup(['starter']);
    const chat = nextId();
    await hook(privateMessage(chat, `/start ${a!.link.code}`));
    expect(lastText()).toBe(TELEGRAM_COPY.added('starter', ['starter']));
    const rows = await getDb().select().from(telegramChats).where(eq(telegramChats.chatId, chat));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agentId: a!.id, chatType: 'private', displayName: 'Dana Tester', telegramUserId: chat });

    await hook(privateMessage(nextId(), '/start vtg_nope'));
    expect(lastText()).toBe(TELEGRAM_COPY.badLink);

    const revoked = await call(revokeLinkRoute, `http://localhost/api/v1/agents/${a!.id}/telegram-links/${a!.link.id}/revoke`, {
      method: 'POST',
      cookie: session.cookie,
      params: { id: a!.id, linkId: a!.link.id },
    });
    expect(revoked.status).toBe(200);
    // Revoking disconnects the chat that joined through it.
    expect(await getDb().select().from(telegramChats).where(eq(telegramChats.chatId, chat))).toHaveLength(0);
    await hook(privateMessage(nextId(), `/start ${a!.link.code}`));
    expect(lastText()).toBe(TELEGRAM_COPY.badLink);
  });

  it('replacing a link disconnects its chats and the new code works', async () => {
    const { session, agents: [a] } = await setup(['rotator']);
    const chat = nextId();
    await hook(privateMessage(chat, `/start ${a!.link.code}`));
    const rotated = await call(rotateLinkRoute, `http://localhost/api/v1/agents/${a!.id}/telegram-links/${a!.link.id}/rotate`, {
      method: 'POST',
      cookie: session.cookie,
      params: { id: a!.id, linkId: a!.link.id },
    });
    expect(rotated.status).toBe(200);
    expect(await getDb().select().from(telegramChats).where(eq(telegramChats.chatId, chat))).toHaveLength(0);
    await hook(privateMessage(chat, 'hello?'));
    expect(lastText()).toBe(TELEGRAM_COPY.notConnected);
    const code = new URL(rotated.data.telegram_link.url).searchParams.get('start')!;
    await hook(privateMessage(chat, `/start ${code}`));
    expect(lastText()).toBe(TELEGRAM_COPY.added('rotator', ['rotator']));
  });
});

describe('telegram: inbound', () => {
  it('relays text through the normal message path with external_sender and a wake carrying message_id', async () => {
    const { session, agents: [a] } = await setup(['inbound']);
    await issueWakeUrl({ kind: 'agent', workspaceId: session.workspace.id, agentId: a!.id }, 'https://valetto.example');
    const chat = nextId();
    await hook(privateMessage(chat, `/start ${a!.link.code}`));
    tgCalls = [];
    const res = await hook(privateMessage(chat, 'Hello from Telegram'));
    expect(res.data.status).toBe('relayed');
    expect(sends()).toHaveLength(0);
    const list = await inbox(a!.key);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      from: 'telegram',
      body: 'Hello from Telegram',
      external_sender: { channel: 'telegram', name: 'Dana Tester', telegram_user_id: chat },
    });
    expect(JSON.stringify(list[0])).not.toMatch(/phone/i);
    const [wake] = await getDb().select().from(wakes).where(eq(wakes.messageId, list[0].id));
    expect(wake).toMatchObject({ agentId: a!.id, reason: 'message' });
    // The hidden sender does not count against the plan's agents.
    const usage = await workspacePlanUsage(session.workspace.id);
    expect(usage.usage.agents).toBe(1);
    const hidden = await getDb()
      .select()
      .from(agents)
      .where(and(eq(agents.workspaceId, session.workspace.id), eq(agents.role, 'telegram_sender')));
    expect(hidden).toHaveLength(1);
    // And it is not in list_agents.
    const teammates = await mcpTool(a!.key, 'list_agents', {});
    expect(JSON.stringify(teammates.payload)).not.toContain('"telegram"');
  });

  it('dedupes on update_id', async () => {
    const { agents: [a] } = await setup(['deduper']);
    const chat = nextId();
    await hook(privateMessage(chat, `/start ${a!.link.code}`));
    const updateId = nextId();
    const body = { update_id: updateId, ...privateMessage(chat, 'only once') };
    const headers = { 'x-telegram-bot-api-secret-token': SECRET };
    const first = await call(webhookRoute, 'http://localhost/api/telegram/webhook', { method: 'POST', body, headers });
    const second = await call(webhookRoute, 'http://localhost/api/telegram/webhook', { method: 'POST', body, headers });
    expect(first.data.status).toBe('relayed');
    expect(second.data.status).toBe('duplicate');
    expect(await inbox(a!.key)).toHaveLength(1);
  });

  it('limits each chat', async () => {
    const { agents: [a] } = await setup(['limited']);
    const chat = nextId();
    await hook(privateMessage(chat, `/start ${a!.link.code}`));
    for (let i = 1; i < TELEGRAM_CHAT_RATE.limit; i += 1) await hook(privateMessage(chat, `m${i}`));
    const over = await hook(privateMessage(chat, 'one too many'));
    expect(over.data.status).toBe('rate_limited');
    expect(lastText()).toBe(TELEGRAM_COPY.slowDown);
    expect(await inbox(a!.key)).toHaveLength(TELEGRAM_CHAT_RATE.limit - 1);
  });

  it('asks unlinked chats to open a link and ignores non-text', async () => {
    const chat = nextId();
    await hook(privateMessage(chat, 'hi'));
    expect(lastText()).toBe(TELEGRAM_COPY.notConnected);
    await hook({ message: { message_id: 1, from: { id: chat }, chat: { id: chat, type: 'private' }, sticker: {} } });
    expect(lastText()).toBe(TELEGRAM_COPY.textOnly);
  });
});

describe('telegram: many agents in one chat', () => {
  it('adds agents, routes by @name, the only agent, last used, and buttons when nothing picks one', async () => {
    const { agents: [a, b] } = await setup(['alpha', 'Beta-Bot']);
    const chat = nextId();
    await hook(privateMessage(chat, `/start ${a!.link.code}`));
    // One agent: everything goes there.
    await hook(privateMessage(chat, 'to the only one'));
    expect((await inbox(a!.key)).map((m) => m.body)).toEqual(['to the only one']);

    await hook(privateMessage(chat, `/start ${b!.link.code}`));
    expect(lastText()).toBe('Added Beta-Bot. You can now talk to: alpha, Beta-Bot.');
    await hook(privateMessage(chat, '/agents'));
    expect(lastText()).toBe(TELEGRAM_COPY.agents(['alpha', 'Beta-Bot']));

    // @name, case-insensitive, prefix removed.
    await hook(privateMessage(chat, '@beta-bot: please check this'));
    expect((await inbox(b!.key)).map((m) => m.body)).toEqual(['please check this']);
    await hook(privateMessage(chat, '@beta-bot'));
    expect(lastText()).toBe(TELEGRAM_COPY.emptyAfterName('Beta-Bot'));

    // No name: the last agent used (Beta-Bot).
    await hook(privateMessage(chat, 'follow-up'));
    expect((await inbox(b!.key)).map((m) => m.body)).toEqual(['please check this', 'follow-up']);
    // An unknown @name is just text for the last agent.
    await hook(privateMessage(chat, '@nobody hi'));
    expect((await inbox(b!.key)).at(-1)?.body).toBe('@nobody hi');
  });

  it('shows buttons when no agent has been used yet, and a tap sends the waiting message', async () => {
    const { agents: [a, b] } = await setup(['pickone', 'picktwo']);
    const chat = nextId();
    await hook(privateMessage(chat, `/start ${a!.link.code}`));
    await hook(privateMessage(chat, `/start ${b!.link.code}`));
    tgCalls = [];
    const res = await hook(privateMessage(chat, 'who gets this?'));
    expect(res.data.status).toBe('pick');
    const ask = sends().at(-1)!;
    expect(ask.body.text).toBe(TELEGRAM_COPY.pick);
    const buttons = ask.body.reply_markup.inline_keyboard.flat() as { text: string; callback_data: string }[];
    expect(buttons.map((x) => x.text)).toEqual(['pickone', 'picktwo']);
    for (const x of buttons) expect(Buffer.byteLength(x.callback_data)).toBeLessThanOrEqual(64);
    expect(await inbox(a!.key)).toHaveLength(0);
    expect(await inbox(b!.key)).toHaveLength(0);

    const tap = (data: string, chatId = chat) =>
      hook({ callback_query: { id: `cb${nextId()}`, from: { id: chat }, data, message: { message_id: 5, chat: { id: chatId, type: 'private' } } } });
    // A tap from another chat cannot release this chat's message.
    const foreign = await tap(buttons[1]!.callback_data, nextId());
    expect(foreign.data.status).toBe('expired');
    const picked = await tap(buttons[1]!.callback_data);
    expect(picked.data.status).toBe('relayed');
    expect(tgCalls.filter((c) => c.method === 'answerCallbackQuery').at(-1)?.body.text).toBe(TELEGRAM_COPY.sentTo('picktwo'));
    expect((await inbox(b!.key)).map((m) => m.body)).toEqual(['who gets this?']);
    expect((await tap(buttons[0]!.callback_data)).data.status).toBe('expired');
    expect(await inbox(a!.key)).toHaveLength(0);
    // The tap made picktwo the last agent used.
    await hook(privateMessage(chat, 'next one'));
    expect((await inbox(b!.key)).at(-1)?.body).toBe('next one');
  });

  it('/stop name removes one agent and /stop removes all', async () => {
    const { agents: [a, b] } = await setup(['stopone', 'stoptwo']);
    const chat = nextId();
    await hook(privateMessage(chat, `/start ${a!.link.code}`));
    await hook(privateMessage(chat, `/start ${b!.link.code}`));
    await hook(privateMessage(chat, '/stop STOPONE'));
    expect(lastText()).toBe(TELEGRAM_COPY.removed('stopone', ['stoptwo']));
    await hook(privateMessage(chat, '/stop missing'));
    expect(lastText()).toBe(TELEGRAM_COPY.noSuchAgent('missing', ['stoptwo']));
    await hook(privateMessage(chat, 'still here'));
    expect((await inbox(b!.key)).map((m) => m.body)).toEqual(['still here']);
    await hook(privateMessage(chat, `/start ${a!.link.code}`));
    await hook(privateMessage(chat, '/stop'));
    expect(lastText()).toBe(TELEGRAM_COPY.removedAll);
    expect(await getDb().select().from(telegramChats).where(eq(telegramChats.chatId, chat))).toHaveLength(0);
  });
});

describe('telegram: outbound', () => {
  it('sends the reply as "<agent>: text", remembers it, and a Telegram reply to it goes back with in_reply_to', async () => {
    const { agents: [a, b] } = await setup(['replier', 'other']);
    const chat = nextId();
    await hook(privateMessage(chat, `/start ${a!.link.code}`));
    await hook(privateMessage(chat, `/start ${b!.link.code}`));
    await hook(privateMessage(chat, '@replier question one'));
    const [incoming] = await inbox(a!.key);
    tgCalls = [];
    const sent = await mcpTool(a!.key, 'send_message', { in_reply_to: incoming.id, body: 'answer one' });
    expect(sent.isError, sent.text).toBe(false);
    expect(sent.payload.message).toMatchObject({ from: 'replier', to: 'telegram', in_reply_to: incoming.id });
    expect(sent.payload.message.telegram).toEqual({ delivered: true, parts: 1 });
    expect(sends()).toHaveLength(1);
    expect(sends()[0]!.body).toMatchObject({ chat_id: chat, text: 'replier: answer one' });
    const botMessageId = nextTelegramMessageId;
    const [mapped] = await getDb().select().from(telegramSent).where(eq(telegramSent.telegramMessageId, botMessageId));
    expect(mapped).toMatchObject({ chatId: chat, agentId: a!.id, messageId: sent.payload.message.id });

    // Talk to "other" so it is the last agent used; a reply to replier's message must still go to replier.
    await hook(privateMessage(chat, '@other unrelated'));
    await hook(privateMessage(chat, 'thanks!', { reply_to_message: { message_id: botMessageId, from: { id: 1, is_bot: true } } }));
    const replierInbox = await inbox(a!.key);
    expect(replierInbox.at(-1)).toMatchObject({ body: 'thanks!', in_reply_to: sent.payload.message.id });
    expect((await inbox(b!.key)).map((m) => m.body)).toEqual(['unrelated']);
  });

  it('splits long replies under 4096 characters with the prefix on every part', async () => {
    const { agents: [a] } = await setup(['longwriter']);
    const chat = nextId();
    await hook(privateMessage(chat, `/start ${a!.link.code}`));
    await hook(privateMessage(chat, 'write a lot'));
    const [incoming] = await inbox(a!.key);
    tgCalls = [];
    const body = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ') + '\n\n' + 'x'.repeat(5000);
    const sent = await mcpTool(a!.key, 'send_message', { in_reply_to: incoming.id, body });
    expect(sent.isError, sent.text).toBe(false);
    const parts = sends().map((c) => c.body.text as string);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX);
      expect(part.startsWith('longwriter: ')).toBe(true);
    }
    expect(parts.map((p) => p.slice('longwriter: '.length)).join('')).toBe(body);
    expect(sent.payload.message.telegram).toEqual({ delivered: true, parts: parts.length });
    expect(await getDb().select().from(telegramSent).where(eq(telegramSent.messageId, sent.payload.message.id))).toHaveLength(parts.length);
  });

  it('logs a Telegram failure instead of throwing, and refuses a reply once the chat is disconnected', async () => {
    const { agents: [a] } = await setup(['failing']);
    const chat = nextId();
    await hook(privateMessage(chat, `/start ${a!.link.code}`));
    await hook(privateMessage(chat, 'ping'));
    const [incoming] = await inbox(a!.key);
    failTelegram = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sent = await mcpTool(a!.key, 'send_message', { in_reply_to: incoming.id, body: 'pong' });
    expect(sent.isError, sent.text).toBe(false);
    expect(sent.payload.message.telegram).toEqual({ delivered: false, parts: 1 });
    expect(errors.mock.calls.flat().join(' ')).not.toContain('test-token');
    failTelegram = false;
    await hook(privateMessage(chat, '/stop'));
    const refused = await mcpTool(a!.key, 'send_message', { in_reply_to: incoming.id, body: 'too late' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('telegram_chat_disconnected');
    const stored = await getDb().select().from(messages).where(eq(messages.body, 'too late'));
    expect(stored).toHaveLength(0);
  });

  it('splitTelegramText keeps every part within the limit and never splits a surrogate pair', () => {
    expect(splitTelegramText('short')).toEqual(['short']);
    const emoji = '😀'.repeat(3000);
    const parts = splitTelegramText(emoji);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX);
      expect(part.length % 2).toBe(0);
    }
    expect(parts.join('')).toBe(emoji);
  });
});

describe('telegram: groups', () => {
  it('ties a group to exactly one agent and passes every message the bot sees to it', async () => {
    const { agents: [a, b] } = await setup(['groupone', 'grouptwo']);
    const group = -nextId();
    // An unlinked group's chatter is ignored without a reply.
    tgCalls = [];
    expect((await hook(groupMessage(group, 'chatter'))).data.status).toBe('ignored');
    expect(sends()).toHaveLength(0);

    await hook(groupMessage(group, `/link@${BOT} ${a!.link.code}`));
    expect(lastText()).toBe(TELEGRAM_COPY.groupBound('groupone'));
    await hook(groupMessage(group, `/start ${b!.link.code}`));
    expect(lastText()).toBe(TELEGRAM_COPY.groupBound('grouptwo'));
    const rows = await getDb().select().from(telegramChats).where(eq(telegramChats.chatId, group));
    expect(rows.map((r) => r.agentId)).toEqual([b!.id]);
    expect(rows[0]?.chatType).toBe('group');

    tgCalls = [];
    await hook(groupMessage(group, 'hello team'));
    await hook(groupMessage(group, `@${BOT} mention me`));
    await hook(groupMessage(group, '/other@SomeOtherBot x'));
    expect(sends()).toHaveLength(0);
    expect((await inbox(b!.key)).map((m) => m.body)).toEqual(['hello team', 'mention me']);
    expect(await inbox(a!.key)).toHaveLength(0);

    await hook(groupMessage(group, '/stop'));
    expect(lastText()).toBe(TELEGRAM_COPY.removedAll);
    expect((await hook(groupMessage(group, 'after stop'))).data.status).toBe('ignored');
  });
});
