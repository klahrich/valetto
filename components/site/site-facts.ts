/**
 * Numbers the public site states, derived from the code constants so the copy cannot drift from what the code
 * enforces (issue #226). No server imports: client components (sign-in, setup prompt) use it too.
 * tests/site-copy-facts.test.ts checks the site copy against these.
 */
import {
  DEFAULT_SHARE_DAILY_CAP,
  JOIN_CODE_DEFAULT_TTL_MS,
  JOIN_CODE_MAX_PENDING,
  JOIN_CODE_MAX_TTL_MS,
  JOIN_CODE_MIN_TTL_MS,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MS,
  MAX_SHARE_DAILY_CAP,
  OFFER_DESCRIPTION_MAX,
  RESULT_SCHEMA_MAX_CHARS,
  SESSION_TTL_SECONDS,
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
  WAKE_MAX_ATTEMPTS,
  WEBHOOK_TIMEOUT_MS,
} from '@/lib/constants';
import { FREE_CUSTOMERS_PER_BOT, PLAN_LIMITS } from '@/lib/plan-limits';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 1000 -> "1,000", the way the site writes numbers. */
export function n(value: number): string {
  return value.toLocaleString('en-US');
}

export const SITE_FACTS = {
  freeAgents: n(PLAN_LIMITS.free.agents),
  freeTasksPerMonth: n(PLAN_LIMITS.free.tasksPerMonth),
  /** Pending or approved guests per shared agent on the free plan. */
  freeGuestsPerAgent: n(FREE_CUSTOMERS_PER_BOT),
  guestDailyCap: n(DEFAULT_SHARE_DAILY_CAP),
  guestDailyCapMax: n(MAX_SHARE_DAILY_CAP),
  loginCodeMinutes: n(LOGIN_CODE_TTL_MS / MINUTE),
  loginCodeTries: n(LOGIN_CODE_MAX_ATTEMPTS),
  sessionDays: n((SESSION_TTL_SECONDS * SECOND) / DAY),
  joinCodeDefaultHours: n(JOIN_CODE_DEFAULT_TTL_MS / HOUR),
  joinCodeMinHours: n(JOIN_CODE_MIN_TTL_MS / HOUR),
  joinCodeMaxDays: n(JOIN_CODE_MAX_TTL_MS / DAY),
  joinCodeMaxPending: n(JOIN_CODE_MAX_PENDING),
  taskTitleMax: n(TASK_TITLE_MAX),
  taskDescriptionMax: n(TASK_DESCRIPTION_MAX),
  resultSchemaMax: n(RESULT_SCHEMA_MAX_CHARS),
  offerDescriptionMax: n(OFFER_DESCRIPTION_MAX),
  webhookTimeoutSeconds: n(WEBHOOK_TIMEOUT_MS / SECOND),
  wakeMaxAttempts: n(WAKE_MAX_ATTEMPTS),
} as const;
