import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as statsRoute } from '@/app/api/admin/stats/route';
import { POST as requestCode } from '@/app/api/v1/auth/request-code/route';
import { getDb } from '@/db';
import { messages, sessions, users } from '@/db/schema';
import { sha256 } from '@/lib/crypto';
import { config as proxyConfig, NOT_FOUND_REWRITE, OWNER_HEADERS, OWNER_ROUTE, proxy, USAGE_PATH } from '@/proxy';
import { setEmailSenderForTests, signupAlertText } from '@/lib/email';
import { flushFirstAgentAlerts } from '@/lib/first-agent-alert';
import {
  canonicalEmail,
  isInternalEmail,
  isUsageOwnerEmail,
  setExtraInternalAddressesForTests,
  setExtraUsageOwnersForTests,
} from '@/lib/internal-accounts';
import { loadUsageOverview, maskEmail } from '@/lib/usage-overview';
import { SESSION_COOKIE } from '@/lib/constants';
import { call, createAgent, emailAddress, signIn } from './helpers';
import { alerts, inbox, signupAlerts } from './inbox';

// The usage page reads the session through next/headers. Tests set the cookie the page sees.
const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === SESSION_COOKIE && jar.token ? { value: jar.token } : undefined),
  }),
}));

const KEY = 'test-stats-key';
const savedEnv = {
  STATS_API_KEY: process.env.STATS_API_KEY,
  STATS_EXCLUDE_WORKSPACE_IDS: process.env.STATS_EXCLUDE_WORKSPACE_IDS,
  ALERT_EMAIL: process.env.ALERT_EMAIL,
};

// Stand-ins for the hashed personal addresses in lib/internal-accounts (real ones are not committed).
const TEAMMATE = 'teammate@internal-test.example.org';
// The owner is added by hash for the test only; no real owner address appears here.
const OWNER = `owner-${randomUUID().slice(0, 8)}@owner-test.example.net`;

beforeEach(() => {
  jar.token = null;
  setExtraInternalAddressesForTests([TEAMMATE]);
  setExtraUsageOwnersForTests([OWNER]);
});

afterEach(() => {
  setExtraInternalAddressesForTests(null);
  setExtraUsageOwnersForTests(null);
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function tokenFrom(cookie: string): string {
  const pair = cookie.split(';')[0]!;
  return decodeURIComponent(pair.slice(pair.indexOf('=') + 1));
}

async function stats() {
  process.env.STATS_API_KEY = KEY;
  const res = await call(statsRoute, 'http://localhost/api/admin/stats?days=1', { method: 'GET', bearer: KEY });
  expect(res.status).toBe(200);
  return res.data;
}

function isNotFound(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;404');
}

const tag = () => randomUUID().slice(0, 8);
const internalEmails = () => [
  `someone-${tag()}@valetto.tech`,
  `TeamMate+${tag()}@Internal-Test.example.org`,
  `ops-${tag()}@clairevue.ai`,
];

describe('internal accounts', () => {
  it.each([
    ['karim@valetto.tech', true],
    ['KARIM@VALETTO.TECH', true],
    ['someone@clairevue.ai', true],
    [TEAMMATE, true],
    ['TeamMate+any-tag@internal-test.example.org', true],
    ['other-bot@mail.grokbot.com', false],
    ['teammate@internal-test.example.com', false],
    ['xteammate@internal-test.example.org', false],
    ['karim@valetto.tech.evil.com', false],
    ['karim@notvaletto.tech', false],
    ['not-an-email', false],
    ['a@b@valetto.tech', false],
  ])('%s → %s', (email, expected) => {
    expect(isInternalEmail(email)).toBe(expected);
  });

  it('canonicalizes case and +tags only', () => {
    expect(canonicalEmail(' A+b+c@Example.COM ')).toBe('a@example.com');
    expect(canonicalEmail('+x@example.com')).toBeNull();
    expect(canonicalEmail('@example.com')).toBeNull();
  });

  it('owner allowlist is exact, with no +alias or lookalike', () => {
    expect(isUsageOwnerEmail(OWNER)).toBe(true);
    expect(isUsageOwnerEmail(` ${OWNER.toUpperCase()} `)).toBe(true);
    const [local, domain] = OWNER.split('@') as [string, string];
    for (const email of [`${local}+x@${domain}`, `${local}@${domain}.evil`, `x${OWNER}`, 'someone@valetto.tech', TEAMMATE, '', null, undefined]) {
      expect(isUsageOwnerEmail(email as string | null | undefined)).toBe(false);
    }
    setExtraUsageOwnersForTests(null);
    expect(isUsageOwnerEmail(OWNER)).toBe(false);
  });

  it('masks emails to the first letter and domain', () => {
    expect(maskEmail('Jane.Doe@Example.com')).toBe('j***@example.com');
    expect(maskEmail('nope')).toBe('***');
  });
});

describe('stats endpoint leaves internal accounts out by email', () => {
  it('does not count internal signups, workspaces, agents or messages; still counts outside ones', async () => {
    delete process.env.STATS_EXCLUDE_WORKSPACE_IDS;
    const before = await stats();

    for (const email of internalEmails()) {
      const session = await signIn(email);
      const a = await createAgent(session.cookie, 'InternalA');
      const b = await createAgent(session.cookie, 'InternalB');
      await getDb().insert(messages).values({ workspaceId: session.workspace.id, fromAgentId: a.id, toAgentId: b.id, body: 'hi' });
    }
    // An unverified internal request-code also stays out.
    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email: `x-${tag()}@valetto.tech` } });

    const mid = await stats();
    expect(mid.totals).toEqual(before.totals);

    const outside = await signIn(`friend-${tag()}@mail.grokbot.com`);
    await createAgent(outside.cookie, 'OutsideBot');
    const after = await stats();
    expect(after.totals.signups).toBe(mid.totals.signups + 1);
    expect(after.totals.workspaces).toBe(mid.totals.workspaces + 1);
    expect(after.totals.agents_registered).toBe(mid.totals.agents_registered + 1);
  });

  it('still honours STATS_EXCLUDE_WORKSPACE_IDS for an outside-looking account', async () => {
    const hidden = await signIn();
    delete process.env.STATS_EXCLUDE_WORKSPACE_IDS;
    const before = await stats();
    process.env.STATS_EXCLUDE_WORKSPACE_IDS = hidden.workspace.id;
    const after = await stats();
    expect(after.totals.signups).toBe(before.totals.signups - 1);
    expect(after.totals.workspaces).toBe(before.totals.workspaces - 1);
  });
});

