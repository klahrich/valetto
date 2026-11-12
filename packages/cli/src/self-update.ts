// SPDX-License-Identifier: Apache-2.0

import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { acquireFileLockSync, releaseFileLock, FileLockError, type HeldFileLock } from './file-lock.ts';
import { envValue, stateHome } from './home.ts';
import { anyAgentNoAutoUpdateEnabled } from './register.ts';
import { CLI_RELEASE_PUBLIC_KEY_PEM, parseCliScriptVersionFromBytes, verifyCliReleaseSignature } from './release-pubkey.ts';
import { superviseDir } from './watcher-progress.ts';

export const DEFAULT_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const MIN_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
export const UPDATE_FETCH_TIMEOUT_MS = 15_000;
export const UPDATE_MAX_BYTES = 5 * 1024 * 1024;
export const LATEST_PATH = '/api/v1/cli/latest';

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export type CliVersionParts = [number, number, number];

export type LatestCliInfo = { version: string; sha256: string; url: string; signature?: string };

export type AutoUpdateStatus = 'updated' | 'current' | 'skipped' | 'failed';

export type AutoUpdateResult = {
  status: AutoUpdateStatus;
  message?: string;
  from?: string;
  to?: string;
};

export type ScriptFs = {
  writeFileSync(path: string, data: string | Uint8Array, options?: { flag?: string; mode?: number }): void;
  readFileSync(path: string): Buffer;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
  existsSync(path: string): boolean;
  chmodSync?(path: string, mode: number): void;
  statSync?(path: string): { mode: number };
};

const defaultFs: ScriptFs = {
  writeFileSync,
  readFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  chmodSync,
  statSync,
};

export function parseCliVersion(value: string): CliVersionParts | null {
  const match = VERSION_RE.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** -1 if a < b, 0 if equal, 1 if a > b. Null if either is not x.y.z. */
export function compareCliVersions(a: string, b: string): number | null {
  const left = parseCliVersion(a);
  const right = parseCliVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i]! < right[i]!) return -1;
    if (left[i]! > right[i]!) return 1;
  }
  return 0;
}

export function isNewerCliVersion(current: string, candidate: string): boolean {
  return compareCliVersions(current, candidate) === -1;
}

export function autoUpdateDisabled(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = [],
  options: { agentConfig?: boolean } = {},
): boolean {
  if (options.agentConfig) return true;
  if (argv.includes('--no-auto-update')) return true;
  const value = envValue(env, 'NO_AUTO_UPDATE');
  return value !== undefined && TRUTHY.has(value.trim().toLowerCase());
}

export function enrolledAgentsDisableAutoUpdate(names: string[], home?: string): boolean {
  return anyAgentNoAutoUpdateEnabled(names, home);
}

export function isLocalhostHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function originsMatch(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    const port = (url: URL) => url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : url.port);
    return left.protocol === right.protocol && left.hostname.toLowerCase() === right.hostname.toLowerCase() && port(left) === port(right);
  } catch {
    return false;
  }
}

function assertSameOriginUrl(origin: string, url: string, allowedPaths: string[], label: string): void {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(origin);
  } catch {
    throw new Error(`${label} is not valid.`);
  }
  const https = parsed.protocol === 'https:';
  const localHttp = parsed.protocol === 'http:' && isLocalhostHostname(parsed.hostname);
  if (!https && !localHttp) throw new Error(`${label} must be https, or http on localhost.`);
  if (!originsMatch(base.href, parsed.href)) throw new Error(`${label} is not on the registered origin.`);
  if (!allowedPaths.includes(parsed.pathname) || parsed.search || parsed.hash) {
    throw new Error(`${label} must be the Valetto CLI script.`);
  }
}

/**
 * The update URL must be on the same origin the agent registered with.
 * HTTPS only, except http://localhost (and loopback) for tests.
 * Path must be the served CLI script.
 */
export function assertUpdateUrlAllowed(origin: string, url: string): void {
  assertSameOriginUrl(origin, url, ['/valetto.mjs', '/replyslip.mjs'], 'Update URL');
}

export function assertSignatureUrlAllowed(origin: string, url: string): void {
  try {
    assertSameOriginUrl(origin, url, ['/valetto.mjs.sig', '/replyslip.mjs.sig'], 'Signature URL');
  } catch (err) {
    if (err instanceof Error && err.message.includes('must be the Valetto CLI script')) {
      throw new Error('Signature URL must be the Valetto CLI signature.');
    }
    throw err;
  }
}

export function backupScriptPath(scriptPath: string): string {
  return `${scriptPath}.old`;
}

export function tempScriptPath(scriptPath: string, token: string): string {
  return `${scriptPath}.tmp-${token}`;
}

