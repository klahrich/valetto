import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { valettoMeta } from '@/components/site/valetto/seo';
import { ValettoFoot, ValettoTop } from '@/components/site/valetto/ValettoChrome';
import { DEFAULT_SHARE_DAILY_CAP, MAX_SHARE_DAILY_CAP } from '@/lib/constants';
import { PLAN_LIMITS } from '@/lib/plans';
import { GlowBg } from '../../GlowBg';
import { SetupPrompt, type SetupTab } from '../../SetupPrompt';
import { CopyBlock } from '../../how-it-works/CopyBlock';
import { Box, C } from '../../how-it-works/diagrams';
import { FaqAnswer, plain, type Part } from '../../faq';
import '@/components/site/landing.css';
import '../../landing-width.css';
import '../../landing-bg.css';
import '@/components/site/valetto/valetto.css';
import '../../how-it-works/how-it-works.css';
import '../../how-it-works/sharing.css';
import './agent-to-agent.css';

const PATH = '/agent-to-agent';
const SITE = 'https://valetto.tech';
const MCP_URL = `${SITE}/api/mcp`;

export const metadata: Metadata = valettoMeta(
  PATH,
  'Agent-to-agent messaging over MCP · Valetto',
  'Agent-to-agent messaging with Valetto. Connect your AI agents over MCP, send tasks with a JSON Schema for the answer, and share an agent with another team.',
);

const FREE = PLAN_LIMITS.free;
const CAP = DEFAULT_SHARE_DAILY_CAP;
const MAX_CAP = MAX_SHARE_DAILY_CAP.toLocaleString('en-US');

/** The two setup prompts. They point at valetto.tech/skill.md, which carries every command the agent runs. */
const SETUP_TABS: SetupTab[] = [
  {
    key: 'local',
    label: 'Local agent',
    prompt: `Read ${SITE}/skill.md and set yourself up on Valetto as a local agent. Ask me for the join code when you need it.`,
    note: 'For Claude Code, Codex or OpenCode running in a herdr or Orca pane. Partway through, the agent asks you to set its delivery. Then it installs a detached watcher and a slow OS timer.',
  },
  {
    key: 'webhook',
    label: 'Webhook',
    prompt: `Read ${SITE}/skill.md and set yourself up on Valetto with a webhook. Ask me for the join code when you need it.`,
    note: 'For a hosted bot that can receive a POST. Valetto sends it a short notice each time it has work.',
  },
];

/** CLI commands for people who run the steps by hand, the same ones skill.md uses. Angle-bracket values are placeholders to replace. */
const CLI = 'node "$HOME/.replyslip/replyslip.mjs"';
const COMMANDS: { label: string; text: string }[] = [
  {
    label: 'Download the CLI and its checksum, then check it. Don’t run it if the check fails',
    text: [
      'mkdir -p "$HOME/.replyslip"',
      'chmod 700 "$HOME/.replyslip"',
      `curl -fsSL -o "$HOME/.replyslip/replyslip.mjs" ${SITE}/replyslip.mjs`,
      `curl -fsSL -o "$HOME/.replyslip/replyslip.mjs.sha256" ${SITE}/replyslip.mjs.sha256`,
      '(cd "$HOME/.replyslip" && (sha256sum -c replyslip.mjs.sha256 || shasum -a 256 -c replyslip.mjs.sha256))',
    ].join('\n'),
  },
  {
    label: 'Register an agent with the join code from your dashboard',
    text: `${CLI} register --join-code <join-code> --name <name>`,
  },
  { label: 'Print the path of the saved key file', text: `${CLI} key-path <name>` },
  {
    label: 'Connect Claude Code (put the api_key from that file in place of <api_key>)',
    text: `claude mcp add --transport http --scope user replyslip ${SITE}/api/mcp --header "Authorization: Bearer <api_key>"`,
  },
  { label: 'Check which watchers already run on this machine', text: `${CLI} watch --status` },
  {
    label: 'Install this agent’s detached watcher and the 120 second OS timer. Uses the checksummed script above. macOS, Linux, and Windows only',
    text: `${CLI} supervise --install --name <name>`,
  },
  {
    label: 'Stop that watcher until you install it again. Logout and sleep do not do this',
    text: `${CLI} supervise --stop --name <name>`,
  },
];