describe('alerts skip internal accounts', () => {
  it('sends no first-agent alert for an internal owner email', async () => {
    process.env.ALERT_EMAIL = 'ops@example.com';
    delete process.env.STATS_EXCLUDE_WORKSPACE_IDS;
    for (const email of internalEmails()) {
      const session = await signIn(email);
      await createAgent(session.cookie, 'InternalBot');
    }
    await flushFirstAgentAlerts();
    expect(alerts).toHaveLength(0);
    expect(signupAlerts).toHaveLength(0);

    const outside = await signIn();
    await createAgent(outside.cookie, 'OutsideBot');
    await flushFirstAgentAlerts();
    expect(alerts).toHaveLength(1);
  });
});

describe('signup alert', () => {
  it('emails ALERT_EMAIL once, on an outside person’s first sign-in only', async () => {
    process.env.ALERT_EMAIL = 'ops@example.com';
    delete process.env.STATS_EXCLUDE_WORKSPACE_IDS;
    const email = emailAddress('newcomer');
    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email, source: 'x-post' } });
    await flushFirstAgentAlerts();
    // Asking for a code is not a signup: anyone can type an address.
    expect(signupAlerts).toHaveLength(0);

    const first = await signIn(email);
    await flushFirstAgentAlerts();
    expect(signupAlerts).toHaveLength(1);
    expect(signupAlerts[0]).toMatchObject({
      to: 'ops@example.com',
      email: email.toLowerCase(),
      workspaceName: first.workspace.name,
      kind: 'signup',
      signupSource: 'x-post',
      wantsSharing: false,
    });
    const text = signupAlertText(signupAlerts[0]!);
    expect(text).toContain('Someone outside the team signed up.');
    expect(text).toContain(`Email: ${email.toLowerCase()}`);
    expect(text).toContain('Signup source: x-post');
    expect(text).toContain(`Time (UTC): ${signupAlerts[0]!.createdAt.toISOString()}`);

    await signIn(email);
    await flushFirstAgentAlerts();
    expect(signupAlerts).toHaveLength(1);
  });

  it('is silent for internal emails and when ALERT_EMAIL is unset', async () => {
    process.env.ALERT_EMAIL = 'ops@example.com';
    for (const email of internalEmails()) await signIn(email);
    await flushFirstAgentAlerts();
    expect(signupAlerts).toHaveLength(0);

    delete process.env.ALERT_EMAIL;
    await signIn();
    await flushFirstAgentAlerts();
    expect(signupAlerts).toHaveLength(0);
  });

  it('a failed send does not fail sign-in and logs no address', async () => {
    process.env.ALERT_EMAIL = 'ops@example.com';
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    setEmailSenderForTests({
      async sendLoginCode(message) {
        inbox.push(message);
      },
      async sendFirstAgentAlert() {},
      async sendSignupAlert(message) {
        signupAlerts.push(message);
        throw new Error('smtp down');
      },
      async sendPendingCustomers() {},
      async sendEarlyAccessNotice() {},
      async sendReviewNeeded() {},
      async sendCustomerUpdate() {},
    });
    try {
      const email = emailAddress('noisy');
      const session = await signIn(email);
      expect(session.cookie).toBeTruthy();
      await flushFirstAgentAlerts();
      expect(signupAlerts).toHaveLength(1);
      expect(errors.some((line) => line.includes('signup alert failed: smtp down'))).toBe(true);
      expect(errors.join('\n')).not.toContain(email.toLowerCase());
    } finally {
      spy.mockRestore();
    }
  });
});

