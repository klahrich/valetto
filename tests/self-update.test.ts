import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GET as latestCli } from '@/app/api/v1/cli/latest/route';
import { cliScriptSha256, cliScriptSha256Line, cliScriptVersion } from '@/lib/cli-script';
import { enrollAgent } from '../packages/cli/src/watcher-progress';
import { runSupervisionTick } from '../packages/cli/src/supervise';
import {
  assertUpdateUrlAllowed,
  autoUpdateDisabled,
  backupScriptPath,
  compareCliVersions,
  isNewerCliVersion,
  maybeUpdateCli,
  parseCliVersion,
  replaceScriptFile,
  tempScriptPath,
  type ScriptFs,
} from '../packages/cli/src/self-update';

const ORIGIN = 'https://relay.example';

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function memFs(initial: Record<string, string | Buffer> = {}) {
  const store = new Map<string, Buffer>(Object.entries(initial).map(([key, value]) => [key, Buffer.from(value)]));
  const ops: string[] = [];
  const fs: ScriptFs = {
    existsSync: (file) => store.has(file),
    readFileSync: (file) => {
      const value = store.get(file);
      if (!value) throw new Error(`ENOENT: ${file}`);
      return value;
    },
    writeFileSync: (file, data) => {
      store.set(file, Buffer.from(data));
      ops.push(`write ${file}`);
    },
    renameSync: (from, to) => {
      const value = store.get(from);
      if (!value) throw new Error(`ENOENT: ${from}`);
      store.delete(from);
      store.set(to, value);
      ops.push(`rename ${from} -> ${to}`);
    },
    unlinkSync: (file) => {
      if (!store.has(file)) throw new Error(`ENOENT: ${file}`);
      store.delete(file);
      ops.push(`unlink ${file}`);
    },
  };
  return { store, ops, fs };
}

function scriptSource(version: string): string {
  return `#!/usr/bin/env node\nif (process.argv.includes('--version')) { process.stdout.write(${JSON.stringify(`${version}\n`)}); process.exit(0); }\nprocess.exit(0);\n`;
}

function latestInfo(version: string, body: string, url = `${ORIGIN}/valetto.mjs`) {
  return { version, sha256: sha256(body), url };
}

function fetchLatestAndScript(latest: { version: string; sha256: string; url: string }, body: string | Buffer, options: { scriptStatus?: number } = {}) {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v1/cli/latest')) {
      return new Response(JSON.stringify(latest), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === latest.url) {
      return new Response(body, { status: options.scriptStatus ?? 200, headers: { 'content-type': 'text/javascript' } });
    }
    return new Response('not found', { status: 404 });
  };
}

describe('CLI version compare', () => {
  it('parses x.y.z and rejects everything else', () => {
    expect(parseCliVersion('0.1.8')).toEqual([0, 1, 8]);
    expect(parseCliVersion(' 1.0.0 ')).toEqual([1, 0, 0]);
    expect(parseCliVersion('dev')).toBeNull();
    expect(parseCliVersion('0.1.8-beta')).toBeNull();
    expect(parseCliVersion('v0.1.8')).toBeNull();
  });

  it('orders versions and never treats a lower or equal version as newer', () => {
    expect(compareCliVersions('0.1.7', '0.1.8')).toBe(-1);
    expect(compareCliVersions('0.1.8', '0.1.8')).toBe(0);
    expect(compareCliVersions('0.2.0', '0.1.9')).toBe(1);
    expect(compareCliVersions('0.1.10', '0.1.9')).toBe(1);
    expect(isNewerCliVersion('0.1.7', '0.1.8')).toBe(true);
    expect(isNewerCliVersion('0.1.8', '0.1.8')).toBe(false);
    expect(isNewerCliVersion('0.1.8', '0.1.7')).toBe(false);
    expect(isNewerCliVersion('dev', '0.1.8')).toBe(false);
  });
});

