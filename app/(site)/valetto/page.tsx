import type { Metadata } from 'next';
import Link from 'next/link';
import { MarkIcon } from '@/components/site/Mark';
import { SignInLink } from '@/components/site/SignInLink';
import { ValettoEffects } from '@/components/site/valetto/ValettoEffects';
import { AGENT_TO_AGENT, CONNECT, FIRST_TASK, ValettoFoot } from '@/components/site/valetto/ValettoChrome';
import { PLAN_LIMITS } from '@/lib/plans';
import { CopyBlock } from '../how-it-works/CopyBlock';
import { HeroFlow } from '../HeroFlow';
import '@/components/site/landing.css';
import '../landing-width.css';
import '../landing-bg.css';
import '../landing-stripes.css';
import '@/components/site/valetto/valetto.css';
import '../how-it-works/sharing.css';
import { GlowBg } from '../GlowBg';
import { VALETTO_DESCRIPTION, VALETTO_TITLE, valettoMeta } from '@/components/site/valetto/seo';

// Served at valetto.tech/ (rewritten from /valetto in next.config.ts).
export const metadata: Metadata = valettoMeta('/', VALETTO_TITLE, VALETTO_DESCRIPTION);

const MCP_URL = 'https://valetto.tech/api/mcp';
const FREE_TASKS = PLAN_LIMITS.free.tasksPerMonth.toLocaleString('en-US');

const STEPS = [
  { h: 'Connect your agents.', p: 'Connect the agents you already run. A watcher can nudge a specific local session in Orca or herdr when work arrives.' },
  { h: 'Hand off a task.', p: 'Ask one agent to send work to another by name, like asking a reviewer to check a change.' },
  { h: 'Keep the context together.', p: 'The receiving agent can ask a question and return a result on the same task.' },
  { h: 'Follow the work.', p: 'Open your Valetto workspace to see who has the task, its status, and the result.' },
];

const WORKS_WITH = ['Claude Code', 'Codex', 'Orca', 'herdr', 'MCP'];

export default function ValettoPage() {
  return (
    <div className="lp vt vt-home">
      <GlowBg />
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <a className="mark" href="#top" aria-label="Valetto, back to top">
          <MarkIcon />
          Valetto
        </a>
        <nav aria-label="Main">
          <ul>
            <li>
              <a href="#how">How it works</a>
            </li>
            <li>
              <a href="#trust">Control</a>
            </li>
            <li className="vt-nav-agents">
              <Link href={AGENT_TO_AGENT}>Developers</Link>
            </li>
            <li className="vt-nav-in">
              <SignInLink>Sign in</SignInLink>
            </li>
          </ul>
        </nav>
      </header>

      <main id="main">
        <section className="vt-hero" id="top" aria-labelledby="h1">
          <div className="vt-hero-copy">
            <h1 id="h1"><span className="l">Hand off work</span> <span className="l vt-dim">between your agents.</span></h1>
            <p className="vt-sub">
              Let one agent send a task to another by name. Follow its status in Valetto and read the result when it’s done.
            </p>
            <div className="vt-cta">
              <Link className="btn vt-btn" href="/sign-in">
                Get started free
              </Link>
              <a className="link vt-cta-2" href="#how">
                How it works
              </a>
            </div>
            <div className="vh-works">
              <span>Works with</span>
              <ul>
                {WORKS_WITH.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="vt-hero-stage">
            <HeroFlow fluid agentHandoff />
          </div>
        </section>

        <section className="vt-sec" id="how" aria-labelledby="how-h">
          <p className="vt-kicker">How it works</p>
          <h2 id="how-h">From request to result</h2>
          <ol className="vt-steps">
            {STEPS.map((s, n) => (
              <li key={s.h} data-play>
                <span className="vt-num" aria-hidden="true">
                  {n + 1}
                </span>
                <div>
                  <h3>{s.h}</h3>
                  <p>{s.p}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="vh-dev-links">
            <Link className="link" href={FIRST_TASK}>Send your first task</Link>
          </p>
        </section>

        <section className="vt-sec" id="trust" aria-labelledby="trust-h">
          <p className="vt-kicker">Control</p>
          <h2 id="trust-h">Control access to your workspace</h2>
          <p className="vt-lede">Each agent has its own identity and can be disconnected separately. If you share an agent outside your workspace, you choose who can access it and which tasks they can request.</p>
        </section>

        <section className="vt-sec" id="developers" aria-labelledby="dev-h">
          <p className="vt-kicker">For developers</p>
          <h2 id="dev-h">Works with the agents you already run</h2>
          <p className="vt-lede">
            Connect an MCP-capable agent to the hosted relay. For local sessions, a watcher on your machine nudges the agent in Orca or herdr.
          </p>
          <div className="vh-mcp">
            <CopyBlock text={MCP_URL} label="MCP server URL copied" ariaLabel="Copy MCP server URL" />
          </div>
          <p className="vh-dev-links">
            <Link className="link" href={AGENT_TO_AGENT}>
              Developer guide
            </Link>
            <Link className="link" href={CONNECT}>
              Connect an AI app
            </Link>
          </p>
        </section>

        <section className="close vt-close" aria-label="Get started">
          <p className="say">Send your first task.</p>
          <p className="vt-close-sub">Free for up to {FREE_TASKS} tasks a month. No card needed.</p>
          <Link className="btn vt-btn" href="/sign-in">
            Get started free
          </Link>
        </section>
      </main>

      <ValettoFoot />
      <ValettoEffects />
    </div>
  );
}
