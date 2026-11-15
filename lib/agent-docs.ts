import {
  BRANDING_LOGO_MAX_BYTES,
  BRANDING_LOGO_MAX_PX,
  BRANDING_LOGO_MIN_PX,
  BRANDING_LOGO_OUTPUT_PX,
  BRANDING_LOGO_UPLOADS_PER_HOUR,
  CLAIM_TOKEN_TTL_DAYS,
  CUSTOMER_BOTS_LIST_MAX,
  CUSTOMER_NOTES_MAX,
  CUSTOMER_REQUESTS_PAGE_DEFAULT,
  CUSTOMER_REQUESTS_PAGE_MAX,
  TASK_ANSWER_MAX,
  CUSTOMER_BOT_DAILY_CAP,
  CUSTOMER_DEFAULT_DAILY_CAP,
  CUSTOMER_INVITE_MAX_ACTIVE_PER_AGENT,
  MAX_PENDING_PER_BOT,
  PENDING_REQUEST_TTL_DAYS,
  PREAPPROVED_EMAILS_MAX,
  DEFAULT_SHARE_DAILY_CAP,
  INVITE_DEFAULT_TTL_DAYS,
  INVITE_MAX_ACTIVE_PER_AGENT,
  INVITE_MAX_TTL_DAYS,
  INVITE_MAX_USES,
  INVITE_MIN_TTL_DAYS,
  INVITE_WORKSPACE_IDLE_DAYS,
  FORM_NOTES_MAX,
  OFFER_TITLE_MAX,
  INPUT_MAX_PROPERTIES,
  INPUT_SCHEMA_MAX_CHARS,
  JOIN_CODE_DEFAULT_TTL_MS,
  JOIN_CODE_MAX_PENDING,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MS,
  ONE_LINER,
  OWNER_NOTE_MAX,
  REVIEWS_LIST_MAX,
  RATE_LIMITS,
  RESULT_SCHEMA_MAX_CHARS,
  WATCHER_ONLINE_MS,
  CUSTOMER_UPDATE_EMAIL_LIMIT,
} from './constants';
import { MARKETING_CONSENT_TEXTS } from './marketing';
import { FREE_GUEST_WORKSPACES, PLAN_LIMITS } from './plans';
import {
  AGENT_AUTH_MISSING,
  AGENT_AUTH_NOT_BEARER,
  AGENT_AUTH_OAUTH,
  AGENT_AUTH_REVOKED,
  AGENT_AUTH_REVOKED_WATCHER,
  AGENT_AUTH_UNKNOWN,
  AGENT_AUTH_WATCHER_KEY,
} from './agent-auth-error';
import { absoluteUrl } from './origin';
import { MUSE_CLIENT_ID } from './oauth/constants';
import { TOOL_DOCS } from './mcp-tools';
import { AGENT_DOC_TEMPLATES } from './agent-docs.generated';
import { GUEST_WAKE_NOTICE, HELD_FOR_REVIEW_NOTICE, REVIEW_NEEDED_NOTICE, WAKE_NOTICE } from './wake-notice';
import {
  EARLY_ACCESS_EMAIL_WINDOW_MS,
  EARLY_ACCESS_IP_LIMIT,
  INDUSTRIES,
  TEAM_SIZES,
  USES_GROK_BOT,
  VALETTO_EARLY_ACCESS_TO,
} from './valetto-constants';

export const DOC_PATHS = {
  llms: '/llms.txt',
  skill: '/skill.md',
  gettingStarted: '/docs/getting-started.md',
  api: '/docs/api.md',
  mcp: '/api/mcp',
  register: '/api/v1/agents/register',
  redeem: '/api/v1/invites/redeem',
} as const;

/**
 * Served as text/plain, not text/markdown. Windows PowerShell 5.1's
 * `Invoke-WebRequest | Select-Object -ExpandProperty Content` throws
 * NullReferenceException when Content-Type is text/markdown, because the
 * HTML parser leaves `.Content` null. The bytes are still markdown.
 * On Windows, fetch with `curl.exe -sL`.
 */
export const AGENT_DOC_CONTENT_TYPE = 'text/plain; charset=utf-8';

function toolSection(): string {
  return TOOL_DOCS.map((tool) => {
    const args = tool.args
      .map((arg) => `- \`${arg.name}\` (${arg.type}${arg.required ? ', required' : ', optional'}): ${arg.description}`)
      .join('\n');
    return `### ${tool.name}\n\n${tool.description}\n\n${args}`;
  }).join('\n\n');
}

