import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as postInvite } from '@/app/api/v1/agents/[id]/invites/route';
import { POST as postOffer } from '@/app/api/v1/agents/[id]/offers/route';
import { POST as postShare } from '@/app/api/v1/agents/[id]/shares/route';
import { POST as approveShare } from '@/app/api/v1/agents/[id]/shares/[shareId]/approve/route';
import { PUT as putSharing } from '@/app/api/v1/agents/[id]/sharing/route';
import { POST as postExternalTasks } from '@/app/api/v1/external/tasks/route';
import { PATCH as patchWorkspace } from '@/app/api/v1/workspaces/current/route';
import { getDb } from '@/db';
import { tasks, wakes } from '@/db/schema';
import { usePlanLimitsForTests } from '@/lib/plans';
import { createTaskRequestHash } from '@/lib/tasks';
import { call, createAgent, createKey, mcpTool, setHerdr, signIn } from './helpers';
import { realPostgres } from './test-database';

const resultSchema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
const offerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['headline'],
  properties: { headline: { type: 'string' } },
};

function handleName(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

async function setHandle(cookie: string, handle: string) {
  const res = await call(patchWorkspace, 'http://localhost/api/v1/workspaces/current', {
    method: 'PATCH',
    cookie,
    body: { handle },
  });
  expect(res.status).toBe(200);
}

/** Owner workspace with a handle and a shared agent Planner offering `draft`. */
async function sharedOwner() {
  const session = await signIn();
  const handle = handleName('o');
  await setHandle(session.cookie, handle);
  const planner = await createAgent(session.cookie, 'Planner');
  const offer = await call(postOffer, `http://localhost/api/v1/agents/${planner.id}/offers`, {
    cookie: session.cookie,
    params: { id: planner.id },
    body: { name: 'draft', description: 'Draft the page.', result_schema: offerSchema },
  });
  expect(offer.status).toBe(201);
  const shared = await call(putSharing, `http://localhost/api/v1/agents/${planner.id}/sharing`, {
    method: 'PUT',
    cookie: session.cookie,
    params: { id: planner.id },
    body: { shared: true },
  });
  expect(shared.status).toBe(200);
  return { cookie: session.cookie, handle, plannerId: planner.id };
}

async function grantGuest(ownerCookie: string, agentId: string, guestHandle: string, dailyCap: number) {
  const invited = await call(postShare, `http://localhost/api/v1/agents/${agentId}/shares`, {
    cookie: ownerCookie,
    params: { id: agentId },
    body: { guest_handle: guestHandle, offers: ['draft'], daily_cap: dailyCap },
  });
  expect(invited.status).toBe(201);
  const shareId = invited.data.share.id as string;
  const approved = await call(approveShare, `http://localhost/api/v1/agents/${agentId}/shares/${shareId}/approve`, {
    method: 'POST',
    cookie: ownerCookie,
    params: { id: agentId, shareId },
  });
  expect(approved.status).toBe(200);
}

/** A same-workspace pair: Sender and Worker, with a key for each. */
async function workspacePair() {
  const session = await signIn();
  const sender = await createAgent(session.cookie, 'Sender');
  const worker = await createAgent(session.cookie, 'Worker');
  const other = await createAgent(session.cookie, 'Other');
  // Local delivery, so a created task queues a wake row the tests can count.
  await setHerdr(session.cookie, worker.id, 'pane-1');
  return {
    session,
    sender,
    worker,
    senderKey: await createKey(session.cookie, sender.id),
    otherKey: await createKey(session.cookie, other.id),
  };
}

async function tasksWithKey(fromAgentId: string, key: string) {
  return getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.fromAgentId, fromAgentId), eq(tasks.idempotencyKey, key)));
}

async function wakesFor(taskId: string) {
  return getDb().select().from(wakes).where(eq(wakes.taskId, taskId));
}

afterEach(() => {
  usePlanLimitsForTests(null);
  delete process.env.VALETTO_AGENT_GUESTS;
});

