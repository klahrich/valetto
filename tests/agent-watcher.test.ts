import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as revokeAgent } from '@/app/api/v1/agents/[id]/revoke/route';
import { POST as testWake } from '@/app/api/v1/agents/[id]/test-wake/route';
import { POST as ack } from '@/app/api/v1/watcher/ack/route';
import { POST as poll } from '@/app/api/v1/watcher/poll/route';
import { POST as createWatcher } from '@/app/api/v1/watcher-keys/route';
import { getDb } from '@/db';
import { agents, wakes } from '@/db/schema';
import { RATE_LIMITS, WATCHER_ONLINE_MS } from '@/lib/constants';
import { call, createAgent, createKey, mcpTool, setHerdr, signIn } from './helpers';

const POLL = 'http://localhost/api/v1/watcher/poll';
const ACK = 'http://localhost/api/v1/watcher/ack';

async function localAgent(cookie: string, name: string, pane: string) {
  const agent = await createAgent(cookie, name);
  await setHerdr(cookie, agent.id, pane);
  const key = await createKey(cookie, agent.id);
  return { ...agent, key };
}

async function sendTestWake(cookie: string, agentId: string): Promise<string> {
  const res = await call(testWake, `http://localhost/api/v1/agents/${agentId}/test-wake`, {
    method: 'POST',
    cookie,
    params: { id: agentId },
  });
  expect(res.status).toBe(200);
  return res.data.wake_id as string;
}

async function wakeRow(id: string) {
  const [row] = await getDb().select().from(wakes).where(eq(wakes.id, id));
  return row!;
}

function ids(res: { data: { wakes: { id: string }[] } }): string[] {
  return res.data.wakes.map((wake) => wake.id);
}