export function readScriptMode(scriptPath: string, fs: ScriptFs = defaultFs): number | undefined {
  try {
    const mode = fs.statSync?.(scriptPath)?.mode;
    return typeof mode === 'number' ? mode : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write `data` to a new exclusive temp file next to `scriptPath`.
 * The name is random; the file is created with `wx` / O_EXCL so a colliding name is not overwritten.
 */
export function writeExclusiveTempScript(
  scriptPath: string,
  data: Buffer,
  options: { fs?: ScriptFs; random?: () => string; mode?: number } = {},
): string {
  const fs = options.fs ?? defaultFs;
  const mode = options.mode ?? 0o600;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = options.random?.() ?? randomBytes(16).toString('hex');
    const tempPath = tempScriptPath(scriptPath, token);
    try {
      fs.writeFileSync(tempPath, data, { flag: 'wx', mode });
      return tempPath;
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : '';
      if (code === 'EEXIST') continue;
      throw err;
    }
  }
  throw new Error('Could not create an exclusive temp file for the CLI update.');
}

/**
 * If the script is missing but a `.old` leftover remains, rename it back.
 * If the current script is already in place (and, when `current` is set, already that version),
 * try to delete the leftover `.old`.
 */
export function healWindowsScript(
  scriptPath: string,
  options: { platform: NodeJS.Platform; fs?: ScriptFs; currentVersion?: string } = { platform: process.platform },
): 'restored' | 'cleaned' | 'none' {
  const fs = options.fs ?? defaultFs;
  const bak = backupScriptPath(scriptPath);
  if (!fs.existsSync(bak)) return 'none';
  if (!fs.existsSync(scriptPath)) {
    fs.renameSync(bak, scriptPath);
    return 'restored';
  }
  if (options.currentVersion) {
    try {
      const version = parseCliScriptVersionFromBytes(fs.readFileSync(scriptPath));
      if (version && compareCliVersions(version, options.currentVersion) === 0) {
        fs.unlinkSync(bak);
        return 'cleaned';
      }
    } catch {
      return 'none';
    }
    return 'none';
  }
  try {
    fs.unlinkSync(bak);
    return 'cleaned';
  } catch {
    return 'none';
  }
}

/**
 * Replace `scriptPath` with `tempPath`, preserving mode. On Windows the running file cannot be overwritten,
 * so it is renamed aside first, then the new file is moved into place. If the second move fails, the original
 * is renamed back. If that restore also fails, `.old` is left for the next tick to self-heal.
 */
export function replaceScriptFile(
  scriptPath: string,
  tempPath: string,
  options: { platform: NodeJS.Platform; fs?: ScriptFs; mode?: number } = { platform: process.platform },
): void {
  const io = options.fs ?? defaultFs;
  const bak = backupScriptPath(scriptPath);
  const mode = options.mode ?? readScriptMode(scriptPath, io);
  if (options.platform === 'win32') {
    const hadScript = io.existsSync(scriptPath);
    if (hadScript && io.existsSync(bak)) {
      try {
        io.unlinkSync(bak);
      } catch {
        // An older leftover may still be open; the rename below may then fail, which is safer than deleting the only copy.
      }
    }
    try {
      if (hadScript) io.renameSync(scriptPath, bak);
    } catch (err) {
      throw err;
    }
    try {
      io.renameSync(tempPath, scriptPath);
    } catch (err) {
      if (!io.existsSync(scriptPath) && io.existsSync(bak)) {
        try {
          io.renameSync(bak, scriptPath);
        } catch {
          // Leave the backup so the next tick can restore it.
        }
      }
      throw err;
    }
    if (mode !== undefined) {
      try {
        io.chmodSync?.(scriptPath, mode & 0o777);
      } catch {
        // Windows ignores Unix modes.
      }
    }
    try {
      io.unlinkSync(bak);
    } catch {
      // The previous watcher may still have this file open.
    }
    return;
  }
  io.renameSync(tempPath, scriptPath);
  if (mode !== undefined) {
    try {
      io.chmodSync?.(scriptPath, mode & 0o777);
    } catch {
      // Some filesystems ignore the mode.
    }
  }
}

export function writeChecksumSidecar(scriptPath: string, sha256: string, fs: ScriptFs = defaultFs): void {
  const base = path.basename(scriptPath);
  if (base !== 'valetto.mjs' && base !== 'replyslip.mjs') return;
  const sidecar = `${scriptPath}.sha256`;
  const written = writeExclusiveTempScript(sidecar, Buffer.from(`${sha256}  ${base}\n`), { fs, mode: 0o644 });
  try {
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  } catch {
    // Windows may need unlink-then-rename when the sidecar is not locked.
  }
  try {
    fs.renameSync(written, sidecar);
  } catch (err) {
    try {
      fs.unlinkSync(written);
    } catch {
      // Best effort.
    }
    throw err;
  }
}

type CheckState = { checked_at: number; outcome: string };

function checkStatePath(home?: string): string {
  return path.join(stateHome(home ?? homedir()), 'auto-update.json');
}

export function updateLockPath(home?: string): string {
  return path.join(superviseDir(home), 'update.lock');
}

export function readUpdateCheckState(home?: string, fs: ScriptFs = defaultFs): CheckState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(checkStatePath(home)).toString('utf8')) as Partial<CheckState>;
    if (typeof parsed.checked_at !== 'number' || !Number.isFinite(parsed.checked_at)) return null;
    return { checked_at: parsed.checked_at, outcome: typeof parsed.outcome === 'string' ? parsed.outcome : '' };
  } catch {
    return null;
  }
}

