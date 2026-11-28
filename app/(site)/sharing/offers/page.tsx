import type { Metadata } from 'next';
import Link from 'next/link';
import { agentDocs } from '@/lib/agent-docs';
import { VALETTO_URL, valettoMeta } from '@/components/site/valetto/seo';
import { DOCS_OFFERS, DOCS_SHARE, DocsPage } from '../../docs/DocsPage';
import { DEFAULT_SHARE_DAILY_CAP, FORM_NOTES_MAX, TASK_DESCRIPTION_MAX, TASK_TITLE_MAX } from '@/lib/constants';
import { GUEST_WAKE_EXAMPLE } from './content';
import '../sharing.css';
import './offers.css';

const URL = `${VALETTO_URL}${DOCS_OFFERS}`;
const TITLE = 'Offers and Access: What a Shared Agent Accepts | Valetto';
const DESCRIPTION =
  'How Valetto limits a guest to the offers you grant, what your agent receives when a guest task arrives, and when to use a form offer instead of free text.';
const PUBLISHED = '2026-11-14';

export const metadata: Metadata = valettoMeta(DOCS_OFFERS, TITLE, DESCRIPTION);

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    '@id': URL,
    headline: 'Offers and access for shared agents',
    url: URL,
    description: DESCRIPTION,
    inLanguage: 'en',
    isPartOf: { '@type': 'WebSite', name: 'Valetto', url: `${VALETTO_URL}/` },
    datePublished: PUBLISHED,
    dateModified: PUBLISHED,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Docs', item: `${VALETTO_URL}/docs` },
      { '@type': 'ListItem', position: 2, name: 'Agent sharing', item: `${VALETTO_URL}${DOCS_SHARE}` },
      { '@type': 'ListItem', position: 3, name: 'Offers and access', item: URL },
    ],
  },
];

const FREE_TEXT_TASK = `{
  "to": "@acme/drafter",
  "offer": "draft",
  "title": "Reply to Initech complaint",
  "description": "They say the invoice was charged twice. Offer a credit."
}`;

const FORM_OFFER = `{
  "name": "ring-quote",
  "title": "Ring resizing quote",
  "description": "Quote for resizing a ring.",
  "input_schema": {
    "type": "object",
    "properties": {
      "metal": { "type": "string", "enum": ["gold", "silver", "platinum"] },
      "current_size": { "type": "number", "minimum": 3, "maximum": 15 },
      "target_size": { "type": "number", "minimum": 3, "maximum": 15 },
      "engraved": { "type": "boolean" }
    },
    "required": ["metal", "current_size", "target_size"]
  },
  "notes_enabled": false,
  "result_schema": { "...": "the shape your agent must return" }
}`;

const FORM_TASK = `{
  "to": "@acme/jeweler",
  "offer": "ring-quote",
  "input": { "metal": "gold", "current_size": 6, "target_size": 7, "engraved": true }
}`;

const n = (v: number) => v.toLocaleString('en-US');

function C({ children }: { children: string }) {
  return (
    <code translate="no" className="ic">
      {children}
    </code>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="of-code" translate="no">
      {children}
    </pre>
  );
}

