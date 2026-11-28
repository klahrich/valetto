import { eq } from 'drizzle-orm';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sitemap from '@/app/sitemap';
import { GET as valettoSitemap } from '@/app/valetto-seo/sitemap/route';
import { GET as reviewModeRoute } from '@/app/api/v1/agents/[id]/review-mode/route';
import { POST as redeemRoute } from '@/app/api/v1/invites/redeem/route';
import { POST as answerRoute } from '@/app/api/v1/tasks/[id]/answer/route';
import { getDb } from '@/db';
import { setAgentDelivery } from '@/lib/agents';
import { agents, messages, oauthClients, tasks, wakes, workspaces } from '@/db/schema';
import { mcpAuthHandler } from '@/lib/mcp-server';
import { setCimdFetcherForTests } from '@/lib/oauth/cimd';
import { RSK_SCOPES } from '@/lib/oauth/config';
import { TOOL_SCOPES, toolAllowed } from '@/lib/oauth/scopes';
import nextConfig from '../next.config';
import { call, createAgent, createKey, mcpListTools, mcpTool, parseRpc, signIn } from './helpers';
import { stubCimd } from './oauth-fixtures';
import { ISSUER, connect } from './oauth-flow';

/** §5.7 / §7: which tools a connected app may call, and what it may send back. */

const RESULT_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
const DENIED_TOOLS = Object.entries(TOOL_SCOPES)
  .filter(([, scope]) => scope !== 'agent')
  .map(([name]) => name);

beforeEach(async () => {
  await getDb().delete(oauthClients);
  vi.stubEnv('MCP_OAUTH_ENABLED', '1');
  vi.stubEnv('MCP_OAUTH_ISSUER', ISSUER);
  vi.stubEnv('VALETTO_AGENT_GUESTS', '1');
  stubCimd();
});

afterEach(() => {
  setCimdFetcherForTests(null);
  vi.unstubAllEnvs();
});

async function setup() {
  const owner = await signIn();
  const app = await connect(owner, { mode: 'new', name: 'chatgpt' });
  const appAgentId = (await mcpTool(app.tokens.access_token, 'whoami')).payload.id as string;
  const appKey = await createKey(owner.cookie, appAgentId);
  const b = await createAgent(owner.cookie, 'bee');
  const bKey = await createKey(owner.cookie, b.id);
  return { owner, oauth: app.tokens.access_token, appKey, bKey, appAgentId };
}

const task = (to: string) => ({ to, title: 'Work', description: 'Do the work.', result_schema: RESULT_SCHEMA });

async function snapshot(workspaceId: string) {
  const db = getDb();
  return JSON.stringify({
    workspace: await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)),
    agents: await db.select().from(agents).where(eq(agents.workspaceId, workspaceId)).orderBy(agents.name),
    tasks: await db.select().from(tasks).where(eq(tasks.workspaceId, workspaceId)).orderBy(tasks.createdAt),
    messages: await db.select().from(messages).where(eq(messages.workspaceId, workspaceId)),
    wakes: (await db.select().from(wakes).where(eq(wakes.workspaceId, workspaceId))).length,
  });
}

