import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { POST as postOffer } from '@/app/api/v1/agents/[id]/offers/route';
import { PUT as putSharing } from '@/app/api/v1/agents/[id]/sharing/route';
import { POST as postInvite } from '@/app/api/v1/agents/[id]/invites/route';
import { GET as listMessagesRoute } from '@/app/api/v1/messages/route';
import { POST as markMessagesRoute } from '@/app/api/v1/messages/read/route';
import { PATCH as patchWorkspace } from '@/app/api/v1/workspaces/current/route';
import { POST as redeemRoute } from '@/app/api/v1/invites/redeem/route';
import { getDb } from '@/db';
import { messages, tasks, wakes } from '@/db/schema';
import { call, createAgent, createKey, mcpListTools, mcpTool, signIn } from './helpers';

const RESULT_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
const TIED_AT = new Date('2024-06-01T00:00:00.000Z');

type Page = {
  messages: Array<{
    id: string;
    body: string;
    from: string;
    to: string;
    task_id: null;
    unread: boolean;
    read_at: string | null;
    created_at: string;
  }>;
  next_cursor: string | null;
  unread_cursor: string | null;
};

async function pair(names: { from?: string; to?: string } = {}) {
  const session = await signIn();
  const from = await createAgent(session.cookie, names.from ?? 'alice');
  const to = await createAgent(session.cookie, names.to ?? 'bob');
  return {
    session,
    from,
    to,
    fromKey: await createKey(session.cookie, from.id),
    toKey: await createKey(session.cookie, to.id),
  };
}

async function send(key: string, to: string, body: string, taskId?: string): Promise<string> {
  const res = await mcpTool(key, 'send_message', { to, body, ...(taskId ? { task_id: taskId } : {}) });
  expect(res.isError, res.text).toBe(false);
  return res.payload.message.id as string;
}

async function listed(key: string, args: Record<string, unknown> = {}): Promise<Page> {
  const res = await mcpTool(key, 'list_messages', args);
  expect(res.isError, res.text).toBe(false);
  return res.payload as Page;
}

async function readAt(id: string): Promise<Date | null> {
  const [row] = await getDb().select({ readAt: messages.readAt }).from(messages).where(eq(messages.id, id));
  return row?.readAt ?? null;
}

const bodies = (page: Page) => page.messages.map((message) => message.body);

