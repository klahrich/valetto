import { authenticateAgentKey, getAgent, renameAgent, serializeAgent, watcherPresence, workspaceWatcherLastSeen } from '@/lib/agents';
import { requireHumanOwner, requireUser } from '@/lib/auth';
import { z } from 'zod';
import { HttpError } from '@/lib/errors';
import { bearerToken, handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { assertSameOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const agent = await getAgent(user.workspace.id, requireUuid(id, 'agent'));
    const seen = await workspaceWatcherLastSeen(user.workspace.id);
    return json({ agent: { ...serializeAgent(agent), ...watcherPresence(agent, seen) } });
  });
}

const renameSchema = z.object({ name: z.string().max(200) }).strict();

/**
 * Rename an agent. A signed-in owner can rename any agent in the workspace. An agent key (`rsk_`) can
 * rename only itself. MCP OAuth tokens use the `rename_agent` tool instead.
 */
export function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params;
    const agentId = requireUuid(id, 'agent');
    const body = parseBody(renameSchema, await readJson(req));
    const token = bearerToken(req);
    let workspaceId: string;
    if (token?.startsWith('rsk_')) {
      const principal = await authenticateAgentKey(token);
      if (!principal) throw new HttpError(401, 'unauthorized', 'Unknown or revoked agent key.');
      if (principal.agentId !== agentId) {
        throw new HttpError(
          403,
          'forbidden',
          'An agent can only rename itself. The workspace owner can rename any agent from the dashboard.',
        );
      }
      workspaceId = principal.workspaceId;
    } else {
      assertSameOrigin(req);
      const user = await requireHumanOwner(req, 'Agents are renamed by a signed-in human in the dashboard, or by the agent itself.');
      workspaceId = user.workspace.id;
    }
    const agent = await renameAgent(workspaceId, agentId, body.name);
    const seen = await workspaceWatcherLastSeen(workspaceId);
    return json({ agent: { ...serializeAgent(agent), ...watcherPresence(agent, seen) } });
  });
}