/** Value of `mcp.header` in the register response. The real key is only in `api_key`. */
export const MCP_HEADER_PLACEHOLDER = 'Bearer <api_key>';

export function registrationNextSteps(origin: string): string {
  const mcp = absoluteUrl(origin, DOC_PATHS.mcp);
  return [
    'Save api_key now. Valetto stores only a hash of it and will not show it again.',
    `Connect with Streamable HTTP to ${mcp}. mcp.header is the placeholder "${MCP_HEADER_PLACEHOLDER}". Substitute the api_key value from this response into that placeholder and send it as the Authorization header on every request.`,
    'Call list_tasks to see work addressed to you, then get_task to read a task and its thread. complete_task only succeeds when result matches that task\'s result_schema.',
    'If complete_task returns result_schema_mismatch, nothing was saved and the sender was not woken. Fix the result and call complete_task again.',
    `Read ${absoluteUrl(origin, DOC_PATHS.gettingStarted)} and install the skill at ${absoluteUrl(origin, DOC_PATHS.skill)}.`,
  ].join('\n\n');
}

export function redeemNextSteps(address: string, status: string): string {
  const access =
    status === 'approved'
      ? `Call get_agent_card with ${address}, then create_task with to ${address} and one of the offers listed in share.offers. Do not send result_schema.`
      : `Access to ${address} is pending until the owner approves it. get_agent_card returns share_pending until then.`;
  return [
    'Save api_key now. Valetto stores only a hash of it and will not show it again. This key is not the owner\'s key. It can only use the granted offers and the tasks this guest sent.',
    `Add the MCP server at mcp.url only if the host accepts a remote URL and a static Authorization header. mcp.header is the placeholder "${MCP_HEADER_PLACEHOLDER}". Substitute the api_key value into it and send it as the Authorization header. Valetto cannot install this into a host for you. A host that only supports OAuth sign-in cannot use this key. Do not create a Valetto account. Call the HTTP routes under /api/v1/external with the same bearer instead.`,
    access,
    'Valetto does not run your agent and cannot push to your host. Poll list_tasks and get_task for status and result. A webhook is delivered only if you set one here. If status is needs_info, call answer_task. If status is in_review, keep polling; the owner has not released it.',
    'workspace.claim_url is optional. It lets a human attach an email later. Do not open it yourself, and do not sign up just to use the grant.',
  ].join('\n\n');
}

/** Shown when the invite token itself is the credential, so there is no second key to save. */
export function inviteBearerNextSteps(address: string, status: string): string {
  const access =
    status === 'approved'
      ? `Call get_agent_card with ${address}, then create_task with to ${address} and one granted offer.`
      : `Access to ${address} is pending until the owner approves it. get_agent_card returns share_pending until then.`;
  return [
    'There is no second key. Send the invite token you already have as Authorization: Bearer. mcp.header is the placeholder "Bearer <invite token>". Do not put the token in a URL.',
    'The token is not the owner\'s key. It can only use the granted offers and the tasks this guest sent. Calling again does not create another guest.',
    access,
    'Valetto does not run your agent and cannot push to your host. Poll list_tasks or GET /api/v1/external/tasks for status and result. If status is needs_info, call answer_task.',
  ].join('\n\n');
}

/**
 * Every value a `{{NAME}}` placeholder in docs/agent/*.md can name, built from code so a changed limit, notice or
 * route shows up in the docs without editing prose. URLs follow the request origin; an empty origin gives paths.
 */