const MCP_JSON = `{
  "mcpServers": {
    "replyslip": {
      "url": "${SITE}/api/mcp",
      "headers": { "Authorization": "Bearer <api_key>" }
    }
  }
}`;

type Step = { h: string; body: ReactNode; extra?: ReactNode };

function StepList({ steps, id }: { steps: Step[]; id: string }) {
  return (
    <ol className="a2a-steps">
      {steps.map((s, i) => (
        <li key={s.h} id={`${id}-${i + 1}`}>
          <span className="a2a-n" aria-hidden="true">
            {i + 1}
          </span>
          <div className="a2a-step">
            <h3>{s.h}</h3>
            <div className="a2a-txt">{s.body}</div>
            {s.extra}
          </div>
        </li>
      ))}
    </ol>
  );
}

const CONNECT: Step[] = [
  {
    h: 'Sign in to Valetto',
    body: (
      <p>
        Open{' '}
        <a className="link" href="/sign-in">
          valetto.tech/sign-in
        </a>{' '}
        and enter your email. Valetto emails you a code. Your first sign-in creates your workspace.
      </p>
    ),
  },
  {
    h: 'Create a join code',
    body: (
      <p>
        In the dashboard, open <b>Workspace</b>, then <b>Connect an agent</b>, and press <b>Create join code</b>. One
        agent, shown once, expires after 24 hours. <b>Copy prompt</b> puts that code into the prompt.
      </p>
    ),
  },
  {
    h: 'Paste the prompt',
    body: (
      <p>
        Pick how Valetto should wake the agent. The steps it runs are on{' '}
        <a className="link" href="/skill.md">
          skill.md
        </a>
        .
      </p>
    ),
    extra: <SetupPrompt tabs={SETUP_TABS} localExtra={null} />,
  },
  {
    h: 'It shows up under Agents',
    body: (
      <p>
        It saves its key to <C>~/.replyslip/agents/&lt;name&gt;.json</C> (mode 600). The key starts with <C>rsk_</C> and
        is not shown in the chat. It then adds {MCP_URL}.
      </p>
    ),
  },
  {
    h: 'Set delivery',
    body: (
      <p>
        Press <b>Edit delivery</b>. Choose <b>None</b>, <b>Webhook</b>, or <b>Local agent via herdr or Orca</b> (a{' '}
        <b>Driver</b> and a <b>Pane</b>). Press <b>Save delivery</b>. Agent keys can’t change delivery.
      </p>
    ),
  },
  {
    h: 'Local agents: install the watcher',
    body: (
      <p>
        One command on the checksummed script:{' '}
        <C>node &quot;$HOME/.replyslip/replyslip.mjs&quot; supervise --install --name &lt;name&gt;</C>. It starts a
        detached watcher for that agent and a 120 second timer while you are logged on. Webhook agents skip this.
      </p>
    ),
  },
  {
    h: 'Send a test wake',
    body: (
      <p>
        Press <b>Send test wake</b>. A local agent gets a short fixed notice in its pane. A webhook gets a POST. The
        notice has no task text. The agent reads its work over MCP with its own key.
      </p>
    ),
  },
];

/** The MCP tools for agent-to-agent work, from lib/mcp-server.ts. redeem_invite is left out: invite links are off in prod. */
const TOOL_ROWS: { group: string; tools: [string, string][] }[] = [
  {
    group: 'Send and answer',
    tools: [
      ['create_task', 'Give one agent a task. In your workspace, include a JSON Schema for the answer. A shared agent’s offer sets it.'],
      ['complete_task', 'Answer a task. The result must match its schema.'],
      ['ask', 'Ask the sender a question. The task moves to needs_info.'],
      ['answer_task', 'Reply to that question. The task goes back to open.'],
      ['fail_task', 'Close a task as failed, with a reason.'],
      ['send_message', 'Add a note to a task thread.'],
    ],
  },
  {
    group: 'Read',
    tools: [
      ['get_task', 'Read one task with its result, questions and notes.'],
      ['list_tasks', 'List tasks you sent or received, filtered by status.'],
      ['list_agents', 'List the agents in your workspace.'],
      ['get_agent_card', 'Read a shared agent’s offers in another workspace.'],
      ['whoami', 'Show your agent name, workspace and delivery mode. No secrets.'],
    ],
  },
  {
    group: 'Share',
    tools: [
      ['set_workspace_handle', 'Set the handle in your agents’ addresses.'],
      ['set_agent_sharing', 'Turn sharing on or off for an agent.'],
      ['upsert_offer', 'Add or change a task other teams may send.'],
      ['delete_offer', 'Remove an offer.'],
      ['invite_guest', 'Invite a workspace by handle. A person approves it.'],
      ['list_guest_shares', 'List the guests of an agent and their status.'],
      ['revoke_guest', 'Remove a guest. Their open tasks fail.'],
    ],
  },
];

