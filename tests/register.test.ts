import { describe, expect, it } from 'vitest';
import { POST as register } from '@/app/api/v1/agents/register/route';
import { POST as revokeJoin } from '@/app/api/v1/join-codes/[id]/revoke/route';
import { call, createJoinCode, mcpListTools, mcpTool, signIn } from './helpers';
import { TOOL_DOCS } from '@/lib/mcp-tools';

describe('agent self-registration', () => {
  it('registers once with a join code and the returned key works on MCP', async () => {
    const session = await signIn();
    const code = await createJoinCode(session.cookie);
    const registered = await call(register, 'https://preview.example/api/v1/agents/register', {
      bearer: code.secret,
      headers: { 'x-forwarded-host': 'preview.example', 'x-forwarded-proto': 'https' },
      body: { name: 'LandingBot', description: 'Drafts pages' },
    });
    expect(registered.status).toBe(201);
    expect(registered.data.api_key.startsWith('rsk_')).toBe(true);
    expect(registered.data.mcp.url).toBe('https://preview.example/api/mcp');
    expect(registered.data.mcp.header).toBe('Bearer <api_key>');
    expect(registered.data.next_steps).toContain('Bearer <api_key>');
    expect(registered.data.next_steps).toContain('https://preview.example/docs/getting-started.md');
    expect(registered.text.split(registered.data.api_key).length - 1).toBe(1);

    const listed = await mcpListTools(registered.data.api_key);
    const names = listed.map((tool) => tool.name).sort();
    // redeem_invite is registered only when VALETTO_AGENT_GUESTS is on, which it is not here.
    const expected = TOOL_DOCS.filter((tool) => tool.name !== 'redeem_invite');
    expect(names).toEqual(expected.map((tool) => tool.name).sort());
    for (const tool of expected) {
      const remote = listed.find((item) => item.name === tool.name);
      for (const arg of tool.args) {
        expect(remote?.inputSchema?.properties).toHaveProperty(arg.name);
      }
    }
    const tasks = await mcpTool(registered.data.api_key, 'list_tasks', {});
    expect(tasks.isError).toBe(false);
    expect(tasks.payload.tasks).toEqual([]);

    const reused = await call(register, 'http://localhost/api/v1/agents/register', {
      bearer: code.secret,
      body: { name: 'OtherBot' },
    });
    expect(reused.status).toBe(401);
    expect(reused.data.error.message).toMatch(/already been used/i);
  });

  it('rejects an invalid join code', async () => {
    const res = await call(register, 'http://localhost/api/v1/agents/register', {
      bearer: 'rjc_not-a-real-code',
      body: { name: 'Nope' },
    });
    expect(res.status).toBe(401);
    expect(res.data.error.message).toMatch(/invalid join code/i);
  });

  it('rejects a revoked join code', async () => {
    const session = await signIn();
    const code = await createJoinCode(session.cookie);
    const revoked = await call(revokeJoin, `http://localhost/api/v1/join-codes/${code.id}/revoke`, {
      cookie: session.cookie,
      params: { id: code.id },
    });
    expect(revoked.status).toBe(200);
    const res = await call(register, 'http://localhost/api/v1/agents/register', {
      bearer: code.secret,
      body: { name: 'LateBot' },
    });
    expect(res.status).toBe(401);
    expect(res.data.error.message).toMatch(/revoked/i);
  });

  it('returns 409 for a duplicate name and leaves the code usable', async () => {
    const session = await signIn();
    const code = await createJoinCode(session.cookie);
    const first = await call(register, 'http://localhost/api/v1/agents/register', {
      bearer: code.secret,
      body: { name: 'SameName' },
    });
    expect(first.status).toBe(201);
    const secondCode = await createJoinCode(session.cookie);
    const clash = await call(register, 'http://localhost/api/v1/agents/register', {
      bearer: secondCode.secret,
      body: { name: 'SameName' },
    });
    expect(clash.status).toBe(409);
    expect(clash.data.error.code).toBe('name_taken');
    const renamed = await call(register, 'http://localhost/api/v1/agents/register', {
      bearer: secondCode.secret,
      body: { name: 'SameNameTwo' },
    });
    expect(renamed.status).toBe(201);
  });

  it('sets local delivery at register and rejects webhook plus delivery', async () => {
    const session = await signIn();
    const code = await createJoinCode(session.cookie);
    const registered = await call(register, 'https://preview.example/api/v1/agents/register', {
      bearer: code.secret,
      headers: { 'x-forwarded-host': 'preview.example', 'x-forwarded-proto': 'https' },
      body: {
        name: 'OrcaBot',
        delivery: { mode: 'local', driver: 'orca', target: 'tab1:leaf-uuid' },
      },
    });
    expect(registered.status).toBe(201);
    expect(registered.data.agent.delivery.mode).toBe('local');
    expect(registered.data.agent.delivery.driver).toBe('orca');
    expect(registered.data.agent.delivery.target).toBe('tab1:leaf-uuid');

    const me = await mcpTool(registered.data.api_key, 'whoami', {});
    expect(me.isError).toBe(false);
    expect(me.payload.delivery.mode).toBe('local');
    expect(me.payload.delivery.driver).toBe('orca');
    expect(me.payload.delivery.target).toBe('tab1:leaf-uuid');

    const secondCode = await createJoinCode(session.cookie);
    const both = await call(register, 'http://localhost/api/v1/agents/register', {
      bearer: secondCode.secret,
      body: {
        name: 'BothBot',
        webhook: { url: 'https://example.com/hook', auth: { type: 'none' } },
        delivery: { mode: 'local', driver: 'orca', target: 'tab1:leaf-uuid' },
      },
    });
    expect(both.status).toBe(400);
    expect(both.data.error.code).toBe('validation_error');

    const still = await call(register, 'http://localhost/api/v1/agents/register', {
      bearer: secondCode.secret,
      body: { name: 'BothBot' },
    });
    expect(still.status).toBe(201);
  });

  it('rejects an invalid Orca pane key at register and leaves the code usable', async () => {
    const session = await signIn();
    const code = await createJoinCode(session.cookie);
    const bad = await call(register, 'http://localhost/api/v1/agents/register', {
      bearer: code.secret,
      body: { name: 'BadPane', delivery: { mode: 'local', driver: 'orca', target: 'not-a-pane' } },
    });
    expect(bad.status).toBe(400);
    const ok = await call(register, 'http://localhost/api/v1/agents/register', {
      bearer: code.secret,
      body: { name: 'BadPane', delivery: { mode: 'local', driver: 'herdr', target: 'dev-bot' } },
    });
    expect(ok.status).toBe(201);
    expect(ok.data.agent.delivery.mode).toBe('local');
    expect(ok.data.agent.delivery.driver).toBe('herdr');
    expect(ok.data.agent.delivery.target).toBe('dev-bot');
  });
});
