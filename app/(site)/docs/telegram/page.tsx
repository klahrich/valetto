import Link from 'next/link';
import { valettoMeta } from '@/components/site/valetto/seo';
import { DOCS_CONNECT, DOCS_WAKE, DocsPage, TELEGRAM_DOC } from '../DocsPage';

export const metadata = valettoMeta(
  TELEGRAM_DOC,
  'Chat with a Valetto agent on Telegram',
  'Create a Telegram link for your Valetto agent and send it a message from your phone.',
);

export default function TelegramGuide() {
  return (
    <DocsPage path={TELEGRAM_DOC}>
      <h1>Chat with your agent on Telegram</h1>
      <p className="docs-lead">
        The shared Valetto bot passes messages between your Telegram chat and a connected agent.
        {' '}<Link className="link" href={DOCS_CONNECT}>Connect an agent</Link> if you’re setting up Valetto for the first time.
      </p>
      <section className="docs-section">
        <h2>Send your first message</h2>
        <ol className="docs-steps">
          <li>Open the <Link className="link" href="/dashboard">dashboard</Link>, expand your agent under <strong>Agents</strong>, and click <strong>Create Telegram link</strong>.</li>
          <li>Copy the link while it’s visible, open it in Telegram, and tap <strong>Start</strong>.</li>
          <li>Send a message. Your agent’s reply appears in the same chat.</li>
        </ol>
        <figure className="docs-chat">
          <figcaption>Example Telegram chat</figcaption>
          <p><strong>You</strong> What were you working on last?</p>
          <p><strong>Your agent</strong> I finished the docs update and checked all the links.</p>
        </figure>
        <p><strong>Anyone with the link can message your agent.</strong> Use <strong>Turn off link</strong> in the dashboard to disconnect chats that joined through it.</p>
      </section>
      <section className="docs-section">
        <h2>More ways to use Telegram</h2>
        <details>
          <summary>Pick an agent in a private chat</summary>
          <p>Start with <code>@agent-name</code> or reply to a message from that agent. Send <code>/agents</code> to see who’s connected.</p>
        </details>
        <details>
          <summary>Connect a group chat</summary>
          <p>Add the bot to the group, then send <code>/link &lt;code&gt;</code> using the part after <code>start=</code> in your invite link. A group connects to one agent at a time. The bot forwards every group message it can see.</p>
          <p>A group admin or the person who connected the agent can use <code>/stop</code> to disconnect it.</p>
        </details>
        <details>
          <summary>Check why an agent hasn’t replied</summary>
          <p>Check that your agent is running and <Link className="link" href={DOCS_WAKE}>wake delivery</Link> is set up. It can also pick up messages by polling its Valetto inbox.</p>
        </details>
        <p className="docs-more"><a className="link" href="https://github.com/klahrich/valetto/blob/main/docs/telegram.md">Bot setup for self-hosted Valetto</a></p>
      </section>
    </DocsPage>
  );
}
