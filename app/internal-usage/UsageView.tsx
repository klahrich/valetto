import Link from 'next/link';
import {
  Activity, ArrowUpRight, Bot, ChartNoAxesColumnIncreasing, ChevronDown, ClipboardList, Clock3,
  Inbox, Layers3, LayoutGrid, MessagesSquare, ShieldCheck, Users,
} from 'lucide-react';
import { MarkIcon } from '@/components/site/Mark';
import { INTERNAL_EMAIL_DOMAINS } from '@/lib/internal-accounts';
import type { RecentSignup, UsageOverview, UsageSegment } from '@/lib/usage-overview';

const number = new Intl.NumberFormat('en-CA');
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium' });
const time = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', timeStyle: 'short' });

const sections = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'signups', label: 'Signups', icon: Users },
  { id: 'breakdown', label: 'Breakdown', icon: Layers3 },
  { id: 'internal', label: 'Internal', icon: ShieldCheck },
] as const;

type Metric = { key: keyof UsageSegment; label: string };

const adoptionMetrics: Metric[] = [
  { key: 'signups_30d', label: 'Signups in the last 30 days' },
  { key: 'unverified_accounts', label: 'Awaiting first sign-in' },
  { key: 'workspaces', label: 'Workspaces' },
  { key: 'invite_workspaces', label: 'Unclaimed invite workspaces' },
];

const sharingMetrics: Metric[] = [
  { key: 'agent_invites', label: 'Agent invite links' },
  { key: 'agent_shares', label: 'Redeemed agent shares' },
  { key: 'customer_links', label: 'Customer links' },
  { key: 'oauth_grants', label: 'Connected apps' },
  { key: 'active_oauth_grants', label: 'Active app connections' },
];

const internalMetrics: Metric[] = [
  { key: 'accounts', label: 'Verified accounts' },
  { key: 'signups_7d', label: 'Signups in the last 7 days' },
  ...adoptionMetrics,
  { key: 'agents', label: 'Registered agents' },
  { key: 'active_agents', label: 'Active agents' },
  { key: 'tasks', label: 'Tasks created' },
  { key: 'tasks_done', label: 'Tasks completed' },
  { key: 'messages', label: 'Messages sent' },
  ...sharingMetrics,
];

function MetricList({ segment, metrics }: { segment: UsageSegment; metrics: Metric[] }) {
  return (
    <dl className="usage-metric-list">
      {metrics.map(({ key, label }) => (
        <div className="usage-metric-row" key={key}>
          <dt>{label}</dt>
          <dd>{number.format(segment[key])}</dd>
        </div>
      ))}
    </dl>
  );
}

function OverviewMetrics({ segment }: { segment: UsageSegment }) {
  const cards = [
    { label: 'Verified accounts', value: segment.accounts, note: `${number.format(segment.signups_7d)} new in the last 7 days`, icon: Users },
    { label: 'Active agents', value: segment.active_agents, note: `${number.format(segment.agents)} registered all time`, icon: Bot },
    { label: 'Tasks created', value: segment.tasks, note: `${number.format(segment.tasks_done)} completed`, icon: ClipboardList },
    { label: 'Messages sent', value: segment.messages, note: 'All time', icon: MessagesSquare },
  ];

  return (
    <dl className="usage-metrics">
      {cards.map(({ label, value, note, icon: Icon }) => (
        <div className="usage-metric" key={label}>
          <dt><Icon aria-hidden="true" size={17} /> {label}</dt>
          <dd><strong>{number.format(value)}</strong><span>{note}</span></dd>
        </div>
      ))}
    </dl>
  );
}

function DateValue({ iso }: { iso: string | null }) {
  return iso ? <time dateTime={iso}>{date.format(new Date(iso))}</time> : <span className="usage-no-value" aria-label="None">—</span>;
}

