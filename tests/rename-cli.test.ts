import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runValetto } from '../packages/cli/src/cli';
import { agentKeyPath } from '../packages/cli/src/register';

const KEY = 'rsk_CANARY_KEY_do_not_print';
const AGENT_ID = '11111111-1111-4111-8111-111111111111';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

async function seedKey(home: string, name: string, extra: Record<string, unknown> = {}) {
  const file = {
    name,
    agent_id: AGENT_ID,
    api_key: KEY,
    mcp_url: 'https://valetto.tech/api/mcp',
    relay_url: 'https://valetto.tech',
    created_at: '2026-10-24T00:00:00.000Z',
    ...extra,
  };
  const target = agentKeyPath(name, home);
  await writeFile(target, `${JSON.stringify({ ...file }, null, 2)}\n`, { flag: 'w', mode: 0o600 });
  // writeFile doesn't create the agents dir — mkdir first via register-style path
  return target;
}

describe('valetto rename', () => {
  it('prints help that includes rename, without starting a network call', async () => {
    const io = capture();
    const fetchImpl: typeof fetch = async () => {
      throw new Error('help must not touch the network');
    };
    expect(await runValetto(['rename', '--help'], { ...io, fetchImpl, env: {} })).toBe(0);
    expect(io.out.join('\n')).toContain('valetto rename --to <new-name>');
    expect(io.err).toEqual([]);
  });

  it('patches the server, moves the key file, and never prints the key', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-'));
    await (await import('node:fs/promises')).mkdir(path.join(home, '.valetto', 'agents'), { recursive: true, mode: 0o700 });
    await seedKey(home, 'OldBot');
    const urls: string[] = [];
    const auths: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      urls.push(String(input));
      auths.push(new Headers(init?.headers).get('authorization') ?? '');
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      expect(init?.method).toBe('PATCH');
      expect(body).toEqual({ name: 'NewBot' });
      return new Response(JSON.stringify({ agent: { id: AGENT_ID, name: 'NewBot', shared: false } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const io = capture();
    const code = await runValetto(['rename', '--name', 'OldBot', '--to', 'NewBot'], {
      home,
      env: {},
      fetchImpl,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(0);
    expect(urls).toEqual([`https://valetto.tech/api/v1/agents/${AGENT_ID}`]);
    expect(auths).toEqual([`Bearer ${KEY}`]);
    expect(io.out[0]).toBe('NewBot');
    expect(io.out.join('\n')).toContain(`key saved to ${agentKeyPath('NewBot', home)}`);
    expect(io.out.join('\n')).toContain(`moved ${agentKeyPath('OldBot', home)}`);
    expect(io.out.join('\n')).not.toContain(KEY);
    expect(io.err).toEqual([]);

    const saved = JSON.parse(await readFile(agentKeyPath('NewBot', home), 'utf8')) as { name: string; api_key: string };
    expect(saved.name).toBe('NewBot');
    expect(saved.api_key).toBe(KEY);
    await expect(stat(agentKeyPath('OldBot', home))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves the local file alone when the server rejects the name', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-'));
    await (await import('node:fs/promises')).mkdir(path.join(home, '.valetto', 'agents'), { recursive: true, mode: 0o700 });
    await seedKey(home, 'OldBot');
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: 'name_taken', message: 'An agent named Taken already exists in this workspace.' } }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    const io = capture();
    const code = await runValetto(['rename', '--name', 'OldBot', '--to', 'Taken'], {
      home,
      env: {},
      fetchImpl,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(1);
    expect(io.err.join('\n')).toContain('An agent named Taken already exists in this workspace.');
    expect(io.out).toEqual([]);
    await expect(stat(agentKeyPath('OldBot', home))).resolves.toBeDefined();
    await expect(stat(agentKeyPath('Taken', home))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
