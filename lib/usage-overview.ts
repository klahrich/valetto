import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { canonicalEmail, externalUserSql, internalWorkspaceIdsSql } from './internal-accounts';

/** One side (external or internal) of the owner usage page. All-time counts unless the name says otherwise. */
export type UsageSegment = {
  accounts: number;
  /** Asked for a sign-in code but never entered it. */
  unverified_accounts: number;
  signups_7d: number;
  signups_30d: number;
  workspaces: number;
  /** Workspaces an agent made by redeeming an invite, with no account yet. */
  invite_workspaces: number;
  agents: number;
  active_agents: number;
  tasks: number;
  tasks_done: number;
  messages: number;
  agent_invites: number;
  agent_shares: number;
  customer_links: number;
  oauth_grants: number;
  active_oauth_grants: number;
};

export type RecentSignup = {
  created_at: string;
  /** First letter of the local part, then `***@domain`. Never the full address. */
  email: string;
  verified: boolean;
  /** Whether they have a workspace. Its name and handle are not returned: a default name is built from the email. */
  has_workspace: boolean;
  agents: number;
  tasks: number;
  messages: number;
  last_activity: string | null;
};

export type UsageOverview = {
  generated_at: string;
  external: UsageSegment;
  internal: UsageSegment;
  recent: RecentSignup[];
};

/** `k***@gmail.com`. A value that is not an address becomes `***`. */
export function maskEmail(email: string): string {
  const canonical = canonicalEmail(email);
  if (!canonical) return '***';
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  return `${lower.slice(0, 1)}***@${lower.slice(at + 1)}`;
}

type Split = { internal: boolean; n: number | string };

async function split(statement: SQL): Promise<{ internal: number; external: number }> {
  const rows = [...(await getDb().execute<Split>(statement))] as Split[];
  const out = { internal: 0, external: 0 };
  for (const row of rows) {
    if (row.internal === true) out.internal += Number(row.n);
    else out.external += Number(row.n);
  }
  return out;
}

const RECENT_LIMIT = 50;

export async function loadUsageOverview(now: Date = new Date()): Promise<UsageOverview> {
  const internalWs = internalWorkspaceIdsSql();
  const wsInternal = (column: SQL) => sql`(${column} in ${internalWs})`;
  const userInternal = (alias: SQL) => sql`(not ${externalUserSql(alias)})`;
  const since = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  const queries = {
    accounts: sql`select ${userInternal(sql`u`)} as internal, count(*)::int as n from users u where u.email_verified_at is not null group by 1`,
    unverified_accounts: sql`select ${userInternal(sql`u`)} as internal, count(*)::int as n from users u where u.email_verified_at is null group by 1`,
    signups_7d: sql`select ${userInternal(sql`u`)} as internal, count(*)::int as n from users u where u.email_verified_at is not null and u.created_at >= ${since(7)}::timestamptz group by 1`,
    signups_30d: sql`select ${userInternal(sql`u`)} as internal, count(*)::int as n from users u where u.email_verified_at is not null and u.created_at >= ${since(30)}::timestamptz group by 1`,
    workspaces: sql`select ${wsInternal(sql`ws.id`)} as internal, count(*)::int as n from workspaces ws group by 1`,
    invite_workspaces: sql`select ${wsInternal(sql`ws.id`)} as internal, count(*)::int as n from workspaces ws where ws.origin = 'invite' and ws.claimed_at is null group by 1`,
    agents: sql`select ${wsInternal(sql`a.workspace_id`)} as internal, count(*)::int as n from agents a group by 1`,
    active_agents: sql`select ${wsInternal(sql`a.workspace_id`)} as internal, count(*)::int as n from agents a where a.revoked_at is null group by 1`,
    tasks: sql`select ${wsInternal(sql`t.workspace_id`)} as internal, count(*)::int as n from tasks t group by 1`,
    tasks_done: sql`select ${wsInternal(sql`t.workspace_id`)} as internal, count(*)::int as n from tasks t where t.status = 'done' group by 1`,
    messages: sql`select ${wsInternal(sql`m.workspace_id`)} as internal, count(*)::int as n from messages m group by 1`,
    agent_invites: sql`select ${wsInternal(sql`i.workspace_id`)} as internal, count(*)::int as n from agent_invites i group by 1`,
    agent_shares: sql`select ${wsInternal(sql`a.workspace_id`)} as internal, count(*)::int as n from agent_shares s join agents a on a.id = s.agent_id group by 1`,
    customer_links: sql`select ${wsInternal(sql`a.workspace_id`)} as internal, count(*)::int as n from customer_invites c join agents a on a.id = c.agent_id group by 1`,
    oauth_grants: sql`select ${wsInternal(sql`g.workspace_id`)} as internal, count(*)::int as n from oauth_grants g group by 1`,
    active_oauth_grants: sql`select ${wsInternal(sql`g.workspace_id`)} as internal, count(*)::int as n from oauth_grants g where g.revoked_at is null group by 1`,
  } satisfies Record<keyof UsageSegment, SQL>;

  const keys = Object.keys(queries) as (keyof UsageSegment)[];
  const results = await Promise.all(keys.map((key) => split(queries[key])));
  const external = {} as UsageSegment;
  const internal = {} as UsageSegment;
  keys.forEach((key, index) => {
    external[key] = results[index]!.external;
    internal[key] = results[index]!.internal;
  });

  type RecentRow = {
    created_at: Date | string;
    email: string;
    verified: boolean;
    has_workspace: boolean;
    agents: number | string;
    tasks: number | string;
    messages: number | string;
    last_activity: Date | string | null;
  };
  const recentRows = [
    ...(await getDb().execute<RecentRow>(sql`
      select u.created_at,
             u.email,
             (u.email_verified_at is not null) as verified,
             (u.workspace_id is not null) as has_workspace,
             (select count(*)::int from agents a where a.workspace_id = u.workspace_id) as agents,
             (select count(*)::int from tasks t where t.workspace_id = u.workspace_id) as tasks,
             (select count(*)::int from messages m where m.workspace_id = u.workspace_id) as messages,
             greatest(
               (select max(t.created_at) from tasks t where t.workspace_id = u.workspace_id),
               (select max(m.created_at) from messages m where m.workspace_id = u.workspace_id)
             ) as last_activity
      from users u
      where ${externalUserSql(sql`u`)}
      order by u.created_at desc
      limit ${RECENT_LIMIT}
    `)),
  ] as RecentRow[];

  const iso = (value: Date | string | null): string | null =>
    value === null ? null : new Date(value).toISOString();

  return {
    generated_at: now.toISOString(),
    external,
    internal,
    recent: recentRows.map((row) => ({
      created_at: iso(row.created_at)!,
      email: maskEmail(row.email),
      verified: row.verified === true,
      has_workspace: row.has_workspace === true,
      agents: Number(row.agents),
      tasks: Number(row.tasks),
      messages: Number(row.messages),
      last_activity: iso(row.last_activity),
    })),
  };
}