describe('update URL policy', () => {
  it('allows https on the registered origin and localhost http for tests', () => {
    expect(() => assertUpdateUrlAllowed(ORIGIN, `${ORIGIN}/valetto.mjs`)).not.toThrow();
    expect(() => assertUpdateUrlAllowed('https://relay.example:443', `${ORIGIN}/replyslip.mjs`)).not.toThrow();
    expect(() => assertUpdateUrlAllowed('http://127.0.0.1:3000', 'http://127.0.0.1:3000/valetto.mjs')).not.toThrow();
    expect(() => assertUpdateUrlAllowed('http://localhost:8787', 'http://localhost:8787/valetto.mjs')).not.toThrow();
  });

  it('rejects a cross-origin URL, http on a public host, and a non-script path', () => {
    expect(() => assertUpdateUrlAllowed(ORIGIN, 'https://evil.example/valetto.mjs')).toThrow(/registered origin/);
    expect(() => assertUpdateUrlAllowed(ORIGIN, 'http://relay.example/valetto.mjs')).toThrow(/https/);
    expect(() => assertUpdateUrlAllowed(ORIGIN, `${ORIGIN}/api/v1/cli/latest`)).toThrow(/CLI script/);
    expect(() => assertUpdateUrlAllowed(ORIGIN, `${ORIGIN}/valetto.mjs?x=1`)).toThrow(/CLI script/);
  });
});

describe('opt-out', () => {
  it('honours VALETTO_NO_AUTO_UPDATE, the REPLYSLIP_ fallback, and --no-auto-update', () => {
    expect(autoUpdateDisabled({}, [])).toBe(false);
    expect(autoUpdateDisabled({ VALETTO_NO_AUTO_UPDATE: '1' }, [])).toBe(true);
    expect(autoUpdateDisabled({ VALETTO_NO_AUTO_UPDATE: 'true' }, [])).toBe(true);
    expect(autoUpdateDisabled({ REPLYSLIP_NO_AUTO_UPDATE: 'yes' }, [])).toBe(true);
    expect(autoUpdateDisabled({ VALETTO_NO_AUTO_UPDATE: '0' }, [])).toBe(false);
    expect(autoUpdateDisabled({}, ['watch', '--no-auto-update'])).toBe(true);
  });
});

describe('Windows replace', () => {
  it('renames the running script aside, then moves the temp file into place', () => {
    const script = 'C:\\Users\\k\\.valetto\\valetto.mjs';
    const temp = tempScriptPath(script, 99);
    const bak = backupScriptPath(script);
    const { store, ops, fs } = memFs({ [script]: 'old', [temp]: 'new' });
    replaceScriptFile(script, temp, { platform: 'win32', fs });
    expect(store.get(script)?.toString()).toBe('new');
    expect(store.has(temp)).toBe(false);
    expect(store.has(bak)).toBe(false);
    expect(ops).toEqual([`rename ${script} -> ${bak}`, `rename ${temp} -> ${script}`, `unlink ${bak}`]);
  });

  it('puts the original script back if the new file cannot be moved into place', () => {
    const script = 'C:\\Users\\k\\.valetto\\valetto.mjs';
    const temp = tempScriptPath(script, 99);
    const bak = backupScriptPath(script);
    const { store, fs } = memFs({ [script]: 'old', [temp]: 'new' });
    const inner = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (from === temp && to === script) throw new Error('EPERM');
      inner(from, to);
    };
    expect(() => replaceScriptFile(script, temp, { platform: 'win32', fs })).toThrow(/EPERM/);
    expect(store.get(script)?.toString()).toBe('old');
    expect(store.has(bak)).toBe(false);
    expect(store.get(temp)?.toString()).toBe('new');
  });

  it('atomically replaces on POSIX without a backup rename', () => {
    const script = '/home/k/.valetto/valetto.mjs';
    const temp = tempScriptPath(script, 99);
    const { store, ops, fs } = memFs({ [script]: 'old', [temp]: 'new' });
    replaceScriptFile(script, temp, { platform: 'linux', fs });
    expect(store.get(script)?.toString()).toBe('new');
    expect(ops).toEqual([`rename ${temp} -> ${script}`]);
  });
});