describe('tool scopes', () => {
  it('every registered tool has a scope entry and is listed for rsk_', async () => {
    const { appKey } = await setup();
    const listed = (await mcpListTools(appKey)).map((tool) => tool.name).sort();
    expect(listed).toEqual(Object.keys(TOOL_SCOPES).sort());
  });

  it('tools/list for an rsoa_ token leaves out exactly the tools tools/call would refuse', async () => {
    const { appKey, oauth } = await setup();
    const full = await mcpListTools(appKey);
    const listed = await mcpListTools(oauth);
    const names = listed.map((tool) => tool.name).sort();
    expect(names).toEqual(
      [
        'answer_task',
        'create_task',
        'get_agent_card',
        'get_task',
        'list_agents',
        'list_messages',
        'get_message',
        'get_wake_status',
        'list_tasks',
        'mark_messages_read',
        'rename_agent',
        'send_message',
        'set_availability',
        'test_wake',
        'whoami',
      ].sort(),
    );
    expect(names).toEqual(Object.keys(TOOL_SCOPES).filter((name) => toolAllowed(name, ['agent'])).sort());
    for (const denied of DENIED_TOOLS) expect(names).not.toContain(denied);
    // The tools that remain are listed exactly as rsk_ sees them (same schema, title, description).
    for (const tool of listed) expect(tool).toEqual(full.find((entry) => entry.name === tool.name));
  });

  it('rsk_ listing is unchanged with agent guests off, and OAuth still sees only agent tools', async () => {
    const { appKey, oauth } = await setup();
    vi.stubEnv('VALETTO_AGENT_GUESTS', '');
    const rsk = (await mcpListTools(appKey)).map((tool) => tool.name);
    expect(rsk).toHaveLength(Object.keys(TOOL_SCOPES).length - 1);
    expect(rsk).not.toContain('redeem_invite');
    expect((await mcpListTools(oauth)).map((tool) => tool.name)).toHaveLength(15);
  });

  it('toolAllowed is the shared predicate: rsk_ scopes allow everything, unknown names never pass', () => {
    for (const name of Object.keys(TOOL_SCOPES)) {
      expect(toolAllowed(name, [...RSK_SCOPES])).toBe(true);
      expect(toolAllowed(name, ['agent'])).toBe(TOOL_SCOPES[name as keyof typeof TOOL_SCOPES] === 'agent');
      expect(toolAllowed(name, undefined)).toBe(false);
    }
    expect(toolAllowed('not_a_tool', [...RSK_SCOPES])).toBe(false);
    expect(toolAllowed('constructor', [...RSK_SCOPES])).toBe(false);
    expect(toolAllowed('__proto__', [...RSK_SCOPES])).toBe(false);
  });

  it('an rsoa_ token gets insufficient_scope on respond and owner tools and changes nothing', async () => {
    const { owner, oauth, bKey } = await setup();
    const received = await mcpTool(bKey, 'create_task', task('chatgpt'));
    const id = received.payload.task.id as string;
    const args: Record<string, Record<string, unknown>> = {
      complete_task: { id, result: { ok: true } },
      fail_task: { id, reason: 'no' },
      ask: { id, question: 'why?' },
      set_wake_target: { target: 'tab:leaf' },
      set_workspace_handle: { handle: 'takeover' },
      set_agent_sharing: { agent: 'bee', shared: true },
      upsert_offer: { agent: 'bee', name: 'x', description: 'x', result_schema: RESULT_SCHEMA },
      delete_offer: { agent: 'bee', name: 'x' },
      invite_guest: { agent: 'bee', guest_handle: 'someone', offers: ['x'] },
      revoke_guest: { agent: 'bee', guest_handle: 'someone' },
      list_guest_shares: { agent: 'bee' },
      redeem_invite: { invite: 'rsi_whatever' },
    };
    expect(Object.keys(args).sort()).toEqual([...DENIED_TOOLS].sort());
    const before = await snapshot(owner.workspace.id);
    for (const tool of DENIED_TOOLS) {
      const res = await mcpTool(oauth, tool, args[tool]);
      expect(res.isError, tool).toBe(true);
      expect(res.payload, tool).toMatchObject({ error: 'insufficient_scope' });
      expect(res.payload.message).toMatch(/Connected apps can't use this tool/);
    }
    expect(await snapshot(owner.workspace.id)).toBe(before);
  });

  it('lets an agent replace only its own existing local wake target', async () => {
    const { owner, appKey, bKey, appAgentId } = await setup();
    const before = { mode: 'local', driver: 'orca', target: 'old:leaf' } as const;
    const after = { ...before, target: 'new:leaf' };
    await setAgentDelivery(owner.workspace.id, appAgentId, before);

    const refused = await mcpTool(bKey, 'set_wake_target', { target: after.target });
    expect(refused.payload).toMatchObject({ error: 'local_delivery_required' });
    expect((await mcpTool(appKey, 'set_wake_target', { target: 'terminal-handle' })).payload)
      .toMatchObject({ error: 'validation_error' });
    const otherAgent = await call(mcpAuthHandler, 'http://localhost/api/mcp', {
      bearer: appKey,
      headers: { accept: 'application/json, text/event-stream' },
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'set_wake_target', arguments: { target: after.target, agent: 'bee' },
      } },
    });
    expect(parseRpc(otherAgent.text).result.isError).toBe(true);
    expect((await mcpTool(appKey, 'whoami')).payload.delivery).toEqual(before);
    expect((await mcpTool(appKey, 'set_wake_target', { target: after.target })).payload).toEqual({ delivery: after });
    expect((await mcpTool(appKey, 'whoami')).payload.delivery).toEqual(after);
    expect((await mcpTool(bKey, 'whoami')).payload.delivery).toEqual({ mode: 'none' });
  });

  it('sends nothing back on received tasks; follows up on its own', async () => {
    const { owner, oauth, appKey, bKey } = await setup();
    const received = (await mcpTool(bKey, 'create_task', task('chatgpt'))).payload.task.id as string;

    const before = await snapshot(owner.workspace.id);
    const onReceived = await mcpTool(oauth, 'send_message', { to: 'bee', body: 'leak', task_id: received });
    expect(onReceived.payload).toMatchObject({ error: 'insufficient_scope' });
    expect(onReceived.payload.message).toMatch(/only message on tasks they created/);
    const standalone = await mcpTool(oauth, 'send_message', { to: 'bee', body: 'hello' });
    expect(standalone.payload).toMatchObject({ error: 'insufficient_scope' });
    expect(await snapshot(owner.workspace.id)).toBe(before);
    // The same agent's rsk_ key still can, as today.
    expect((await mcpTool(appKey, 'send_message', { to: 'bee', body: 'ok', task_id: received })).isError).toBe(false);

    // Own task: thread message works and wakes B; answer_task works after B asks.
    const own = (await mcpTool(oauth, 'create_task', task('bee'))).payload.task.id as string;
    const followUp = await mcpTool(oauth, 'send_message', { to: 'bee', body: 'more detail', task_id: own });
    expect(followUp.isError).toBe(false);
    expect((await mcpTool(bKey, 'ask', { id: own, question: 'which file?' })).isError).toBe(false);
    const answered = await mcpTool(oauth, 'answer_task', { id: own, answer: 'notes.md' });
    expect(answered.isError).toBe(false);

    // answer_task on a task it received (put in needs_info with its rsk_ key) is refused by the sender check.
    expect((await mcpTool(appKey, 'ask', { id: received, question: 'context?' })).isError).toBe(false);
    const refused = await mcpTool(oauth, 'answer_task', { id: received, answer: 'self-answer' });
    expect(refused.payload).toMatchObject({ error: 'forbidden' });
    const [row] = await getDb().select().from(tasks).where(eq(tasks.id, received));
    expect(row?.status).toBe('needs_info');
  });

  it('reads and marks only the connected agent inbox, and a foreign id marks nothing', async () => {
    const { owner, oauth, bKey } = await setup();
    const cee = await createAgent(owner.cookie, 'cee');
    const ceeKey = await createKey(owner.cookie, cee.id);
    expect((await mcpTool(bKey, 'send_message', { to: 'chatgpt', body: 'completion notice' })).isError).toBe(false);
    const hidden = await mcpTool(bKey, 'send_message', { to: 'cee', body: 'not for the app' });
    expect(hidden.isError).toBe(false);
    const hiddenId = hidden.payload.message.id as string;

    const listed = await mcpTool(oauth, 'list_messages', {});
    expect(listed.isError, listed.text).toBe(false);
    expect(listed.payload.messages.map((message: { body: string }) => message.body)).toEqual(['completion notice']);
    expect(listed.payload.messages[0].unread).toBe(true);
    const noticeId = listed.payload.messages[0].id as string;

    const lookup = await mcpTool(oauth, 'get_message', { id: noticeId });
    expect(lookup.isError, lookup.text).toBe(false);
    expect(lookup.payload.message).toEqual(listed.payload.messages[0]);

    const mixed = await mcpTool(oauth, 'mark_messages_read', { message_ids: [noticeId, hiddenId] });
    expect(mixed.payload).toMatchObject({ error: 'not_found' });
    const still = await mcpTool(oauth, 'list_messages', { unread: true });
    expect(still.payload.messages.map((message: { id: string }) => message.id)).toEqual([noticeId]);
    const forCee = await mcpTool(ceeKey, 'list_messages', { unread: true });
    expect(forCee.payload.messages.map((message: { id: string }) => message.id)).toEqual([hiddenId]);

    const marked = await mcpTool(oauth, 'mark_messages_read', { message_ids: [noticeId] });
    expect(marked.isError, marked.text).toBe(false);
    expect(marked.payload.messages[0]).toMatchObject({ id: noticeId, unread: false });
    expect(marked.payload.unread_cursor).toBeNull();
    expect((await mcpTool(ceeKey, 'list_messages', { unread: true })).payload.messages).toHaveLength(1);
  });
});

