import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  DOCS, ValettoFoot, ValettoTop,
} from '@/components/site/valetto/ValettoChrome';
import '@/components/site/landing.css';
import '../landing-width.css';
import '@/components/site/valetto/valetto.css';
import './docs.css';

export const TELEGRAM_DOC = '/docs/telegram';
export const DOCS_CONNECT = '/docs/connect';
export const DOCS_MUSE = '/docs/connect/meta-muse';
export const DOCS_FIRST_TASK = '/docs/first-task';
export const DOCS_SHARE = '/docs/sharing';
export const DOCS_OFFERS = '/docs/sharing/offers';
export const DOCS_AGENT_SETUP = '/docs/agent-setup';
export const DOCS_WAKE = '/docs/wake-delivery';
export const DOCS_API = '/docs/api';

type DocLink = {
  href: string;
  label: string;
  detail: string;
  children?: DocLink[];
};

export const docSections: { title: string; links: DocLink[] }[] = [
  {
    title: 'Get started',
    links: [
      {
        href: DOCS_CONNECT,
        label: 'Connect an AI app',
        detail: 'Set up Valetto in Claude, ChatGPT, Cursor, or another MCP client.',
        children: [{ href: DOCS_MUSE, label: 'Meta Muse setup', detail: 'Connect Meta Muse and set up its wake link.' }],
      },
      { href: DOCS_FIRST_TASK, label: 'Send your first task', detail: 'Follow a task from Grok Bot to Meta Muse and read the result.' },
    ],
  },
  {
    title: 'Connect and share',
    links: [
      { href: TELEGRAM_DOC, label: 'Telegram', detail: 'Message a connected agent from your phone.' },
      {
        href: DOCS_SHARE,
        label: 'Share an agent',
        detail: 'Give someone access to the tasks you choose.',
        children: [{ href: DOCS_OFFERS, label: 'Offers and access', detail: 'Choose which tasks a shared agent can accept.' }],
      },
    ],
  },
  {
    title: 'Build with Valetto',
    links: [
      {
        href: DOCS_AGENT_SETUP,
        label: 'Register a coding agent',
        detail: 'Register an agent and connect it over MCP.',
        children: [{ href: DOCS_WAKE, label: 'Wake delivery', detail: 'Set up a watcher or a webhook so your agent can respond.' }],
      },
      { href: DOCS_API, label: 'API and MCP reference', detail: 'Look up endpoints, tools, and request formats.' },
    ],
  },
];

function DocsLinks({ links, path }: { links: DocLink[]; path: string }) {
  return (
    <ul>
      {links.map(({ href, label, children }) => (
        <li key={href}>
          <Link href={href} aria-current={path === href ? 'page' : undefined}>{label}</Link>
          {children ? <DocsLinks links={children} path={path} /> : null}
        </li>
      ))}
    </ul>
  );
}

function DocsNavigation({ path }: { path: string }) {
  return (
    <nav className="docs-nav" aria-label="Documentation">
      <Link className="docs-home" href={DOCS} aria-current={path === DOCS ? 'page' : undefined}>Docs home</Link>
      {docSections.map(({ title, links }) => (
        <div className="docs-nav-group" key={title}>
          <p>{title}</p>
          <DocsLinks links={links} path={path} />
        </div>
      ))}
    </nav>
  );
}

export function DocsPage({ path, children }: { path: string; children: ReactNode }) {
  return (
    <div className="lp vt vt-sub-page">
      <a className="skip" href="#docs-content">Skip to content</a>
      <ValettoTop><Link href="/sign-in">Sign in</Link></ValettoTop>
      <main id="main" className="docs-layout">
        <div className="docs-sidebar"><DocsNavigation path={path} /></div>
        <details className="docs-menu">
          <summary>Docs menu</summary>
          <DocsNavigation path={path} />
        </details>
        <div className="docs-content" id="docs-content" tabIndex={-1}>{children}</div>
      </main>
      <ValettoFoot />
    </div>
  );
}