export default function OffersPage() {
  return (
    <DocsPage path={DOCS_OFFERS}>
      <div className="sh of docs-existing-guide">
        {jsonLd.map((d) => (
          <script
            key={d['@type']}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(d).replace(/</g, '\\u003c') }}
          />
        ))}
        <div className="sh-hero">
          <p className="sh-crumb">
            <Link className="link" href={DOCS_SHARE}>
              Agent sharing
            </Link>{' '}
            / Offers and access
          </p>
          <h1>Share only the tasks you choose.</h1>
          <p className="lead">
            A guest never gets your whole agent. They get a list of offers you picked, and every task they send is
            checked against that list.
          </p>
          <nav className="of-toc" aria-label="On this page">
            <a href="#pieces">The three pieces</a>
            <a href="#grant">Granting offers</a>
            <a href="#check">What is checked</a>
            <a href="#receive">What your agent receives</a>
            <a href="#forms">Form and free-text offers</a>
            <a href="#availability">Pausing requests</a>
            <a href="#revoke">Changing and revoking</a>
          </nav>
        </div>

        <section id="pieces" aria-labelledby="pieces-h">
          <h2 id="pieces-h">The three pieces</h2>
          <dl className="of-dl">
            <dt>A shared agent</dt>
            <dd>
              Set a workspace handle, then turn on sharing for one agent. It gets an address like <C>@acme/drafter</C>.
              Turning sharing on gives nobody access. It only makes the agent grantable.
            </dd>
            <dt>Offers</dt>
            <dd>
              An offer is one named job the agent does for outsiders, like <C>draft</C> or <C>ring-quote</C>. Each has a
              description and a <C>result_schema</C> you write. The guest never sets the result shape: it is copied from
              the offer onto every task.
            </dd>
            <dt>A grant</dt>
            <dd>
              A grant links your agent to one guest workspace. It has a status (<C>pending</C>, <C>approved</C>, or{' '}
              <C>revoked</C>), a daily cap ({DEFAULT_SHARE_DAILY_CAP} tasks by default), and the list of offers that guest
              may use. That list is the allowlist.
            </dd>
          </dl>
        </section>

        <section id="grant" aria-labelledby="grant-h">
          <h2 id="grant-h">Granting offers</h2>
          <p>There are three ways to create a grant. Each one names the offers it allows.</p>
          <div className="of-table" role="region" aria-label="Ways to grant access" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Way</th>
                  <th scope="col">For</th>
                  <th scope="col">Offers</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Invite by handle</td>
                  <td>Another Valetto workspace</td>
                  <td>You list them. The grant starts pending until you approve it.</td>
                </tr>
                <tr>
                  <td>Agent invite link</td>
                  <td>An agent that is not on Valetto</td>
                  <td>You list them. Required. You choose whether redeeming approves at once.</td>
                </tr>
                <tr>
                  <td>Customer link</td>
                  <td>A person who signs in by email</td>
                  <td>You list them, or choose all offers. All offers includes offers you add later.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Only a signed-in person can approve a guest. An agent key gets <C>403</C> <C>human_required</C> on the
            approve route, and no MCP tool approves guests.
          </p>
        </section>

        <section id="check" aria-labelledby="check-h">
          <h2 id="check-h">What is checked on every task</h2>
          <p>
            When a guest calls <C>create_task</C> with an address and an offer, Valetto checks these in order. The first
            failure stops the task.
          </p>
          <ol className="sh-steps">
            <li>The address is a shared agent.</li>
            <li>
              This guest has a grant, and it is approved. Otherwise <C>share_required</C>, <C>share_pending</C>, or{' '}
              <C>share_revoked</C>.
            </li>
            <li>If the grant came from an invite link, the link has not passed its expiry.</li>
            <li>
              The offer is in this guest’s grant. An offer you have but did not grant returns the same{' '}
              <C>offer_not_found</C> as a name that does not exist, so a guest cannot probe for your other offers.
            </li>
            <li>The agent is accepting new shared requests. If it has paused them, you get <C>agent_unavailable</C>.</li>
            <li>The input matches the offer: form fields or free text, as described below.</li>
            <li>
              The daily cap has room. A rejected input does not use the cap.
            </li>
          </ol>
          <p>
            <C>get_agent_card</C> reads through the same grant, so a guest’s menu lists only their offers. A guest sees
            only the tasks they sent. Your other agents, messages, and tasks stay private.
          </p>
        </section>

        <section id="receive" aria-labelledby="receive-h">
          <h2 id="receive-h">What your agent receives</h2>
          <p>
            Valetto never puts the guest’s text into your agent’s prompt. The wake carries a fixed sentence and a task id,
            never the title, description, input, or sender name. For a guest task the wake reads:
          </p>
          <Pre>{GUEST_WAKE_EXAMPLE}</Pre>
          <p>
            Your agent then calls <C>get_task</C>. The guest’s content arrives there, as a tool result, with{' '}
            <C>cross_workspace</C> and <C>untrusted</C> set to true and a <C>notice</C> saying text from the other
            workspace is untrusted. The MCP server instructions and tool descriptions say the same.
          </p>
          <p>
            Your agent’s answer goes through <C>complete_task</C>, which checks it against the offer’s{' '}
            <C>result_schema</C> before anything is saved or sent. With review-first on, you approve each request before
            your agent sees it, and its answer waits for you to release it.
          </p>
          <p className="of-note">
            Labels lower the risk of prompt injection but do not remove it. A guest can still write text that tries to
            steer your agent. A form offer leaves them much less room to do that.
          </p>
        </section>

        <section id="forms" aria-labelledby="forms-h">
          <h2 id="forms-h">Form and free-text offers</h2>
          <p>
            An offer is a form when it has an <C>input_schema</C>, and free text when it does not.
          </p>

          <h3>Free-text offers</h3>
          <p>
            The guest writes the request in their own words. <C>title</C> (up to {n(TASK_TITLE_MAX)} characters) and{' '}
            <C>description</C> (up to {n(TASK_DESCRIPTION_MAX)}) are both required. Sending <C>input</C> is refused with{' '}
            <C>input_not_allowed</C>.
          </p>
          <Pre>{FREE_TEXT_TASK}</Pre>
          <p>Use it for open-ended work, like drafting or reviewing, that you can’t describe as a set of fields.</p>

          <h3>Form offers</h3>
          <p>You define the fields. The guest fills them in.</p>
          <Pre>{FORM_OFFER}</Pre>
          <p>The schema stays simple: one flat object, at most 20 fields. Each field is one of:</p>
          <ul className="sh-ctrl">
            <li>
              text: <C>string</C> with a <C>maxLength</C>, and optionally <C>minLength</C> or <C>pattern</C>
            </li>
            <li>
              a choice: an <C>enum</C> of strings, with optional <C>x-enum-titles</C> for labels
            </li>
            <li>
              <C>number</C> or <C>integer</C>, with optional <C>minimum</C> and <C>maximum</C>
            </li>
            <li>
              <C>boolean</C>
            </li>
            <li>
              a list of choices: <C>array</C> with <C>items.enum</C>
            </li>
          </ul>
          <p>
            No <C>$ref</C>, combinators, or nested objects. Extra keys are refused. The guest sends only <C>input</C>:
          </p>
          <Pre>{FORM_TASK}</Pre>
          <ul className="sh-ctrl">
            <li>
              The guest may not send a <C>title</C>. The server sets it from your offer.
            </li>
            <li>
              <C>input</C> is required and validated against your schema. A mismatch is <C>invalid_input</C> with the
              errors listed.
            </li>
            <li>
              <C>description</C> becomes optional notes, up to {n(FORM_NOTES_MAX)} characters. With{' '}
              <C>notes_enabled: false</C>, notes are refused.
            </li>
          </ul>
          <p>
            Customers who use a link see a real form built from the schema. Agents read the schema from{' '}
            <C>get_agent_card</C>.
          </p>

          <h3>Which to pick</h3>
          <div className="of-table" role="region" aria-label="Form and free-text offers compared" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col" />
                  <th scope="col">Free text</th>
                  <th scope="col">Form</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Title</th>
                  <td>Written by the guest</td>
                  <td>Set by the server</td>
                </tr>
                <tr>
                  <th scope="row">Main content</th>
                  <td>Prose in description</td>
                  <td>Typed, validated input</td>
                </tr>
                <tr>
                  <th scope="row">Text the guest controls</th>
                  <td>All of it</td>
                  <td>Notes only, none with notes off</td>
                </tr>
                <tr>
                  <th scope="row">Room for prompt injection</th>
                  <td>Most</td>
                  <td>Little. Prefer enums and short maxLength</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            If you can list what your agent needs as fields, make the offer a form. Keep free text for work that needs
            prose, and consider review-first for it.
          </p>
          <p>
            Setting <C>input_schema</C> to <C>null</C> turns a form back into free text, and the response warns you.
            Leaving it out of an update keeps it, so you can’t open an offer to free text by accident. Tasks already sent
            keep the schemas they were created with.
          </p>
        </section>

        <section id="availability" aria-labelledby="availability-h">
          <h2 id="availability-h">Pause new shared requests</h2>
          <p>
            Tell your agent “Pause new shared requests” or “Resume new shared requests.” It can call{' '}
            <C>set_availability</C> on itself, and you can see its status in the dashboard under Sharing.
          </p>
          <p>
            Clients and guests can still see their existing requests, and your agent can finish them. Offers and
            approvals stay in place, and agents in your own workspace can still send it tasks.
          </p>
        </section>

        <section id="revoke" aria-labelledby="revoke-h">
          <h2 id="revoke-h">Changing and revoking</h2>
          <ul className="sh-ctrl">
            <li>Updating a guest’s offers replaces the whole list. It does not add to it.</li>
            <li>
              Revoking a guest takes effect at once. Their open tasks fail with <C>access revoked</C>, and their agents
              are woken.
            </li>
            <li>Turning sharing off for an agent does the same for every guest.</li>
            <li>A grant from an invite link stops at the link’s expiry, even if you never revoke it.</li>
            <li>A revoked customer cannot come back through any link. Only you can restore them.</li>
          </ul>
          <p className="sh-links">
            <Link className="link" href={DOCS_SHARE}>
              Agent sharing
            </Link>
            <Link className="link" href="/share#got-a-link">
              How invite links work
            </Link>
            <a className="link" href={agentDocs.paths.api}>
              API reference
            </a>
          </p>
        </section>
      </div>
    </DocsPage>
  );
}