function Signups({ recent }: { recent: RecentSignup[] }) {
  return (
    <section id="signups" className="usage-panel" aria-labelledby="signups-heading">
      <header className="usage-panel-heading">
        <div>
          <h2 id="signups-heading">Latest outside signups</h2>
          <p>Recent accounts and activity in their workspaces</p>
        </div>
        <span className="usage-count" aria-label={`${number.format(recent.length)} signups shown`}>{number.format(recent.length)}</span>
      </header>
      {recent.length === 0 ? (
        <div className="usage-empty">
          <Inbox aria-hidden="true" size={25} />
          <p>No outside signups yet.</p>
        </div>
      ) : (
        <div className="usage-signups-scroll" tabIndex={0} role="region" aria-label="Signup history">
          <table className="usage-signups" role="table" aria-labelledby="signups-heading">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Account</th>
                <th role="columnheader" scope="col">Signed up</th>
                <th role="columnheader" scope="col">Agents</th>
                <th role="columnheader" scope="col">Tasks</th>
                <th role="columnheader" scope="col">Messages</th>
                <th role="columnheader" scope="col">Last activity</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {recent.map((row, index) => (
                <tr role="row" key={`${row.created_at}-${index}`}>
                  <th role="rowheader" scope="row" className="usage-account">
                    <span className="usage-account-email">{row.email}</span>
                    <span className={`usage-account-status${row.verified ? ' usage-account-status--verified' : ''}`}>
                      {row.verified ? 'Verified' : 'Code requested'}
                    </span>
                  </th>
                  <td role="cell" data-label="Signed up"><DateValue iso={row.created_at} /></td>
                  <td role="cell" data-label="Agents">{number.format(row.agents)}</td>
                  <td role="cell" data-label="Tasks">{number.format(row.tasks)}</td>
                  <td role="cell" data-label="Messages">{number.format(row.messages)}</td>
                  <td role="cell" data-label="Last activity"><DateValue iso={row.last_activity} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Ratio({ label, count, total, caption }: { label: string; count: number; total: number; caption: string }) {
  const percent = total ? count / total * 100 : 0;
  return (
    <div className="usage-ratio">
      <dt>{label}</dt>
      <dd>{total ? `${number.format(Math.round(percent))}%` : '—'}</dd>
      <dd className="usage-ratio-caption">
        <span className="usage-ratio-bar" aria-hidden="true"><span style={{ width: `${Math.min(percent, 100)}%` }} /></span>
        {number.format(count)} of {number.format(total)} {caption}
      </dd>
    </div>
  );
}

export function UsageView({ email, usage }: { email: string; usage: UsageOverview }) {
  const { external } = usage;
  const generated = new Date(usage.generated_at);
  return (
    <div className="usage-shell">
      <a className="skip" href="#main">Skip to content</a>
      <aside className="usage-sidebar">
        <Link className="usage-brand" href="/dashboard" aria-label="Valetto dashboard"><MarkIcon size={30} /> Valetto</Link>
        <nav className="usage-nav" aria-label="Usage sections">
          {sections.map(({ id, label, icon: Icon }) => (
            <a key={id} href={`#${id}`}><Icon aria-hidden="true" size={17} />{label}</a>
          ))}
        </nav>
        <a className="usage-site-analytics" href="https://vercel.com/dashboard" rel="noreferrer" title="Page visits in Vercel Analytics">
          <ChartNoAxesColumnIncreasing aria-hidden="true" size={17} /> <span>Vercel Analytics</span> <ArrowUpRight aria-hidden="true" size={14} />
        </a>
      </aside>

      <div className="usage-body">
        <header className="usage-topbar">
          <span className="usage-owner"><ShieldCheck aria-hidden="true" size={16} /><span title={email}>{email}</span></span>
          <Link className="usage-workspace" href="/dashboard">Workspace dashboard <ArrowUpRight aria-hidden="true" size={15} /></Link>
        </header>
        <main id="main" className="usage-main">
          <section id="overview" aria-labelledby="overview-heading">
            <header className="usage-intro">
              <div>
                <h1 id="overview-heading">Outside usage</h1>
                <p>See who signs up and how they use Valetto.</p>
              </div>
              <div className="usage-freshness">
                <Clock3 aria-hidden="true" size={15} />
                <span>Updated <time dateTime={usage.generated_at} title="Toronto time">{date.format(generated)} · {time.format(generated)} ET</time></span>
              </div>
            </header>
            <OverviewMetrics segment={external} />
          </section>

          <div className="usage-activity">
            <Signups recent={usage.recent} />
            <section className="usage-panel usage-activation" aria-labelledby="activation-heading">
              <header className="usage-panel-heading">
                <div><h2 id="activation-heading">Activity</h2><p>Outside usage across all time</p></div>
                <Activity className="usage-panel-icon" aria-hidden="true" size={18} />
              </header>
              <dl className="usage-ratios">
                <Ratio label="First sign-in" count={external.accounts} total={external.accounts + external.unverified_accounts} caption="accounts signed in" />
                <Ratio label="Task completion" count={external.tasks_done} total={external.tasks} caption="tasks completed" />
              </dl>
            </section>
          </div>

          <section id="breakdown" className="usage-breakdown" aria-labelledby="breakdown-heading">
            <h2 id="breakdown-heading">Usage breakdown</h2>
            <div className="usage-breakdown-grid">
              <section className="usage-panel" aria-labelledby="adoption-heading">
                <header className="usage-panel-heading"><h3 id="adoption-heading">Accounts &amp; workspaces</h3></header>
                <MetricList segment={external} metrics={adoptionMetrics} />
              </section>
              <section className="usage-panel" aria-labelledby="sharing-heading">
                <header className="usage-panel-heading"><h3 id="sharing-heading">Sharing &amp; integrations</h3></header>
                <MetricList segment={external} metrics={sharingMetrics} />
              </section>
            </div>
          </section>

          <details id="internal" className="usage-panel usage-internal">
            <summary>
              <span className="usage-internal-icon"><ShieldCheck aria-hidden="true" size={19} /></span>
              <span><strong>Internal accounts</strong><small>Team and bot activity tracked separately</small></span>
              <ChevronDown className="usage-chevron" aria-hidden="true" size={20} />
            </summary>
            <div className="usage-internal-body">
              <p>Includes {INTERNAL_EMAIL_DOMAINS.join(' and ')} accounts, designated personal and bot inboxes, and explicitly excluded workspaces.</p>
              <MetricList segment={usage.internal} metrics={internalMetrics} />
            </div>
          </details>
        </main>
      </div>
    </div>
  );
}