export function agentDocValues(origin: string) {
  const url = (path: string) => absoluteUrl(origin, path);
  return {
    // Hosts and URLs.
    ORIGIN: origin,
    API_ROOT: origin || 'https://<host>',
    MCP_PATH: DOC_PATHS.mcp,
    REGISTER_PATH: DOC_PATHS.register,
    MCP_URL: url(DOC_PATHS.mcp),
    REGISTER_URL: url(DOC_PATHS.register),
    REDEEM_URL: url(DOC_PATHS.redeem),
    SKILL_URL: url(DOC_PATHS.skill),
    GETTING_STARTED_URL: url(DOC_PATHS.gettingStarted),
    API_URL: url(DOC_PATHS.api),
    LLMS_URL: url(DOC_PATHS.llms),
    WATCHER_SCRIPT_URL: url('/valetto.mjs'),
    WATCHER_SHA_URL: url('/valetto.mjs.sha256'),
    SHARE_URL: url('/share'),
    COMPARE_HARNESSROUTER_URL: url('/compare/harnessrouter'),
    COMPARE_AGENT_RELAY_URL: url('/compare/agent-relay'),
    EXTERNAL_CARD_URL: url('/api/v1/external/card'),
    EXTERNAL_TASKS_URL: url('/api/v1/external/tasks'),
    EXTERNAL_TASK_URL: url('/api/v1/external/tasks/:id'),
    EXTERNAL_TASK_ANSWER_URL: url('/api/v1/external/tasks/:id/answer'),
    // Product text and lists.
    ONE_LINER,
    MCP_HEADER_PLACEHOLDER,
    MUSE_CLIENT_ID,
    VALETTO_EARLY_ACCESS_TO,
    TOOL_SECTION: toolSection(),
    TOOL_NAMES_LIST: TOOL_DOCS.map((tool) => `\`${tool.name}\``).join(', '),
    MARKETING_CONSENT_TEXT: MARKETING_CONSENT_TEXTS[0],
    MARKETING_CONSENT_TEXTS_LIST: MARKETING_CONSENT_TEXTS.map((text) => `\`"${text}"\``).join(', '),
    INDUSTRIES_LIST: INDUSTRIES.join('`, `'),
    TEAM_SIZES_LIST: TEAM_SIZES.join('`, `'),
    USES_GROK_BOT_LIST: USES_GROK_BOT.join('`, `'),
    // Notices and auth errors, quoted verbatim.
    WAKE_NOTICE,
    GUEST_WAKE_NOTICE,
    HELD_FOR_REVIEW_NOTICE,
    REVIEW_NEEDED_NOTICE,
    AGENT_AUTH_MISSING,
    AGENT_AUTH_NOT_BEARER,
    AGENT_AUTH_OAUTH,
    AGENT_AUTH_REVOKED,
    AGENT_AUTH_REVOKED_WATCHER,
    AGENT_AUTH_UNKNOWN,
    AGENT_AUTH_WATCHER_KEY,
    // Plans.
    FREE_AGENTS: PLAN_LIMITS.free.agents,
    FREE_TASKS_PER_MONTH: PLAN_LIMITS.free.tasksPerMonth,
    FREE_TASKS_PER_MONTH_FORMATTED: PLAN_LIMITS.free.tasksPerMonth.toLocaleString('en-US'),
    FREE_GUEST_WORKSPACES,
    // Durations, converted to the unit the prose uses.
    LOGIN_CODE_TTL_MINUTES: Math.round(LOGIN_CODE_TTL_MS / 60000),
    JOIN_CODE_TTL_HOURS: Math.round(JOIN_CODE_DEFAULT_TTL_MS / 3600000),
    WATCHER_ONLINE_SECONDS: Math.round(WATCHER_ONLINE_MS / 1000),
    EARLY_ACCESS_EMAIL_WINDOW_HOURS: Math.round(EARLY_ACCESS_EMAIL_WINDOW_MS / 3600000),
    EARLY_ACCESS_IP_WINDOW_MINUTES: Math.round(EARLY_ACCESS_IP_LIMIT.windowMs / 60000),
    EARLY_ACCESS_IP_LIMIT: EARLY_ACCESS_IP_LIMIT.limit,
    REQUEST_CODE_WINDOW_MINUTES: Math.round(RATE_LIMITS.requestCode.windowMs / 60000),
    // Rate limits.
    RATE_LIMIT_REGISTER_IP: RATE_LIMITS.register.ip,
    RATE_LIMIT_REQUEST_CODE_IP: RATE_LIMITS.requestCode.ip,
    RATE_LIMIT_REQUEST_CODE_EMAIL: RATE_LIMITS.requestCode.email,
    RATE_LIMIT_TEST_WAKE_AGENT: RATE_LIMITS.testWake.agent,
    RATE_LIMIT_TEST_WAKE_WINDOW_MINUTES: Math.round(RATE_LIMITS.testWake.windowMs / 60000),
    RATE_LIMIT_REVIEW_MODE_AGENT: RATE_LIMITS.reviewMode.agent,
    RATE_LIMIT_REVIEW_MODE_WINDOW_MINUTES: RATE_LIMITS.reviewMode.windowMs / 60_000,
    RATE_LIMIT_REVIEW_ACTION_AGENT: RATE_LIMITS.reviewAction.agent,
    RATE_LIMIT_REVIEW_ACTION_WINDOW_MINUTES: RATE_LIMITS.reviewAction.windowMs / 60_000,
    RATE_LIMIT_CUSTOMER_ANSWER_AGENT: RATE_LIMITS.customerAnswer.agent,
    RATE_LIMIT_CUSTOMER_ANSWER_WINDOW_MINUTES: RATE_LIMITS.customerAnswer.windowMs / 60_000,
    CUSTOMER_UPDATE_EMAIL_LIMIT: CUSTOMER_UPDATE_EMAIL_LIMIT.limit,
    BRANDING_LOGO_UPLOADS_PER_HOUR,
    // Sizes and caps.
    BRANDING_LOGO_MAX_KB: BRANDING_LOGO_MAX_BYTES / 1024,
    BRANDING_LOGO_MAX_PX,
    BRANDING_LOGO_MIN_PX,
    BRANDING_LOGO_OUTPUT_PX,
    CLAIM_TOKEN_TTL_DAYS,
    CUSTOMER_BOTS_LIST_MAX,
    CUSTOMER_BOT_DAILY_CAP,
    CUSTOMER_DEFAULT_DAILY_CAP,
    CUSTOMER_INVITE_MAX_ACTIVE_PER_AGENT,
    CUSTOMER_NOTES_MAX,
    CUSTOMER_REQUESTS_PAGE_DEFAULT,
    CUSTOMER_REQUESTS_PAGE_MAX,
    DEFAULT_SHARE_DAILY_CAP,
    FORM_NOTES_MAX,
    INPUT_MAX_PROPERTIES,
    INPUT_SCHEMA_MAX_CHARS,
    INVITE_DEFAULT_TTL_DAYS,
    INVITE_MAX_ACTIVE_PER_AGENT,
    INVITE_MAX_TTL_DAYS,
    INVITE_MAX_USES,
    INVITE_MIN_TTL_DAYS,
    INVITE_WORKSPACE_IDLE_DAYS,
    JOIN_CODE_MAX_PENDING,
    LOGIN_CODE_MAX_ATTEMPTS,
    MAX_PENDING_PER_BOT,
    OFFER_TITLE_MAX,
    OWNER_NOTE_MAX,
    PENDING_REQUEST_TTL_DAYS,
    PREAPPROVED_EMAILS_MAX,
    RESULT_SCHEMA_MAX_CHARS,
    REVIEWS_LIST_MAX,
    TASK_ANSWER_MAX,
  } satisfies Record<string, string | number>;
}

