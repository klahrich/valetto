import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARTICLE_MD } from '@/app/(site)/compare/agent-relay/article';
import { plain } from '@/app/(site)/faq';
import { PRIVACY_MD } from '@/app/(site)/privacy/content';
import { CONTROL, sharingFaq, sharingSteps } from '@/app/(site)/sharing/content';
import { TERMS_MD } from '@/app/(site)/terms/content';
import { VALETTO_PRIVACY_MD } from '@/app/(site)/valetto/privacy/content';
import {
  DEFAULT_SHARE_DAILY_CAP,
  JOIN_CODE_MAX_TTL_MS,
  JOIN_CODE_MIN_TTL_MS,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MS,
  SESSION_TTL_SECONDS,
} from '@/lib/constants';
import { FREE_CUSTOMERS_PER_BOT, PLAN_LIMITS } from '@/lib/plan-limits';

// Issue #226: the public site states limits that the code enforces. Each check finds the number next to a fixed
// phrase in the copy and compares it to the constant, so a hand-typed number that drifts fails here.
// Pure: no database, no rendering. The content modules are what the pages and their JSON-LD are built from.

const ROOT = join(__dirname, '..');
const FREE = PLAN_LIMITS.free;

/** "1,000" -> 1000. */
function num(text: string): number {
  return Number(text.replace(/,/g, ''));
}

/** Every number captured by `pattern` (group 1) in `text`. Fails when the phrase is missing, so a reworded line is noticed. */
function stated(text: string, pattern: RegExp): number[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const found = [...text.matchAll(new RegExp(pattern.source, flags))].map((m) => num(m[1]!));
  expect(found, `no match for ${pattern} in the copy`).not.toEqual([]);
  return found;
}

function expectAll(text: string, pattern: RegExp, value: number) {
  for (const n of stated(text, pattern)) expect(n, `${pattern}`).toBe(value);
}

const N = String.raw`(\d[\d,]*)`;

describe('site copy matches code constants', () => {
  it('sharing page content: guest limit, daily cap, both with and without agent invites', () => {
    for (const invites of [true, false]) {
      const text = [
        ...sharingSteps(invites),
        ...CONTROL.map(plain),
        ...sharingFaq(invites).flatMap((f) => [f.q, plain(f.a)]),
      ].join('\n');
      expectAll(text, new RegExp(`up to ${N} guest workspaces`), FREE_CUSTOMERS_PER_BOT);
      expectAll(text, new RegExp(`daily cap, ${N} tasks by default`), DEFAULT_SHARE_DAILY_CAP);
    }
  });

  it('sharing page only mentions invite links when agent invites are on', () => {
    const off = [...sharingSteps(false), ...sharingFaq(false).flatMap((f) => [f.q, plain(f.a)])].join('\n');
    const on = [...sharingSteps(true), ...sharingFaq(true).flatMap((f) => [f.q, plain(f.a)])].join('\n');
    expect(off).not.toMatch(/invite link/i);
    expect(on).toMatch(/invite link/i);
  });

  it('terms: free plan agents, monthly tasks, guests per shared agent, default daily cap', () => {
    const text = TERMS_MD;
    expectAll(text, new RegExp(`^- ${N} agents;`, 'm'), FREE.agents);
    expectAll(text, new RegExp(`${N} tasks created per calendar month`), FREE.tasksPerMonth);
    expectAll(text, new RegExp(`up to ${N} guest workspaces`), FREE_CUSTOMERS_PER_BOT);
    expectAll(text, new RegExp(`daily cap, ${N} tasks by default`), DEFAULT_SHARE_DAILY_CAP);
  });

  it('compare page: free plan agents and monthly tasks', () => {
    const text = ARTICLE_MD;
    expectAll(text, new RegExp(`${N} (?:active )?agents and`), FREE.agents);
    expectAll(text, new RegExp(`agents and ${N} tasks`), FREE.tasksPerMonth);
  });

  it('privacy pages: sign-in code lifetime and tries, session length', () => {
    for (const text of [PRIVACY_MD, VALETTO_PRIVACY_MD]) {
      expectAll(text, new RegExp(`(?:works for|stop working after) ${N} minutes`), LOGIN_CODE_TTL_MS / 60_000);
      expectAll(text, new RegExp(`allows ${N} tries`), LOGIN_CODE_MAX_ATTEMPTS);
      expectAll(text, new RegExp(`(?:signed in for up to|expire after) ${N} days`), SESSION_TTL_SECONDS / 86_400);
    }
    const text = PRIVACY_MD;
    expectAll(text, new RegExp(`after ${N} hour to`), JOIN_CODE_MIN_TTL_MS / 3_600_000);
    expectAll(text, new RegExp(`hour to ${N} days`), JOIN_CODE_MAX_TTL_MS / 86_400_000);
  });

  // JSX pages are not rendered here. Their numbers come from components/site/site-facts.ts, so the guard is that
  // the source does not type these facts by hand again.
  it('JSX pages do not hard-code plan limits', () => {
    const files = [
      'app/(site)/sharing/page.tsx',
      'app/(site)/how-it-works/page.tsx',
      'app/(site)/how-it-works/sharing-steps.tsx',
      'app/(site)/how-it-works/invite-steps.tsx',
      'app/(site)/SetupPrompt.tsx',
    ];
    const handTyped = [
      /\b\d[\d,]* tasks (?:on the free plan|per UTC month)/,
      /\bholds \d+ active agents/,
      /\bup to \d[\d,]* guest/,
      /\bexpires after \d+ hours/,
    ];
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      for (const pattern of handTyped) expect(source, `${file} matches ${pattern}`).not.toMatch(pattern);
    }
  });
});
