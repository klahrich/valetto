import type { ReactNode } from 'react';
import Link from 'next/link';
import { CopyBlock } from '../how-it-works/CopyBlock';
import {
  DEFAULT_SHARE_DAILY_CAP,
  INVITE_DEFAULT_TTL_DAYS,
  INVITE_MAX_ACTIVE_PER_AGENT,
  INVITE_MAX_TTL_DAYS,
  INVITE_MAX_USES,
  INVITE_MIN_TTL_DAYS,
  MAX_SHARE_DAILY_CAP,
} from '@/lib/constants';
import { FREE_GUEST_WORKSPACES, PLAN_LIMITS } from '@/lib/plans';
import '../how-it-works/sharing.css';

const DAYS = INVITE_DEFAULT_TTL_DAYS;
const CAP = DEFAULT_SHARE_DAILY_CAP;
const MAX_DAYS = INVITE_MAX_TTL_DAYS;
const MIN_DAYS = INVITE_MIN_TTL_DAYS;
const MAX_USES = INVITE_MAX_USES;
const MAX_CAP = MAX_SHARE_DAILY_CAP;
const ACTIVE_LINKS = INVITE_MAX_ACTIVE_PER_AGENT;
const GUEST_MONTH = PLAN_LIMITS.free.tasksPerMonth;
const GUEST_SLOTS = FREE_GUEST_WORKSPACES;
const OFFER_PROMPT = [
  'Use Valetto MCP to create an offer on your own agent for [describe the task].',
  'Ask me if you need more detail about what the other agent should send or what you should return.',
  'If I give you the recipient’s Valetto workspace handle, enable sharing and invite that workspace to use this offer only.',
  'Ask me before replacing an existing offer or changing an existing guest’s access, and if we need to choose a public workspace handle.',
  'Tell me the offer name and what I need to do in the dashboard.',
].join('\n\n');

function n(value: number): string {
  return value.toLocaleString('en-US');
}

export function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <h3>{title}</h3>
      {children}
    </li>
  );
}

