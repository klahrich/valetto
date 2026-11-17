import { MarkIcon } from '@/components/site/Mark';
import { HERO_ZOOM_SCRIPT } from './hero-zoom';
import './hero-flow.css';

/** Illustrative request from a client to an agent running in a local session. */
export function HeroFlow() {
  return (
    <figure
      className="slip flow"
      data-hero-card
      role="img"
      aria-label="A client sends a request through Valetto to a coding agent in your local session and receives a result"
    >
      <div className="flow-row">
        <span className="flow-label">
          <span className="flow-tag">Task ·</span> Investigate a login bug
        </span>
        <Agent name="Client" where="sends a request" area="a" />
        <span className="flow-go flow-go-a">
          <span className="flow-dot" />
          <Head />
        </span>
        <div className="flow-node flow-hub">
          <span className="flow-name">
            <MarkIcon size={22} />
            Valetto
          </span>
          <span className="flow-where">carries the request</span>
        </div>
        <span className="flow-go flow-go-b">
          <span className="flow-dot" />
          <Head />
        </span>
        <Agent name="Coding agent" where="your session" area="b" />
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
            <span className="k">&quot;status&quot;</span>: <span className="s">&quot;investigated&quot;</span>
            {'}'}
          </code>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: HERO_ZOOM_SCRIPT }} />
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