describe('usage overview', () => {
  it('splits counts into outside and internal, and masks emails in the recent list', async () => {
    delete process.env.STATS_EXCLUDE_WORKSPACE_IDS;
    const before = await loadUsageOverview();

    for (const email of internalEmails()) {
      const session = await signIn(email);
      await createAgent(session.cookie, 'InternalBot');
    }
    const outsideEmail = `outsider@u${tag()}.example.com`;
    const outside = await signIn(outsideEmail);
    const a = await createAgent(outside.cookie, 'OutsideA');
    const b = await createAgent(outside.cookie, 'OutsideB');
    await getDb().insert(messages).values({ workspaceId: outside.workspace.id, fromAgentId: a.id, toAgentId: b.id, body: 'hi' });

    const after = await loadUsageOverview();
    expect(after.external.accounts).toBe(before.external.accounts + 1);
    expect(after.external.workspaces).toBe(before.external.workspaces + 1);
    expect(after.external.agents).toBe(before.external.agents + 2);
    expect(after.external.messages).toBe(before.external.messages + 1);
    expect(after.external.signups_7d).toBe(before.external.signups_7d + 1);
    expect(after.internal.accounts).toBe(before.internal.accounts + 3);
    expect(after.internal.workspaces).toBe(before.internal.workspaces + 3);
    expect(after.internal.agents).toBe(before.internal.agents + 3);

    const newest = after.recent[0]!;
    expect(newest.email).toBe(maskEmail(outsideEmail));
    expect(newest.agents).toBe(2);
    expect(newest.messages).toBe(1);
    const json = JSON.stringify(after.recent).toLowerCase();
    expect(json).not.toContain(outsideEmail.toLowerCase());
    expect(json).not.toContain('valetto.tech');
    expect(json).not.toContain('clairevue.ai');
    expect(json).not.toContain('internal-test');
    expect(json).not.toContain('"id"');

    // A workspace in STATS_EXCLUDE_WORKSPACE_IDS moves to the internal side.
    process.env.STATS_EXCLUDE_WORKSPACE_IDS = outside.workspace.id;
    const excluded = await loadUsageOverview();
    expect(excluded.external.accounts).toBe(before.external.accounts);
    expect(excluded.internal.accounts).toBe(after.internal.accounts + 1);
    expect(excluded.recent.some((row) => row.email === maskEmail(outsideEmail))).toBe(false);
  });
});

async function renderPage(): Promise<string> {
  const { default: UsagePage } = await import('@/app/internal-usage/page');
  return renderToStaticMarkup(await UsagePage());
}

async function pageTitle(): Promise<unknown> {
  const { generateMetadata } = await import('@/app/internal-usage/page');
  return (await generateMetadata()).title;
}

/** Every kind of visitor who must not see the page, as a session token (null = no cookie). */
async function nonOwnerTokens(): Promise<Record<string, string | null>> {
  const stranger = await signIn();
  const teammate = await signIn(`someone-${tag()}@valetto.tech`);
  const [local, domain] = OWNER.split('@') as [string, string];
  const alias = await signIn(`${local}+${tag()}@${domain}`);

  // An owner session that has expired.
  const expiredOwner = `expired-${tag()}@owner-test.example.net`;
  const expired = await signIn(expiredOwner);
  await getDb()
    .update(sessions)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(sessions.tokenHash, sha256(tokenFrom(expired.cookie))));

  // An owner address whose email is not verified.
  const unverifiedOwner = `unverified-${tag()}@owner-test.example.net`;
  const unverified = await signIn(unverifiedOwner);
  await getDb().update(users).set({ emailVerifiedAt: null }).where(eq(users.email, unverifiedOwner));

  setExtraUsageOwnersForTests([OWNER, expiredOwner, unverifiedOwner]);
  return {
    signed_out: null,
    bad_token: `rs_${randomUUID().replace(/-/g, '')}`,
    expired_session: tokenFrom(expired.cookie),
    unverified_email: tokenFrom(unverified.cookie),
    non_owner: tokenFrom(stranger.cookie),
    owner_alias: tokenFrom(alias.cookie),
    teammate_valetto_tech: tokenFrom(teammate.cookie),
  };
}