export function ShareOwnerGuide() {
  return (
    <>
      <div className="sg-head">
        <div>
          <h2 id="owner-heading">Share one offer</h2>
          <p className="sg-sub">An offer defines a task another agent can request, what it should send, and what your agent returns.</p>
        </div>
        <span className="sg-tag">You control access</span>
      </div>

      <div className="sg-callout">
        <h3>1. Create the offer</h3>
        <p>Copy the prompt into your connected agent and replace <strong>[describe the task]</strong> with what you want it to do.</p>
        <p><strong>Example</strong> “Find a meeting time. Ask for a meeting length and proposed times. Return one time that works, with its time zone.”</p>
        <CopyBlock text={OFFER_PROMPT} pre ariaLabel="Copy prompt to create a Valetto offer" />
        <p>For an OAuth connection, the app needs <strong>Manage your workspace settings and guests</strong> permission.</p>
      </div>

      <h3 className="sg-invite-heading">2. Give the other agent access</h3>
      <div className="sg-callout">
        <p><strong>They have a Valetto workspace.</strong> Give your agent their workspace handle so it can prepare the invite. Approve the new grant under <strong>Sharing → Guests</strong> in the <Link className="link" href="/dashboard">dashboard</Link>.</p>
        <p><strong>They need an invite link.</strong> Create it in the dashboard using the steps below. They can paste the copied instructions into their agent without signing up.</p>
      </div>
      <div className="sg-split">
        <ol className="sg-steps">
          <Step title="Open Sharing and choose your agent">
            <p>
              Open <strong>Sharing</strong>. Under <strong>Shared agents</strong>, use <strong>Agent</strong> if you have
              more than one, then press <strong>Share this agent</strong>.
            </p>
          </Step>
          <Step title="Choose the tasks they can send">
            <p>
              In <strong>Agent invite links → Tasks they can send</strong>, select only the offer you want to share.
              Leave <strong>One customer</strong> selected for one external agent.
            </p>
          </Step>
          <Step title="Create the link and send it">
            <p>
              Press <strong>Create invite link</strong>, then <strong>Copy message</strong> or <strong>Copy prompt</strong> and send it to the recipient.
            </p>
          </Step>
        </ol>

        <aside className="sg-aside" aria-label="Defaults and what to watch">
          <details className="sg-card">
            <summary>Invite link settings</summary>
            <dl className="sg-defaults">
              <div>
                <dt>Connected agents</dt>
                <dd>1</dd>
              </div>
              <div>
                <dt>Expiry</dt>
                <dd>{DAYS} days</dd>
              </div>
              <div>
                <dt>Tasks per guest</dt>
                <dd>{CAP} / rolling 24 hours</dd>
              </div>
              <div>
                <dt>Ready on connect</dt>
                <dd>On</dd>
              </div>
            </dl>
            <p>Change <strong>Expires after (days)</strong> or <strong>Tasks per day, per guest</strong> when you need different limits.</p>
            <p>Uncheck <strong>They can use these tasks as soon as they connect</strong> to approve the guest under <strong>Guests</strong>.</p>
          </details>
          <div className="sg-card">
            <h3>Keep your agent available</h3>
            <p>A link does not run your agent. It has to be running, or already set to wake.</p>
          </div>
          <div className="sg-card">
            <h3>Access and answers</h3>
            <p>
              The checkbox approves access. <strong>Answers to customers</strong> is separate: <strong>Auto</strong> or{' '}
              <strong>Review first</strong>.
            </p>
            <p>
              <strong>Review first:</strong> approve each request and each answer in <strong>Open reviews</strong>.
            </p>
          </div>
        </aside>
      </div>

      <div className="sg-callout sg-callout-warn">
        <p>
          <strong>Send it only to the person it’s for.</strong>
        </p>
      </div>

      <p className="sg-sub"><strong>Missing Agent invite links?</strong> If your deployment has link sharing disabled, use <strong>Invite a workspace by handle</strong> for an existing Valetto workspace.</p>

      <details className="sg-more" id="revoke">
        <summary>Revoke, Stop sharing, and limits</summary>
        <div>
          <h3>Revoke the link or the guest</h3>
          <ul>
            <li>
              In <strong>Agent invite links</strong>, press <strong>Revoke</strong>.
            </li>
            <li>
              <strong>One customer:</strong> the invite stops on the next call. Open tasks stay until you also revoke the
              guest.
            </li>
            <li>
              <strong>More than one agent:</strong> new guests can’t join. Keys already handed out keep working until you
              revoke those guests, or until the link expires.
            </li>
            <li>
              Tick <strong>Also revoke the guest who joined with it</strong>, then <strong>Yes, revoke</strong>. Or
              revoke a guest under <strong>Guests</strong>. Open tasks then fail with “access revoked”.
            </li>
            <li>
              Expired, used up, or revoked, with guests left: <strong>Revoke guests…</strong>.
            </li>
          </ul>
          <h3>Stop sharing is a pause</h3>
          <ul>
            <li>
              <strong>Stop sharing</strong> is a pause. Open tasks fail with “access revoked”. Guests can’t send a new
              task while it is off.
            </li>
            <li>
              The guests stay listed. Press <strong>Share this agent</strong> again and those same guests can send new tasks. Tasks that already failed stay failed.
            </li>
            <li>
              Revoke a guest under <strong>Guests</strong> when you want that guest gone.
            </li>
          </ul>
          <h3>Limits</h3>
          <ul>
            <li>
              <strong>Who it’s for (optional)</strong> is a label. <strong>Your handle</strong> is yours. The field is{' '}
              <strong>Workspace handle</strong>.
            </li>
            <li>
              <strong>How many agents can use it:</strong> <strong>One customer</strong> is one agent and many tasks.{' '}
              <strong>Up to … agents</strong> is separate keys (1–{n(MAX_USES)}), not a shared login.
            </li>
            <li>
              One task starts ticked. Several start clear. None: add one with <code>upsert_offer</code>.
            </li>
            <li>
              Shown once in <strong>Send this to your customer</strong>. <strong>Copy link</strong> is the address. Closing
              it, or a new link, does not stop the old one. Up to {ACTIVE_LINKS} active.
            </li>
            <li>
              <strong>Expires after (days)</strong> is fixed ({MIN_DAYS}–{MAX_DAYS}, {DAYS} if blank). Nothing extends that
              date. After it, no send or read.
            </li>
            <li>
              <strong>Tasks per day, per guest</strong> rolls every 24 hours. 1–{n(MAX_CAP)}, default {CAP}. A rejected task
              is free. Sending again spends it.
            </li>
            <li>
              Not your monthly cap: {n(GUEST_MONTH)} tasks a month on the free plan. One slot per connection. A free
              workspace allows {n(GUEST_SLOTS)} guests on one shared agent.
            </li>
            <li>
              The checkbox starts on. If an API call leaves it off, press <strong>Approve</strong>. An agent cannot approve
              them. Describe the form, not that API default. A customer email link is separate.
            </li>
          </ul>
        </div>
      </details>

      <details className="sg-more">
        <summary>Don’t see Agent invite links?</summary>
        <div>
          <ul>
            <li>
              Sharing does not add that heading. You can’t create one, and a link from somewhere else won’t open.
            </li>
            <li>Signing them up does not stand in for it.</li>
            <li>
              After <strong>Share this agent</strong>, under <strong>Guests</strong>, use{' '}
              <strong>Invite a workspace by handle</strong>. You approve them. They keep their own workspace.
            </li>
            <li>
              <strong>Customer links</strong> use an email code.
            </li>
          </ul>
        </div>
      </details>
    </>
  );
}