export function writeUpdateCheckState(home: string | undefined, state: CheckState, fs: ScriptFs = defaultFs): void {
  const file = checkStatePath(home);
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  } catch {
    // The write below will fail if the directory still cannot be created.
  }
  try {
    fs.writeFileSync(file, `${JSON.stringify(state)}\n`);
  } catch {
    // A missed check stamp is not fatal; the next tick will try again.
  }
}

export type AutoUpdateIo = {
  origin: string;
  scriptPath: string;
  nodePath?: string;
  currentVersion: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  /** Enrolled agent names, used to honour `no_auto_update` on a key file. */
  enrolledNames?: string[];
  now?: () => number;
  intervalMs?: number;
  /** Tests may set 0. Production clamps to at least an hour. */
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  platform?: NodeJS.Platform;
  fs?: ScriptFs;
  /** Override the pinned release public key (tests only). */
  publicKeyPem?: string;
  /** When false, skip the exclusive update lock. Tests may set this. Default true. */
  lock?: boolean;
  acquireLock?: (file: string) => HeldFileLock;
};

function clampInterval(intervalMs: number | undefined, minIntervalMs: number): number {
  const wanted = intervalMs ?? DEFAULT_UPDATE_INTERVAL_MS;
  return Math.max(wanted, minIntervalMs);
}

