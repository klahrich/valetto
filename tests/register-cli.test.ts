import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { relayOrigin, runValetto } from '../packages/cli/src/cli';
import { joinCodeEnvName, legacyJoinCodeEnvName } from '../packages/cli/src/register';

const KEY = 'rsk_CANARY_KEY_do_not_print';

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

describe('valetto register', () => {
  it('defaults --url to https://valetto.tech, then REPLYSLIP_URL, then --url', async () => {
    const cases: [string[], NodeJS.ProcessEnv, string][] = [
      [[], {}, 'https://valetto.tech'],
      [[], { REPLYSLIP_URL: 'http://localhost:3000' }, 'http://localhost:3000'],
      [['--url', 'https://relay.example'], { REPLYSLIP_URL: 'http://localhost:3000' }, 'https://relay.example'],
    ];
    for (const [extra, env, expected] of cases) {
      const home = await mkdtemp(path.join(tmpdir(), 'replyslip-'));
      const urls: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({
            api_key: KEY,
            agent: { id: '11111111-1111-4111-8111-111111111111', created_at: '2026-10-24T00:00:00.000Z' },
            mcp: { url: `${expected}/api/mcp` },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      };
      const io = capture();
      const code = await runValetto(['register', '--join-code', 'rjc_x', '--name', 'DefaultBot', ...extra], {
        home,
        env,
        fetchImpl,
        stdout: io.stdout,
        stderr: io.stderr,
      });
      expect(code).toBe(0);
      expect(urls[0]?.startsWith(`${expected}/`)).toBe(true);
      const file = io.out.find((line) => line.startsWith('key saved to '))!.replace('key saved to ', '');
      expect((JSON.parse(await readFile(file, 'utf8')) as { relay_url: string }).relay_url).toBe(expected);
    }
  });

  it('writes mode 600, prints no key, and refuses to overwrite', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-'));
    const io = capture();
    const calls: { authorization?: string; body?: string }[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls.push({
        authorization: new Headers(init?.headers).get('authorization') ?? undefined,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return new Response(
        JSON.stringify({
          api_key: KEY,
          agent: { id: '11111111-1111-4111-8111-111111111111', created_at: '2026-10-24T00:00:00.000Z' },
          mcp: { url: 'https://replyslip.com/api/mcp' },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    };

    const code = await runValetto(
      ['register', '--name', 'LandingBot', '--description', 'Drafts', '--url', 'https://replyslip.com'],
      {
        home,
        env: { REPLYSLIP_JOIN_CODE: 'rjc_shared_burned', REPLYSLIP_JOIN_CODE_LANDINGBOT: 'rjc_personal' },
        fetchImpl,
        stdout: io.stdout,
        stderr: io.stderr,
      },
    );
    expect(code).toBe(0);
    expect(joinCodeEnvName('LandingBot')).toBe('VALETTO_JOIN_CODE_LANDINGBOT');
    expect(legacyJoinCodeEnvName('LandingBot')).toBe('REPLYSLIP_JOIN_CODE_LANDINGBOT');
    expect(calls[0]?.authorization).toBe('Bearer rjc_personal');
    expect(calls[0]?.body).toContain('"description":"Drafts"');
    const printed = [...io.out, ...io.err].join('\n');
    expect(printed).not.toContain(KEY);
    expect(printed).toContain('LandingBot');
    expect(printed).toContain('https://replyslip.com/api/mcp');
    expect(printed).toContain('key saved to ');

    const file = io.out.find((line) => line.startsWith('key saved to '))!.replace('key saved to ', '');
    const saved = JSON.parse(await readFile(file, 'utf8')) as { api_key: string; relay_url: string };
    expect(saved.api_key).toBe(KEY);
    expect(saved.relay_url).toBe('https://replyslip.com');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(file).toBe(path.join(home, '.valetto', 'agents', 'LandingBot.json'));
    expect((await stat(path.join(home, '.valetto'))).mode & 0o777).toBe(0o700);
    await expect(stat(path.join(home, '.replyslip'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);

    const again = capture();
    const second = await runValetto(['register', '--join-code', 'rjc_other', '--name', 'LandingBot'], {
      home,
      env: { REPLYSLIP_JOIN_CODE: 'rjc_shared_burned' },
      fetchImpl,
      stdout: again.stdout,
      stderr: again.stderr,
    });
    expect(second).toBe(1);
    expect(again.err.join('\n')).toMatch(/Refusing to overwrite/);
    expect([...again.out, ...again.err].join('\n')).not.toContain(KEY);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(await readFile(file, 'utf8')).api_key).toBe(KEY);

    const pathOnly = capture();
    const looked = await runValetto(['key-path', 'LandingBot'], { home, stdout: pathOnly.stdout, stderr: pathOnly.stderr });
    expect(looked).toBe(0);
    expect(pathOnly.out).toEqual([file]);
    expect(pathOnly.err).toEqual([]);

    const shared = capture();
    let fetched = false;
    const ignored = await runValetto(['register', '--name', 'OtherBot'], {
      home,
      env: { REPLYSLIP_JOIN_CODE: 'rjc_shared_burned' },
      fetchImpl: async () => {
        fetched = true;
        return new Response('{}', { status: 500 });
      },
      stdout: shared.stdout,
      stderr: shared.stderr,
    });
    expect(ignored).toBe(1);
    expect(fetched).toBe(false);
    expect(shared.err.join('\n')).toMatch(/VALETTO_JOIN_CODE/);
    expect([...shared.out, ...shared.err].join('\n')).not.toContain('rjc_shared_burned');
  });

  it('sends local delivery when --driver and --target are set', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-'));
    const io = capture();
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      bodies.push(typeof init?.body === 'string' ? init.body : '');
      return new Response(
        JSON.stringify({
          api_key: KEY,
          agent: { id: '11111111-1111-4111-8111-111111111111', created_at: '2026-10-24T00:00:00.000Z' },
          mcp: { url: 'https://valetto.tech/api/mcp' },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    };
    const code = await runValetto(
      ['register', '--join-code', 'rjc_x', '--name', 'OrcaBot', '--driver', 'orca', '--target', 'tab1:leaf-uuid'],
      { home, env: {}, fetchImpl, stdout: io.stdout, stderr: io.stderr },
    );
    expect(code).toBe(0);
    expect(JSON.parse(bodies[0] as string)).toEqual({
      name: 'OrcaBot',
      delivery: { mode: 'local', driver: 'orca', target: 'tab1:leaf-uuid' },
    });
    expect(io.out.join('\n')).toContain('delivery set to orca tab1:leaf-uuid');
    expect([...io.out, ...io.err].join('\n')).not.toContain(KEY);
  });

  it('refuses --driver without --target', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-'));
    const io = capture();
    let fetched = false;
    const code = await runValetto(['register', '--join-code', 'rjc_x', '--name', 'OrcaBot', '--driver', 'orca'], {
      home,
      env: {},
      fetchImpl: async () => {
        fetched = true;
        return new Response('{}', { status: 500 });
      },
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(code).toBe(1);
    expect(fetched).toBe(false);
    expect(io.err.join('\n')).toMatch(/--driver and --target/);
  });

  it('prints whoami without the key', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-'));
    const io = capture();
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          api_key: KEY,
          agent: { id: '11111111-1111-4111-8111-111111111111', created_at: '2026-10-24T00:00:00.000Z' },
          mcp: { url: 'https://valetto.tech/api/mcp' },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    expect(await runValetto(['register', '--join-code', 'rjc_x', '--name', 'OrcaBot'], {
      home, env: {}, fetchImpl, stdout: io.stdout, stderr: io.stderr,
    })).toBe(0);
    const who = capture();
    const whoFetch: typeof fetch = async (_input, init) => {
      const auth = new Headers(init?.headers).get('authorization');
      expect(auth).toBe(`Bearer ${KEY}`);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: JSON.stringify({ name: 'OrcaBot', workspace: 'Acme', delivery: { mode: 'none' } }) }] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    expect(await runValetto(['whoami', '--name', 'OrcaBot'], {
      home, env: {}, fetchImpl: whoFetch, stdout: who.stdout, stderr: who.stderr,
    })).toBe(0);
    expect(who.out).toEqual(['OrcaBot', 'workspace Acme', 'delivery {"mode":"none"}']);
    expect([...who.out, ...who.err].join('\n')).not.toContain(KEY);
  });
});

describe('valetto watch --key-file', () => {
  it('treats an empty or blank REPLYSLIP_URL or --url as unset', async () => {
    for (const env of [{ REPLYSLIP_URL: '' }, { REPLYSLIP_URL: '   ' }]) {
      expect(relayOrigin([], env)).toBe('https://valetto.tech');
      expect(relayOrigin(['--url', '  '], env)).toBe('https://valetto.tech');
      expect(relayOrigin(['--url', ' https://relay.example '], env)).toBe('https://relay.example');
    }
    expect(relayOrigin(['--url', '  '], { REPLYSLIP_URL: ' http://localhost:3000 ' })).toBe('http://localhost:3000');

    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-watch-'));
    const urls: string[] = [];
    const io = capture();
    const code = await runValetto(['watch', '--once', '--key', 'rsw_blank_env'], {
      home,
      env: { REPLYSLIP_URL: '  ' },
      stdout: io.stdout,
      stderr: io.stderr,
      fetchImpl: async (input) => {
        urls.push(String(input));
        return new Response('{"wakes":[]}', { status: 200 });
      },
    });
    expect(code, io.err.join('\n')).toBe(0);
    expect(urls[0]).toBe('https://valetto.tech/api/v1/watcher/poll');

    const regHome = await mkdtemp(path.join(tmpdir(), 'replyslip-'));
    const regUrls: string[] = [];
    const reg = capture();
    const regCode = await runValetto(['register', '--join-code', 'rjc_x', '--name', 'BlankBot'], {
      home: regHome,
      env: { REPLYSLIP_URL: '' },
      stdout: reg.stdout,
      stderr: reg.stderr,
      fetchImpl: async (input) => {
        regUrls.push(String(input));
        return new Response(
          JSON.stringify({
            api_key: KEY,
            agent: { id: '11111111-1111-4111-8111-111111111111', created_at: '2026-10-24T00:00:00.000Z' },
            mcp: { url: 'https://valetto.tech/api/mcp' },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    expect(regCode, reg.err.join('\n')).toBe(0);
    expect(regUrls[0]?.startsWith('https://valetto.tech/')).toBe(true);
  });

  it('defaults --url to https://valetto.tech, then REPLYSLIP_URL, then --url', async () => {
    const cases: [string[], NodeJS.ProcessEnv, string][] = [
      [[], {}, 'https://valetto.tech'],
      [[], { REPLYSLIP_URL: 'http://localhost:3000' }, 'http://localhost:3000'],
      [['--url', 'https://relay.example'], { REPLYSLIP_URL: 'http://localhost:3000' }, 'https://relay.example'],
    ];
    for (const [extra, env, expected] of cases) {
      const home = await mkdtemp(path.join(tmpdir(), 'replyslip-watch-'));
      const urls: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        urls.push(String(input));
        if (String(input).endsWith('/ack')) return new Response('{"acked":0}', { status: 200 });
        return new Response('{"wakes":[]}', { status: 200 });
      };
      const io = capture();
      const code = await runValetto(['watch', '--once', '--key', 'rsw_default_test', ...extra], {
        home,
        env,
        fetchImpl,
        stdout: io.stdout,
        stderr: io.stderr,
      });
      expect(code, io.err.join('\n')).toBe(0);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) expect(url.startsWith(`${expected}/`), url).toBe(true);
    }
  });

  it('with no key and no registered agent, asks to register or pass --key-file', async () => {
    const io = capture();
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-empty-'));
    const fetchImpl: typeof fetch = async () => {
      throw new Error('must not poll without a key');
    };
    const code = await runValetto(['watch', '--once'], { env: {}, home, fetchImpl, stdout: io.stdout, stderr: io.stderr });
    expect(code).toBe(1);
    expect(io.err.join('\n')).toContain('--key-file');
  });

  it('sends the file key, prefers it over --key, and does not print it', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'replyslip-watch-'));
    const keyFile = path.join(home, 'watcher-box.key');
    const secret = 'rsw_CANARY_do_not_print';
    await writeFile(keyFile, `${secret}\n`, { mode: 0o600 });
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push(new Headers(init?.headers).get('authorization') ?? '');
      if (String(input).endsWith('/ack')) return new Response('{"acked":0}', { status: 200 });
      return new Response('{"wakes":[]}', { status: 200 });
    };
    const io = capture();
    const code = await runValetto(
      ['watch', '--once', '--url', 'https://replyslip.com', '--key-file', keyFile, '--key', 'rsw_ignored'],
      {
        home,
        env: { REPLYSLIP_WATCHER_KEY: 'rsw_env_ignored' },
        fetchImpl,
        stdout: io.stdout,
        stderr: io.stderr,
      },
    );
    expect(code).toBe(0);
    expect(seen[0]).toBe(`Bearer ${secret}`);
    expect([...io.out, ...io.err].join('\n')).not.toContain(secret);
    expect([...io.out, ...io.err].join('\n')).not.toContain('rsw_ignored');

    const missing = capture();
    const failed = await runValetto(['watch', '--url', 'https://replyslip.com', '--key-file', path.join(home, 'missing.key')], {
      home,
      stdout: missing.stdout,
      stderr: missing.stderr,
    });
    expect(failed).toBe(1);
    expect(missing.err.join('\n')).toMatch(/Could not read watcher key file/);
    expect(missing.err.join('\n')).not.toContain(secret);
  });
});