describe('maybeUpdateCli', () => {
  function setup(version = '0.1.7') {
    const home = mkdtempSync(path.join(tmpdir(), 'valetto-update-'));
    const dir = path.join(home, '.valetto');
    mkdirSync(dir, { recursive: true });
    const scriptPath = path.join(dir, 'valetto.mjs');
    const current = scriptSource(version);
    writeFileSync(scriptPath, current);
    writeFileSync(`${scriptPath}.sha256`, `${sha256(current)}  valetto.mjs\n`);
    return { home, scriptPath, current };
  }

  it('replaces the script and logs one clear line when a newer version verifies', async () => {
    const { home, scriptPath, current } = setup('0.1.7');
    const next = scriptSource('0.1.8');
    const logs: string[] = [];
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      env: {},
      minIntervalMs: 0,
      fetchImpl: fetchLatestAndScript(latestInfo('0.1.8', next), next),
      log: (line) => logs.push(line),
    });
    expect(result.status).toBe('updated');
    expect(result.message).toBe('Updated Valetto watcher 0.1.7 -> 0.1.8');
    expect(logs.some((line) => line.includes('Updated Valetto watcher 0.1.7 -> 0.1.8'))).toBe(true);
    expect(readFileSync(scriptPath, 'utf8')).toBe(next);
    expect(readFileSync(scriptPath, 'utf8')).not.toBe(current);
    expect(readFileSync(`${scriptPath}.sha256`, 'utf8')).toBe(`${sha256(next)}  valetto.mjs\n`);
  });

  it('updates a script still named replyslip.mjs in place', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'valetto-update-'));
    const dir = path.join(home, '.replyslip');
    mkdirSync(dir, { recursive: true });
    const scriptPath = path.join(dir, 'replyslip.mjs');
    writeFileSync(scriptPath, scriptSource('0.1.7'));
    const next = scriptSource('0.1.8');
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      env: {},
      minIntervalMs: 0,
      fetchImpl: fetchLatestAndScript(latestInfo('0.1.8', next, `${ORIGIN}/valetto.mjs`), next),
    });
    expect(result.status).toBe('updated');
    expect(readFileSync(scriptPath, 'utf8')).toBe(next);
    expect(readFileSync(`${scriptPath}.sha256`, 'utf8')).toBe(`${sha256(next)}  replyslip.mjs\n`);
  });

  it('rejects a sha256 mismatch and keeps the old file', async () => {
    const { home, scriptPath, current } = setup('0.1.7');
    const next = scriptSource('0.1.8');
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      env: {},
      minIntervalMs: 0,
      fetchImpl: fetchLatestAndScript({ version: '0.1.8', sha256: 'a'.repeat(64), url: `${ORIGIN}/valetto.mjs` }, next),
    });
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/sha256/);
    expect(readFileSync(scriptPath, 'utf8')).toBe(current);
    expect(readFileSync(`${scriptPath}.sha256`, 'utf8')).toBe(`${sha256(current)}  valetto.mjs\n`);
  });

  it('rejects a cross-origin download URL and keeps the old file', async () => {
    const { home, scriptPath, current } = setup('0.1.7');
    const next = scriptSource('0.1.8');
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      env: {},
      minIntervalMs: 0,
      fetchImpl: fetchLatestAndScript(latestInfo('0.1.8', next, 'https://evil.example/valetto.mjs'), next),
    });
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/registered origin/);
    expect(readFileSync(scriptPath, 'utf8')).toBe(current);
  });

  it('does not downgrade when the server advertises an older version', async () => {
    const { home, scriptPath, current } = setup('0.1.8');
    const older = scriptSource('0.1.7');
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.8',
      home,
      env: {},
      minIntervalMs: 0,
      fetchImpl: fetchLatestAndScript(latestInfo('0.1.7', older), older),
    });
    expect(result.status).toBe('current');
    expect(readFileSync(scriptPath, 'utf8')).toBe(current);
  });

  it('skips when VALETTO_NO_AUTO_UPDATE is set', async () => {
    const { home, scriptPath, current } = setup('0.1.7');
    const next = scriptSource('0.1.8');
    let calls = 0;
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      env: { VALETTO_NO_AUTO_UPDATE: '1' },
      minIntervalMs: 0,
      fetchImpl: async (input) => {
        calls += 1;
        return fetchLatestAndScript(latestInfo('0.1.8', next), next)(input);
      },
    });
    expect(result.status).toBe('skipped');
    expect(calls).toBe(0);
    expect(readFileSync(scriptPath, 'utf8')).toBe(current);
  });

  it('skips when --no-auto-update is on argv', async () => {
    const { home, scriptPath, current } = setup('0.1.7');
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      env: {},
      argv: ['supervise', '--once', '--no-auto-update'],
      minIntervalMs: 0,
      fetchImpl: async () => {
        throw new Error('should not fetch');
      },
    });
    expect(result.status).toBe('skipped');
    expect(readFileSync(scriptPath, 'utf8')).toBe(current);
  });

  it('keeps the old file when the downloaded script --version does not match', async () => {
    const { home, scriptPath, current } = setup('0.1.7');
    const next = scriptSource('0.1.8');
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      env: {},
      minIntervalMs: 0,
      fetchImpl: fetchLatestAndScript(latestInfo('0.1.8', next), next),
      runVersion: async () => ({ code: 0, stdout: '0.1.7\n', stderr: '' }),
    });
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/--version/);
    expect(readFileSync(scriptPath, 'utf8')).toBe(current);
  });
});

