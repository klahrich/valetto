// SPDX-License-Identifier: Apache-2.0

import { chmod, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { AGENT_NAME_PATTERN } from '../../../lib/constants.ts';

export type AgentKeyFile = {
  name: string;
  agent_id: string;
  api_key: string;
  mcp_url: string;
  relay_url: string;
  created_at: string;
};

export function replyslipHome(home = homedir()): string {
  return path.join(home, '.replyslip');
}

export function agentKeyPath(name: string, home = homedir()): string {
  return path.join(replyslipHome(home), 'agents', `${name}.json`);
}

/** REPLYSLIP_JOIN_CODE_<NAME>: uppercase the agent name and replace every other character with _. */
export function joinCodeEnvName(agentName: string): string {
  return `REPLYSLIP_JOIN_CODE_${agentName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export function resolveJoinCode(agentName: string, flag: string | undefined, env: NodeJS.ProcessEnv): string | null {
  if (flag && flag.trim()) return flag.trim();
  const fromEnv = env[joinCodeEnvName(agentName)];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return null;
}

function relayOrigin(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Relay URL must use http or https.');
  }
  return url.origin;
}

async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

export async function writeAgentKeyFile(file: AgentKeyFile, options: { home?: string; force?: boolean }): Promise<string> {
  if (!AGENT_NAME_PATTERN.test(file.name)) {
    throw new Error('Agent name must start with a letter and then use only letters, numbers, underscores, or hyphens.');
  }
  const home = options.home ?? homedir();
  const root = replyslipHome(home);
  const agentsDir = path.join(root, 'agents');
  await ensurePrivateDir(root);
  await ensurePrivateDir(agentsDir);
  const target = agentKeyPath(file.name, home);
  const body = `${JSON.stringify(file, null, 2)}\n`;
  try {
    await writeFile(target, body, { flag: options.force ? 'w' : 'wx', mode: 0o600 });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : '';
    if (code === 'EEXIST') {
      throw new Error(`Refusing to overwrite ${target}. Pass --force to replace it.`);
    }
    throw new Error(`Registered ${file.name} but could not save the key file. The key was not printed. Revoke the agent and register again.`);
  }
  await chmod(target, 0o600);
  return target;
}

async function refuseExistingKeyFile(name: string, home: string | undefined, force: boolean | undefined): Promise<void> {
  if (force) return;
  const target = agentKeyPath(name, home ?? homedir());
  try {
    await stat(target);
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : '';
    if (code === 'ENOENT') return;
    throw err;
  }
  throw new Error(`Refusing to overwrite ${target}. Pass --force to replace it.`);
}

export type LocalRegisterDelivery = { mode: 'local'; driver: string; target: string };

export async function registerAgent(options: {
  name: string;
  description?: string;
  joinCode: string;
  relayUrl: string;
  delivery?: LocalRegisterDelivery;
  home?: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ path: string; name: string; mcpUrl: string }> {
  if (!AGENT_NAME_PATTERN.test(options.name)) {
    throw new Error('Agent name must start with a letter and then use only letters, numbers, underscores, or hyphens.');
  }
  await refuseExistingKeyFile(options.name, options.home, options.force);
  const relay = relayOrigin(options.relayUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${relay}/api/v1/agents/register`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.joinCode}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: options.name,
      ...(options.description ? { description: options.description } : {}),
      ...(options.delivery ? { delivery: options.delivery } : {}),
    }),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && payload && 'error' in payload &&
      typeof (payload as { error?: { message?: unknown } }).error?.message === 'string'
        ? (payload as { error: { message: string } }).error.message
        : `Registration failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  const record = payload as {
    api_key?: unknown;
    agent?: { id?: unknown; created_at?: unknown };
    mcp?: { url?: unknown };
  };
  if (typeof record.api_key !== 'string' || typeof record.agent?.id !== 'string') {
    throw new Error(`Registration failed (HTTP ${response.status}).`);
  }
  const mcpUrl = typeof record.mcp?.url === 'string' ? record.mcp.url : `${relay}/api/mcp`;
  const createdAt = typeof record.agent.created_at === 'string' ? record.agent.created_at : new Date().toISOString();
  const filePath = await writeAgentKeyFile(
    {
      name: options.name,
      agent_id: record.agent.id,
      api_key: record.api_key,
      mcp_url: mcpUrl,
      relay_url: relay,
      created_at: createdAt,
    },
    { home: options.home, force: options.force },
  );
  return { path: filePath, name: options.name, mcpUrl };
}

/** Names with a key file under ~/.replyslip/agents, sorted. */
export async function listRegisteredAgents(home = homedir()): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(path.join(replyslipHome(home), 'agents'));
  } catch {
    return [];
  }
  return names
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .filter((name) => AGENT_NAME_PATTERN.test(name))
    .sort();
}

export type AgentCredentials = { name: string; apiKey: string; agentId: string | null; relayUrl: string | null; path: string };

/**
 * The agent's own key, from the file `register` wrote (the same key the agent's MCP config uses). Errors never
 * include the key. A file readable by group or others gets a warning.
 */
export async function readAgentCredentials(
  name: string,
  options: { home?: string; warn?: (line: string) => void } = {},
): Promise<AgentCredentials> {
  const file = agentKeyPath(name, options.home ?? homedir());
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error(`No key file for agent ${name} at ${file}. Register it first: replyslip register --join-code <code> --name ${name}`);
  }
  let parsed: Partial<AgentKeyFile>;
  try {
    parsed = JSON.parse(text) as Partial<AgentKeyFile>;
  } catch {
    throw new Error(`Agent key file ${file} is not valid JSON.`);
  }
  if (typeof parsed.api_key !== 'string' || !parsed.api_key.trim()) {
    throw new Error(`Agent key file ${file} has no api_key.`);
  }
  try {
    const info = await stat(file);
    if ((info.mode & 0o077) !== 0) options.warn?.(`Agent key file ${file} is not mode 600.`);
  } catch {
    // The read already succeeded.
  }
  const relayUrl = typeof parsed.relay_url === 'string' && parsed.relay_url.trim() ? parsed.relay_url.trim() : null;
  const agentId = typeof parsed.agent_id === 'string' && parsed.agent_id.trim() ? parsed.agent_id.trim() : null;
  return { name, apiKey: parsed.api_key.trim(), agentId, relayUrl, path: file };
}

function httpErrorMessage(payload: unknown, status: number, fallback: string): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof (payload as { error?: { message?: unknown } }).error?.message === 'string'
  ) {
    return (payload as { error: { message: string } }).error.message;
  }
  return `${fallback} (HTTP ${status}).`;
}

/**
 * Rename this agent on the server, then move ~/.replyslip/agents/<old>.json to the new name.
 * The key itself does not change. The local file is only moved after the server accepts the name.
 */
export async function renameRegisteredAgent(options: {
  currentName: string;
  newName: string;
  relayUrl: string;
  home?: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ name: string; path: string; previousPath: string; shared: boolean }> {
  if (!AGENT_NAME_PATTERN.test(options.currentName) || !AGENT_NAME_PATTERN.test(options.newName.trim())) {
    throw new Error('Agent name must start with a letter and then use only letters, numbers, underscores, or hyphens.');
  }
  const newName = options.newName.trim();
  const home = options.home ?? homedir();
  const credentials = await readAgentCredentials(options.currentName, { home });
  if (!credentials.agentId) {
    throw new Error(`Agent key file ${credentials.path} has no agent_id, so it cannot be renamed from the CLI.`);
  }
  const previousPath = credentials.path;
  const nextPath = agentKeyPath(newName, home);
  if (previousPath !== nextPath) {
    try {
      const existing = JSON.parse(await readFile(nextPath, 'utf8')) as Partial<AgentKeyFile>;
      const sameAgent = existing.agent_id === credentials.agentId;
      if (!options.force && !sameAgent) {
        throw new Error(`Refusing to overwrite ${nextPath}. Pass --force to replace it.`);
      }
      if (!options.force && sameAgent) {
        throw new Error(`Refusing to overwrite ${nextPath}. Pass --force to replace it.`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Refusing to overwrite')) throw err;
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : '';
      if (code && code !== 'ENOENT') throw err;
    }
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.relayUrl.replace(/\/$/, '')}/api/v1/agents/${credentials.agentId}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${credentials.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: newName }),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(httpErrorMessage(payload, response.status, 'Rename failed'));
  }
  const record = payload as { agent?: { name?: unknown; shared?: unknown } };
  const savedName = typeof record.agent?.name === 'string' ? record.agent.name : newName;
  const shared = record.agent?.shared === true;

  const raw = JSON.parse(await readFile(previousPath, 'utf8')) as AgentKeyFile;
  const updated: AgentKeyFile = { ...raw, name: savedName };
  if (previousPath === nextPath) {
    await writeAgentKeyFile(updated, { home, force: true });
    return { name: savedName, path: nextPath, previousPath, shared };
  }
  await writeAgentKeyFile(updated, { home, force: true });
  try {
    await unlink(previousPath);
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : '';
    if (code !== 'ENOENT') {
      throw new Error(
        `Renamed ${savedName} on the server and saved ${nextPath}, but could not remove ${previousPath}. Delete the old file so watch and supervise use the new name.`,
      );
    }
  }
  return { name: savedName, path: nextPath, previousPath, shared };
}

function parseMcpJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed) as unknown;
  const dataLines = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  if (dataLines.length === 0) throw new Error('whoami failed: the server did not return JSON.');
  return JSON.parse(dataLines[dataLines.length - 1]!) as unknown;
}

/** Calls the MCP whoami tool with the saved key. Errors never include the key. */
export async function callWhoami(options: {
  name: string;
  home?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ name: string; delivery: unknown; workspace?: string }> {
  const creds = await readAgentCredentials(options.name, { home: options.home });
  const raw = JSON.parse(await readFile(creds.path, 'utf8')) as { mcp_url?: unknown };
  const mcpUrl = typeof raw.mcp_url === 'string' && raw.mcp_url.trim()
    ? raw.mcp_url.trim()
    : `${creds.relayUrl ?? 'https://valetto.tech'}/api/mcp`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(mcpUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${creds.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami', arguments: {} } }),
  });
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }
  if (!response.ok) {
    throw new Error(`whoami failed (HTTP ${response.status}). Check the MCP URL and the key file, and do not print the key.`);
  }
  let rpc: { error?: { message?: unknown }; result?: { isError?: unknown; content?: { type: string; text?: string }[] } };
  try {
    rpc = parseMcpJson(body) as typeof rpc;
  } catch {
    throw new Error('whoami failed: the server did not return JSON.');
  }
  if (rpc.error) {
    throw new Error(typeof rpc.error.message === 'string' ? rpc.error.message : 'whoami failed.');
  }
  const content = rpc.result?.content?.find((item) => item.type === 'text');
  if (!content?.text) throw new Error('whoami failed: the tool returned no text.');
  let payload: { name?: unknown; delivery?: unknown; workspace?: unknown; workspace_name?: unknown };
  try {
    payload = JSON.parse(content.text) as typeof payload;
  } catch {
    throw new Error('whoami failed: the tool result was not JSON.');
  }
  if (typeof payload.name !== 'string' || !payload.name) {
    throw new Error('whoami failed: the result had no agent name.');
  }
  const workspace = typeof payload.workspace === 'string'
    ? payload.workspace
    : typeof payload.workspace_name === 'string'
      ? payload.workspace_name
      : undefined;
  return { name: payload.name, delivery: payload.delivery ?? null, workspace };
}
