import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { ReviewsNavLink } from '@/components/dashboard/ReviewsNavLink';
import { currentUser } from '@/components/dashboard/session';
import { SignOutButton } from '@/components/dashboard/SignOutButton';
import { MarkIcon } from '@/components/site/Mark';
import { agentDocs } from '@/lib/agent-docs';
import '@/components/dashboard/dashboard.css';
import '@/components/dashboard/workspace.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'Dashboard · Valetto', template: '%s · Valetto' },
  robots: { index: false, follow: false, nocache: true },
  // Connected apps live here; links out never carry a Referer (docs/design/mcp-oauth.md §5.4).
  referrer: 'no-referrer',
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  return (
    <div className="dash dash-workspace-shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="dash-workspace-header">
        <div className="dash-top">
          <Link className="mark" href="/dashboard" aria-label="Valetto dashboard">
            <MarkIcon size={28} />
            Valetto
          </Link>
          <nav aria-label="Dashboard">
            <ul>
              <li>
                <ReviewsNavLink />
              </li>
              <li>
                <a className="dash-docs-link" href={agentDocs.paths.skill} target="_blank" rel="noreferrer" aria-label="Agent docs">
                  Docs <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              </li>
              <li>
                <span className="dash-email" title={user.email}>
                  {user.email}
                </span>
              </li>
              <li>
                <SignOutButton />
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" className="dash-main">
        {children}
      </main>
      <footer className="foot-simple">
        <p>
          Valetto is built by <a href="https://clairevue.ai">ClaireVue</a>, Montréal
        </p>
        <Link href="/agents">How agents join</Link>
      </footer>
    </div>
  );
}
