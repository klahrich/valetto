// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, appendFileSync, chmodSync, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AGENT_NAME_PATTERN } from '../../../lib/constants.ts';
import { agentKeyPath, persistAgentNoAutoUpdate, readAgentCredentials } from './register.ts';
import { envValue } from './home.ts';
import { autoUpdateDisabled, maybeUpdateCli, originsMatch, type AutoUpdateResult } from './self-update.ts';
import { redactSecrets } from './redact.ts';
import { identifyProcess, killLockAllowed, killSpawnAllowed, watchCommandForAgent, type ProcessIdentity } from './process-identity.ts';
import { decideSupervision, type SuperviseDecision } from './supervise-decide.ts';
import { FileLockError } from './file-lock.ts';
import { withAgentOp, type OpGuard } from './supervise-lock.ts';
import { buildInstallPlan, type InstallPlan, type InstallPlanInput, type PlannedCommand } from './supervise-os.ts';
import { listLiveWatcherLocks, pidIsAlive, type WatcherLockInfo } from './watcher-lock.ts';
import {
  clearHold,
  clearProgress,
  clearStopped,
  emptySuperviseState,
  enrollAgent,
  isStopped,
  readEnrolled,
  readHold,
  readProgress,
  readSuperviseState,
  superviseDir,
  unenrollAgent,
  writeEnrolled,
  writeHold,
  writeStopped,
  writeSuperviseState,
  type AgentSuperviseState,
} from './watcher-progress.ts';

export type CommandOutput = { code: number; stdout: string; stderr: string };
export type CommandRun = (command: string, args: string[]) => Promise<CommandOutput>;

export type SpawnRequest = {
  nodePath: string;
  scriptPath: string;
  name: string;
  home: string;
  pathEnv: string;
  orcaBin?: string;
  /** Exact lock identity proved foreign. The child replaces that lock only if it is still the same at rename. */
  reclaim?: { pid: number; token: string; startedAt: string };
};

export type SuperviseIo = {
  home?: string;
  platform?: NodeJS.Platform;
  uid?: number;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  run?: CommandRun;
  spawnWatcher?: (request: SpawnRequest) => { pid: number };
  identify?: (pid: number) => Promise<ProcessIdentity | null>;
  alive?: (pid: number) => boolean;
  kill?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void;
  sleep?: (ms: number) => Promise<void>;
  /** Test hook. Runs inside the agent operation lock, immediately before the child is spawned. */
  beforeSpawn?: () => Promise<void> | void;
  /** Present for every operation inside the agent lock. Absent only outside that lock. */
  op?: OpGuard;
  scriptPath?: string;
  nodePath?: string;
  log?: (line: string) => void;
  label?: string;
  taskName?: string;
  unitName?: string;
  legacyLabel?: string;
  legacyTaskName?: string;
  legacyUnitName?: string;
  fetchImpl?: typeof fetch;
  /** Baked CLI version. Missing or non-x.y.z (for example "dev" under tsx) skips auto-update. */
  currentVersion?: string;
  argv?: string[];
  /** Tests set this to skip the update check without changing env. */
  skipAutoUpdate?: boolean;
  /** Tests may pin an ephemeral release key. Production uses the baked-in public key. */
  publicKeyPem?: string;
  lockUpdates?: boolean;
};

export type SuperviseResult = { ok: true; lines: string[] } | { ok: false; message: string };

/** VALETTO_ORCA_BIN, or the pre-rename REPLYSLIP_ORCA_BIN. Copied into the timer as VALETTO_ORCA_BIN. */
function orcaBinFrom(env: NodeJS.ProcessEnv | undefined): string | undefined {
  return env ? envValue(env, 'ORCA_BIN') : undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function verifyDistributedScript(scriptPath: string): { ok: true } | { ok: false; message: string } {
  const base = path.basename(scriptPath);
  // The served file is valetto.mjs. replyslip.mjs is the same bundle under its pre-rename name.
  if (base !== 'valetto.mjs' && base !== 'replyslip.mjs') return { ok: true };
  const checksumPath = `${scriptPath}.sha256`;
  let text: string;
  try {
    text = readFileSync(checksumPath, 'utf8');
  } catch {
    return {
      ok: false,
      message: `Refusing to install: ${checksumPath} is missing. Download ${base} and ${base}.sha256 from the same host, check the file, then run supervise --install again.`,
    };
  }
  const expected = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    return { ok: false, message: `Refusing to install: ${checksumPath} is not a sha256 checksum line.` };
  }
  const actual = createHash('sha256').update(readFileSync(scriptPath)).digest('hex');
  if (actual !== expected) {
    return { ok: false, message: `Refusing to install: ${scriptPath} does not match ${checksumPath}. Download both files again.` };
  }
  return { ok: true };
}

