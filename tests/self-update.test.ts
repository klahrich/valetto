import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GET as latestCli } from '@/app/api/v1/cli/latest/route';
import { cliScriptBytes, cliScriptSha256, cliScriptSha256Line, cliScriptSignature, cliScriptVersion } from '@/lib/cli-script';
import { enrollAgent } from '../packages/cli/src/watcher-progress';
import { persistAgentNoAutoUpdate } from '../packages/cli/src/register';
import {
  CLI_RELEASE_PUBLIC_KEY_FINGERPRINT,
  CLI_RELEASE_PUBLIC_KEY_PEM,
  cliReleasePublicKeyFingerprint,
  parseCliScriptVersionFromBytes,
  verifyCliReleaseSignature,
} from '../packages/cli/src/release-pubkey';
import { runSupervisionTick } from '../packages/cli/src/supervise';
import { buildInstallPlan } from '../packages/cli/src/supervise-os';
import {
  assertUpdateUrlAllowed,
  autoUpdateDisabled,
  backupScriptPath,
  compareCliVersions,
  healWindowsScript,
  isNewerCliVersion,
  maybeUpdateCli,
  parseCliVersion,
  replaceScriptFile,
  tempScriptPath,
  writeExclusiveTempScript,
  type ScriptFs,
} from '../packages/cli/src/self-update';

const ORIGIN = 'https://relay.example';

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function testKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    sign(bytes: string | Buffer): string {
      return sign(null, Buffer.from(bytes), privateKey).toString('base64');
    },
  };
}

function memFs(initial: Record<string, string | Buffer> = {}, initialModes: Record<string, number> = {}) {
  const store = new Map<string, Buffer>(Object.entries(initial).map(([key, value]) => [key, Buffer.from(value)]));
  const modes = new Map<string, number>(Object.entries(initialModes));
  const ops: string[] = [];
  const fs: ScriptFs = {
    existsSync: (file) => store.has(file),
    readFileSync: (file) => {
      const value = store.get(file);
      if (!value) throw new Error(`ENOENT: ${file}`);
      return value;
    },
    writeFileSync: (file, data, options) => {
      if (options?.flag === 'wx' && store.has(file)) {
        const err = Object.assign(new Error(`EEXIST: ${file}`), { code: 'EEXIST' });
        throw err;
      }
      store.set(file, Buffer.from(data));
      if (typeof options?.mode === 'number') modes.set(file, options.mode);
      ops.push(`write ${file}`);
    },
    renameSync: (from, to) => {
      const value = store.get(from);
      if (!value) throw new Error(`ENOENT: ${from}`);
      store.delete(from);
      store.set(to, value);
      if (modes.has(from)) {
        modes.set(to, modes.get(from)!);
        modes.delete(from);
      }
      ops.push(`rename ${from} -> ${to}`);
    },
    unlinkSync: (file) => {
      if (!store.has(file)) throw new Error(`ENOENT: ${file}`);
      store.delete(file);
      modes.delete(file);
      ops.push(`unlink ${file}`);
    },
    chmodSync: (file, mode) => {
      if (!store.has(file)) throw new Error(`ENOENT: ${file}`);
      modes.set(file, mode);
      ops.push(`chmod ${file} ${mode.toString(8)}`);
    },
    statSync: (file) => {
      if (!store.has(file)) throw new Error(`ENOENT: ${file}`);
      return { mode: modes.get(file) ?? 0o100644 };
    },
  };
  return { store, modes, ops, fs };
}

function scriptSource(version: string): string {
  return `#!/usr/bin/env node\n// valetto-cli-version: ${version}\nprocess.exit(0);\n`;
}

function latestInfo(version: string, body: string, extra: { url?: string; signature?: string; sha256?: string } = {}) {
  return {
    version,
    sha256: extra.sha256 ?? sha256(body),
    url: extra.url ?? `${ORIGIN}/valetto.mjs`,
    signature: extra.signature,
  };
}