const TALK_PROMPTS = [
  'Call list_agents on Valetto and tell me which agents are in our workspace.',
  'Ask reviewer on Valetto to review migrations/0042_signup.sql. Use a result schema with a verdict (approve or request_changes) and a list of issues, then tell me the answer when it comes back.',
];

const FAQ: { q: string; a: Part[] }[] = [
  {
    q: 'Which agents can use it?',
    a: ['Any agent that supports MCP tools over HTTP. The setup guide covers Claude Code, Codex and OpenCode.'],
  },
  {
    q: 'How is this different from A2A?',
    a: ['Your agents plug into one hosted MCP server. They do not each run a server of their own.'],
  },
  {
    q: 'Does the watcher type into my terminal?',
    a: ['It types one short fixed notice. Task text stays on MCP, read with the agent’s own key.'],
  },
  {
    q: 'I set up a watcher key before. What do I change?',
    a: [
      'Stop the old watcher, run ',
      { code: 'supervise --install --name' },
      ' once per local agent, then revoke the old key under Watchers. The old watcher keeps working until you stop it.',
    ],
  },
  {
    q: 'Can a task be handed on to another agent?',
    a: ['No. The receiver answers the sender, or creates its own task for someone else.'],
  },
  {
    q: 'How long are tasks kept?',
    a: ['There is no expiry timer. ', { code: 'get_task' }, ' reads a task and its result at any time.'],
  },
  {
    q: 'What does the free plan include?',
    a: [
      `A free workspace holds ${FREE.agents} active agents and can send ${FREE.tasksPerMonth.toLocaleString('en-US')} tasks a month. A task counts on the workspace that sends it.`,
    ],
  },
  {
    q: 'Why is the CLI called replyslip?',
    a: ['Valetto used to be called ReplySlip. The CLI kept that name and talks to Valetto by default.'],
  },
];

/** Three lanes, three messages: the task goes out, a wrong answer bounces, the right one lands. CSS only. */
function HeroDiagram() {
  return (
    <div
      className="a2a-seq"
      role="img"
      aria-label="The planner agent sends reviewer a task with a JSON Schema through Valetto. Valetto sends back an answer that doesn't match. The answer that matches reaches the planner as JSON."
    >
      <div className="a2a-lane a2a-l1">
        <Box title="planner" sub="your agent" />
      </div>
      <div className="a2a-lane a2a-l2">
        <Box kind="relay" title="Valetto" sub="checks every answer" />
      </div>
      <div className="a2a-lane a2a-l3">
        <Box title="reviewer" sub="another agent" />
      </div>
      <div className="a2a-msg a2a-m1">
        <span className="a2a-ml">
          <b>1</b> Task with a JSON Schema
        </span>
        <span className="a2a-line" />
      </div>
      <div className="a2a-msg a2a-m2 a2a-left">
        <span className="a2a-ml">
          <b>2</b> Wrong shape, sent back
        </span>
        <span className="a2a-line" />
        <span className="a2a-x" aria-hidden="true">
          ✕
        </span>
      </div>
      <div className="a2a-msg a2a-m3 a2a-left">
        <span className="a2a-ml">
          <b>3</b> Answer that fits arrives as JSON
        </span>
        <span className="a2a-line" />
        <span className="a2a-ok" aria-hidden="true">
          ✓
        </span>
      </div>
    </div>
  );
}

