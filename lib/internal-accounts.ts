import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { excludedWorkspaceIds } from './first-agent-alert';

/**
 * Accounts that belong to the Valetto team or its own test bots. Usage stats, the owner usage page and the signup and
 * first-agent alerts leave them out, so outside usage is counted honestly. This is code, not an env var, so it
 * applies on every deployment without a settings change. STATS_EXCLUDE_WORKSPACE_IDS still excludes extra
 * workspaces on top of this list.
 *
 * Personal addresses are kept as SHA-256 hex of the canonical address (lowercased, `+tag` removed) so this public
 * repo does not publish them. To add one: `printf '%s' 'name@example.com' | sha256sum`.
 * mail.grokbot.com is not a listed domain: other people's Grok Bots sign up from it.
 */
export const INTERNAL_EMAIL_DOMAINS: readonly string[] = ['valetto.tech', 'clairevue.ai'];

/** The owner's personal address and the owner's bot test inbox (all of its `+tag` aliases). */
const INTERNAL_ADDRESS_SHA256: readonly string[] = [
  '385b95633226348a362ff75b42d4aeb920b60ff99b91211d6da6e297843a5c07',
  '97d38089f4dc66246ff6f193de8906959ff5545cf1f76d36a0d5f4546620734c',
];

/**
 * Signed-in accounts allowed to open /admin/usage, as SHA-256 hex of the lowercased address. Exact match: no `+tag`
 * folding, so an alias cannot get in. Everyone else, signed in or not, gets a 404.
 */
const USAGE_OWNER_SHA256: readonly string[] = [
  '385b95633226348a362ff75b42d4aeb920b60ff99b91211d6da6e297843a5c07',
  '484549a60a870e187d66a691cfecddb784c5545f361355031ee43cc41c34da0f',
];

let extraInternal: string[] = [];
let extraOwners: string[] = [];

/** Tests add plain addresses here instead of committing real ones. Null clears them. */
export function setExtraInternalAddressesForTests(addresses: string[] | null): void {
  extraInternal = (addresses ?? []).map((address) => sha256Hex(canonicalEmail(address) ?? address));
}

/** Tests add owner addresses here. Null clears them. */
export function setExtraUsageOwnersForTests(addresses: string[] | null): void {
  extraOwners = (addresses ?? []).map((address) => sha256Hex(address.trim().toLowerCase()));
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function internalHashes(): string[] {
  return [...INTERNAL_ADDRESS_SHA256, ...extraInternal];
}

/** Lowercased, with any `+tag` removed from the local part. Null when it is not one `local@domain` address. */
export function canonicalEmail(email: string): string | null {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at <= 0 || at === lower.length - 1 || lower.indexOf('@') !== at) return null;
  const local = lower.slice(0, at).split('+')[0]!;
  if (!local) return null;
  return `${local}@${lower.slice(at + 1)}`;
}

export function isInternalEmail(email: string): boolean {
  const canonical = canonicalEmail(email);
  if (!canonical) return false;
  const domain = canonical.slice(canonical.indexOf('@') + 1);
  return INTERNAL_EMAIL_DOMAINS.includes(domain) || internalHashes().includes(sha256Hex(canonical));
}

export function isUsageOwnerEmail(email: string | null | undefined): boolean {
  if (typeof email !== 'string' || !email.trim()) return false;
  const hash = sha256Hex(email.trim().toLowerCase());
  return USAGE_OWNER_SHA256.includes(hash) || extraOwners.includes(hash);
}

/** SQL twin of `isInternalEmail` for an email column. */
export function internalEmailSql(column: SQL): SQL {
  const list = (values: readonly string[]) =>
    sql.join(
      values.map((value) => sql`${value}`),
      sql`, `,
    );
  const lower = sql`lower(btrim(${column}))`;
  const domain = sql`split_part(${lower}, '@', 2)`;
  const local = sql`split_part(split_part(${lower}, '@', 1), '+', 1)`;
  const hash = sql`encode(sha256(convert_to(${local} || '@' || ${domain}, 'UTF8')), 'hex')`;
  return sql`(${domain} in (${list(INTERNAL_EMAIL_DOMAINS)}) or ${hash} in (${list(internalHashes())}))`;
}

/**
 * Subquery of internal workspace ids: any workspace in STATS_EXCLUDE_WORKSPACE_IDS, plus any workspace with a user
 * whose email is internal.
 */
export function internalWorkspaceIdsSql(): SQL {
  const ids = excludedWorkspaceIds();
  const listed =
    ids.length === 0
      ? sql`false`
      : sql`w.id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  return sql`(select w.id from workspaces w where ${listed} or exists (
    select 1 from users iu where iu.workspace_id = w.id and ${internalEmailSql(sql`iu.email`)}
  ))`;
}

/** True when the workspace column is not internal. A null column counts as not internal. */
export function externalWorkspaceSql(column: SQL): SQL {
  return sql`(${column} is null or ${column} not in ${internalWorkspaceIdsSql()})`;
}

/** True when a users row is external: its own email is not internal and its workspace is not internal. */
export function externalUserSql(alias = sql`users`): SQL {
  return sql`(not ${internalEmailSql(sql`${alias}.email`)} and ${externalWorkspaceSql(sql`${alias}.workspace_id`)})`;
}