describe('per-agent watcher: an agent key polls and acks only its own wakes', () => {
  it('queues a self-test and checks only its own wake and watcher activity', async () => {
    const session = await signIn();
    const a = await localAgent(session.cookie, 'SelfTest', 'self-test');
    const b = await localAgent(session.cookie, 'Sibling', 'sibling');

    const test = await mcpTool(a.key, 'test_wake');
    expect(test.isError, test.text).toBe(false);
    expect(test.payload).toMatchObject({ status: 'pending', wake_id: expect.any(String) });
    const wakeId = test.payload.wake_id as string;
    const readStatus = () => mcpTool(a.key, 'get_wake_status', { wake_id: wakeId });

    await call(poll, POLL, { bearer: a.key, body: { lease: false } });
    expect((await readStatus()).payload).toMatchObject({
      watcher_online: false,
      watcher_last_seen_at: null,
      wake: { status: 'pending', reason: 'test', task_id: null, message_id: null, attempts: 0 },
    });
    expect((await mcpTool(b.key, 'get_wake_status', { wake_id: wakeId })).payload.error).toBe('not_found');

    expect(ids(await call(poll, POLL, { bearer: a.key }))).toEqual([wakeId]);
    const leased = (await readStatus()).payload;
    expect(leased).toMatchObject({ watcher_online: true, watcher_last_seen_at: expect.any(String), wake: { status: 'pending', attempts: 1 } });
    expect((await mcpTool(b.key, 'get_wake_status')).payload.watcher_online).toBe(false);
    expect((await mcpTool(a.key, 'whoami')).payload.watcher_online).toBe(true);

    await call(ack, ACK, { bearer: a.key, body: { wake_ids: [wakeId] } });
    expect((await readStatus()).payload.wake).toMatchObject({ status: 'delivered', delivered_at: expect.any(String) });
    await getDb().update(agents).set({ watcherLastSeenAt: new Date(Date.now() - WATCHER_ONLINE_MS - 1_000) }).where(eq(agents.id, a.id));
    expect((await readStatus()).payload.watcher_online).toBe(false);
    expect(ids(await call(poll, POLL, { bearer: a.key }))).toEqual([]);
    expect((await readStatus()).payload.watcher_online).toBe(true);
  });

  it('requires local delivery and shares the dashboard test wake limit', async () => {
    const session = await signIn();
    const a = await localAgent(session.cookie, 'Local', 'self-test');
    const quiet = await createAgent(session.cookie, 'Quiet');
    const quietKey = await createKey(session.cookie, quiet.id);
    expect((await mcpTool(quietKey, 'test_wake')).payload.error).toBe('local_delivery_required');

    for (let i = 0; i < RATE_LIMITS.testWake.agent - 1; i++) {
      expect((await mcpTool(a.key, 'test_wake')).isError).toBe(false);
    }
    await sendTestWake(session.cookie, a.id);
    expect((await mcpTool(a.key, 'test_wake')).payload).toMatchObject({
      error: 'rate_limited', details: { retry_after_seconds: expect.any(Number) },
    });
  });

  it("never leases, returns, or acks another agent's wake in the same workspace", async () => {
    const session = await signIn();
    const a = await localAgent(session.cookie, 'AgentA', 'agent-a');
    const b = await localAgent(session.cookie, 'AgentB', 'agent-b');
    const wakeA = await sendTestWake(session.cookie, a.id);
    const wakeB = await sendTestWake(session.cookie, b.id);
    const beforeB = await wakeRow(wakeB);

    const polledA = await call(poll, POLL, { bearer: a.key });
    expect(polledA.status).toBe(200);
    expect(polledA.data).toMatchObject({ workspace_id: session.workspace.id, agent_id: a.id, agent_name: 'AgentA' });
    expect(ids(polledA)).toEqual([wakeA]);
    expect(polledA.data.wakes[0]).toMatchObject({ driver: 'herdr', target: 'agent-a', agent_name: 'AgentA' });
    expect(JSON.stringify(polledA.data)).not.toContain('agent-b');

    // A's poll did not lease B's wake: same attempts, same next attempt time.
    const afterB = await wakeRow(wakeB);
    expect(afterB.attempts).toBe(beforeB.attempts);
    expect(afterB.nextAttemptAt.getTime()).toBe(beforeB.nextAttemptAt.getTime());

    // A cannot ack B's wake, alone or mixed with its own.
    const ackB = await call(ack, ACK, { bearer: a.key, body: { wake_ids: [wakeB] } });
    expect(ackB.status).toBe(200);
    expect(ackB.data.acked).toBe(0);
    const mixed = await call(ack, ACK, { bearer: a.key, body: { wake_ids: [wakeB, wakeA] } });
    expect(mixed.data.acked).toBe(1);
    expect((await wakeRow(wakeA)).status).toBe('delivered');
    expect((await wakeRow(wakeB)).status).toBe('pending');

    // B's own key still gets B's wake, and only that.
    const polledB = await call(poll, POLL, { bearer: b.key });
    expect(ids(polledB)).toEqual([wakeB]);
    const ackOwn = await call(ack, ACK, { bearer: b.key, body: { wake_ids: [wakeB] } });
    expect(ackOwn.data.acked).toBe(1);

    // A later poll by A still never shows B's wakes.
    const wakeB2 = await sendTestWake(session.cookie, b.id);
    const again = await call(poll, POLL, { bearer: a.key });
    expect(ids(again)).not.toContain(wakeB2);
  });

  it('keeps the legacy workspace watcher key covering every local agent', async () => {
    const session = await signIn();
    const a = await localAgent(session.cookie, 'LegacyA', 'legacy-a');
    const b = await localAgent(session.cookie, 'LegacyB', 'legacy-b');
    const wakeA = await sendTestWake(session.cookie, a.id);
    const wakeB = await sendTestWake(session.cookie, b.id);
    const watcher = await call(createWatcher, 'http://localhost/api/v1/watcher-keys', {
      cookie: session.cookie,
      body: { name: 'desk' },
    });
    const secret = watcher.data.watcher_key.secret as string;
    const polled = await call(poll, POLL, { bearer: secret });
    expect(polled.status).toBe(200);
    expect(polled.data.agent_id).toBeUndefined();
    expect(ids(polled).sort()).toEqual([wakeA, wakeB].sort());
    const acked = await call(ack, ACK, { bearer: secret, body: { wake_ids: [wakeA, wakeB] } });
    expect(acked.data.acked).toBe(2);
  });

  it("gets nothing from another workspace's agent", async () => {
    const one = await signIn();
    const two = await signIn();
    const mine = await localAgent(one.cookie, 'MineBot', 'mine-bot');
    const theirs = await localAgent(two.cookie, 'TheirBot', 'their-bot');
    const theirWake = await sendTestWake(two.cookie, theirs.id);
    const polled = await call(poll, POLL, { bearer: mine.key });
    expect(polled.data.workspace_id).toBe(one.workspace.id);
    expect(ids(polled)).toEqual([]);
    const acked = await call(ack, ACK, { bearer: mine.key, body: { wake_ids: [theirWake] } });
    expect(acked.data.acked).toBe(0);
    expect((await wakeRow(theirWake)).status).toBe('pending');
  });

  it('identifies the caller without leasing when lease is false', async () => {
    const session = await signIn();
    const a = await localAgent(session.cookie, 'PeekBot', 'peek-bot');
    const wake = await sendTestWake(session.cookie, a.id);
    const before = await wakeRow(wake);
    const peek = await call(poll, POLL, { bearer: a.key, body: { lease: false } });
    expect(peek.status).toBe(200);
    expect(peek.data).toEqual({ wakes: [], workspace_id: session.workspace.id, agent_id: a.id, agent_name: 'PeekBot' });
    const after = await wakeRow(wake);
    expect(after.attempts).toBe(before.attempts);
    expect(after.nextAttemptAt.getTime()).toBe(before.nextAttemptAt.getTime());
  });

  it("rejects a revoked agent's key", async () => {
    const session = await signIn();
    const a = await localAgent(session.cookie, 'GoneBot', 'gone-bot');
    const revoked = await call(revokeAgent, `http://localhost/api/v1/agents/${a.id}/revoke`, {
      method: 'POST',
      cookie: session.cookie,
      params: { id: a.id },
    });
    expect(revoked.status).toBe(200);
    expect((await call(poll, POLL, { bearer: a.key })).status).toBe(401);
    expect((await call(ack, ACK, { bearer: a.key, body: { wake_ids: [] } })).status).toBe(401);
  });
});
