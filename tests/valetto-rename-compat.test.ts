import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUEST_WAKE_NOTICE, LEGACY_GUEST_WAKE_NOTICE, LEGACY_REVIEW_NEEDED_NOTICE, REVIEW_NEEDED_NOTICE, WAKE_NOTICE } from '@/lib/wake-notice';
import { runValetto } from '../packages/cli/src/cli';
import { envValue, legacyHome, stateHome, stateHomes, valettoHome } from '../packages/cli/src/home';
import { agentKeyPath, listRegisteredAgents, resolveJoinCode } from '../packages/cli/src/register';
import { installSupervision, uninstallSupervision } from '../packages/cli/src/supervise';
import { nudgeText } from '../packages/cli/src/watch';
import { acquireAgentWatcherLock, agentWatcherScopeId, machineBootId, watcherLockPath } from '../packages/cli/src/watcher-lock';

const KEY = 'rsk_CANARY_rename_key_do_not_print';

function tempHome(): string {
  return mkdtempSync(path.join(tmpdir(), 'valetto-compat-'));
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (line: string) => out.push(line), stderr: (line: string) => err.push(line) };
}

function writeKeyIn(dir: string, name: string) {
  mkdirSync(path.join(dir, 'agents'), { recursive: true });
  const file = path.join(dir, 'agents', `${name}.json`);
  writeFileSync(file, `${JSON.stringify({ name, api_key: KEY, relay_url: 'https://relay.example' })}\n`, { mode: 0o600 });
  return file;
}

function writeScript(dir: string, base = 'valetto.mjs') {
  const script = path.join(dir, base);
  const body = '#!/usr/bin/env node\nprocess.exit(0)\n';
  writeFileSync(script, body);
  writeFileSync(`${script}.sha256`, `${createHash('sha256').update(body).digest('hex')}  ${base}\n`);
  return script;
}

describe('names from before the rename', () => {
  it('prefers VALETTO_* and falls back to REPLYSLIP_*, skipping blanks', () => {
    expect(envValue({ VALETTO_URL: 'https://new.example', REPLYSLIP_URL: 'https://old.example' }, 'URL')).toBe('https://new.example');
    expect(envValue({ REPLYSLIP_URL: 'https://old.example' }, 'URL')).toBe('https://old.example');
    expect(envValue({ VALETTO_URL: '  ', REPLYSLIP_URL: 'https://old.example' }, 'URL')).toBe('https://old.example');
    expect(envValue({}, 'URL')).toBeUndefined();
    expect(resolveJoinCode('Bot', undefined, { VALETTO_JOIN_CODE_BOT: 'rjc_new', REPLYSLIP_JOIN_CODE_BOT: 'rjc_old' })).toBe('rjc_new');
    expect(resolveJoinCode('Bot', undefined, { REPLYSLIP_JOIN_CODE_BOT: 'rjc_old' })).toBe('rjc_old');
  });

  it('keeps state in ~/.replyslip on a machine set up before the rename, else ~/.valetto', () => {
    const fresh = tempHome();
    expect(stateHome(fresh)).toBe(valettoHome(fresh));
    expect(stateHomes(fresh)).toEqual([valettoHome(fresh), legacyHome(fresh)]);
    const old = tempHome();
    mkdirSync(legacyHome(old));
    expect(stateHome(old)).toBe(legacyHome(old));
    expect(stateHomes(old)).toEqual([legacyHome(old), valettoHome(old)]);
  });

  it('reads a key file left in ~/.replyslip, never moves it, and writes new registrations to ~/.valetto', async () => {
    const home = tempHome();
    const old = writeKeyIn(legacyHome(home), 'OldBot');
    expect(agentKeyPath('OldBot', home)).toBe(old);
    expect(agentKeyPath('NewBot', home)).toBe(path.join(home, '.valetto', 'agents', 'NewBot.json'));
    writeKeyIn(valettoHome(home), 'NewBot');
    expect((await listRegisteredAgents(home)).sort()).toEqual(['NewBot', 'OldBot']);

    const looked = capture();
    expect(await runValetto(['key-path', 'OldBot'], { home, stdout: looked.stdout, stderr: looked.stderr })).toBe(0);
    expect(looked.out).toEqual([old]);

    const again = capture();
    const fetchImpl: typeof fetch = async () => {
      throw new Error('must not register over an existing key file');
    };
    expect(
      await runValetto(['register', '--join-code', 'rjc_x', '--name', 'OldBot'], { home, env: {}, fetchImpl, stdout: again.stdout, stderr: again.stderr }),
    ).toBe(1);
    expect(again.err.join('\n')).toMatch(/Refusing to overwrite/);
    expect(JSON.parse(readFileSync(old, 'utf8')).api_key).toBe(KEY);
    expect(existsSync(path.join(home, '.valetto', 'agents', 'OldBot.json'))).toBe(false);
    expect([...looked.out, ...looked.err, ...again.out, ...again.err].join('\n')).not.toContain(KEY);
  });

  it('types the Valetto wording for the pre-rename guest and review notices, and nothing else', () => {
    expect(nudgeText({ id: 'w', notice: LEGACY_GUEST_WAKE_NOTICE })).toBe(GUEST_WAKE_NOTICE);
    expect(nudgeText({ id: 'w', notice: LEGACY_REVIEW_NEEDED_NOTICE })).toBe(REVIEW_NEEDED_NOTICE);
    expect(nudgeText({ id: 'w', notice: `${LEGACY_GUEST_WAKE_NOTICE} ` })).toBe(WAKE_NOTICE);
    for (const text of [GUEST_WAKE_NOTICE, REVIEW_NEEDED_NOTICE, WAKE_NOTICE]) {
      expect(text).toContain('Valetto');
      expect(text).not.toContain('ReplySlip');
    }
  });

  it('sees a live watcher lock in the other directory, so an old and a new CLI never run two watchers for one agent', async () => {
    const home = tempHome();
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });
    try {
      const base = { home, origin: 'https://valetto.tech', workspaceId: 'ws-1', agentId: 'agent-1', agentName: 'Bot', hostname: hostname(), bootId: machineBootId() };
      // A new CLI on a fresh machine holds its lock in ~/.valetto.
      const first = acquireAgentWatcherLock({ ...base, pid: child.pid! });
      expect(first.ok).toBe(true);
      expect(watcherLockPath(home, agentWatcherScopeId('agent-1')).startsWith(valettoHome(home))).toBe(true);
      // An older CLI then creates ~/.replyslip, so the state home flips. The lock in ~/.valetto still blocks.
      mkdirSync(legacyHome(home), { recursive: true });
      expect(watcherLockPath(home, agentWatcherScopeId('agent-1')).startsWith(legacyHome(home))).toBe(true);
      const second = acquireAgentWatcherLock({ ...base, pid: process.pid });
      expect(second).toMatchObject({ ok: false, reason: 'running', pid: child.pid });
    } finally {
      child.kill();
      await once(child, 'exit');
    }
  });
});