export function parseLatestPayload(body: unknown): LatestCliInfo {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Latest CLI response is not valid.');
  const row = body as Record<string, unknown>;
  if (typeof row.version !== 'string' || !parseCliVersion(row.version)) throw new Error('Latest CLI version is not valid.');
  if (typeof row.sha256 !== 'string' || !SHA_RE.test(row.sha256.toLowerCase())) throw new Error('Latest CLI sha256 is not valid.');
  if (typeof row.url !== 'string' || !row.url.trim()) throw new Error('Latest CLI url is not valid.');
  const signature = typeof row.signature === 'string' && row.signature.trim() ? row.signature.trim() : undefined;
  return { version: row.version.trim(), sha256: row.sha256.toLowerCase(), url: row.url.trim(), signature };
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  if (response.body == null) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('Downloaded CLI is too large.');
    return buf;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error('Downloaded CLI is too large.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function resolveSignature(origin: string, latest: LatestCliInfo, fetchImpl: typeof fetch): Promise<string> {
  if (latest.signature) return latest.signature;
  const sigUrl = latest.url.endsWith('replyslip.mjs') ? `${origin}/replyslip.mjs.sig` : `${origin}/valetto.mjs.sig`;
  assertSignatureUrlAllowed(origin, sigUrl);
  const response = await fetchImpl(sigUrl, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(UPDATE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`CLI signature request failed (HTTP ${response.status}).`);
  const text = (await response.text()).trim();
  if (!text) throw new Error('CLI signature is missing.');
  return text;
}

/**
 * Check the registered origin for a newer CLI and, if so, replace this script in place.
 * The download is signature-checked against the pinned release key before any file is written
 * to the final path, and the downloaded bytes are never executed.
 * On any failure the existing script is left untouched.
 */
export async function maybeUpdateCli(io: AutoUpdateIo): Promise<AutoUpdateResult> {
  const log = io.log ?? (() => undefined);
  const env = io.env ?? process.env;
  const configDisabled = enrolledAgentsDisableAutoUpdate(io.enrolledNames ?? [], io.home);
  if (autoUpdateDisabled(env, io.argv ?? [], { agentConfig: configDisabled })) {
    return { status: 'skipped', message: 'Auto-update is off.' };
  }

  const useLock = io.lock !== false;
  let held: HeldFileLock | undefined;
  if (useLock) {
    try {
      mkdirSync(superviseDir(io.home), { recursive: true, mode: 0o700 });
      const acquire = io.acquireLock ?? ((file: string) => acquireFileLockSync(file, { waitMs: 2_000 }));
      held = acquire(updateLockPath(io.home));
    } catch (err) {
      if (err instanceof FileLockError) {
        log('[valetto] auto-update skipped: another update is already running.');
        return { status: 'skipped', message: 'Another update is already running.' };
      }
      const detail = err instanceof Error ? err.message : 'Could not take the update lock.';
      log(`[valetto] auto-update skipped: ${detail}`);
      return { status: 'skipped', message: detail };
    }
  }
  try {
    return await maybeUpdateCliLocked(io);
  } finally {
    if (held) releaseFileLock(held);
  }
}

async function maybeUpdateCliLocked(io: AutoUpdateIo): Promise<AutoUpdateResult> {
  const log = io.log ?? (() => undefined);
  const current = io.currentVersion.trim();
  if (!parseCliVersion(current)) return { status: 'skipped' };
  const scriptPath = path.resolve(io.scriptPath);
  if (!scriptPath) return { status: 'skipped' };
  const fs = io.fs ?? defaultFs;
  const platform = io.platform ?? process.platform;
  try {
    healWindowsScript(scriptPath, { platform, fs, currentVersion: current });
  } catch {
    // Healing must not block a later successful replace.
  }

  const minInterval = io.minIntervalMs ?? MIN_UPDATE_INTERVAL_MS;
  const interval = clampInterval(io.intervalMs, minInterval);
  const now = (io.now ?? Date.now)();
  const previous = readUpdateCheckState(io.home, fs);
  if (previous && now - previous.checked_at < interval) return { status: 'skipped' };

  const origin = io.origin.replace(/\/+$/, '');
  let latest: LatestCliInfo;
  const mark = (outcome: string) => {
    writeUpdateCheckState(io.home, { checked_at: now, outcome }, fs);
  };
  try {
    const fetchImpl = io.fetchImpl ?? fetch;
    const response = await fetchImpl(`${origin}${LATEST_PATH}`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(UPDATE_FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Latest CLI request failed (HTTP ${response.status}).`);
    latest = parseLatestPayload(await response.json());
  } catch (err) {
    mark('failed');
    const detail = err instanceof Error ? err.message : 'Latest CLI request failed.';
    log(`[valetto] auto-update check failed: ${detail}`);
    return { status: 'failed', message: detail };
  }

  try {
    assertUpdateUrlAllowed(origin, latest.url);
  } catch (err) {
    mark('failed');
    const detail = err instanceof Error ? err.message : 'Update URL is not allowed.';
    log(`[valetto] auto-update skipped: ${detail}`);
    return { status: 'failed', message: detail };
  }

  const cmp = compareCliVersions(current, latest.version);
  if (cmp === null) {
    mark('failed');
    return { status: 'failed', message: 'Latest CLI version is not valid.' };
  }
  if (cmp >= 0) {
    mark('current');
    try {
      healWindowsScript(scriptPath, { platform, fs, currentVersion: current });
    } catch {
      // Leftover cleanup is best effort.
    }
    return { status: 'current' };
  }

  const publicKeyPem = io.publicKeyPem ?? CLI_RELEASE_PUBLIC_KEY_PEM;
  let tempPath: string | undefined;
  try {
    const fetchImpl = io.fetchImpl ?? fetch;
    const response = await fetchImpl(latest.url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(UPDATE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`CLI download failed (HTTP ${response.status}).`);
    const bytes = await readLimited(response, UPDATE_MAX_BYTES);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== latest.sha256) throw new Error('Downloaded CLI does not match sha256.');
    const signature = await resolveSignature(origin, latest, fetchImpl);
    if (!verifyCliReleaseSignature(bytes, signature, publicKeyPem)) {
      throw new Error('Downloaded CLI does not match the release signature.');
    }
    const parsedVersion = parseCliScriptVersionFromBytes(bytes);
    if (parsedVersion !== latest.version) throw new Error('Downloaded CLI version marker did not match.');
    const mode = readScriptMode(scriptPath, fs) ?? 0o644;
    tempPath = writeExclusiveTempScript(scriptPath, bytes, { fs, mode });
    replaceScriptFile(scriptPath, tempPath, { platform, fs, mode });
    tempPath = undefined;
    try {
      writeChecksumSidecar(scriptPath, latest.sha256, fs);
    } catch {
      // The script is already replaced; a missing sidecar only matters for a later --install.
    }
    try {
      healWindowsScript(scriptPath, { platform, fs, currentVersion: latest.version });
    } catch {
      // Leftover cleanup is best effort.
    }
    mark('updated');
    const message = `Updated Valetto watcher ${current} -> ${latest.version}`;
    log(`[valetto] ${message}`);
    return { status: 'updated', message, from: current, to: latest.version };
  } catch (err) {
    if (tempPath) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // Keep going; the old script was not replaced.
      }
    }
    mark('failed');
    const detail = err instanceof Error ? err.message : 'Auto-update failed.';
    log(`[valetto] auto-update failed: ${detail}`);
    return { status: 'failed', message: detail };
  }
}