function fetchLatestAndScript(
  latest: { version: string; sha256: string; url: string; signature?: string },
  body: string | Buffer,
  options: { scriptStatus?: number; signatureBody?: string } = {},
) {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v1/cli/latest')) {
      return new Response(JSON.stringify(latest), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === latest.url) {
      return new Response(body, { status: options.scriptStatus ?? 200, headers: { 'content-type': 'text/javascript' } });
    }
    if (url.endsWith('.mjs.sig')) {
      const sig = options.signatureBody ?? latest.signature ?? '';
      return new Response(`${sig}\n`, { status: sig ? 200 : 404, headers: { 'content-type': 'text/plain' } });
    }
    return new Response('not found', { status: 404 });
  };
}

const updateOpts = { minIntervalMs: 0, lock: false as const, env: {} as NodeJS.ProcessEnv };

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
  it('honours VALETTO_NO_AUTO_UPDATE, the REPLYSLIP_ fallback, --no-auto-update, and agent config', () => {
    expect(autoUpdateDisabled({}, [])).toBe(false);
    expect(autoUpdateDisabled({ VALETTO_NO_AUTO_UPDATE: '1' }, [])).toBe(true);
    expect(autoUpdateDisabled({ VALETTO_NO_AUTO_UPDATE: 'true' }, [])).toBe(true);
    expect(autoUpdateDisabled({ REPLYSLIP_NO_AUTO_UPDATE: 'yes' }, [])).toBe(true);
    expect(autoUpdateDisabled({ VALETTO_NO_AUTO_UPDATE: '0' }, [])).toBe(false);
    expect(autoUpdateDisabled({}, ['watch', '--no-auto-update'])).toBe(true);
    expect(autoUpdateDisabled({}, [], { agentConfig: true })).toBe(true);
  });
});

