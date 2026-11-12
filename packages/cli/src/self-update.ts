// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { envValue, stateHome } from './home.ts';

export const DEFAULT_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const MIN_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
export const UPDATE_FETCH_TIMEOUT_MS = 15_000;
export const UPDATE_MAX_BYTES = 5 * 1024 * 1024;
export const LATEST_PATH = '/api/v1/cli/latest';

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export type CliVersionParts = [number, number, number];

export type LatestCliInfo = { version: string; sha256: string; url: string };

export type AutoUpdateStatus = 'updated' | 'current' | 'skipped' | 'failed';

export type AutoUpdateResult = {
  status: AutoUpdateStatus;
  message?: string;
  from?: string;
  to?: string;
};

export type ScriptFs = {
  writeFileSync(path: string, data: string | Uint8Array): void;
  readFileSync(path: string): Buffer;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
  existsSync(path: string): boolean;
  chmodSync?(path: string, mode: number): void;
};

const defaultFs: ScriptFs = {
  writeFileSync,
  readFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  chmodSync,
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

export function autoUpdateDisabled(env: NodeJS.ProcessEnv = process.env, argv: string[] = []): boolean {
  if (argv.includes('--no-auto-update')) return true;
  const value = envValue(env, 'NO_AUTO_UPDATE');
  return value !== undefined && TRUTHY.has(value.trim().toLowerCase());
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

/**
 * The update URL must be on the same origin the agent registered with.
 * HTTPS only, except http://localhost (and loopback) for tests.
 * Path must be the served CLI script.
 */
export function assertUpdateUrlAllowed(origin: string, url: string): void {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(origin);
  } catch {
    throw new Error('Update URL is not valid.');
  }
  const https = parsed.protocol === 'https:';
  const localHttp = parsed.protocol === 'http:' && isLocalhostHostname(parsed.hostname);
  if (!https && !localHttp) throw new Error('Update URL must be https, or http on localhost.');
  if (!originsMatch(base.href, parsed.href)) throw new Error('Update URL is not on the registered origin.');
  if (parsed.pathname !== '/valetto.mjs' && parsed.pathname !== '/replyslip.mjs') {
    throw new Error('Update URL must be the Valetto CLI script.');
  }
  if (parsed.search || parsed.hash) throw new Error('Update URL must be the Valetto CLI script.');
}

export function backupScriptPath(scriptPath: string): string {
  return `${scriptPath}.old`;
}

export function tempScriptPath(scriptPath: string, pid = process.pid): string {
  return `${scriptPath}.tmp-${pid}`;
}

/**
 * Replace `scriptPath` with `tempPath`. On Windows the running file cannot be overwritten,
 * so it is renamed aside first, then the new file is moved into place. If the second move
 * fails, the original is renamed back. A leftover `.old` on Windows is the previous script
 * still held open by a process; a later tick deletes it.
 */
export function replaceScriptFile(
  scriptPath: string,
  tempPath: string,
  options: { platform: NodeJS.Platform; fs?: ScriptFs } = { platform: process.platform },
): void {
  const io = options.fs ?? defaultFs;
  const bak = backupScriptPath(scriptPath);
  if (io.existsSync(bak)) {
    try {
      io.unlinkSync(bak);
    } catch {
      // An older leftover may still be open on Windows.
    }
  }
  if (options.platform === 'win32') {
    const hadScript = io.existsSync(scriptPath);
    if (hadScript) io.renameSync(scriptPath, bak);
    try {
      io.renameSync(tempPath, scriptPath);
    } catch (err) {
      if (hadScript && io.existsSync(bak) && !io.existsSync(scriptPath)) {
        try {
          io.renameSync(bak, scriptPath);
        } catch {
          // Leave the backup so the machine is not left without a script.
        }
      }
      throw err;
    }
    try {
      io.unlinkSync(bak);
    } catch {
      // The previous watcher may still have this file open.
    }
    return;
  }
  io.renameSync(tempPath, scriptPath);
}

export function writeChecksumSidecar(scriptPath: string, sha256: string, fs: ScriptFs = defaultFs): void {
  const base = path.basename(scriptPath);
  if (base !== 'valetto.mjs' && base !== 'replyslip.mjs') return;
  const sidecar = `${scriptPath}.sha256`;
  const temp = `${sidecar}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${sha256}  ${base}\n`);
  try {
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  } catch {
    // Windows may need unlink-then-rename when the sidecar is not locked.
  }
  try {
    fs.renameSync(temp, sidecar);
  } catch (err) {
    try {
      fs.unlinkSync(temp);
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
  now?: () => number;
  intervalMs?: number;
  /** Tests may set 0. Production clamps to at least an hour. */
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
  runVersion?: (nodePath: string, scriptPath: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  log?: (line: string) => void;
  platform?: NodeJS.Platform;
  fs?: ScriptFs;
  pid?: number;
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
  return { version: row.version.trim(), sha256: row.sha256.toLowerCase(), url: row.url.trim() };
}

async function defaultRunVersion(nodePath: string, scriptPath: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(nodePath, [scriptPath, '--version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Timed out running the downloaded script --version.'));
    }, 15_000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
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

/**
 * Check the registered origin for a newer CLI and, if so, replace this script in place.
 * On any failure the existing script is left untouched.
 */
export async function maybeUpdateCli(io: AutoUpdateIo): Promise<AutoUpdateResult> {
  const log = io.log ?? (() => undefined);
  const env = io.env ?? process.env;
  if (autoUpdateDisabled(env, io.argv ?? [])) return { status: 'skipped', message: 'Auto-update is off.' };
  const current = io.currentVersion.trim();
  if (!parseCliVersion(current)) return { status: 'skipped' };
  const scriptPath = path.resolve(io.scriptPath);
  if (!scriptPath) return { status: 'skipped' };

  const minInterval = io.minIntervalMs ?? MIN_UPDATE_INTERVAL_MS;
  const interval = clampInterval(io.intervalMs, minInterval);
  const now = (io.now ?? Date.now)();
  const previous = readUpdateCheckState(io.home, io.fs);
  if (previous && now - previous.checked_at < interval) return { status: 'skipped' };

  const origin = io.origin.replace(/\/+$/, '');
  let latest: LatestCliInfo;
  const fs = io.fs ?? defaultFs;
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
    return { status: 'current' };
  }

  const tempPath = tempScriptPath(scriptPath, io.pid ?? process.pid);
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
    fs.writeFileSync(tempPath, bytes);
    try {
      fs.chmodSync?.(tempPath, 0o644);
    } catch {
      // Windows ignores Unix modes.
    }
    const runVersion = io.runVersion ?? defaultRunVersion;
    const ran = await runVersion(io.nodePath ?? process.execPath, tempPath);
    if (ran.code !== 0) throw new Error('Downloaded CLI did not run.');
    if (ran.stdout.trim().split(/\s+/, 1)[0] !== latest.version) {
      throw new Error('Downloaded CLI --version did not match.');
    }
    replaceScriptFile(scriptPath, tempPath, { platform: io.platform ?? process.platform, fs });
    try {
      writeChecksumSidecar(scriptPath, latest.sha256, fs);
    } catch {
      // The script is already replaced; a missing sidecar only matters for a later --install.
    }
    mark('updated');
    const message = `Updated Valetto watcher ${current} -> ${latest.version}`;
    log(`[valetto] ${message}`);
    return { status: 'updated', message, from: current, to: latest.version };
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Keep going; the old script was not replaced.
    }
    mark('failed');
    const detail = err instanceof Error ? err.message : 'Auto-update failed.';
    log(`[valetto] auto-update failed: ${detail}`);
    return { status: 'failed', message: detail };
  }
}
