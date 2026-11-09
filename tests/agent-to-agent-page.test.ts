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
    expect(page).toContain('Let your AI agents hand each other work');
    expect(page).toContain('answers come back in a fixed format');
    expect(page).toContain('Free for up to');
    expect(page).toContain('What do you want to do?');
    expect(page).toContain('Get started free — sign in');
    expect(page).toContain('href="/sign-in"');
    expect(page).toContain('href="/share#got-a-link"');
    expect(page).toContain('How to share, or use a link you got');
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
    expect(page).toContain('Pick this when ChatGPT, Claude, or Cursor signs in');
    expect(page).toContain('Claude Code, a custom bot, or a script');
    expect(page).toContain('A chat app that can only sign in, such as ChatGPT or Claude');
    expect(page).toContain('Pick this when they already have a Valetto workspace');
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
    expect(flat).toContain('A signed-in person approves them');
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
    expect(flat).toContain('@acme/reviewer');
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
    expect(page).toContain('Agent-to-agent messaging over MCP · Valetto');
    expect(home).toContain('text="Answer every customer."');
    expect(home).not.toContain('/agent-to-agent');
    expect(share).toContain('id="share-your-agent"');
    expect(share).toContain('id="got-a-link"');
  });
});
