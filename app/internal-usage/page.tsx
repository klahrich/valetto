import type { Metadata } from 'next';
import Link from 'next/link';
import { MarkIcon } from '@/components/site/Mark';
import { INTERNAL_EMAIL_DOMAINS } from '@/lib/internal-accounts';
import { loadUsageOverview, type UsageSegment } from '@/lib/usage-overview';
import { currentUser } from '@/components/dashboard/session';
import { isUsageOwner } from '@/lib/usage-gate';
import { requireUsageOwner } from './gate';
import '@/components/dashboard/dashboard.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PRIVATE = { robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' } satisfies Metadata;

/** The real title only for the owner; anyone else sees the not-found title (proxy.ts normally stops them first). */
export async function generateMetadata(): Promise<Metadata> {
  const user = await currentUser();
  return { ...PRIVATE, title: { absolute: isUsageOwner(user) ? 'Usage · Valetto' : 'Page not found · Valetto' } };
}

const ROWS: { key: keyof UsageSegment; label: string }[] = [
  { key: 'accounts', label: 'Signed-up accounts' },
  { key: 'signups_7d', label: 'New accounts, last 7 days' },
  { key: 'signups_30d', label: 'New accounts, last 30 days' },
  { key: 'unverified_accounts', label: 'Asked for a code, never signed in' },
  { key: 'workspaces', label: 'Workspaces' },
  { key: 'invite_workspaces', label: 'Unclaimed workspaces made from an invite' },
  { key: 'agents', label: 'Agents (ever registered)' },
  { key: 'active_agents', label: 'Agents (not revoked)' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'tasks_done', label: 'Tasks completed' },
  { key: 'messages', label: 'Messages' },
  { key: 'agent_invites', label: 'Agent invite links' },
  { key: 'agent_shares', label: 'Agent shares (redeemed)' },
  { key: 'customer_links', label: 'Customer links' },
  { key: 'oauth_grants', label: 'Connected apps (OAuth grants)' },
  { key: 'active_oauth_grants', label: 'Connected apps, still active' },
];

function day(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

function SegmentTable({ segment, caption }: { segment: UsageSegment; caption: string }) {
  return (
    <div className="dash-table-wrap">
      <table className="dash-table" aria-label={caption}>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>{segment[row.key].toLocaleString('en-CA')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function UsagePage() {
  const owner = await requireUsageOwner();
  const usage = await loadUsageOverview();

  return (
    <div className="dash">
      <header className="dash-top">
        <Link className="mark" href="/dashboard" aria-label="Valetto dashboard">
          <MarkIcon />
          Valetto
        </Link>
        <nav aria-label="Usage">
          <ul>
            <li>
              <Link href="/dashboard">Dashboard</Link>
            </li>
            <li>
              <span className="dash-email" title={owner.email}>
                {owner.email}
              </span>
            </li>
          </ul>
        </nav>
      </header>
      <main id="main" className="dash-main">
        <h1>Usage</h1>
        <p>
          Outside people only. Your accounts and the bots&rsquo; test accounts are counted separately below. Updated{' '}
          {new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Toronto',
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(usage.generated_at))}{' '}
          (Toronto time).
        </p>

        <section className="dash-card" aria-labelledby="external-h">
          <h2 id="external-h">Outside usage</h2>
          <p>All time, unless a row says otherwise.</p>
          <SegmentTable segment={usage.external} caption="Outside usage" />
        </section>

        <section className="dash-card" aria-labelledby="recent-h">
          <h2 id="recent-h">Latest outside signups</h2>
          {usage.recent.length === 0 ? (
            <p>No one outside the team has signed up yet.</p>
          ) : (
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th scope="col">Signed up</th>
                    <th scope="col">Email</th>
                    <th scope="col">Agents</th>
                    <th scope="col">Tasks</th>
                    <th scope="col">Messages</th>
                    <th scope="col">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.recent.map((row, index) => (
                    <tr key={`${row.created_at}-${index}`}>
                      <td>{day(row.created_at)}</td>
                      <td>
                        {row.email}
                        {row.verified ? '' : ' (never signed in)'}
                      </td>
                      <td>{row.agents}</td>
                      <td>{row.tasks}</td>
                      <td>{row.messages}</td>
                      <td>{day(row.last_activity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="dash-card" aria-labelledby="internal-h">
          <details>
            <summary>
              <h2 id="internal-h" style={{ display: 'inline' }}>
                Internal accounts (you and the bots)
              </h2>
            </summary>
            <p>
              Internal means an email at {INTERNAL_EMAIL_DOMAINS.join(' or ')}, your personal address or the bots&rsquo;
              test inbox (including +aliases), or a workspace listed in STATS_EXCLUDE_WORKSPACE_IDS.
            </p>
            <SegmentTable segment={usage.internal} caption="Internal usage" />
          </details>
        </section>

        <section className="dash-card" aria-labelledby="visitors-h">
          <h2 id="visitors-h">Visitors</h2>
          <p>
            Page visits are in Vercel: open the replyslip project and choose the Analytics tab (
            <a href="https://vercel.com/dashboard" rel="noreferrer">
              vercel.com
            </a>
            ).
          </p>
        </section>
      </main>
    </div>
  );
}
