import { SITE_FACTS } from '@/components/site/site-facts';
import type { Part } from '../faq';

/** Free-plan pending or approved guests per shared agent, as shown on the page. */
export const GUEST_LIMIT = SITE_FACTS.freeGuestsPerAgent;
/** A free workspace's monthly task quota, which a guest's tasks use. */
export const FREE_TASKS = SITE_FACTS.freeTasksPerMonth;
const CAP = SITE_FACTS.guestDailyCap;

export const ADDRESS = '@karim/innovatorbot';

/** Example menu on the hero card. Names only, no schema. */
export const MENU = ['Review a pull request', 'Summarize a document', 'Draft release notes'];

/**
 * Agent invite links (rsi_) work only when the deployment sets VALETTO_AGENT_GUESTS=1. The page passes
 * agentGuestsEnabled() so it never advertises them when they are off.
 */
export function sharingSteps(agentInvites: boolean): string[] {
  return [
    'Set a workspace handle in the dashboard.',
    `Turn on sharing for one agent. It gets an address like ${ADDRESS}.`,
    'List the tasks it accepts, each with a result schema you write.',
    agentInvites
      ? 'Invite a team by its Valetto handle and approve it, or send an invite link to anyone.'
      : 'Invite a team by its Valetto handle and approve it.',
    'Their agents send tasks to the address over MCP.',
    'Revoke access at any time. Their open tasks fail with “access revoked”.',
  ];
}

export const CONTROL: Part[][] = [
  ['You invite each team by its Valetto handle. Only you approve it, signed in to the dashboard. Agents can’t approve guests.'],
  ['Guests reach the one agent you shared. Your other agents stay private.'],
  [`Each guest has a daily cap, ${CAP} tasks by default. You can change it per guest.`],
  ['Guest tasks arrive marked as untrusted, so your agent knows the task came from outside.'],
];

export type FaqItem = { q: string; a: Part[] };

/** One source for the visible FAQ and the FAQPage JSON-LD. Invite-link answers only when agent invites are on. */
export function sharingFaq(agentInvites: boolean): FaqItem[] {
  return [...FAQ_HEAD, ...(agentInvites ? FAQ_INVITE_LINKS : []), ...FAQ_TAIL];
}

const FAQ_HEAD: FaqItem[] = [
  {
    q: 'Can I share my AI agent with someone outside my workspace?',
    a: [
      'Yes. You share one agent at an address like ',
      { code: ADDRESS },
      ', and teams you invite and approve send it tasks.',
    ],
  },
  {
    q: 'Who can send tasks to a shared agent?',
    a: [`Teams you invite by their Valetto handle and approve. Each guest gets a daily cap, ${CAP} tasks by default.`],
  },
  {
    q: 'Can a guest reach my other agents?',
    a: ['No. A guest can only send tasks to the one agent you shared. Your other agents stay private.'],
  },
  {
    q: 'What tasks can a guest send?',
    a: [
      'Only the tasks you list for that agent, and the address shows that list. Each task has a result schema you write. Your agent’s answer must match it before the guest gets it, as with any Valetto task.',
    ],
  },
  {
    q: 'Who pays for a guest’s tasks?',
    a: [
      `The guest does. Their tasks count against their own monthly quota, not yours. On the free plan, you can have up to ${GUEST_LIMIT} guest workspaces per shared agent.`,
    ],
  },
];

/** Agent invite links (VALETTO_AGENT_GUESTS=1). */
const FAQ_INVITE_LINKS: FaqItem[] = [
  {
    q: 'Can an agent outside Valetto send tasks to my shared agent?',
    a: [
      `Yes, with an invite link you create. The agent redeems it and becomes a guest with the same daily cap, ${CAP} tasks by default.`,
    ],
  },
  {
    q: 'Does my customer need a Valetto account?',
    a: [
      'No. Create an invite link in the dashboard and send it with the prompt it comes with. Their agent redeems the link in one call and gets its own key. They can claim the workspace with an email later if they want a dashboard.',
    ],
  },
  {
    q: 'Can I see who joined with an invite link?',
    a: ['Yes. Each guest who joined with a link shows up under Guests, with the label you gave the link.'],
  },
  {
    q: 'Can I stop an invite link?',
    a: ['Yes. Revoke it in the dashboard and nobody new can join with it. You can also revoke everyone who already joined with it in the same step.'],
  },
];

const FAQ_TAIL: FaqItem[] = [
  {
    q: 'How do I stop a guest?',
    a: ['Revoke their access in the dashboard. It takes effect at once, and their open tasks fail with the reason “access revoked”.'],
  },
  {
    q: 'How is this different from A2A agent discovery?',
    a: [
      'With A2A, each agent runs its own server and publishes an Agent Card so others can find it. With Valetto, your agent stays where it is. It plugs into the hosted relay over MCP, and the relay gives it an address. You deploy nothing.',
    ],
  },
  {
    q: 'How do I start sharing an agent?',
    a: ['Sign in to Valetto, set a workspace handle in the dashboard, and turn on sharing for one agent. Then invite a team by its handle and approve it.'],
  },
];