describe('Windows replace and heal', () => {
  it('renames the running script aside, then moves the temp file into place', () => {
    const script = 'C:\\Users\\k\\.valetto\\valetto.mjs';
    const temp = tempScriptPath(script, '99');
    const bak = backupScriptPath(script);
    const { store, ops, fs } = memFs({ [script]: 'old', [temp]: 'new' });
    replaceScriptFile(script, temp, { platform: 'win32', fs });
    expect(store.get(script)?.toString()).toBe('new');
    expect(store.has(temp)).toBe(false);
    expect(store.has(bak)).toBe(false);
    expect(ops).toEqual([
      `rename ${script} -> ${bak}`,
      `rename ${temp} -> ${script}`,
      `chmod ${script} 644`,
      `unlink ${bak}`,
    ]);
  });

  it('puts the original script back if the new file cannot be moved into place', () => {
    const script = 'C:\\Users\\k\\.valetto\\valetto.mjs';
    const temp = tempScriptPath(script, '99');
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

  it('leaves .old in place when both the replace and the restore fail, and the next tick restores it', () => {
    const script = 'C:\\Users\\k\\.valetto\\valetto.mjs';
    const temp = tempScriptPath(script, '99');
    const bak = backupScriptPath(script);
    const { store, fs } = memFs({ [script]: 'old', [temp]: 'new' });
    const inner = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (from === temp && to === script) throw new Error('EPERM');
      if (from === bak && to === script) throw new Error('EPERM-restore');
      inner(from, to);
    };
    expect(() => replaceScriptFile(script, temp, { platform: 'win32', fs })).toThrow(/EPERM/);
    expect(store.has(script)).toBe(false);
    expect(store.get(bak)?.toString()).toBe('old');
    fs.renameSync = inner;
    expect(healWindowsScript(script, { platform: 'win32', fs })).toBe('restored');
    expect(store.get(script)?.toString()).toBe('old');
    expect(store.has(bak)).toBe(false);
  });

  it('cleans a leftover .old once the current script is already the expected version', () => {
    const script = 'C:\\Users\\k\\.valetto\\valetto.mjs';
    const bak = backupScriptPath(script);
    const { store, fs } = memFs({ [script]: scriptSource('0.1.8'), [bak]: scriptSource('0.1.7') });
    expect(healWindowsScript(script, { platform: 'win32', fs, currentVersion: '0.1.8' })).toBe('cleaned');
    expect(store.has(bak)).toBe(false);
    expect(store.get(script)?.toString()).toBe(scriptSource('0.1.8'));
  });

  it('preserves the original file mode after a POSIX replace', () => {
    const script = '/home/k/.valetto/valetto.mjs';
    const temp = tempScriptPath(script, '99');
    const { modes, fs } = memFs({ [script]: 'old', [temp]: 'new' }, { [script]: 0o100755, [temp]: 0o100600 });
    replaceScriptFile(script, temp, { platform: 'linux', fs, mode: 0o100755 });
    expect(modes.get(script)).toBe(0o755);
  });

  it('atomically replaces on POSIX without a backup rename', () => {
    const script = '/home/k/.valetto/valetto.mjs';
    const temp = tempScriptPath(script, '99');
    const { store, ops, fs } = memFs({ [script]: 'old', [temp]: 'new' });
    replaceScriptFile(script, temp, { platform: 'linux', fs });
    expect(store.get(script)?.toString()).toBe('new');
    expect(ops[0]).toBe(`rename ${temp} -> ${script}`);
  });
});

describe('exclusive temp file', () => {
  it('creates a randomly named file with wx and does not overwrite a collision', () => {
    const script = '/home/k/.valetto/valetto.mjs';
    const { store, fs } = memFs();
    let n = 0;
    const first = writeExclusiveTempScript(script, Buffer.from('a'), { fs, random: () => 'aaa' });
    expect(first).toBe(`${script}.tmp-aaa`);
    expect(store.get(first)?.toString()).toBe('a');
    const second = writeExclusiveTempScript(script, Buffer.from('b'), {
      fs,
      random: () => {
        n += 1;
        return n === 1 ? 'aaa' : 'bbb';
      },
    });
    expect(second).toBe(`${script}.tmp-bbb`);
    expect(store.get(first)?.toString()).toBe('a');
    expect(store.get(second)?.toString()).toBe('b');
  });
});

describe('maybeUpdateCli', () => {
  function setup(version = '0.1.7') {
    const home = mkdtempSync(path.join(tmpdir(), 'valetto-update-'));
    const dir = path.join(home, '.valetto');
    mkdirSync(dir, { recursive: true });
    const scriptPath = path.join(dir, 'valetto.mjs');
    const current = scriptSource(version);
    writeFileSync(scriptPath, current, { mode: 0o755 });
    writeFileSync(`${scriptPath}.sha256`, `${sha256(current)}  valetto.mjs\n`);
    const keys = testKeys();
    return { home, scriptPath, current, keys };
  }

  it('replaces the script and logs one clear line when a newer signed version verifies', async () => {
    const { home, scriptPath, current, keys } = setup('0.1.7');
    const next = scriptSource('0.1.8');
    const logs: string[] = [];
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      ...updateOpts,
      publicKeyPem: keys.publicKeyPem,
      fetchImpl: fetchLatestAndScript(latestInfo('0.1.8', next, { signature: keys.sign(next) }), next),
      log: (line) => logs.push(line),
    });
    expect(result.status).toBe('updated');
    expect(result.message).toBe('Updated Valetto watcher 0.1.7 -> 0.1.8');
    expect(logs.some((line) => line.includes('Updated Valetto watcher 0.1.7 -> 0.1.8'))).toBe(true);
    expect(readFileSync(scriptPath, 'utf8')).toBe(next);
    expect(readFileSync(scriptPath, 'utf8')).not.toBe(current);
    expect(readFileSync(`${scriptPath}.sha256`, 'utf8')).toBe(`${sha256(next)}  valetto.mjs\n`);
    expect(statSync(scriptPath).mode & 0o777).toBe(0o755);
  });

  it('updates a script still named replyslip.mjs in place', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'valetto-update-'));
    const dir = path.join(home, '.replyslip');
    mkdirSync(dir, { recursive: true });
    const scriptPath = path.join(dir, 'replyslip.mjs');
    writeFileSync(scriptPath, scriptSource('0.1.7'));
    const next = scriptSource('0.1.8');
    const keys = testKeys();
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      ...updateOpts,
      publicKeyPem: keys.publicKeyPem,
      fetchImpl: fetchLatestAndScript(latestInfo('0.1.8', next, { signature: keys.sign(next) }), next),
    });
    expect(result.status).toBe('updated');
    expect(readFileSync(scriptPath, 'utf8')).toBe(next);
    expect(readFileSync(`${scriptPath}.sha256`, 'utf8')).toBe(`${sha256(next)}  replyslip.mjs\n`);
  });

  it('rejects a sha256 mismatch and keeps the old file', async () => {
    const { home, scriptPath, current, keys } = setup('0.1.7');
    const next = scriptSource('0.1.8');
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      ...updateOpts,
      publicKeyPem: keys.publicKeyPem,
      fetchImpl: fetchLatestAndScript({ version: '0.1.8', sha256: 'a'.repeat(64), url: `${ORIGIN}/valetto.mjs`, signature: keys.sign(next) }, next),
    });
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/sha256/);
    expect(readFileSync(scriptPath, 'utf8')).toBe(current);
    expect(readFileSync(`${scriptPath}.sha256`, 'utf8')).toBe(`${sha256(current)}  valetto.mjs\n`);
  });

  it('rejects a signature mismatch before writing the final path and keeps the old file', async () => {
    const { home, scriptPath, current, keys } = setup('0.1.7');
    const next = scriptSource('0.1.8');
    const other = testKeys();
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      ...updateOpts,
      publicKeyPem: keys.publicKeyPem,
      fetchImpl: fetchLatestAndScript(latestInfo('0.1.8', next, { signature: other.sign(next) }), next),
    });
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/signature/);
    expect(readFileSync(scriptPath, 'utf8')).toBe(current);
    expect(parseCliScriptVersionFromBytes(readFileSync(scriptPath))).toBe('0.1.7');
  });

  it('rejects a cross-origin download URL and keeps the old file', async () => {
    const { home, scriptPath, current, keys } = setup('0.1.7');
    const next = scriptSource('0.1.8');
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      ...updateOpts,
      publicKeyPem: keys.publicKeyPem,
      fetchImpl: fetchLatestAndScript(latestInfo('0.1.8', next, { url: 'https://evil.example/valetto.mjs', signature: keys.sign(next) }), next),
    });
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/registered origin/);
    expect(readFileSync(scriptPath, 'utf8')).toBe(current);
  });

  it('does not downgrade when the server advertises an older version', async () => {
    const { home, scriptPath, current, keys } = setup('0.1.8');
    const older = scriptSource('0.1.7');
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.8',
      home,
      ...updateOpts,
      publicKeyPem: keys.publicKeyPem,
      fetchImpl: fetchLatestAndScript(latestInfo('0.1.7', older, { signature: keys.sign(older) }), older),
    });
    expect(result.status).toBe('current');
    expect(readFileSync(scriptPath, 'utf8')).toBe(current);
  });

  it('skips when VALETTO_NO_AUTO_UPDATE is set', async () => {
    const { home, scriptPath, current, keys } = setup('0.1.7');
    const next = scriptSource('0.1.8');
    let calls = 0;
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      env: { VALETTO_NO_AUTO_UPDATE: '1' },
      minIntervalMs: 0,
      lock: false,
      publicKeyPem: keys.publicKeyPem,
      fetchImpl: async (input) => {
        calls += 1;
        return fetchLatestAndScript(latestInfo('0.1.8', next, { signature: keys.sign(next) }), next)(input);
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
      lock: false,
      fetchImpl: async () => {
        throw new Error('should not fetch');
      },
    });
    expect(result.status).toBe('skipped');
    expect(readFileSync(scriptPath, 'utf8')).toBe(current);
  });

  it('skips when the agent key file has no_auto_update set', async () => {
    const { home, scriptPath, current } = setup('0.1.7');
    mkdirSync(path.join(home, '.valetto', 'agents'), { recursive: true });
    writeFileSync(
      path.join(home, '.valetto', 'agents', 'Bot.json'),
      `${JSON.stringify({ name: 'Bot', api_key: 'rsk_test_key', relay_url: ORIGIN, no_auto_update: true })}\n`,
      { mode: 0o600 },
    );
    let calls = 0;
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      ...updateOpts,
      enrolledNames: ['Bot'],
      fetchImpl: async () => {
        calls += 1;
        throw new Error('should not fetch');
      },
    });
    expect(result.status).toBe('skipped');
    expect(calls).toBe(0);
    expect(readFileSync(scriptPath, 'utf8')).toBe(current);
  });

  it('keeps the old file when the version marker in the verified bytes does not match', async () => {
    const { home, scriptPath, current, keys } = setup('0.1.7');
    const next = scriptSource('0.1.7');
    const result = await maybeUpdateCli({
      origin: ORIGIN,
      scriptPath,
      currentVersion: '0.1.7',
      home,
      ...updateOpts,
      publicKeyPem: keys.publicKeyPem,
      fetchImpl: fetchLatestAndScript(latestInfo('0.1.8', next, { signature: keys.sign(next) }), next),
    });
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/version marker/);
    expect(readFileSync(scriptPath, 'utf8')).toBe(current);
  });
});