describe('rsk_ regression and REST refusals', () => {
  async function unauthenticated() {
    return mcpAuthHandler(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'x-forwarded-host': 'evil.example',
          'x-forwarded-proto': 'https',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
    );
  }

  it('401 resource_metadata uses the fixed issuer, never X-Forwarded-Host (flag on and off)', async () => {
    const on = await unauthenticated();
    expect(on.status).toBe(401);
    expect(on.headers.get('www-authenticate')).toContain(
      `resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/api/mcp"`,
    );
    expect(on.headers.get('www-authenticate')).toContain('scope="agent"');

    vi.stubEnv('MCP_OAUTH_ENABLED', '');
    vi.stubEnv('MCP_OAUTH_ISSUER', '');
    const off = await unauthenticated();
    expect(off.status).toBe(401);
    const header = off.headers.get('www-authenticate')!;
    expect(header).toContain(`resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`);
    expect(header).not.toContain('evil.example');
  });

  it('an rsoa_ token is refused off /api/mcp, and with the flag off', async () => {
    const { owner, oauth, bKey, appAgentId } = await setup();
    const sent = (await mcpTool(oauth, 'create_task', task('bee'))).payload.task.id as string;
    await mcpTool(bKey, 'ask', { id: sent, question: 'q?' });
    const answer = await call(answerRoute, `http://localhost/api/v1/tasks/${sent}/answer`, {
      body: { answer: 'a' },
      bearer: oauth,
      params: { id: sent },
    });
    expect(answer.status).toBe(401);
    const redeem = await call(redeemRoute, 'http://localhost/api/v1/invites/redeem', {
      body: { invite: 'rsi_x' },
      bearer: oauth,
    });
    expect(redeem.status).toBe(401);
    const human = await call(reviewModeRoute, `http://localhost/api/v1/agents/${appAgentId}/review-mode`, {
      bearer: oauth,
      cookie: owner.cookie,
      params: { id: appAgentId },
    });
    expect(human.status).toBe(403);
    expect(human.data.error.code).toBe('human_required');

    vi.stubEnv('MCP_OAUTH_ENABLED', '');
    expect((await mcpTool(oauth, 'whoami')).httpStatus).toBe(401);
  });
});