describe('GET /api/v1/cli/latest', () => {
  it('returns the served bundle version, sha256, and same-origin url', async () => {
    const res = await latestCli(
      new Request('https://preview.example/api/v1/cli/latest', {
        headers: { 'x-forwarded-host': 'preview.example', 'x-forwarded-proto': 'https' },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; sha256: string; url: string };
    expect(body.version).toBe(cliScriptVersion());
    expect(body.sha256).toBe(cliScriptSha256());
    expect(body.url).toBe('https://preview.example/valetto.mjs');
    expect(cliScriptSha256Line('valetto.mjs')).toBe(`${body.sha256}  valetto.mjs\n`);
    expect(cliScriptSha256Line('replyslip.mjs')).toBe(`${body.sha256}  replyslip.mjs\n`);
  });
});

describe('supervise tick update', () => {
  it('replaces the installed script and restarts a live watcher', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'valetto-sup-update-'));
    const dir = path.join(home, '.valetto');
    mkdirSync(dir, { recursive: true });
    mkdirSync(path.join(home, '.valetto', 'agents'), { recursive: true });
    const scriptPath = path.join(dir, 'valetto.mjs');
    writeFileSync(scriptPath, scriptSource('0.1.7'));
    writeFileSync(
      path.join(home, '.valetto', 'agents', 'Bot.json'),
      `${JSON.stringify({ name: 'Bot', api_key: 'rsk_test_key', relay_url: ORIGIN })}\n`,
      { mode: 0o600 },
    );
    enrollAgent(home, 'Bot');
    const next = scriptSource('0.1.8');
    const kills: number[] = [];
    const spawns: string[] = [];
    const result = await runSupervisionTick({
      home,
      scriptPath,
      currentVersion: '0.1.7',
      env: {},
      fetchImpl: fetchLatestAndScript(latestInfo('0.1.8', next), next),
      spawnWatcher: (request) => {
        spawns.push(request.scriptPath);
        return { pid: 4242 };
      },
      identify: async () => null,
      alive: () => false,
      kill: (pid) => {
        kills.push(pid);
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines[0]).toBe('Updated Valetto watcher 0.1.7 -> 0.1.8');
      expect(result.lines.some((line) => line.startsWith('Bot:'))).toBe(true);
    }
    expect(readFileSync(scriptPath, 'utf8')).toBe(next);
    expect(spawns).toEqual([scriptPath]);
  });
});