describe('release signatures', () => {
  it('pins the expected public key fingerprint', () => {
    expect(cliReleasePublicKeyFingerprint()).toBe(CLI_RELEASE_PUBLIC_KEY_FINGERPRINT);
    expect(cliReleasePublicKeyFingerprint(CLI_RELEASE_PUBLIC_KEY_PEM)).toBe(
      'sha256:f85d73645f98325d0b6fc20b9069f106c393322e148c400fcfa016d9bbc27ca5',
    );
  });

  it('accepts a signature from the pinned key and rejects a signature from another key', () => {
    const bytes = cliScriptBytes();
    expect(verifyCliReleaseSignature(bytes, cliScriptSignature())).toBe(true);
    const other = testKeys();
    expect(verifyCliReleaseSignature(bytes, other.sign(bytes))).toBe(false);
    expect(verifyCliReleaseSignature(bytes, 'not-a-signature')).toBe(false);
  });
});

describe('GET /api/v1/cli/latest', () => {
  it('returns the served bundle version, sha256, same-origin url, and signature', async () => {
    const res = await latestCli(
      new Request('https://preview.example/api/v1/cli/latest', {
        headers: { 'x-forwarded-host': 'preview.example', 'x-forwarded-proto': 'https' },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; sha256: string; url: string; signature: string };
    expect(body.version).toBe(cliScriptVersion());
    expect(body.sha256).toBe(cliScriptSha256());
    expect(body.url).toBe('https://preview.example/valetto.mjs');
    expect(body.signature).toBe(cliScriptSignature());
    expect(verifyCliReleaseSignature(cliScriptBytes(), body.signature)).toBe(true);
    expect(cliScriptSha256Line('valetto.mjs')).toBe(`${body.sha256}  valetto.mjs\n`);
    expect(cliScriptSha256Line('replyslip.mjs')).toBe(`${body.sha256}  replyslip.mjs\n`);
    expect(parseCliScriptVersionFromBytes(cliScriptBytes())).toBe(body.version);
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
    const keys = testKeys();
    const spawns: string[] = [];
    const result = await runSupervisionTick({
      home,
      scriptPath,
      currentVersion: '0.1.7',
      env: {},
      publicKeyPem: keys.publicKeyPem,
      lockUpdates: false,
      fetchImpl: fetchLatestAndScript(latestInfo('0.1.8', next, { signature: keys.sign(next) }), next),
      spawnWatcher: (request) => {
        spawns.push(request.scriptPath);
        return { pid: 4242 };
      },
      identify: async () => null,
      alive: () => false,
      kill: () => undefined,
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

describe('OS timer templates', () => {
  const base = {
    home: '/tmp/valetto-home',
    nodePath: '/usr/bin/node',
    scriptPath: '/tmp/valetto-home/.valetto/valetto.mjs',
    pathEnv: '/usr/bin:/bin',
  };

  it('passes VALETTO_NO_AUTO_UPDATE and --no-auto-update through launchd, systemd, and Windows tick.cmd', () => {
    const darwin = buildInstallPlan({ ...base, platform: 'darwin', uid: 501, noAutoUpdate: true });
    const linux = buildInstallPlan({ ...base, platform: 'linux', noAutoUpdate: true });
    const win = buildInstallPlan({
      ...base,
      platform: 'win32',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      scriptPath: 'C:\\Users\\Ada\\.valetto\\valetto.mjs',
      pathEnv: 'C:\\Windows\\System32',
      noAutoUpdate: true,
    });
    if (!('files' in darwin) || !('files' in linux) || !('files' in win)) throw new Error('plan');
    const plist = darwin.files[0]?.contents ?? '';
    const unit = linux.files.find((file) => file.path.endsWith('.service'))?.contents ?? '';
    const cmd = win.files[0]?.contents ?? '';
    expect(plist).toContain('--no-auto-update');
    expect(plist).toContain('<key>VALETTO_NO_AUTO_UPDATE</key>');
    expect(plist).toContain('<string>1</string>');
    expect(unit).toContain('supervise --once --no-auto-update');
    expect(unit).toContain('Environment=VALETTO_NO_AUTO_UPDATE=1');
    expect(cmd).toContain('set "VALETTO_NO_AUTO_UPDATE=1"');
    expect(cmd).toContain('supervise --once --no-auto-update');

    const darwinOn = buildInstallPlan({ ...base, platform: 'darwin', uid: 501 });
    const linuxOn = buildInstallPlan({ ...base, platform: 'linux' });
    const winOn = buildInstallPlan({ ...base, platform: 'win32', pathEnv: 'C:\\Windows\\System32' });
    if (!('files' in darwinOn) || !('files' in linuxOn) || !('files' in winOn)) throw new Error('plan');
    const onText = [darwinOn, linuxOn, winOn].flatMap((plan) => plan.files.map((file) => file.contents)).join('\n');
    expect(onText).not.toContain('--no-auto-update');
    expect(onText).not.toContain('VALETTO_NO_AUTO_UPDATE');
  });
});

describe('persist no_auto_update on the agent key file', () => {
  it('writes and clears the flag without changing the key', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'valetto-opt-'));
    const dir = path.join(home, '.valetto', 'agents');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'Bot.json');
    writeFileSync(file, `${JSON.stringify({ name: 'Bot', api_key: 'rsk_secret_value', relay_url: ORIGIN }, null, 2)}\n`, { mode: 0o600 });
    persistAgentNoAutoUpdate('Bot', home, true);
    const enabled = JSON.parse(readFileSync(file, 'utf8')) as { api_key: string; no_auto_update?: boolean };
    expect(enabled.no_auto_update).toBe(true);
    expect(enabled.api_key).toBe('rsk_secret_value');
    persistAgentNoAutoUpdate('Bot', home, false);
    const cleared = JSON.parse(readFileSync(file, 'utf8')) as { api_key: string; no_auto_update?: boolean };
    expect(cleared.no_auto_update).toBeUndefined();
    expect(cleared.api_key).toBe('rsk_secret_value');
  });
});