describe('indexing and referrers (SeoBot, §5.4)', () => {
  async function configHeaders(path: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const rule of (await nextConfig.headers?.()) ?? []) {
      if (getPathMatch(rule.source, { removeUnnamedParams: true, strict: true })(path)) {
        for (const h of rule.headers) out.set(h.key.toLowerCase(), h.value);
      }
    }
    return out;
  }

  // next.config headers() match on the path before routing, so they apply to every status on that path (200, 404,
  // 410, 500). Checked against `next start`: /oauth/consent with no page (404), notFound() (404) and a throwing page
  // (500) all carried these four headers.
  it.each(['/oauth/consent', '/oauth/anything/else'])('%s: noindex, no-referrer, never framed', async (path) => {
    const headers = await configHeaders(path);
    expect(headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  });

  it.each(['/api/oauth/authorize', '/api/oauth/token', '/api/oauth/consent', '/api/v1/connected-apps', '/api/v1/connected-apps/x/revoke'])(
    '%s: noindex and no-referrer',
    async (path) => {
      const headers = await configHeaders(path);
      expect(headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(headers.get('referrer-policy')).toBe('no-referrer');
    },
  );

  it('keeps /oauth and /.well-known out of both sitemaps', async () => {
    expect(sitemap().some((entry) => /\/(oauth|\.well-known)(\/|$)/.test(new URL(entry.url).pathname))).toBe(false);
    const xml = await valettoSitemap().text();
    expect(xml).not.toMatch(/<loc>[^<]*\/(oauth|\.well-known)/);
  });
});
