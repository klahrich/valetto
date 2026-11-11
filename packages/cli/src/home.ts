// SPDX-License-Identifier: Apache-2.0

import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Where Valetto keeps key files, locks, and supervision state: `~/.valetto`. */
export const HOME_DIR_NAME = '.valetto';
/** The directory used before the rename. Still read, never moved or deleted. */
export const LEGACY_HOME_DIR_NAME = '.replyslip';

export function valettoHome(home = homedir()): string {
  return path.join(home, HOME_DIR_NAME);
}

export function legacyHome(home = homedir()): string {
  return path.join(home, LEGACY_HOME_DIR_NAME);
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Locks, the acquire mutex, and supervision state. A machine set up before the rename keeps using
 * `~/.replyslip` for these, so an older CLI and this one share one set of locks and one op lock per agent
 * and can never run two watchers for the same agent. Every other machine uses `~/.valetto`.
 */
export function stateHome(home = homedir()): string {
  const legacy = legacyHome(home);
  return isDirectory(legacy) ? legacy : valettoHome(home);
}

/** Both directories, the state home first. Lock scans read both so a watcher in either one is seen. */
export function stateHomes(home = homedir()): [string, string] {
  const primary = stateHome(home);
  const other = primary === legacyHome(home) ? valettoHome(home) : legacyHome(home);
  return [primary, other];
}

/**
 * `VALETTO_<name>`, then the pre-rename `REPLYSLIP_<name>`. A missing or blank value falls through.
 * The returned value is not trimmed.
 */
export function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  for (const key of [`VALETTO_${name}`, `REPLYSLIP_${name}`]) {
    const value = env[key];
    if (value !== undefined && value.trim() !== '') return value;
  }
  return undefined;
}
