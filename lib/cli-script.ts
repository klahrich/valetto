import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** File names the CLI is served under. `replyslip.mjs` is the pre-rename name; both serve the same bytes. */
export type CliScriptName = 'valetto.mjs' | 'replyslip.mjs';

export function cliScriptPath(): string {
  return path.join(process.cwd(), 'packages/cli/valetto.mjs');
}

export function cliScriptBytes(): Buffer {
  return readFileSync(cliScriptPath());
}

export function cliScriptSha256(): string {
  return createHash('sha256').update(cliScriptBytes()).digest('hex');
}

/** Line accepted by `sha256sum -c` and `shasum -a 256 -c` for a download saved as `name`. */
export function cliScriptSha256Line(name: CliScriptName = 'valetto.mjs'): string {
  return `${cliScriptSha256()}  ${name}\n`;
}

/** Version of the served bundle. packages/cli/package.json is the source of truth. */
export function cliScriptVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'packages/cli/package.json'), 'utf8')) as { version?: unknown };
  if (typeof pkg.version !== 'string' || !pkg.version.trim()) throw new Error('packages/cli/package.json has no version.');
  return pkg.version.trim();
}
