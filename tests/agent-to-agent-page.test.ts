import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const page = read('app/(site)/valetto/agent-to-agent/page.tsx');
const home = read('app/(site)/valetto/page.tsx');
const share = read('app/(site)/share/page.tsx');

describe('agent-to-agent landing', () => {
  it('opens with the outcome, the MCP URL, and two paths', () => {
    expect(page).toContain('Let your AI agents hand each other work');
    expect(page).toContain("const SITE = 'https://valetto.tech'");
    expect(page).toContain('const MCP_URL = `${SITE}/api/mcp`');
    expect(page).toContain('text={MCP_URL}');
    expect(page).toContain('ariaLabel="Copy MCP server URL"');
    expect(page).toContain('href="/connect"');
    expect(page).toContain('href="/share"');
    expect(page).toContain('Connect an app you use');
    expect(page).toContain('Share with an outside agent');
    expect(page).not.toContain('and another team’s agent can send tasks to one of yours once you approve it');
  });

  it('keeps own-account connect distinct from an outside-agent invite', () => {
    const flat = page.replace(/\s+/g, ' ');
    expect(flat).toContain('Invite a workspace by handle');
    expect(flat).toContain('needs its own Valetto workspace');
    expect(flat).toContain('Sign in to Valetto');
    expect(flat).toContain('No API key');
    expect(flat).toContain('They do not sign up');
    expect(flat).toContain('MCP with an authorization header, or the API');
    expect(flat).toContain('Signing them up does not stand in for it');
    expect(page).not.toContain('as shown on the');
    expect(page).not.toMatch(/VALETTO_AGENT_GUESTS|agent_guests_enabled|process\.env|\bflag\b/i);
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