describe('supervise --install replaces the pre-rename timer', () => {
  function recorder() {
    const calls: string[][] = [];
    return { calls, run: async (command: string, args: string[]) => (calls.push([command, ...args]), { code: 0, stdout: '', stderr: '' }) };
  }
  const common = (home: string, script: string, run: (c: string, a: string[]) => Promise<{ code: number; stdout: string; stderr: string }>) => ({
    home,
    scriptPath: script,
    nodePath: '/usr/bin/node',
    env: { PATH: '/usr/bin:/bin', REPLYSLIP_ORCA_BIN: '/opt/orca', REPLYSLIP_WATCHER_KEY: KEY },
    run,
    spawnWatcher: () => ({ pid: 4242 }),
    alive: () => true,
    identify: async () => null,
    kill: () => undefined,
  });

  it('linux: enables valetto-supervise first, then disables and deletes replyslip-supervise; uninstall clears both', async () => {
    const home = tempHome();
    writeKeyIn(legacyHome(home), 'Bot');
    const script = writeScript(home, 'replyslip.mjs');
    const unitDir = path.join(home, '.config', 'systemd', 'user');
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(path.join(unitDir, 'replyslip-supervise.service'), '[Service]\n');
    writeFileSync(path.join(unitDir, 'replyslip-supervise.timer'), '[Timer]\n');
    const rec = recorder();
    const result = await installSupervision('Bot', { ...common(home, script, rec.run), platform: 'linux' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toContain('Removed the old ReplySlip timer. Only the Valetto timer runs now.');
    const flat = rec.calls.map((call) => call.join(' '));
    const enabled = flat.indexOf('systemctl --user enable --now valetto-supervise.timer');
    const disabled = flat.indexOf('systemctl --user disable --now replyslip-supervise.timer');
    expect(enabled).toBeGreaterThanOrEqual(0);
    expect(disabled).toBeGreaterThan(enabled);
    expect(existsSync(path.join(unitDir, 'replyslip-supervise.service'))).toBe(false);
    expect(existsSync(path.join(unitDir, 'replyslip-supervise.timer'))).toBe(false);
    const unit = readFileSync(path.join(unitDir, 'valetto-supervise.service'), 'utf8');
    expect(unit).toContain('VALETTO_ORCA_BIN="/opt/orca"');
    expect(unit).not.toContain(KEY);

    const again = recorder();
    expect((await installSupervision('Bot', { ...common(home, script, again.run), platform: 'linux' })).ok).toBe(true);
    expect(again.calls.filter((call) => call.join(' ').includes('enable --now')).length).toBe(1);

    const gone = recorder();
    const removed = await uninstallSupervision({ all: true }, { ...common(home, script, gone.run), platform: 'linux' });
    expect(removed.ok).toBe(true);
    const goneFlat = gone.calls.map((call) => call.join(' '));
    expect(goneFlat).toContain('systemctl --user disable --now valetto-supervise.timer');
    expect(goneFlat).toContain('systemctl --user disable --now replyslip-supervise.timer');
    expect(existsSync(path.join(unitDir, 'valetto-supervise.service'))).toBe(false);
  });

  it('macOS: bootstraps tech.valetto.supervise, then boots out and deletes the old LaunchAgent', async () => {
    const home = tempHome();
    writeKeyIn(legacyHome(home), 'Bot');
    const script = writeScript(home);
    const agents = path.join(home, 'Library', 'LaunchAgents');
    mkdirSync(agents, { recursive: true });
    const oldPlist = path.join(agents, 'tech.valetto.replyslip-supervise.plist');
    writeFileSync(oldPlist, '<plist/>\n');
    const rec = recorder();
    const result = await installSupervision('Bot', { ...common(home, script, rec.run), platform: 'darwin', uid: 501 });
    expect(result.ok).toBe(true);
    const flat = rec.calls.map((call) => call.join(' '));
    const boot = flat.findIndex((line) => line.startsWith('launchctl bootstrap gui/501') && line.includes('tech.valetto.supervise.plist'));
    const out = flat.indexOf('launchctl bootout gui/501/tech.valetto.replyslip-supervise');
    expect(boot).toBeGreaterThanOrEqual(0);
    expect(out).toBeGreaterThan(boot);
    expect(existsSync(oldPlist)).toBe(false);
    expect(existsSync(path.join(agents, 'tech.valetto.supervise.plist'))).toBe(true);
  });

  it('Windows: creates "Valetto Supervise", then deletes "ReplySlip Supervise", and keeps the rewritten tick.cmd', async () => {
    const home = tempHome();
    writeKeyIn(legacyHome(home), 'Bot');
    const script = writeScript(home);
    const rec = recorder();
    const result = await installSupervision('Bot', {
      ...common(home, script, rec.run),
      platform: 'win32',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      env: { PATH: 'C:\\Windows\\System32' },
    });
    expect(result.ok).toBe(true);
    const flat = rec.calls.map((call) => call.join(' '));
    const created = flat.findIndex((line) => line.startsWith('schtasks /Create /F /TN Valetto Supervise'));
    const deleted = flat.indexOf('schtasks /Delete /F /TN ReplySlip Supervise');
    expect(created).toBeGreaterThanOrEqual(0);
    expect(deleted).toBeGreaterThan(created);
    expect(existsSync(path.join(legacyHome(home), 'supervise', 'tick.cmd'))).toBe(true);
  });

  it('does not touch the old timer when the new one fails to enable', async () => {
    const home = tempHome();
    writeKeyIn(legacyHome(home), 'Bot');
    const script = writeScript(home);
    const unitDir = path.join(home, '.config', 'systemd', 'user');
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(path.join(unitDir, 'replyslip-supervise.timer'), '[Timer]\n');
    const calls: string[] = [];
    const run = async (command: string, args: string[]) => {
      const line = [command, ...args].join(' ');
      calls.push(line);
      return line.includes('enable --now valetto') ? { code: 1, stdout: '', stderr: 'boom' } : { code: 0, stdout: '', stderr: '' };
    };
    const result = await installSupervision('Bot', { ...common(home, script, run), platform: 'linux' });
    expect(result.ok).toBe(false);
    expect(calls.some((line) => line.includes('replyslip-supervise'))).toBe(false);
    expect(existsSync(path.join(unitDir, 'replyslip-supervise.timer'))).toBe(true);
  });
});
