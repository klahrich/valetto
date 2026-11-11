import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const page = read('app/(site)/valetto/agent-to-agent/page.tsx');
const home = read('app/(site)/valetto/page.tsx');
const share = read('app/(site)/share/page.tsx');

describe('agent-to-agent landing', () => {
  it('opens with the outcome, the MCP URL, and three equal choices', () => {
    expect(page).toContain('Let your AI agents talk to each other');
    expect(page).toContain('Or share them with someone else');
    expect(page).not.toContain('Let your AI agents hand each other work');
    expect(page).not.toContain('Share an agent, or let yours work together.');
    expect(page).toContain('Get started free');
    expect(page).not.toContain('Get started free — sign in');
    expect(page).not.toContain('What do you want to do?');
    expect(page).toContain('href="/sign-in"');
    expect(page).toContain('href="/share#got-a-link"');
    expect(page).toContain('Paste their message into your agent. You do not sign up.');
    expect(page).toContain("id: 'share'");
    expect(page).toContain("id: 'use'");
    expect(page).toContain('Share my agent');
    expect(page).toContain('Use an agent shared with me');
    expect(page).toContain('The owner approves your workspace. Then your agent can send tasks.');
    expect(page).toContain('Connect it to your own workspace. It can then ask an agent shared with you.');
    expect(page).toContain('A private link does not sign you in.');
    expect(page).toContain('id="mcp-url-h"');
    expect(page).toContain("const SITE = 'https://valetto.tech'");
    expect(page).toContain('const MCP_URL = `${SITE}/api/mcp`');
    expect(page).toContain('text={MCP_URL}');
    expect(page).toContain('ariaLabel="Copy MCP server URL"');
    expect(page).toContain('href="/connect"');
    expect(page).toContain('href="/share"');
    expect(page).toContain('href="#sharing"');
    expect(page).toContain('Connect an app you use');
    expect(page).toContain('Send a private link');
    expect(page).toContain('Invite a workspace by handle');
    expect(page).toContain('ChatGPT, Claude or Cursor. No API key.');
    expect(page).toContain('Share any of your bots with your customers or teammates — only the functions you choose. They don’t need to sign up.');
    expect(page).toContain('>How to share<');
    const tabsCss = read('app/(site)/valetto/agent-to-agent/agent-to-agent.css');
    expect(tabsCss).toContain('.a2a .hw-tabs [role=tab][aria-selected=true]{background:var(--accent);color:var(--accent-ink)}');
    expect(tabsCss).toContain('flex-wrap:nowrap');
    expect(read('app/(site)/how-it-works/Tabs.tsx')).toContain('role="tablist"');
    expect(read('app/(site)/how-it-works/Tabs.tsx')).toContain('ArrowRight');
    expect(read('app/(site)/how-it-works/Tabs.tsx')).toContain("e.key === 'Home'");
    expect(read('app/(site)/how-it-works/Tabs.tsx')).toContain("e.key === 'End'");
    expect(page).toContain(
      'Pick this when they already have a Valetto workspace. Only the approved workspaces will have access to your agents.',
    );
    expect(page).not.toContain('A team that already uses Valetto');
    expect(page).not.toContain('and another team’s agent can send tasks to one of yours once you approve it');
  });

  it('keeps own-account connect distinct from an outside-agent invite', () => {
    const flat = page.replace(/\s+/g, ' ');
    expect(flat).toContain('Invite a workspace by handle');
    expect(flat).toContain('needs its own Valetto workspace');
    expect(flat).toContain('Sign in to Valetto');
    expect(flat).toContain('No API key');
    expect(flat).toContain('They do not sign up');
    expect(flat).toContain('MCP with an authorization header, or the HTTP API');
    expect(flat).toContain('A person signed in presses <b>Approve</b>');
    expect(flat).toContain('Signing them up does not stand in for it');
    expect(page).not.toContain('as shown on the');
    expect(page).not.toMatch(/VALETTO_AGENT_GUESTS|agent_guests_enabled|process\.env|\bflag\b/i);
  });

  it('describes standalone messages the way the API docs do', () => {
    const flat = page.replace(/\s+/g, ' ');
    expect(flat).toContain('standalone inbox message');
    expect(flat).toContain('list_messages');
    expect(flat).toContain('mark_messages_read');
    expect(flat).toContain('completion notice');
    expect(flat).toContain('complete_task');
    expect(flat).toContain('does not start a turn');
    expect(flat).toContain('Add a note to a task, or send a standalone message.');
    expect(flat).toContain('Read standalone messages sent to you, a page at a time, with an unread marker.');
    expect(flat).toContain('Mark the messages you’ve read.');
    expect(page).not.toContain('cannot read it yet');
    expect(page).not.toContain('Start with');
  });

  it('compares tasks and messages without extra billing or guest claims', () => {
    const flat = page.replace(/\s+/g, ' ');
    expect(flat).toContain('Tasks or messages');
    expect(flat).toContain('Use it when you need work done and the answer has to fit a format.');
    expect(flat).toContain('On a shared agent, the offer sets the schema');
    expect(flat).toContain('needs_info');
    expect(flat).toContain('in_review');
    expect(flat).toContain('awaiting_release');
    expect(flat).toContain('An answer that does not fit the schema is rejected, and nothing is saved.');
    expect(flat).toContain('The sender reads the result with');
    expect(flat).toContain('Questions go through');
    expect(flat).toContain('counts on the sender’s monthly allowance and on that share’s daily limit');
    expect(flat).toContain('It does not count on the owner’s monthly allowance.');
    expect(flat).toContain('A free-form note. No schema and no status.');
    expect(flat).toContain('one page at a time, with an unread marker');
    expect(flat).toContain('your task finished');
    expect(flat).toContain('It does not replace the task result.');
    expect(flat).toContain('goes on that task’s thread instead');
    expect(flat).toContain('It stays in your workspace, and it does not count toward the monthly task cap.');
    expect(flat).toContain('It has no message text, and it does not start a turn.');
    expect(flat).toContain('What happens next');
    expect(flat).toContain('only if the prompt skipped it');
    expect(flat).toContain('Check it worked');
    expect(flat).toContain('Most agents that support MCP tools over HTTP');
    expect(flat).toContain('Connect an AI app');
    expect(flat).toContain('Set your workspace handle; it becomes your agents’ address (e.g. <C>@yourteam/reviewer</C>)');
    expect(flat).toContain('enter their handle, like <C>otherco</C>');
    expect(page).not.toContain('their Valetto team name');
    expect(page).not.toContain('@acme/reviewer');
    expect(flat).toContain('Task, with the answer format you expect');
    expect(page).not.toContain('If <b>Agent invite links</b> is not on your Sharing page');
    expect(flat).toContain('A result that matches is saved as <C>done</C>');
    expect(flat).toContain('saved as <C>awaiting_release</C> until they release it');
    expect(flat).toContain('with its own key');
    expect(page).not.toMatch(/isn.t billed|Coming soon|not available to guests/i);
    expect(page).toContain('id="tasks-or-messages"');
  });

  it('keeps setup, commands, and sharing behind closed disclosures that deep links can open', () => {
    // Hash targets sit inside the closed disclosure, so the browser opens it.
    expect(page).toContain('<div className="a2a-body" id="connect">');
    expect(page).toContain('<div className="a2a-body" id="sharing">');
    expect(page).toContain('<div className="a2a-body" id="commands">');
    expect(page).toContain('id="tools"');
    expect(page).toContain('id="faq"');
    expect(page).not.toMatch(/<details[^>]*\sopen[\s>]/);
  });

  it('keeps the FAQ metadata and does not touch the shop homepage or the share guide', () => {
    expect(page).toContain("'@type': 'FAQPage'");
    expect(page).toContain('AGENT_TO_AGENT_TITLE');
    expect(page).toContain('AGENT_TO_AGENT_DESCRIPTION');
    expect(home).toContain('text="Answer every customer."');
    expect(home).not.toContain('/agent-to-agent');
    expect(share).toContain('id="share-your-agent"');
    expect(share).toContain('id="got-a-link"');
  });
});
