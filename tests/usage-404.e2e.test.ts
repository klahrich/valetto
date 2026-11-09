import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db';
import { sessions, users } from '@/db/schema';
import { SESSION_COOKIE } from '@/lib/constants';
import { sha256 } from '@/lib/crypto';
import { signIn } from './helpers';

/**
 * Black-box check against a running `next start` build. Skipped unless USAGE_E2E_BASE_URL is set. The server and this
 * run must share one database: set TEST_DATABASE_URL to the server's DATABASE_URL (a local one, never production).
 * USAGE_E2E_OWNER_EMAIL is a real owner address (kept out of the repo) used for the owner, expired and unverified
 * cases. Example:
 *   TEST_DATABASE_URL=$LOCAL USAGE_E2E_BASE_URL=http://127.0.0.1:3917 USAGE_E2E_OWNER_EMAIL=… npx vitest run tests/usage-404.e2e.test.ts
 */
const BASE = process.env.USAGE_E2E_BASE_URL?.trim() ?? '';
const OWNER = process.env.USAGE_E2E_OWNER_EMAIL?.trim().toLowerCase() ?? '';
const run = BASE && OWNER ? describe : describe.skip;

function tokenFrom(cookie: string): string {
  const pair = cookie.split(';')[0]!;
  return decodeURIComponent(pair.slice(pair.indexOf('=') + 1));
}

const NOISE = ['date', 'etag', 'x-nextjs-date', 'keep-alive', 'connection'];

async function fetchPage(path: string, token: string | null, rsc = false) {
  const headers: Record<string, string> = { host: 'valetto.tech' };
  if (token) headers.cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
  if (rsc) headers.rsc = '1';
  // `?_rsc` with no value is the cache-busting key Next expects when no router-state headers are sent.
  const res = await fetch(`${BASE}${path}${rsc ? '?_rsc' : ''}`, { headers, redirect: 'manual' });
  const body = (await res.text()).split(path).join('<path>');
  const head = [...res.headers.entries()]
    .filter(([name]) => !NOISE.includes(name))
    .map(([name, value]) => `${name}: ${value}`)
    .sort();
  return { status: res.status, body, head };
}

run('/admin/usage over HTTP', () => {
  it('a non-owner gets the same 404 as an unknown path: body, RSC payload and headers', async () => {
    const stranger = await signIn();
    const teammate = await signIn(`someone-${randomUUID().slice(0, 8)}@valetto.tech`);
    const [local, domain] = OWNER.split('@') as [string, string];
    const alias = await signIn(`${local}+${randomUUID().slice(0, 8)}@${domain}`);

    const expired = await signIn(OWNER);
    await getDb()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(sessions.tokenHash, sha256(tokenFrom(expired.cookie))));

    // Unverified: drop the verification, test, then restore it for the owner case below.
    const unverified = await signIn(OWNER);
    const cases: Record<string, string | null> = {
      signed_out: null,
      bad_token: `rs_${randomUUID().replace(/-/g, '')}`,
      expired_session: tokenFrom(expired.cookie),
      non_owner: tokenFrom(stranger.cookie),
      owner_alias: tokenFrom(alias.cookie),
      teammate_valetto_tech: tokenFrom(teammate.cookie),
    };

    const check = async (label: string, token: string | null) => {
      for (const rsc of [false, true]) {
        const unknown = await fetchPage(`/zz-${randomUUID()}`, null, rsc);
        const got = await fetchPage('/admin/usage', token, rsc);
        expect(got.status, label).toBe(404);
        expect(unknown.status).toBe(404);
        expect(got.body, `${label} rsc=${rsc}`).toBe(unknown.body);
        expect(got.head, `${label} rsc=${rsc}`).toEqual(unknown.head);
        expect(got.body).not.toContain('"admin"');
        expect(got.body).not.toContain('"usage"');
        expect(got.body).not.toContain('Usage · Valetto');
        expect(got.body).not.toContain('internal-usage');
      }
    };
    for (const [label, token] of Object.entries(cases)) await check(label, token);

    await getDb().update(users).set({ emailVerifiedAt: null }).where(eq(users.email, OWNER));
    try {
      await check('unverified_email', tokenFrom(unverified.cookie));
    } finally {
      await getDb().update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, OWNER));
    }
  });

  it('the owner sees the page, and a seeded jane.doe@example.com is not revealed in HTML or RSC', async () => {
    const janeEmail = 'jane.doe@example.com';
    await signIn(janeEmail);
    const owner = await signIn(OWNER);
    const token = tokenFrom(owner.cookie);
    for (const rsc of [false, true]) {
      const page = await fetchPage('/admin/usage', token, rsc);
      expect(page.status).toBe(200);
      expect(page.body).toContain('Outside usage');
      expect(page.body).toContain('j***@example.com');
      expect(page.body.toLowerCase()).not.toContain('jane');
      expect(page.body.toLowerCase()).not.toContain('doe');
    }
    const html = await fetchPage('/admin/usage', token);
    expect(html.head).toContain('x-robots-tag: noindex, nofollow');
    expect(html.head).toContain('cache-control: private, no-store');
  });
});
