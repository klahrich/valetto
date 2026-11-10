import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PATCH as renameRoute } from '@/app/api/v1/agents/[id]/route';
import { POST as postOffer } from '@/app/api/v1/agents/[id]/offers/route';
import { POST as postShare } from '@/app/api/v1/agents/[id]/shares/route';
import { POST as approveShare } from '@/app/api/v1/agents/[id]/shares/[shareId]/approve/route';
import { PUT as putSharing } from '@/app/api/v1/agents/[id]/sharing/route';
import { PATCH as patchWorkspace } from '@/app/api/v1/workspaces/current/route';
import { call, createAgent, createKey, mcpListTools, mcpTool, signIn } from './helpers';

const ISSUER = 'http://localhost';

function handleName(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

async function patchAgent(
  agentId: string,
  name: unknown,
  auth: { cookie?: string; bearer?: string; origin?: string },
) {
  return call(renameRoute, `${ISSUER}/api/v1/agents/${agentId}`, {
    method: 'PATCH',
    body: { name },
    cookie: auth.cookie,
    bearer: auth.bearer,
    params: { id: agentId },
    headers: auth.origin ? { origin: auth.origin } : {},
  });
}

describe('rename an agent', () => {
  it('lets the owner rename from the dashboard route, and the agent rename itself', async () => {
    const owner = await signIn();
    const bot = await createAgent(owner.cookie, 'OldBot', 'Drafts');
    const peer = await createAgent(owner.cookie, 'PeerBot');
    const key = await createKey(owner.cookie, bot.id);
    const peerKey = await createKey(owner.cookie, peer.id);

    const byOwner = await patchAgent(bot.id, '  MidBot  ', { cookie: owner.cookie });
    expect(byOwner.status).toBe(200);
    expect(byOwner.data.agent.name).toBe('MidBot');
    expect(byOwner.data.agent.id).toBe(bot.id);
    expect((await mcpTool(key, 'whoami')).payload.name).toBe('MidBot');

    const same = await patchAgent(bot.id, 'MidBot', { cookie: owner.cookie });
    expect(same.status).toBe(200);
    expect(same.data.agent.name).toBe('MidBot');

    const bySelf = await patchAgent(bot.id, 'NewBot', { bearer: key });
    expect(bySelf.status).toBe(200);
    expect(bySelf.data.agent.name).toBe('NewBot');
    expect((await mcpTool(key, 'whoami')).payload.name).toBe('NewBot');

    const teammate = await patchAgent(bot.id, 'Stolen', { bearer: peerKey });
    expect(teammate.status).toBe(403);
    expect(teammate.data.error.code).toBe('forbidden');
    expect((await mcpTool(key, 'whoami')).payload.name).toBe('NewBot');

    const taken = await patchAgent(bot.id, 'PeerBot', { cookie: owner.cookie });
    expect(taken.status).toBe(409);
    expect(taken.data.error.code).toBe('name_taken');

    const invalid = await patchAgent(bot.id, 'no spaces', { cookie: owner.cookie });
    expect(invalid.status).toBe(400);
    expect(invalid.data.error.code).toBe('invalid_name');

    const foreign = await patchAgent(bot.id, 'Other', { cookie: (await signIn()).cookie });
    expect(foreign.status).toBe(404);

    const crossSite = await patchAgent(bot.id, 'Other', { cookie: owner.cookie, origin: 'https://evil.example' });
    expect(crossSite.status).toBe(403);
  });

  it('renames through MCP rename_agent, only for the caller, and updates message and task names', async () => {
    const owner = await signIn();
    const alice = await createAgent(owner.cookie, 'alice');
    const bob = await createAgent(owner.cookie, 'bob');
    const aliceKey = await createKey(owner.cookie, alice.id);
    const bobKey = await createKey(owner.cookie, bob.id);

    const tools = await mcpListTools(aliceKey);
    expect(tools.map((tool) => tool.name)).toContain('rename_agent');

    const sent = await mcpTool(aliceKey, 'send_message', { to: 'bob', body: 'hello from alice' });
    expect(sent.isError).toBe(false);

    const renamed = await mcpTool(aliceKey, 'rename_agent', { name: 'alice-v2' });
    expect(renamed.isError).toBe(false);
    expect(renamed.payload.agent.name).toBe('alice-v2');
    expect(renamed.payload.agent.id).toBe(alice.id);

    expect((await mcpTool(aliceKey, 'whoami')).payload.name).toBe('alice-v2');
    const listed = await mcpTool(bobKey, 'list_agents');
    expect(listed.payload.agents.map((agent: { name: string }) => agent.name)).toEqual(['alice-v2', 'bob']);

    const inbox = await mcpTool(bobKey, 'list_messages');
    expect(inbox.isError).toBe(false);
    expect(inbox.payload.messages[0].from).toBe('alice-v2');
    expect(inbox.payload.messages[0].from_agent_id).toBe(alice.id);

    const task = await mcpTool(bobKey, 'create_task', {
      to: 'alice-v2',
      title: 'Ping',
      description: 'Say hi',
      result_schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    });
    expect(task.isError).toBe(false);
    expect(task.payload.task.to).toBe('alice-v2');

    const stale = await mcpTool(bobKey, 'create_task', {
      to: 'alice',
      title: 'Stale',
      description: 'Old name',
      result_schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    });
    expect(stale.isError).toBe(true);
    expect(stale.payload.error).toBe('agent_not_found');

    const takeover = await mcpTool(bobKey, 'rename_agent', { name: 'alice-v2' });
    expect(takeover.isError).toBe(true);
    expect(takeover.payload.error).toBe('name_taken');
    expect((await mcpTool(bobKey, 'whoami')).payload.name).toBe('bob');
  });

  it('changes the shared @handle/name address and leaves grants and invite-style access on the agent id', async () => {
    const owner = await signIn();
    const guestOwner = await signIn();
    const planner = await createAgent(owner.cookie, 'Planner');
    const plannerKey = await createKey(owner.cookie, planner.id);
    const guest = await createAgent(guestOwner.cookie, 'GuestBot');
    const guestKey = await createKey(guestOwner.cookie, guest.id);

    const ownerHandle = handleName('o');
    const guestHandle = handleName('g');
    const handleRes = await call(patchWorkspace, `${ISSUER}/api/v1/workspaces/current`, {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { handle: ownerHandle },
    });
    expect(handleRes.status).toBe(200);
    const guestHandleRes = await call(patchWorkspace, `${ISSUER}/api/v1/workspaces/current`, {
      method: 'PATCH',
      cookie: guestOwner.cookie,
      body: { handle: guestHandle },
    });
    expect(guestHandleRes.status).toBe(200);

    const shared = await call(putSharing, `${ISSUER}/api/v1/agents/${planner.id}/sharing`, {
      method: 'PUT',
      cookie: owner.cookie,
      params: { id: planner.id },
      body: { shared: true },
    });
    expect(shared.status).toBe(200);

    const offer = await call(postOffer, `${ISSUER}/api/v1/agents/${planner.id}/offers`, {
      cookie: owner.cookie,
      params: { id: planner.id },
      body: {
        name: 'draft',
        description: 'Draft the requested page.',
        result_schema: { type: 'object', additionalProperties: false, required: ['headline'], properties: { headline: { type: 'string' } } },
      },
    });
    expect(offer.status).toBe(201);

    const invited = await call(postShare, `${ISSUER}/api/v1/agents/${planner.id}/shares`, {
      cookie: owner.cookie,
      params: { id: planner.id },
      body: { guest_handle: guestHandle, offers: ['draft'] },
    });
    expect(invited.status).toBe(201);
    const shareId = invited.data.share.id as string;
    const approved = await call(approveShare, `${ISSUER}/api/v1/agents/${planner.id}/shares/${shareId}/approve`, {
      method: 'POST',
      cookie: owner.cookie,
      params: { id: planner.id, shareId },
    });
    expect(approved.status).toBe(200);

    const oldAddress = `@${ownerHandle}/Planner`;
    const before = await mcpTool(guestKey, 'get_agent_card', { address: oldAddress });
    expect(before.isError).toBe(false);
    expect(before.payload.card.address).toBe(oldAddress);

    const renamed = await mcpTool(plannerKey, 'rename_agent', { name: 'PlannerV2' });
    expect(renamed.isError).toBe(false);
    expect(renamed.payload.agent.shared).toBe(true);

    const newAddress = `@${ownerHandle}/PlannerV2`;
    const after = await mcpTool(guestKey, 'get_agent_card', { address: newAddress });
    expect(after.isError).toBe(false);
    expect(after.payload.card.address).toBe(newAddress);
    expect(after.payload.card.name).toBe('PlannerV2');

    const staleCard = await mcpTool(guestKey, 'get_agent_card', { address: oldAddress });
    expect(staleCard.isError).toBe(true);

    const task = await mcpTool(guestKey, 'create_task', {
      to: newAddress,
      offer: 'draft',
      title: 'Page',
      description: 'Write it',
    });
    expect(task.isError).toBe(false);
    expect(task.payload.task.to).toBe('PlannerV2');
    expect(task.payload.task.to_agent_id).toBe(planner.id);
  });
});
