import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET as listMessagesRoute } from '@/app/api/v1/messages/route';
import { POST as markMessagesRoute } from '@/app/api/v1/messages/read/route';
import { getDb } from '@/db';
import { messages } from '@/db/schema';
import { call, createAgent, createKey, mcpTool, signIn } from './helpers';

const RESULT_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };

async function pair(names: { from?: string; to?: string; third?: string } = {}) {
  const session = await signIn();
  const from = await createAgent(session.cookie, names.from ?? 'alice');
  const to = await createAgent(session.cookie, names.to ?? 'bob');
  const third = await createAgent(session.cookie, names.third ?? 'carol');
  return {
    session,
    from,
    to,
    third,
    fromKey: await createKey(session.cookie, from.id),
    toKey: await createKey(session.cookie, to.id),
    thirdKey: await createKey(session.cookie, third.id),
  };
}

describe('send_message in_reply_to', () => {
  it('auto-addresses the original sender, returns the link, and lists it over MCP and HTTP', async () => {
    const { from, to, fromKey, toKey } = await pair();
    const sent = await mcpTool(fromKey, 'send_message', { to: 'bob', body: 'hello bob' });
    expect(sent.isError, sent.text).toBe(false);
    expect(sent.payload.message.in_reply_to).toBeNull();
    const originalId = sent.payload.message.id as string;

    const reply = await mcpTool(toKey, 'send_message', { in_reply_to: originalId, body: 'hi alice' });
    expect(reply.isError, reply.text).toBe(false);
    expect(reply.payload.message).toMatchObject({
      from: 'bob',
      to: 'alice',
      from_agent_id: to.id,
      to_agent_id: from.id,
      body: 'hi alice',
      task_id: null,
      in_reply_to: originalId,
    });

    const inbox = await mcpTool(fromKey, 'list_messages', {});
    expect(inbox.isError, inbox.text).toBe(false);
    expect(inbox.payload.messages).toHaveLength(1);
    expect(inbox.payload.messages[0]).toMatchObject({ id: reply.payload.message.id, in_reply_to: originalId, from: 'bob' });

    const http = await call(listMessagesRoute, 'http://localhost/api/v1/messages', { bearer: fromKey });
    expect(http.status).toBe(200);
    expect(http.data.messages[0].in_reply_to).toBe(originalId);

    const marked = await call(markMessagesRoute, 'http://localhost/api/v1/messages/read', {
      bearer: fromKey,
      body: { message_ids: [reply.payload.message.id] },
    });
    expect(marked.status).toBe(200);
    expect(marked.data.messages[0].in_reply_to).toBe(originalId);
  });

  it('rejects a message the caller did not receive, and a to that is not the original sender', async () => {
    const { fromKey, toKey, thirdKey } = await pair();
    const sent = await mcpTool(fromKey, 'send_message', { to: 'bob', body: 'for bob' });
    const originalId = sent.payload.message.id as string;

    const asSender = await mcpTool(fromKey, 'send_message', { in_reply_to: originalId, body: 'cannot reply to my own' });
    expect(asSender.isError).toBe(true);
    expect(asSender.payload).toMatchObject({ error: 'not_found' });

    const asBystander = await mcpTool(thirdKey, 'send_message', { in_reply_to: originalId, body: 'not mine' });
    expect(asBystander.isError).toBe(true);
    expect(asBystander.payload).toMatchObject({ error: 'not_found' });

    const mismatch = await mcpTool(toKey, 'send_message', {
      in_reply_to: originalId,
      to: 'carol',
      body: 'wrong person',
    });
    expect(mismatch.isError).toBe(true);
    expect(mismatch.payload).toMatchObject({ error: 'invalid_recipient' });
    expect(String(mismatch.text)).toMatch(/in_reply_to/);

    const withTo = await mcpTool(toKey, 'send_message', { in_reply_to: originalId, to: 'alice', body: 'ok' });
    expect(withTo.isError, withTo.text).toBe(false);
    expect(withTo.payload.message.in_reply_to).toBe(originalId);
    expect(withTo.payload.message.to).toBe('alice');
  });

  it('does not accept an in_reply_to from another workspace, and keeps guests from messaging', async () => {
    const here = await pair();
    const there = await pair({ from: 'erin', to: 'frank' });
    const sent = await mcpTool(there.fromKey, 'send_message', { to: 'frank', body: 'other workspace' });
    const foreignId = sent.payload.message.id as string;

    const denied = await mcpTool(here.toKey, 'send_message', { in_reply_to: foreignId, body: 'nope' });
    expect(denied.isError).toBe(true);
    expect(denied.payload).toMatchObject({ error: 'not_found' });
    const rows = await getDb().select({ id: messages.id }).from(messages).where(eq(messages.inReplyTo, foreignId));
    expect(rows).toEqual([]);

    const shared = await mcpTool(here.fromKey, 'send_message', {
      to: '@someone/erin',
      in_reply_to: sent.payload.message.id,
      body: 'cross',
    });
    expect(shared.isError).toBe(true);
    expect(shared.payload).toMatchObject({ error: 'invalid_recipient' });
  });

  it('links a reply on a task thread and returns it from get_task', async () => {
    const { fromKey, toKey } = await pair();
    const task = await mcpTool(fromKey, 'create_task', {
      to: 'bob',
      title: 'Work',
      description: 'Do it.',
      result_schema: RESULT_SCHEMA,
    });
    expect(task.isError, task.text).toBe(false);
    const taskId = task.payload.task.id as string;
    const thread = await mcpTool(fromKey, 'send_message', { to: 'bob', body: 'on the thread', task_id: taskId });
    expect(thread.isError, thread.text).toBe(false);
    const reply = await mcpTool(toKey, 'send_message', {
      in_reply_to: thread.payload.message.id,
      task_id: taskId,
      body: 'got it',
    });
    expect(reply.isError, reply.text).toBe(false);
    expect(reply.payload.message).toMatchObject({
      to: 'alice',
      task_id: taskId,
      in_reply_to: thread.payload.message.id,
    });
    const got = await mcpTool(fromKey, 'get_task', { id: taskId });
    expect(got.payload.messages.map((message: { in_reply_to: string | null }) => message.in_reply_to)).toEqual([
      null,
      thread.payload.message.id,
    ]);
  });
});