describe('list_messages inbox', () => {
  it('pages arrival order across created_at ties, and a later page cursor is stable', async () => {
    const { fromKey, toKey } = await pair();
    const sent: string[] = [];
    for (let i = 0; i < 8; i += 1) sent.push(await send(fromKey, 'bob', `m${i}`));
    for (const id of sent) {
      await getDb().update(messages).set({ createdAt: TIED_AT }).where(eq(messages.id, id));
    }

    let bySeq = sent;
    let byId = [...sent].sort();
    let extra = 0;
    while (bySeq.join() === byId.join() && extra < 5) {
      sent.push(await send(fromKey, 'bob', `extra${extra}`));
      await getDb().update(messages).set({ createdAt: TIED_AT }).where(eq(messages.id, sent.at(-1)!));
      bySeq = sent;
      byId = [...sent].sort();
      extra += 1;
    }
    expect(bySeq.join()).not.toBe(byId.join());

    const seen: string[] = [];
    let cursor: string | null = null;
    let unreadCursor: string | null = null;
    let pages = 0;
    do {
      const page = await listed(toKey, { limit: 2, ...(cursor ? { cursor } : {}) });
      expect(page.messages.every((message) => message.task_id === null && message.unread && message.read_at === null)).toBe(true);
      expect(page.messages.every((message) => message.created_at === TIED_AT.toISOString())).toBe(true);
      if (unreadCursor === null) unreadCursor = page.unread_cursor;
      expect(page.unread_cursor).toBe(unreadCursor);
      expect(page.unread_cursor).not.toBe(page.next_cursor);
      seen.push(...bodies(page));
      cursor = page.next_cursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBeGreaterThan(1);
    expect(seen).toEqual(sent.map((_, i) => (i < 8 ? `m${i}` : `extra${i - 8}`)));

    const first = await listed(toKey, { limit: 2 });
    const again = await listed(toKey, { limit: 2 });
    expect(again.next_cursor).toBe(first.next_cursor);
    expect(again.unread_cursor).toBe(first.unread_cursor);
    expect(again.messages.map((message) => message.id)).toEqual(first.messages.map((message) => message.id));
  });

  it('keeps a new arrival that commits between pages, even when its created_at is earlier', async () => {
    const { fromKey, toKey, to } = await pair();
    for (const body of ['a', 'b', 'c', 'd']) await send(fromKey, 'bob', body);
    const first = await listed(toKey, { limit: 2 });
    expect(bodies(first)).toEqual(['a', 'b']);
    const lateId = await send(fromKey, 'bob', 'late');
    await getDb().update(messages).set({ createdAt: new Date('2000-01-01T00:00:00.000Z') }).where(eq(messages.id, lateId));

    const second = await listed(toKey, { limit: 2, cursor: first.next_cursor });
    expect(bodies(second)).toEqual(['c', 'd']);
    expect(second.messages.some((message) => message.id === lateId)).toBe(false);
    const third = await listed(toKey, { limit: 2, cursor: second.next_cursor });
    expect(bodies(third)).toEqual(['late']);
    expect(third.next_cursor).toBeNull();
    expect(third.unread_cursor).toBe(first.unread_cursor);

    const marked = await mcpTool(toKey, 'mark_messages_read', { message_ids: first.messages.map((message) => message.id) });
    expect(marked.isError, marked.text).toBe(false);
    expect((await readAt(lateId)) === null).toBe(true);
    expect(to.id).toBeTruthy();
  });

  it('rejects a tampered cursor, an unread watermark used as a page, and another agent cursor', async () => {
    const alice = await pair();
    const carol = await pair({ from: 'cara', to: 'dave' });
    for (const body of ['one', 'two', 'three']) await send(alice.fromKey, 'bob', body);
    await send(carol.fromKey, 'dave', 'secret-for-dave');
    await send(carol.fromKey, 'dave', 'secret-page-two');
    const bobPage = await listed(alice.toKey, { limit: 1 });
    const davePage = await listed(carol.toKey, { limit: 1 });
    expect(bobPage.next_cursor).toBeTruthy();
    expect(bobPage.unread_cursor).toBeTruthy();
    expect(davePage.messages[0]!.body).toBe('secret-for-dave');

    const tampered = `${bobPage.next_cursor!.slice(0, -1)}${bobPage.next_cursor!.endsWith('a') ? 'b' : 'a'}`;
    for (const cursor of [tampered, 'not-a-cursor', bobPage.unread_cursor, davePage.next_cursor]) {
      const res = await mcpTool(alice.toKey, 'list_messages', { cursor });
      expect(res.isError, `${cursor} ${res.text}`).toBe(true);
      expect(res.payload).toMatchObject({ error: 'validation_error' });
      expect(res.text).not.toContain('secret-for-dave');
      expect(res.text).not.toContain('"one"');
    }

    const flipped = await mcpTool(alice.toKey, 'list_messages', { cursor: bobPage.next_cursor, unread: true });
    expect(flipped.payload).toMatchObject({ error: 'validation_error' });

    const http = await call(listMessagesRoute, `http://localhost/api/v1/messages?cursor=${encodeURIComponent(davePage.next_cursor!)}`, {
      bearer: alice.toKey,
    });
    expect(http.status).toBe(400);
    expect(http.data.error.code).toBe('validation_error');
    expect(http.text).not.toContain('secret-for-dave');
  });

  it('moves the unread watermark only when the oldest unread message is marked, and a repeat keeps read_at', async () => {
    const { fromKey, toKey } = await pair();
    const ids = [];
    for (const body of ['A', 'B', 'C']) ids.push(await send(fromKey, 'bob', body));
    const [a, b, c] = ids as [string, string, string];
    const before = await listed(toKey, { limit: 1 });
    const page2 = await listed(toKey, { limit: 1, cursor: before.next_cursor });
    expect(page2.unread_cursor).toBe(before.unread_cursor);
    expect(bodies(page2)).toEqual(['B']);

    const markedB = await mcpTool(toKey, 'mark_messages_read', { message_ids: [b] });
    expect(markedB.isError, markedB.text).toBe(false);
    expect(markedB.payload.unread_cursor).toBe(before.unread_cursor);
    expect(markedB.payload.messages[0]).toMatchObject({ id: b, unread: false });
    const readB = markedB.payload.messages[0].read_at as string;
    expect(readB).toEqual(expect.any(String));

    const againB = await mcpTool(toKey, 'mark_messages_read', { message_ids: [b, b] });
    expect(againB.isError, againB.text).toBe(false);
    expect(againB.payload.messages).toHaveLength(1);
    expect(againB.payload.messages[0].read_at).toBe(readB);
    expect((await readAt(b))?.toISOString()).toBe(readB);
    expect(await readAt(a)).toBeNull();
    expect(await readAt(c)).toBeNull();

    const unread = await listed(toKey, { unread: true });
    expect(bodies(unread)).toEqual(['A', 'C']);
    expect(unread.unread_cursor).toBe(before.unread_cursor);

    const markedA = await mcpTool(toKey, 'mark_messages_read', { message_ids: [a] });
    expect(markedA.payload.unread_cursor).not.toBe(before.unread_cursor);
    expect(markedA.payload.unread_cursor).toBeTruthy();
    const onlyC = await listed(toKey, { unread: true });
    expect(bodies(onlyC)).toEqual(['C']);
    expect(onlyC.unread_cursor).toBe(markedA.payload.unread_cursor);

    const markedC = await mcpTool(toKey, 'mark_messages_read', { message_ids: [c] });
    expect(markedC.payload.unread_cursor).toBeNull();
    const repeatC = await mcpTool(toKey, 'mark_messages_read', { message_ids: [c] });
    expect(repeatC.payload.messages[0].read_at).toBe(markedC.payload.messages[0].read_at);
    expect((await listed(toKey, { unread: true })).messages).toEqual([]);
    expect((await listed(toKey)).unread_cursor).toBeNull();
    expect(bodies(await listed(toKey))).toEqual(['A', 'B', 'C']);
  });

  it('does not mark a message that was not named, including one that arrived after the page', async () => {
    const { fromKey, toKey } = await pair();
    const firstIds = [await send(fromKey, 'bob', 'p1'), await send(fromKey, 'bob', 'p2')];
    const page = await listed(toKey, { limit: 2 });
    const late = await send(fromKey, 'bob', 'after');
    let cursorRejected = false;
    try {
      const withCursor = await mcpTool(toKey, 'mark_messages_read', {
        message_ids: page.messages.map((message) => message.id),
        cursor: page.next_cursor,
        unread_cursor: page.unread_cursor,
      });
      cursorRejected = withCursor.isError === true;
    } catch {
      // The tool schema rejects cursor and unread_cursor before the handler runs.
      cursorRejected = true;
    }
    expect(cursorRejected).toBe(true);
    expect(await readAt(firstIds[0]!)).toBeNull();
    expect(await readAt(late)).toBeNull();

    const http = await call(markMessagesRoute, 'http://localhost/api/v1/messages/read', {
      bearer: toKey,
      body: { message_ids: page.messages.map((message) => message.id), cursor: page.next_cursor },
    });
    expect(http.status).toBe(400);
    expect(http.data.error.code).toBe('validation_error');
    expect(await readAt(firstIds[0]!)).toBeNull();

    const marked = await mcpTool(toKey, 'mark_messages_read', { message_ids: page.messages.map((message) => message.id) });
    expect(marked.isError, marked.text).toBe(false);
    expect(await readAt(late)).toBeNull();
    expect(bodies(await listed(toKey, { unread: true }))).toEqual(['after']);
  });

  it('isolates sender, teammate, other workspace, task threads, and task results', async () => {
    const { session, fromKey, toKey, from, to } = await pair();
    const teammate = await createAgent(session.cookie, 'carol');
    const teammateKey = await createKey(session.cookie, teammate.id);
    const other = await pair({ from: 'erin', to: 'frank' });
    const inboxId = await send(fromKey, 'bob', 'for-bob');
    const task = await mcpTool(fromKey, 'create_task', {
      to: 'bob',
      title: 'Work',
      description: 'Do it.',
      result_schema: RESULT_SCHEMA,
    });
    expect(task.isError, task.text).toBe(false);
    const taskId = task.payload.task.id as string;
    const threadId = await send(fromKey, 'bob', 'on the thread', taskId);
    expect((await mcpTool(toKey, 'complete_task', { id: taskId, result: { ok: true } })).isError).toBe(false);

    const bob = await listed(toKey);
    expect(bodies(bob)).toEqual(['for-bob']);
    expect(bob.messages[0]).toMatchObject({ from: 'alice', to: 'bob', from_agent_id: from.id, to_agent_id: to.id });
    expect(bodies(await listed(fromKey))).toEqual([]);
    expect(bodies(await listed(teammateKey))).toEqual([]);
    expect(bodies(await listed(other.toKey))).toEqual([]);

    const got = await mcpTool(toKey, 'get_task', { id: taskId });
    expect(got.payload.messages.map((message: { id: string }) => message.id)).toEqual([threadId]);
    const threadLookup = await mcpTool(toKey, 'get_message', { id: threadId });
    expect(threadLookup.payload).toMatchObject({ error: 'not_found' });
    expect(got.payload.task.result).toEqual({ ok: true });
    expect(got.payload.messages[0]).not.toHaveProperty('unread');

    const wakeCount = async () => (await getDb().select({ id: wakes.id }).from(wakes)).length;
    const beforeWakes = await wakeCount();
    for (const key of [fromKey, teammateKey, other.toKey]) {
      const denied = await mcpTool(key, 'mark_messages_read', { message_ids: [inboxId, threadId] });
      expect(denied.payload).toMatchObject({ error: 'not_found' });
    }
    expect(await readAt(inboxId)).toBeNull();
    expect(await readAt(threadId)).toBeNull();
    expect(await wakeCount()).toBe(beforeWakes);
    const [taskRow] = await getDb().select({ status: tasks.status, result: tasks.result }).from(tasks).where(eq(tasks.id, taskId));
    expect(taskRow).toEqual({ status: 'done', result: { ok: true } });

    const mixed = await mcpTool(toKey, 'mark_messages_read', { message_ids: [inboxId, threadId] });
    expect(mixed.payload).toMatchObject({ error: 'not_found' });
    expect(await readAt(inboxId)).toBeNull();
  });

  it('serves the same page and mark over HTTP, and refuses a session, a watcher-shaped bearer, and a bad query', async () => {
    const { session, fromKey, toKey } = await pair();
    await send(fromKey, 'bob', 'http-1');
    await send(fromKey, 'bob', 'http-2');
    const mcpPage = await listed(toKey, { limit: 1 });
    const httpPage = await call(listMessagesRoute, 'http://localhost/api/v1/messages?limit=1', { bearer: toKey });
    expect(httpPage.status).toBe(200);
    expect(httpPage.data.messages).toEqual(mcpPage.messages);
    expect(httpPage.data.next_cursor).toBe(mcpPage.next_cursor);
    expect(httpPage.data.unread_cursor).toBe(mcpPage.unread_cursor);

    const next = await call(
      listMessagesRoute,
      `http://localhost/api/v1/messages?limit=1&cursor=${encodeURIComponent(httpPage.data.next_cursor)}`,
      { bearer: toKey },
    );
    expect(next.status).toBe(200);
    expect(next.data.messages[0].body).toBe('http-2');
    expect(next.data.unread_cursor).toBe(httpPage.data.unread_cursor);

    const marked = await call(markMessagesRoute, 'http://localhost/api/v1/messages/read', {
      bearer: toKey,
      body: { message_ids: [httpPage.data.messages[0].id] },
    });
    expect(marked.status).toBe(200);
    expect(marked.data.messages[0].unread).toBe(false);
    const repeated = await call(markMessagesRoute, 'http://localhost/api/v1/messages/read', {
      bearer: toKey,
      body: { message_ids: [httpPage.data.messages[0].id] },
    });
    expect(repeated.status).toBe(200);
    expect(repeated.data.messages[0].read_at).toBe(marked.data.messages[0].read_at);

    const cookie = await call(listMessagesRoute, 'http://localhost/api/v1/messages', { cookie: session.cookie });
    expect(cookie.status).toBe(401);
    const watcher = await call(listMessagesRoute, 'http://localhost/api/v1/messages', { bearer: 'rsw_not-a-key' });
    expect(watcher.status).toBe(401);
    const oauth = await call(listMessagesRoute, 'http://localhost/api/v1/messages', { bearer: 'rsoa_not-a-key' });
    expect(oauth.status).toBe(401);
    const badLimit = await call(listMessagesRoute, 'http://localhost/api/v1/messages?limit=0', { bearer: toKey });
    expect(badLimit.status).toBe(400);
    const badUnread = await call(listMessagesRoute, 'http://localhost/api/v1/messages?unread=1', { bearer: toKey });
    expect(badUnread.status).toBe(400);
  });

  it('uses a default page of 50 and rejects an oversize limit', async () => {
    const { session, from, to, toKey } = await pair();
    await getDb().insert(messages).values(
      Array.from({ length: 51 }, (_, i) => ({
        workspaceId: session.workspace.id,
        fromAgentId: from.id,
        toAgentId: to.id,
        body: `n-${String(i).padStart(2, '0')}`,
      })),
    );
    const page = await listed(toKey);
    expect(page.messages).toHaveLength(50);
    expect(page.messages[0]!.body).toBe('n-00');
    expect(page.messages[49]!.body).toBe('n-49');
    expect(page.next_cursor).toBeTruthy();
    const rest = await listed(toKey, { cursor: page.next_cursor });
    expect(bodies(rest)).toEqual(['n-50']);
    let oversize = false;
    try {
      const tooBig = await mcpTool(toKey, 'list_messages', { limit: 101 });
      oversize = tooBig.isError === true;
    } catch {
      oversize = true;
    }
    expect(oversize).toBe(true);
    const all = await listed(toKey, { limit: 100 });
    expect(all.messages).toHaveLength(51);
    expect(all.next_cursor).toBeNull();
  });
});

describe('invite-link guests cannot read an inbox', () => {
  afterEach(() => {
    delete process.env.VALETTO_AGENT_GUESTS;
  });

  it('hides list_messages from the guest tool list and does not mark the owner inbox', async () => {
    process.env.VALETTO_AGENT_GUESTS = '1';
    const session = await signIn();
    const handle = `o${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const named = await call(patchWorkspace, 'http://localhost/api/v1/workspaces/current', {
      method: 'PATCH',
      cookie: session.cookie,
      body: { handle },
    });
    expect(named.status).toBe(200);
    const agent = await createAgent(session.cookie, 'Grok');
    const offer = await call(postOffer, `http://localhost/api/v1/agents/${agent.id}/offers`, {
      cookie: session.cookie,
      params: { id: agent.id },
      body: { name: 'draft', description: 'Draft.', result_schema: RESULT_SCHEMA },
    });
    expect(offer.status).toBe(201);
    const shared = await call(putSharing, `http://localhost/api/v1/agents/${agent.id}/sharing`, {
      method: 'PUT',
      cookie: session.cookie,
      params: { id: agent.id },
      body: { shared: true },
    });
    expect(shared.status).toBe(200);
    const ownerKey = await createKey(session.cookie, agent.id);
    const mate = await createAgent(session.cookie, 'Mate');
    const mateKey = await createKey(session.cookie, mate.id);
    const notice = await send(ownerKey, 'Mate', 'owner-notice');

    const invite = await call(postInvite, `http://localhost/api/v1/agents/${agent.id}/invites`, {
      cookie: session.cookie,
      params: { id: agent.id },
      body: { kind: 'agent', offers: ['draft'], approve_on_redeem: true, max_uses: 2 },
    });
    expect(invite.status).toBe(201);
    const redeemed = await call(redeemRoute, 'http://localhost/api/v1/invites/redeem', {
      body: { invite: invite.data.token, name: 'CustomerBot' },
      headers: { 'x-forwarded-for': '10.9.9.9' },
    });
    expect(redeemed.status).toBe(201);
    const guestKey = redeemed.data.api_key as string;

    const single = await call(postInvite, `http://localhost/api/v1/agents/${agent.id}/invites`, {
      cookie: session.cookie,
      params: { id: agent.id },
      body: { kind: 'agent', offers: ['draft'], approve_on_redeem: true },
    });
    expect(single.status).toBe(201);
    const token = single.data.token as string;

    for (const key of [guestKey, token]) {
      const names = (await mcpListTools(key)).map((tool) => tool.name);
      expect(names).not.toContain('list_messages');
      expect(names).not.toContain('mark_messages_read');
      const list = await mcpTool(key, 'list_messages', {});
      expect(list.payload).toMatchObject({ error: 'insufficient_scope' });
      expect(JSON.stringify(list.payload)).not.toContain('owner-notice');
      const mark = await mcpTool(key, 'mark_messages_read', { message_ids: [notice] });
      expect(mark.payload).toMatchObject({ error: 'insufficient_scope' });
    }
    expect(await readAt(notice)).toBeNull();

    const httpList = await call(listMessagesRoute, 'http://localhost/api/v1/messages', { bearer: guestKey });
    expect(httpList.status).toBe(403);
    expect(httpList.data.error.code).toBe('insufficient_scope');
    expect(httpList.text).not.toContain('owner-notice');
    const httpMark = await call(markMessagesRoute, 'http://localhost/api/v1/messages/read', {
      bearer: guestKey,
      body: { message_ids: [notice] },
    });
    expect(httpMark.status).toBe(403);
    const tokenHttp = await call(listMessagesRoute, 'http://localhost/api/v1/messages', { bearer: token });
    expect(tokenHttp.status).toBe(401);
    expect(await readAt(notice)).toBeNull();
    expect(bodies(await listed(mateKey))).toEqual(['owner-notice']);
  });
});
