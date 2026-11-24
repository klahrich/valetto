import { MarkIcon } from '@/components/site/Mark';
import { HERO_ZOOM_SCRIPT } from './hero-zoom';
import './hero-flow.css';

/** Illustrative handoff to an agent running in a local session. */
export function HeroFlow({ fluid = false, agentHandoff = false }: { fluid?: boolean; agentHandoff?: boolean }) {
  return (
    <figure
      className="slip flow"
      data-hero-card
      role="img"
      aria-label={agentHandoff
        ? 'A builder agent sends a task through Valetto to a reviewer in another session and receives a result'
        : 'A client sends a request through Valetto to a coding agent in your local session and receives a result'}
    >
      <div className="flow-row">
        <span className="flow-label">
          <span className="flow-tag">Task ·</span> {agentHandoff ? 'Review the login fix' : 'Investigate a login bug'}
        </span>
        <Agent name={agentHandoff ? 'Builder' : 'Client'} where={agentHandoff ? 'sends a task' : 'sends a request'} area="a" />
        <span className="flow-go flow-go-a">
          <span className="flow-dot" />
          <Head />
        </span>
        <div className="flow-node flow-hub">
          <span className="flow-name">
            <MarkIcon size={22} />
            Valetto
          </span>
          <span className="flow-where">{agentHandoff ? 'tracks the task' : 'carries the request'}</span>
        </div>
        <span className="flow-go flow-go-b">
          <span className="flow-dot" />
          <Head />
        </span>
        <Agent name={agentHandoff ? 'Reviewer' : 'Coding agent'} where={agentHandoff ? 'another session' : 'your session'} area="b" />
      </div>
      <div className="flow-back">
        <svg className="flow-up" viewBox="0 0 10 8" aria-hidden="true">
          <path d="M5 0L10 8H0Z" />
        </svg>
        <div className="flow-reply">
          <svg className="flow-left" viewBox="0 0 8 10" aria-hidden="true">
            <path d="M8 0L0 5L8 10Z" />
          </svg>
          <div className="flow-reply-head">
            <svg className="flow-check" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="8" />
              <path d="M4.6 8.3l2.2 2.2 4.6-4.8" />
            </svg>
            <span>
              <b>Result</b> · returned
            </span>
          </div>
          <div className="flow-tear" />
          <code translate="no">
            {'{'}
            <span className="k">&quot;status&quot;</span>: <span className="s">&quot;{agentHandoff ? 'reviewed' : 'investigated'}&quot;</span>
            {'}'}
          </code>
        </div>
      </div>
      {!fluid && <script dangerouslySetInnerHTML={{ __html: HERO_ZOOM_SCRIPT }} />}
    </figure>
  );
}

function Head() {
  return (
    <svg className="flow-head" viewBox="0 0 8 10" aria-hidden="true">
      <path d="M0 0L8 5L0 10Z" />
    </svg>
  );
}

function Agent({ name, where, area }: { name: string; where: string; area: string }) {
  return (
    <div className={`flow-node flow-agent flow-${area}`}>
      <span className="flow-name">
        <i className="flow-sq" />
        {name}
      </span>
      <span className="flow-where">{where}</span>
    </div>
  );
}