export function supervisedEnv(request: SpawnRequest, base: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: request.pathEnv,
    HOME: request.home,
    USERPROFILE: request.home,
    VALETTO_SUPERVISED: '1',
  };
  if (request.orcaBin) env.VALETTO_ORCA_BIN = request.orcaBin;
  // Orca on Windows resolves its runtime metadata from APPDATA. Dropping it makes
  // `orca status --json` return runtime_unavailable while Orca is running.
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'TMPDIR'] as const) {
    const value = base[key];
    if (value) env[key] = value;
  }
  return env;
}

export function spawnDetachedWatcher(request: SpawnRequest): { pid: number } {
  const dir = superviseDir(request.home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const logPath = path.join(dir, `${request.name}.log`);
  const fd = openSync(logPath, 'a', 0o600);
  try {
    chmodSync(logPath, 0o600);
  } catch {
    // Windows ignores the Unix mode.
  }
  const args = [request.scriptPath, 'watch', '--name', request.name];
  if (request.reclaim) {
    args.push(
      '--reclaim-pid',
      String(request.reclaim.pid),
      '--reclaim-token',
      request.reclaim.token,
      '--reclaim-started-at',
      request.reclaim.startedAt,
    );
  }
  const child = spawn(request.nodePath, args, {
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    env: supervisedEnv(request, process.env),
  });
  child.unref();
  closeSync(fd);
  if (!child.pid) throw new Error('Could not start the watcher.');
  return { pid: child.pid };
}

export async function installSupervision(name: string, io: SuperviseIo = {}): Promise<SuperviseResult> {
  const checked = checkName(name);
  if (checked) return { ok: false, message: checked };
  const home = io.home;
  const epochAtInvoke = readSuperviseState(home, name).epoch;
  const scriptPath = path.resolve(io.scriptPath ?? process.argv[1] ?? '');
  const nodePath = io.nodePath ?? process.execPath;
  const verified = verifyDistributedScript(scriptPath);
  if (!verified.ok) return verified;
  if (!agentKeyFileExists(name, home)) {
    return {
      ok: false,
      message: `No key file at ${agentKeyPath(name, home)}. Register this agent first. The key was not read.`,
    };
  }
  const noAutoUpdate = autoUpdateDisabled(io.env ?? process.env, io.argv ?? []);
  try {
    persistAgentNoAutoUpdate(name, home, noAutoUpdate);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not save the auto-update setting.' };
  }
  const plan = buildInstallPlan(planInput(io, scriptPath, nodePath));
  if ('error' in plan) return { ok: false, message: plan.error };
  const run = io.run ?? defaultRun;
  const preflight = await runPlan(plan.preflight, run);
  if (!preflight.ok) return { ok: false, message: preflightMessage(plan.platform, preflight.message) };
  try {
    writePlanFiles(plan);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not write the supervision files.' };
  }
  const applied = await runPlan(plan.commands, run);
  if (!applied.ok) {
    return {
      ok: false,
      message: `${preflightMessage(plan.platform, applied.message)} Unit files were written, but the timer is not confirmed. The watcher was not started.`,
    };
  }
  // The new timer is confirmed. Only now remove a timer an older CLI installed under the ReplySlip names, so a
  // failed install never leaves the machine with no timer, and a good one never leaves two.
  const legacyNotes = await removeLegacyTimer(plan, run);
  let started: SuperviseResult;
  try {
    started = await withAgentOp(home, name, async (op) => {
      const bound: SuperviseIo = { ...io, op };
      op.assertHeld();
      if (readSuperviseState(home, name).epoch !== epochAtInvoke) {
        return {
          ok: false as const,
          message: `Stop for ${name} won before install finished. The watcher was not started.`,
        };
      }
      op.assertHeld();
      clearStopped(home, name);
      clearHold(home, name);
      clearProgress(home, name);
      const epoch = readSuperviseState(home, name).epoch;
      writeSuperviseState(home, name, { ...emptySuperviseState(), epoch });
      enrollAgent(home, name);
      return ensureWatcher(name, bound, scriptPath, nodePath, true);
    });
  } catch (err) {
    const message = lockWaitMessage(err);
    if (message) return { ok: false, message };
    throw err;
  }
  if (!started.ok) return started;
  const lines = [...plan.notes, ...legacyNotes, `Enrolled ${name}. The timer runs this same script: ${scriptPath}`, ...started.lines];
  return { ok: true, lines };
}

export async function stopSupervision(name: string, io: SuperviseIo = {}): Promise<SuperviseResult> {
  const checked = checkName(name);
  if (checked) return { ok: false, message: checked };
  try {
    return await withAgentOp(io.home, name, (op) => stopLocked(name, { ...io, op }));
  } catch (err) {
    const message = lockWaitMessage(err);
    if (message) return { ok: false, message };
    throw err;
  }
}

export async function uninstallSupervision(options: { name?: string; all?: boolean }, io: SuperviseIo = {}): Promise<SuperviseResult> {
  const names = options.all ? readEnrolled(io.home) : options.name ? [options.name] : [];
  if (!options.all && !options.name) return { ok: false, message: 'Usage: valetto supervise --uninstall --name <name> | --uninstall --all' };
  if (options.name) {
    const checked = checkName(options.name);
    if (checked) return { ok: false, message: checked };
  }
  const lines: string[] = [];
  let lostLock = false;
  for (const name of names) {
    let stopped: SuperviseResult;
    try {
      stopped = await withAgentOp(io.home, name, async (op) => {
        const result = await stopLocked(name, { ...io, op });
        op.assertHeld();
        unenrollAgent(io.home, name);
        return result;
      });
    } catch (err) {
      const message = lockWaitMessage(err);
      if (!message) throw err;
      lostLock = true;
      lines.push(message);
      continue;
    }
    if (!stopped.ok) lines.push(stopped.message);
    else lines.push(...stopped.lines);
  }
  if (options.all && !lostLock) writeEnrolled(io.home, []);
  const remaining = readEnrolled(io.home);
  if (remaining.length > 0) {
    lines.push(`Timer left in place for ${remaining.join(', ')}.`);
    return { ok: true, lines };
  }
  const removed = await removeTimer(io);
  if (!removed.ok) return { ok: false, message: `${removed.message} Deliberate stops stay recorded, so a leftover timer will not start a watcher.` };
  lines.push(...removed.lines);
  return { ok: true, lines };
}

export async function runSupervisionTick(io: SuperviseIo = {}): Promise<SuperviseResult> {
  const lines: string[] = [];
  const names = readEnrolled(io.home);
  if (names.length === 0) return { ok: true, lines: ['No enrolled agents.'] };
  const update = await applyCliUpdateIfDue(names, io);
  if (update.status === 'updated' && update.message) {
    lines.push(update.message);
    await restartEnrolledAfterUpdate(names, io, lines);
  }
  for (const name of names) {
    const outcome = await tickAgent(name, io);
    lines.push(`${name}: ${outcome}`);
  }
  return { ok: true, lines };
}

async function uniqueRegisteredOrigin(names: string[], io: SuperviseIo): Promise<string | null> {
  const found: string[] = [];
  for (const name of names) {
    try {
      const creds = await readAgentCredentials(name, { home: io.home });
      if (creds.relayUrl) found.push(creds.relayUrl.replace(/\/+$/, ''));
    } catch {
      // The tick will surface a missing key later.
    }
  }
  if (found.length === 0) return null;
  const first = found[0]!;
  if (found.some((origin) => !originsMatch(first, origin))) {
    const message = '[valetto] auto-update skipped: enrolled agents are registered with more than one server.';
    (io.log ?? ((line: string) => appendSuperviseLog(io.home, line)))(message);
    return null;
  }
  return first;
}

async function applyCliUpdateIfDue(names: string[], io: SuperviseIo): Promise<AutoUpdateResult> {
  if (io.skipAutoUpdate) return { status: 'skipped' };
  const version = io.currentVersion?.trim();
  if (!version) return { status: 'skipped' };
  const origin = await uniqueRegisteredOrigin(names, io);
  if (!origin) return { status: 'skipped' };
  const scriptPath = path.resolve(io.scriptPath ?? process.argv[1] ?? '');
  if (!scriptPath) return { status: 'skipped' };
  try {
    return await maybeUpdateCli({
      origin,
      scriptPath,
      nodePath: io.nodePath ?? process.execPath,
      currentVersion: version,
      home: io.home,
      env: io.env ?? process.env,
      argv: io.argv ?? [],
      enrolledNames: names,
      now: io.now,
      fetchImpl: io.fetchImpl,
      publicKeyPem: io.publicKeyPem,
      lock: io.lockUpdates,
      log: (line) => {
        io.log?.(line);
        appendSuperviseLog(io.home, line);
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Auto-update failed.';
    appendSuperviseLog(io.home, `[valetto] auto-update failed: ${detail}`);
    return { status: 'failed', message: detail };
  }
}

async function restartEnrolledAfterUpdate(names: string[], io: SuperviseIo, lines: string[]): Promise<void> {
  for (const name of names) {
    if (isStopped(io.home, name)) continue;
    try {
      await withAgentOp(io.home, name, async (op) => {
        await reapOurWatchers(name, { ...io, op });
      });
      lines.push(`${name}: restarting after CLI update`);
    } catch (err) {
      const wait = lockWaitMessage(err);
      lines.push(`${name}: could not signal the watcher after CLI update${wait ? ` (${wait})` : ''}`);
    }
  }
}

export function supervisionStatus(io: SuperviseIo = {}): string[] {
  const names = readEnrolled(io.home);
  if (names.length === 0) return ['No enrolled agents. Run supervise --install --name <name> after the checksummed script is in place.'];
  const lines = names.map((name) => statusLine(name, io.home));
  lines.push(`Tick interval is 120 seconds. Supported timers: macOS LaunchAgent, Linux systemd --user, Windows Task Scheduler.`);
  return lines;
}

async function stopLocked(name: string, io: SuperviseIo): Promise<SuperviseResult> {
  own(io);
  const state = readSuperviseState(io.home, name);
  writeSuperviseState(io.home, name, { ...state, epoch: state.epoch + 1 });
  writeStopped(io.home, name);
  const lock = liveLock(io.home, name);
  const spawnPid = state.lastSpawnPid;
  let signalled = false;
  let lockSkipped = false;
  if (lock) {
    const result = await reapExact(lock.pid, name, io);
    if (result === 'signalled') signalled = true;
    if (result === 'skipped') lockSkipped = true;
  }
  if (spawnPid && spawnPid !== lock?.pid) {
    const result = await reapExact(spawnPid, name, io);
    if (result === 'signalled') signalled = true;
  }
  if (lockSkipped && !signalled) {
    return {
      ok: false,
      message: `Stop is recorded for ${name}, so it will not be restarted. The process was not signalled (not-watcher).`,
    };
  }
  const detail = signalled ? 'The watcher was signalled.' : 'No watcher process was running.';
  return { ok: true, lines: [`Deliberate stop recorded for ${name}. ${detail}`, 'Login, logout, and sleep do not set this stop. supervise --install clears it.'] };
}

async function tickAgent(name: string, io: SuperviseIo): Promise<string> {
  try {
    return await withAgentOp(io.home, name, (op) => tickLocked(name, { ...io, op }));
  } catch (err) {
    const message = lockWaitMessage(err);
    if (message) return message;
    throw err;
  }
}

function lockWaitMessage(err: unknown): string | null {
  return err instanceof FileLockError ? err.message : null;
}

function own(io: SuperviseIo): void {
  if (!io.op) throw new FileLockError('Supervision reached a protected step without the agent lock.');
  io.op.assertHeld();
}

async function tickLocked(name: string, io: SuperviseIo): Promise<string> {
  own(io);
  if (isStopped(io.home, name)) {
    await reapOurWatchers(name, io);
    return 'stopped';
  }
  const epoch = readSuperviseState(io.home, name).epoch;
  const now = (io.now ?? Date.now)();
  const alive = io.alive ?? pidIsAlive;
  const state = readSuperviseState(io.home, name);
  const lock = liveLock(io.home, name);
  const decision = decideSupervision({
    now,
    stopped: isStopped(io.home, name),
    hold: readHold(io.home, name),
    lockLive: !!lock,
    lock: lock ? { pid: lock.pid, token: lock.token ?? '', startedAt: lock.startedAt } : null,
    progress: readProgress(io.home, name),
    spawnAlive: !!state.lastSpawnPid && alive(state.lastSpawnPid),
    state,
  });
  own(io);
  writeSuperviseState(io.home, name, decision.state);
  if (decision.decision.action === 'skip') return decision.decision.reason === 'hold' ? `held (${decision.decision.hold})` : decision.decision.reason;
  if (!(await stopStillCurrent(io.home, name, epoch))) {
    own(io);
    await reapOurWatchers(name, io);
    return 'stopped';
  }
  if (decision.decision.action === 'start') {
    const started = await startWatcher(name, io, decision.state, null);
    if (!started.ok) return `start failed: ${started.message}`;
    if (!(await stopStillCurrent(io.home, name, epoch))) {
      own(io);
      await reapExact(started.pid, name, io);
      return 'stopped';
    }
    return `started pid ${started.pid}`;
  }
  const killed = await killDecision(name, decision.decision, io);
  if (!(await stopStillCurrent(io.home, name, epoch))) {
    own(io);
    await reapOurWatchers(name, io);
    return 'stopped';
  }
  own(io);
  if (!killed.ok) {
    const recovered = await recoverWithoutSignal(name, decision.decision, decision.state, killed.reason, io, epoch);
    if (recovered) return recovered;
    return `left in place (${killed.reason})`;
  }
  const started = await startWatcher(name, io, { ...decision.state, lastSpawnPid: null }, null);
  if (!started.ok) return `killed, then start failed: ${started.message}`;
  if (!(await stopStillCurrent(io.home, name, epoch))) {
    own(io);
    await reapExact(started.pid, name, io);
    return 'stopped';
  }
  return `replaced with pid ${started.pid}`;
}

async function stopStillCurrent(home: string | undefined, name: string, epoch: number): Promise<boolean> {
  return !isStopped(home, name) && readSuperviseState(home, name).epoch === epoch;
}

/** Signal only this agent's watcher pids. Never deletes a lock file and never signals an unrelated pid. */
async function reapOurWatchers(name: string, io: SuperviseIo): Promise<'signalled' | 'skipped' | 'none'> {
  const state = readSuperviseState(io.home, name);
  const pids = new Set<number>();
  if (state.lastSpawnPid) pids.add(state.lastSpawnPid);
  const lock = liveLock(io.home, name);
  if (lock) pids.add(lock.pid);
  if (pids.size === 0) return 'none';
  let signalled = false;
  let skipped = false;
  for (const pid of pids) {
    own(io);
    const result = await reapExact(pid, name, io);
    if (result === 'signalled') signalled = true;
    if (result === 'skipped') skipped = true;
  }
  if (signalled) return 'signalled';
  if (skipped) return 'skipped';
  return 'none';
}

async function reapExact(pid: number, name: string, io: SuperviseIo): Promise<'signalled' | 'skipped' | 'not-running'> {
  const alive = io.alive ?? pidIsAlive;
  if (!alive(pid)) return 'not-running';
  const identify = io.identify ?? ((target: number) => identifyProcess(target, io.platform ?? process.platform));
  const identity = await identify(pid);
  own(io);
  if (!identity?.cmdline || !watchCommandForAgent(identity.cmdline, name)) return 'skipped';
  const platform = io.platform ?? process.platform;
  const kill = io.kill ?? ((target: number, signal: 'SIGTERM' | 'SIGKILL') => defaultKill(target, signal, platform));
  own(io);
  kill(pid, platform === 'win32' ? 'SIGKILL' : 'SIGTERM');
  return 'signalled';
}

const FOREIGN_PID = new Set(['pid-reused', 'not-watcher']);

/**
 * The pid we remembered is not our watcher. Do not signal it. A foreign lock is reclaimed
 * only by passing its exact pid, token, and start time. The child refuses if that lock changed.
 */
async function recoverWithoutSignal(
  name: string,
  decision: Extract<SuperviseDecision, { action: 'kill-lock' | 'kill-spawn' }>,
  state: AgentSuperviseState,
  reason: string,
  io: SuperviseIo,
  epoch: number,
): Promise<string | null> {
  const spawnWasNotOurs = decision.action === 'kill-spawn' && (FOREIGN_PID.has(reason) || reason === 'unverified-process');
  const lockWasNotOurs = decision.action === 'kill-lock' && FOREIGN_PID.has(reason);
  if (!spawnWasNotOurs && !lockWasNotOurs) return null;
  if (!(await stopStillCurrent(io.home, name, epoch))) {
    own(io);
    await reapOurWatchers(name, io);
    return 'stopped';
  }
  own(io);
  const cleared: AgentSuperviseState = { ...state, lastSpawnPid: null, lastSpawnAt: null };
  writeSuperviseState(io.home, name, cleared);
  const reclaim = lockWasNotOurs ? { pid: decision.pid, token: decision.token, startedAt: decision.startedAt } : null;
  const started = await startWatcher(name, io, cleared, reclaim);
  if (!started.ok) return `start failed: ${started.message}`;
  if (!(await stopStillCurrent(io.home, name, epoch))) {
    own(io);
    await reapExact(started.pid, name, io);
    return 'stopped';
  }
  return `started pid ${started.pid} without signalling ${decision.pid} (${reason})`;
}

async function ensureWatcher(
  name: string,
  io: SuperviseIo,
  scriptPath: string,
  nodePath: string,
  replace: boolean,
): Promise<SuperviseResult> {
  const bound: SuperviseIo = { ...io, scriptPath, nodePath };
  const lock = liveLock(io.home, name);
  if (lock && replace) {
    const killed = await killDecision(
      name,
      { action: 'kill-lock', reason: 'wedge', pid: lock.pid, token: lock.token ?? '', startedAt: lock.startedAt },
      bound,
    );
    own(bound);
    if (!killed.ok) {
      return {
        ok: false,
        message: `A watcher for ${name} is already running (pid ${lock.pid}) and was not replaced (${killed.reason}). A second watcher was not started.`,
      };
    }
  } else if (lock) {
    return { ok: true, lines: [`Watcher already running for ${name} (pid ${lock.pid}).`] };
  }
  own(bound);
  const started = await startWatcher(name, bound, readSuperviseState(io.home, name), null);
  if (!started.ok) return { ok: false, message: started.message };
  return { ok: true, lines: [`Watcher started for ${name} (pid ${started.pid}), detached from this terminal.`] };
}

async function startWatcher(
  name: string,
  io: SuperviseIo,
  state: AgentSuperviseState,
  reclaim: { pid: number; token: string; startedAt: string } | null,
): Promise<{ ok: true; pid: number } | { ok: false; message: string }> {
  own(io);
  if (isStopped(io.home, name)) return { ok: false, message: 'stopped' };
  if (!agentKeyFileExists(name, io.home)) {
    own(io);
    writeHold(io.home, name, 'config');
    return { ok: false, message: `No key file for ${name}. Not started.` };
  }
  const scriptPath = path.resolve(io.scriptPath ?? process.argv[1] ?? '');
  const nodePath = io.nodePath ?? process.execPath;
  await io.beforeSpawn?.();
  own(io);
  if (isStopped(io.home, name) || readSuperviseState(io.home, name).epoch !== state.epoch) {
    return { ok: false, message: 'stopped' };
  }
  const request: SpawnRequest = {
    nodePath,
    scriptPath,
    name,
    home: io.home ?? '',
    pathEnv: io.env?.PATH ?? process.env.PATH ?? '',
    ...(orcaBinFrom(io.env) ? { orcaBin: orcaBinFrom(io.env) } : {}),
    ...(reclaim ? { reclaim } : {}),
  };
  try {
    const spawnWatcher = io.spawnWatcher ?? spawnDetachedWatcher;
    own(io);
    const child = spawnWatcher(request);
    const now = (io.now ?? Date.now)();
    own(io);
    writeSuperviseState(io.home, name, {
      ...state,
      restarts: [...state.restarts, new Date(now).toISOString()],
      lastSpawnAt: new Date(now).toISOString(),
      lastSpawnPid: child.pid,
    });
    return { ok: true, pid: child.pid };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not start the watcher.' };
  }
}

async function killDecision(
  name: string,
  decision: Extract<SuperviseDecision, { action: 'kill-lock' | 'kill-spawn' }>,
  io: SuperviseIo,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const identify = io.identify ?? ((pid: number) => identifyProcess(pid, io.platform ?? process.platform));
  const identity = await identify(decision.pid);
  own(io);
  const allowed =
    decision.action === 'kill-lock'
      ? killLockAllowed({
          lock: currentLockIdentity(io.home, name),
          expected: { pid: decision.pid, token: decision.token, startedAt: decision.startedAt },
          identity,
        })
      : killSpawnAllowed({ identity, spawnedAt: decision.spawnedAt });
  if (!allowed.ok) return allowed;
  return signalPid(decision.pid, io, decision.action === 'kill-lock' ? 'graceful' : 'force', async () => {
    const again = await identify(decision.pid);
    if (decision.action === 'kill-lock') {
      return killLockAllowed({
        lock: currentLockIdentity(io.home, name),
        expected: { pid: decision.pid, token: decision.token, startedAt: decision.startedAt },
        identity: again,
      });
    }
    return killSpawnAllowed({ identity: again, spawnedAt: decision.spawnedAt });
  });
}

async function signalPid(
  pid: number,
  io: SuperviseIo,
  mode: 'graceful' | 'force',
  recheck: () => Promise<{ ok: true } | { ok: false; reason: string }>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const platform = io.platform ?? process.platform;
  const kill = io.kill ?? ((target: number, signal: 'SIGTERM' | 'SIGKILL') => defaultKill(target, signal, platform));
  const alive = io.alive ?? pidIsAlive;
  const sleep = io.sleep ?? defaultSleep;
  const again = await recheck();
  own(io);
  if (!again.ok) return again;
  if (platform === 'win32' || mode === 'force') {
    own(io);
    kill(pid, 'SIGKILL');
    return { ok: true };
  }
  own(io);
  kill(pid, 'SIGTERM');
  await sleep(500);
  own(io);
  if (!alive(pid)) return { ok: true };
  const finalCheck = await recheck();
  own(io);
  if (!finalCheck.ok) return { ok: true };
  own(io);
  kill(pid, 'SIGKILL');
  return { ok: true };
}

function defaultKill(pid: number, signal: 'SIGTERM' | 'SIGKILL', platform: NodeJS.Platform): void {
  if (platform === 'win32') {
    process.kill(pid);
    return;
  }
  process.kill(pid, signal);
}

function currentLockIdentity(home: string | undefined, name: string): { pid: number; token: string; startedAt: string } | null {
  const lock = liveLock(home, name);
  if (!lock?.token) return null;
  return { pid: lock.pid, token: lock.token, startedAt: lock.startedAt };
}

function liveLock(home: string | undefined, name: string): WatcherLockInfo | null {
  return listLiveWatcherLocks(home).find((lock) => lock.agentName === name) ?? null;
}

async function removeTimer(io: SuperviseIo): Promise<SuperviseResult> {
  const scriptPath = path.resolve(io.scriptPath ?? process.argv[1] ?? '');
  const nodePath = io.nodePath ?? process.execPath;
  const plan = buildInstallPlan(planInput(io, scriptPath, nodePath));
  if ('error' in plan) return { ok: true, lines: [plan.error] };
  const run = io.run ?? defaultRun;
  const applied = await runPlan(plan.uninstallCommands, run);
  const legacyNotes = await removeLegacyTimer(plan, run);
  for (const file of plan.files) {
    try {
      unlinkSync(file.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { ok: false, message: `Could not remove ${file.path}.` };
      }
    }
  }
  if (!applied.ok) return { ok: false, message: applied.message };
  return { ok: true, lines: [...legacyNotes, 'Supervision timer removed.'] };
}

/**
 * Removes the pre-rename timer (launchd label, systemd unit, or scheduled task with the ReplySlip name) and its
 * unit files. Every step is best effort. Returns one line when an old timer file was found and removed, or could not be.
 */
async function removeLegacyTimer(plan: InstallPlan, run: CommandRun): Promise<string[]> {
  const existed = plan.legacyFiles.filter((file) => {
    try {
      accessSync(file);
      return true;
    } catch {
      return false;
    }
  });
  let commandRemoved = false;
  for (const step of plan.legacyCommands) {
    try {
      if ((await run(step.command, step.args)).code === 0) commandRemoved = true;
    } catch {
      // Best effort: the old timer may never have existed here.
    }
  }
  const left: string[] = [];
  for (const file of plan.legacyFiles) {
    try {
      unlinkSync(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') left.push(file);
    }
  }
  if (left.length > 0) return [`Could not remove the old ReplySlip timer file ${left.join(', ')}. Delete it by hand.`];
  if (existed.length > 0 || commandRemoved) return ['Removed the old ReplySlip timer. Only the Valetto timer runs now.'];
  return [];
}

function planInput(io: SuperviseIo, scriptPath: string, nodePath: string): InstallPlanInput {
  return {
    platform: io.platform ?? process.platform,
    home: io.home ?? '',
    nodePath,
    scriptPath,
    pathEnv: io.env?.PATH ?? process.env.PATH ?? '',
    ...(orcaBinFrom(io.env) ? { orcaBin: orcaBinFrom(io.env) } : {}),
    ...(io.env?.APPDATA ? { appData: io.env.APPDATA } : {}),
    ...(io.env?.LOCALAPPDATA ? { localAppData: io.env.LOCALAPPDATA } : {}),
    ...(typeof (io.uid ?? process.getuid?.()) === 'number' ? { uid: io.uid ?? process.getuid?.() } : {}),
    ...(io.label ? { label: io.label } : {}),
    ...(io.taskName ? { taskName: io.taskName } : {}),
    ...(io.unitName ? { unitName: io.unitName } : {}),
    ...(io.legacyLabel ? { legacyLabel: io.legacyLabel } : {}),
    ...(io.legacyTaskName ? { legacyTaskName: io.legacyTaskName } : {}),
    ...(io.legacyUnitName ? { legacyUnitName: io.legacyUnitName } : {}),
    noAutoUpdate: autoUpdateDisabled(io.env ?? process.env, io.argv ?? []),
  };
}

function writePlanFiles(plan: InstallPlan): void {
  for (const file of plan.files) {
    mkdirSync(path.dirname(file.path), { recursive: true, mode: 0o700 });
    writeFileSync(file.path, file.contents, { mode: file.mode });
    try {
      chmodSync(file.path, file.mode);
    } catch {
      // Windows ignores the Unix mode.
    }
  }
}

async function runPlan(commands: PlannedCommand[], run: CommandRun): Promise<{ ok: true } | { ok: false; message: string }> {
  for (const step of commands) {
    let result: CommandOutput;
    try {
      result = await run(step.command, step.args);
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
      if (step.optional) continue;
      if (code === 'ENOENT') return { ok: false, message: `${step.command} was not found.` };
      return { ok: false, message: err instanceof Error ? err.message : `${step.command} failed.` };
    }
    if (result.code !== 0 && !step.optional) {
      const detail = redactSecrets(`${result.stderr}\n${result.stdout}`).trim().slice(0, 400);
      return { ok: false, message: `${step.command} ${step.args.join(' ')} exited ${result.code}${detail ? `: ${detail}` : ''}.` };
    }
  }
  return { ok: true };
}

function preflightMessage(platform: InstallPlan['platform'], detail: string): string {
  if (platform === 'linux' && /not found|systemctl/i.test(detail)) {
    return `No working systemd user session (${detail}). Log in on this machine and try again. Linger was not enabled. Supervision was not installed.`;
  }
  if (platform === 'darwin') {
    return `launchctl could not load the LaunchAgent (${detail}). Supervision was not installed.`;
  }
  if (platform === 'win32') {
    return `Task Scheduler could not install the task (${detail}). Supervision was not installed. The task is not configured to run while logged off.`;
  }
  return detail;
}

function statusLine(name: string, home: string | undefined): string {
  if (isStopped(home, name)) return `${name}: deliberate stop. supervise --install clears it.`;
  const hold = readHold(home, name);
  if (hold) return `${name}: held (${hold}). supervise --install clears it after the cause is fixed.`;
  const lock = liveLock(home, name);
  const progress = readProgress(home, name);
  if (!lock) return `${name}: watcher not running.`;
  if (!progress || progress.token !== lock.token) return `${name}: running pid ${lock.pid}, progress not matched yet.`;
  return `${name}: running pid ${lock.pid}, phase ${progress.phase}, deadline ${progress.deadlineAt}.`;
}

function agentKeyFileExists(name: string, home: string | undefined): boolean {
  try {
    accessSync(agentKeyPath(name, home));
    return true;
  } catch {
    return false;
  }
}

function checkName(name: string): string | null {
  if (!AGENT_NAME_PATTERN.test(name)) return 'Usage: valetto supervise --install --name <name>';
  return null;
}

const defaultRun: CommandRun = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

export function appendSuperviseLog(home: string | undefined, line: string): void {
  try {
    const dir = superviseDir(home);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'supervise.log');
    appendFileSync(file, `${redactSecrets(line)}\n`, { mode: 0o600 });
  } catch {
    // Logging must not hide the supervision result.
  }
}

export function clearProgressOnExit(home: string | undefined, name: string): void {
  clearProgress(home, name);
}