describe('create_task idempotency_key', () => {
  it('hashes the semantic request regardless of key order or undefined fields', () => {
    const a = createTaskRequestHash({ to: 'Worker', title: 'T', description: 'D', resultSchema: { b: 1, a: [1, { y: 2, x: 1 }] } });
    const b = createTaskRequestHash({
      description: 'D',
      resultSchema: { a: [1, { x: 1, y: 2 }], b: 1 },
      title: 'T',
      to: 'Worker',
      offer: undefined,
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(createTaskRequestHash({ to: 'Worker', title: 'T', description: 'D2', resultSchema: {} })).not.toBe(
      createTaskRequestHash({ to: 'Worker', title: 'T', description: 'D', resultSchema: {} }),
    );
  });

  it('replays the original task over MCP without a new row, wake, or monthly quota', async () => {
    const p = await workspacePair();
    const key = `retry:${randomUUID()}`;
    const args = { to: 'Worker', title: 'Draft', description: 'Once only.', result_schema: resultSchema, idempotency_key: key };
    const first = await mcpTool(p.senderKey, 'create_task', args);
    expect(first.isError).toBe(false);
    expect(first.payload.idempotent_replay).toBeUndefined();
    const taskId = first.payload.task.id as string;
    expect(await wakesFor(taskId)).toHaveLength(1);

    // At the monthly cap, a new task is refused but the replay still returns the original.
    usePlanLimitsForTests({ agents: 10, tasksPerMonth: 1 });
    const replay = await mcpTool(p.senderKey, 'create_task', {
      // Same request, different key order in result_schema.
      ...args,
      result_schema: { properties: { ok: { type: 'boolean' } }, required: ['ok'], type: 'object' },
    });
    expect(replay.isError).toBe(false);
    expect(replay.payload.idempotent_replay).toBe(true);
    expect(replay.payload.task.id).toBe(taskId);
    expect(replay.payload.task.title).toBe('Draft');
    expect(await tasksWithKey(p.sender.id, key)).toHaveLength(1);
    expect(await wakesFor(taskId)).toHaveLength(1);

    const fresh = await mcpTool(p.senderKey, 'create_task', { ...args, idempotency_key: `retry:${randomUUID()}` });
    expect(fresh.isError).toBe(true);
    expect(fresh.payload.error).toBe('plan_limit');
  });

  it('rejects the same key with a different request (409) and writes nothing', async () => {
    const p = await workspacePair();
    const key = randomUUID();
    const args = { to: 'Worker', title: 'Draft', description: 'First.', result_schema: resultSchema, idempotency_key: key };
    const first = await mcpTool(p.senderKey, 'create_task', args);
    expect(first.isError).toBe(false);
    const reused = await mcpTool(p.senderKey, 'create_task', { ...args, description: 'Second.' });
    expect(reused.isError).toBe(true);
    expect(reused.payload.error).toBe('idempotency_key_reused');
    const otherTarget = await mcpTool(p.senderKey, 'create_task', { ...args, to: 'Other' });
    expect(otherTarget.payload.error).toBe('idempotency_key_reused');
    expect(await tasksWithKey(p.sender.id, key)).toHaveLength(1);
  });

  it('scopes keys per sending agent', async () => {
    const p = await workspacePair();
    const key = 'shared-key.1';
    const a = await mcpTool(p.senderKey, 'create_task', {
      to: 'Worker',
      title: 'From Sender',
      description: 'A',
      result_schema: resultSchema,
      idempotency_key: key,
    });
    const b = await mcpTool(p.otherKey, 'create_task', {
      to: 'Worker',
      title: 'From Other',
      description: 'B',
      result_schema: resultSchema,
      idempotency_key: key,
    });
    expect(a.isError).toBe(false);
    expect(b.isError).toBe(false);
    expect(b.payload.idempotent_replay).toBeUndefined();
    expect(b.payload.task.id).not.toBe(a.payload.task.id);
    expect(b.payload.task.title).toBe('From Other');
  });

  it('validates the key format', async () => {
    const p = await workspacePair();
    const base = { to: 'Worker', title: 'Draft', description: 'x', result_schema: resultSchema };
    for (const bad of ['', 'has space', 'slash/key', 'é', 'x'.repeat(129)]) {
      const res = await mcpTool(p.senderKey, 'create_task', { ...base, idempotency_key: bad });
      expect(res.isError, bad).toBe(true);
      expect(res.payload.error, bad).toBe('validation_error');
    }
    const longest = await mcpTool(p.senderKey, 'create_task', { ...base, idempotency_key: 'A9._:-'.padEnd(128, 'z') });
    expect(longest.isError).toBe(false);
  });

  it('does not spend the shared daily cap on a replay over MCP', async () => {
    const owner = await sharedOwner();
    const guest = await signIn();
    const guestHandle = handleName('g');
    await setHandle(guest.cookie, guestHandle);
    await grantGuest(owner.cookie, owner.plannerId, guestHandle, 1);
    const guestBot = await createAgent(guest.cookie, 'GuestBot');
    const guestKey = await createKey(guest.cookie, guestBot.id);
    const args = {
      to: `@${owner.handle}/Planner`,
      offer: 'draft',
      title: 'Guest draft',
      description: 'Cap of one.',
      idempotency_key: 'guest-1',
    };
    const first = await mcpTool(guestKey, 'create_task', args);
    expect(first.isError).toBe(false);
    for (let i = 0; i < 2; i += 1) {
      const replay = await mcpTool(guestKey, 'create_task', args);
      expect(replay.isError).toBe(false);
      expect(replay.payload.idempotent_replay).toBe(true);
      expect(replay.payload.task.id).toBe(first.payload.task.id);
    }
    // The cap of one was spent once, by the first call.
    const another = await mcpTool(guestKey, 'create_task', { ...args, idempotency_key: 'guest-2' });
    expect(another.payload.error).toBe('rate_limited');
    expect(await tasksWithKey(guestBot.id, 'guest-1')).toHaveLength(1);
  });

  describe('external HTTP', () => {
    beforeEach(() => {
      process.env.VALETTO_AGENT_GUESTS = '1';
    });

    it('returns 201 then 200 with idempotent_replay, 409 on reuse, 400 on a bad key, and spends the cap once', async () => {
      const owner = await sharedOwner();
      const invite = await call(postInvite, `http://localhost/api/v1/agents/${owner.plannerId}/invites`, {
        cookie: owner.cookie,
        params: { id: owner.plannerId },
        body: { kind: 'agent', offers: ['draft'], approve_on_redeem: true, daily_cap: 1, max_uses: 1 },
      });
      expect(invite.status).toBe(201);
      const token = invite.data.token as string;
      const body = {
        to: `@${owner.handle}/Planner`,
        offer: 'draft',
        title: 'HTTP',
        description: 'From the fallback.',
        idempotency_key: 'ext-1',
      };
      const post = (payload: Record<string, unknown>) =>
        call(postExternalTasks, 'http://localhost/api/v1/external/tasks', { bearer: token, body: payload });

      const first = await post(body);
      expect(first.status).toBe(201);
      expect(first.data.idempotent_replay).toBeUndefined();
      const replay = await post(body);
      expect(replay.status).toBe(200);
      expect(replay.data.idempotent_replay).toBe(true);
      expect(replay.data.task.id).toBe(first.data.task.id);

      const reused = await post({ ...body, title: 'Other' });
      expect(reused.status).toBe(409);
      expect(reused.data.error.code).toBe('idempotency_key_reused');

      const bad = await post({ ...body, idempotency_key: 'no spaces' });
      expect(bad.status).toBe(400);
      expect(bad.data.error.code).toBe('validation_error');

      const capped = await post({ ...body, idempotency_key: 'ext-2' });
      expect(capped.status).toBe(429);
      expect(capped.data.error.code).toBe('rate_limited');

      // MCP with the same invite bearer shares the key space (same sending agent).
      const mcpReplay = await mcpTool(token, 'create_task', body);
      expect(mcpReplay.isError).toBe(false);
      expect(mcpReplay.payload.idempotent_replay).toBe(true);
      expect(mcpReplay.payload.task.id).toBe(first.data.task.id);
    });
  });

  // Two connections racing the same key: PGlite is one session, so this needs a real server.
  it.runIf(realPostgres)('lets one of two concurrent duplicates win and replays it to the other', async () => {
    const p = await workspacePair();
    const key = `race-${randomUUID()}`;
    const args = { to: 'Worker', title: 'Race', description: 'Twice at once.', result_schema: resultSchema, idempotency_key: key };
    const results = await Promise.all([1, 2, 3].map(() => mcpTool(p.senderKey, 'create_task', args)));
    for (const res of results) expect(res.isError).toBe(false);
    const ids = new Set(results.map((res) => res.payload.task.id));
    expect(ids.size).toBe(1);
    expect(results.filter((res) => res.payload.idempotent_replay === true).length).toBe(2);
    const rows = await tasksWithKey(p.sender.id, key);
    expect(rows).toHaveLength(1);
    expect(await wakesFor(rows[0]!.id)).toHaveLength(1);
  });
});