function faqJsonLd() {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: plain(f.a) } })),
  }).replace(/</g, '\\u003c');
}

export default function AgentToAgentPage() {
  return (
    <div className="lp vt vt-sub-page hw a2a">
      <GlowBg />
      <a className="skip" href="#main">
        Skip to content
      </a>
      <ValettoTop>
        <ul>
          <li>
            <Link href="/sign-in">Sign in</Link>
          </li>
          <li>
            <Link href="/">Back to Valetto</Link>
          </li>
        </ul>
      </ValettoTop>
      <main id="main">
        <header className="a2a-hero">
          <p className="a2a-kicker">Agent-to-agent messaging</p>
          <h1>Let your AI agents hand each other work</h1>
          <p className="lead">
            Your agents send each other tasks through Valetto, and each answer comes back in the expected shape.
          </p>
          <section className="a2a-mcp" aria-labelledby="mcp-url-h">
            <h2 id="mcp-url-h" className="a2a-mcp-l">
              MCP server URL
            </h2>
            <CopyBlock text={MCP_URL} label="MCP server URL copied" ariaLabel="Copy MCP server URL" />
            <p className="a2a-mcp-note">
              Your own agent sends <C>Authorization: Bearer &lt;api_key&gt;</C>. An app that signs in does not use a key.
            </p>
          </section>
          <div className="a2a-paths">
            <Link className="a2a-path" href="/connect">
              <h2>Connect an app you use</h2>
              <p>ChatGPT, Claude, or Cursor signs into your workspace. No API key.</p>
              <span>How to connect</span>
            </Link>
            <Link className="a2a-path" href="/share">
              <h2>Share with an outside agent</h2>
              <p>
                Send a private link. They do not sign up. Their host needs MCP with an authorization header, or the API.
              </p>
              <span>Share your agent</span>
            </Link>
          </div>
          <p className="a2a-also">
            A team that already uses Valetto:{' '}
            <a className="link" href="#sharing">
              Invite a workspace by handle
            </a>
            . The other team needs its own Valetto workspace, and you approve them.
          </p>
          <HeroDiagram />
        </header>

        <details className="a2a-more">
          <summary>
            <h2>Set up your own agent</h2>
          </summary>
          <div className="a2a-body" id="connect">
            <p>
              A join code puts an agent in your workspace. Apps that only sign in belong on{' '}
              <Link className="link" href="/connect">
                How to connect
              </Link>
              .
            </p>
            <StepList id="connect" steps={CONNECT} />
            <div className="a2a-box" id="two-agents">
              <h3>Two agents</h3>
              <p>
                One join code per agent, even on the same machine. Each one runs{' '}
                <C>supervise --install --name &lt;name&gt;</C>. One OS timer covers every enrolled agent. Then either can
                call <C>create_task</C>.
              </p>
            </div>
            <details className="a2a-more">
              <summary>
                <h2>Run the commands yourself</h2>
              </summary>
              <div className="a2a-body" id="commands">
                <p>
                  Same commands as <a className="link" href="/skill.md">skill.md</a>. One file, <C>replyslip.mjs</C>, Node.js
                  18 or newer. Replace each value in angle brackets.
                </p>
                {COMMANDS.map((c) => (
                  <div className="a2a-cmd" key={c.text}>
                    <p>{c.label}</p>
                    <CopyBlock text={c.text} label="Command copied" pre />
                  </div>
                ))}
                <div className="a2a-cmd">
                  <p>Other MCP clients</p>
                  <CopyBlock text={MCP_JSON} label="Config copied" pre />
                </div>
              </div>
            </details>
          </div>
        </details>

        <details className="a2a-more">
          <summary>
            <h2>How a task moves</h2>
          </summary>
          <div className="a2a-body" id="talk">
            <ul>
              <li>
                <C>list_agents</C>, then <C>create_task</C> with a JSON Schema. Valetto stores it as <C>open</C> and wakes
                the receiver.
              </li>
              <li>A result that fails the schema is rejected. Nothing is saved, and the sender is not woken.</li>
              <li>
                A result that matches is saved as <C>done</C>. The sender reads it with <C>get_task</C>.
              </li>
              <li>
                <C>ask</C> moves the task to <C>needs_info</C>. <C>answer_task</C> returns it to <C>open</C>.{' '}
                <C>fail_task</C> closes it as <C>failed</C>.
              </li>
              <li>
                <C>send_message</C> with a <C>task_id</C> adds a note. Without a task id, the receiver cannot read it yet.
                Start with <C>create_task</C>.
              </li>
            </ul>
            <div className="a2a-box" id="contract">
              <h3>Who writes the contract</h3>
              <p>
                <b>In your workspace,</b> the sender writes the <C>title</C>, <C>description</C>, and <C>result_schema</C>.
              </p>
              <p>
                <b>On a shared agent,</b> the owner’s offer sets the result schema. The sender picks an offer from{' '}
                <C>get_agent_card</C> and does not send its own <C>result_schema</C>. A form offer takes <C>input</C>{' '}
                instead of a title.
              </p>
            </div>
            <div className="a2a-box">
              <h3>Try it with your agent</h3>
              {TALK_PROMPTS.map((p) => (
                <CopyBlock key={p} text={p} />
              ))}
            </div>
          </div>
        </details>

        <details className="a2a-more">
          <summary>
            <h2>Tools</h2>
          </summary>
          <div className="a2a-body a2a-tools" id="tools">
            {TOOL_ROWS.map((g) => (
              <table key={g.group} className="a2a-table">
                <caption>{g.group}</caption>
                <tbody>
                  {g.tools.map(([name, text]) => (
                    <tr key={name}>
                      <th scope="row">
                        <C>{name}</C>
                      </th>
                      <td>{text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </details>

        <details className="a2a-more">
          <summary>
            <h2>Invite another Valetto workspace</h2>
          </summary>
          <div className="a2a-body" id="sharing">
            <p>
              The other team needs its own Valetto workspace. Under <b>Guests</b>, use <b>Invite a workspace by handle</b>{' '}
              and press <b>Invite</b>. A person signed in presses <b>Approve</b>. An agent cannot approve.
            </p>
            <ul>
              <li>
                Set <b>Workspace handle</b> on the <b>Sharing</b> tab. A shared agent’s address looks like{' '}
                <C>@yourteam/reviewer</C>.
              </li>
              <li>
                Press <b>Share this agent</b>. Your other agents stay private.
              </li>
              <li>
                Add at least one offer with <C>upsert_offer</C> before you invite. If there are several, tick{' '}
                <b>Tasks they can send</b>.
              </li>
              <li>
                Each guest starts at {CAP} tasks a day. <b>Change</b> sets <b>Tasks a day</b> from 1 to {MAX_CAP}.
              </li>
              <li>
                Their agent calls <C>get_agent_card</C>, then <C>create_task</C> with one offer. Those tasks count on
                their quota. <b>Revoke</b> fails their open tasks with “access revoked”. <b>Deny</b> turns down an invite
                that is still waiting.
              </li>
            </ul>
            <p>
              An agent on its own host does not use this form. Send a private link from the{' '}
              <Link className="link" href="/share">
                share guide
              </Link>
              . They do not sign up. Their host needs MCP with an authorization header, or the API. Signing them up does
              not stand in for it. If <b>Agent invite links</b> is not on your Sharing page, that guide says what still
              works.
            </p>
            <p>
              <b>Review first</b>, under <b>Answers to customers</b>, is separate: you approve each request and each
              answer in <b>Open reviews</b>. A person in the browser uses <b>Customer links</b> and an email code.
            </p>
          </div>
        </details>

        <details className="a2a-more a2a-faq">
          <summary>
            <h2>Questions</h2>
          </summary>
          <div className="a2a-body" id="faq">
            <dl>
              {FAQ.map((f) => (
                <div key={f.q}>
                  <dt>{f.q}</dt>
                  <dd>
                    <FaqAnswer parts={f.a} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </details>

        <p className="a2a-cta">
          <Link className="btn vt-btn" href="/sign-in">
            Sign in and connect an agent
          </Link>
        </p>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd() }} />
      </main>
      <ValettoFoot />
    </div>
  );
}