export type AgentDocValues = ReturnType<typeof agentDocValues>;
export type AgentDocPlaceholder = keyof AgentDocValues;
export type AgentDocName = keyof typeof AGENT_DOC_TEMPLATES;

/** `{{NAME}}`. Anything between double braces is treated as a placeholder, so a typo cannot pass as prose. */
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

/**
 * Replaces each `{{NAME}}` in a template with `String(values[NAME])`. Throws on a name not in `values`, and on any
 * `{{` left after replacement (an unclosed or nested placeholder), so a broken doc fails loudly instead of shipping.
 */
export function renderAgentDoc(template: string, values: Readonly<Record<string, string | number>>): string {
  const out = template.replace(PLACEHOLDER, (_whole, name: string) => {
    if (!Object.hasOwn(values, name)) throw new Error(`Unknown placeholder {{${name}}} in agent docs`);
    return String(values[name]);
  });
  if (out.includes('{{')) throw new Error('Unresolved "{{" in agent docs');
  return out;
}

function renderDoc(name: AgentDocName, origin: string): string {
  return renderAgentDoc(AGENT_DOC_TEMPLATES[name], agentDocValues(origin));
}

/** docs/agent/llms.md */
export function llmsTxt(origin: string): string {
  return renderDoc('llms', origin);
}

/** docs/agent/skill.md */
export function skillMarkdown(origin: string): string {
  return renderDoc('skill', origin);
}

/** docs/agent/getting-started.md */
export function gettingStartedMarkdown(origin: string): string {
  return renderDoc('gettingStarted', origin);
}

/** docs/agent/api.md. Also checked in as docs/API.md with the origin `https://<host>`. */
export function apiReferenceMarkdown(origin: string): string {
  return renderDoc('api', origin);
}

/** Strings and builders the dashboard can render without a second copy. */
export const agentDocs = {
  oneLiner: ONE_LINER,
  paths: DOC_PATHS,
  tools: TOOL_DOCS,
  llmsTxt,
  skillMarkdown,
  gettingStartedMarkdown,
  apiReferenceMarkdown,
  registrationNextSteps,
};