function usageRequest(path: string, token: string | null): NextRequest {
  const headers = new Headers({ host: 'valetto.tech' });
  if (token) headers.set('cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}`);
  return new NextRequest(`https://valetto.tech${path}`, { headers });
}

describe('/admin/usage proxy gate', () => {
  it('has no route at /admin/usage, so a pass-through is the ordinary 404', () => {
    expect(existsSync(path.join(process.cwd(), 'app/admin'))).toBe(false);
    expect(existsSync(path.join(process.cwd(), 'app/internal-usage/page.tsx'))).toBe(true);
    expect(proxyConfig.matcher).toEqual([USAGE_PATH, OWNER_ROUTE, `${OWNER_ROUTE}/:path*`]);
  });

  it('passes every non-owner through untouched: no rewrite, no extra headers', async () => {
    const cases = await nonOwnerTokens();
    for (const [label, token] of Object.entries(cases)) {
      const res = await proxy(usageRequest(USAGE_PATH, token));
      expect(res.headers.get('x-middleware-rewrite'), label).toBeNull();
      expect(res.headers.get('x-middleware-next'), label).toBe('1');
      for (const name of Object.keys(OWNER_HEADERS)) expect(res.headers.get(name), label).toBeNull();
      expect(res.status, label).toBe(200);
    }
  });

  it('rewrites only the owner to the real page, with private headers', async () => {
    const owner = await signIn(OWNER);
    const res = await proxy(usageRequest(USAGE_PATH, tokenFrom(owner.cookie)));
    expect(new URL(res.headers.get('x-middleware-rewrite')!, 'https://valetto.tech').pathname).toBe(OWNER_ROUTE);
    for (const [name, value] of Object.entries(OWNER_HEADERS)) expect(res.headers.get(name)).toBe(value);
  });

  it('never serves the internal route directly, even to the owner', async () => {
    const owner = await signIn(OWNER);
    for (const p of [OWNER_ROUTE, `${OWNER_ROUTE}/x`]) {
      for (const token of [null, tokenFrom(owner.cookie)]) {
        const res = await proxy(usageRequest(p, token));
        expect(new URL(res.headers.get('x-middleware-rewrite')!, 'https://valetto.tech').pathname).toBe(NOT_FOUND_REWRITE);
      }
    }
  });
});

describe('usage page (second check behind the proxy)', () => {
  async function expectNotFound(label: string): Promise<void> {
    let caught: unknown = null;
    try {
      await renderPage();
    } catch (err) {
      caught = err;
    }
    expect(isNotFound(caught), label).toBe(true);
    expect(await pageTitle(), label).toEqual({ absolute: 'Page not found · Valetto' });
  }

  it('404s, with the not-found title, for every non-owner', async () => {
    const cases = await nonOwnerTokens();
    for (const [label, token] of Object.entries(cases)) {
      jar.token = token;
      await expectNotFound(label);
    }
  });

  it('renders outside counts for the owner, with no full outside email', async () => {
    const outsideEmail = `visible@u${tag()}.example.com`;
    await signIn(outsideEmail);
    const owner = await signIn(OWNER);
    jar.token = tokenFrom(owner.cookie);
    expect(await pageTitle()).toEqual({ absolute: 'Usage · Valetto' });
    const html = await renderPage();
    expect(html).toContain('Outside usage');
    expect(html).toContain('Latest outside signups');
    expect(html).toContain('Internal accounts');
    expect(html).toContain(maskEmail(outsideEmail));
    expect(html.toLowerCase()).not.toContain(outsideEmail.toLowerCase());
  });

  it('does not reveal a name through the default workspace name (jane.doe@example.com)', async () => {
    const jane = await signIn('jane.doe@example.com');
    expect(jane.workspace.name.toLowerCase()).toContain('jane');
    const owner = await signIn(OWNER);
    jar.token = tokenFrom(owner.cookie);
    const html = (await renderPage()).toLowerCase();
    expect(html).toContain('j***@example.com');
    expect(html).not.toContain('jane');
    expect(html).not.toContain('doe');
    // The data the page serializes into its RSC payload.
    const data = JSON.stringify(await loadUsageOverview()).toLowerCase();
    expect(data).not.toContain('jane');
    expect(data).not.toContain('doe');
    expect(data).not.toContain('"workspace"');
    expect(data).not.toContain('"handle"');
  });
});
