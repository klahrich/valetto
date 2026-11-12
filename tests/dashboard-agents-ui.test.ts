import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Agents } from '@/components/dashboard/Agents';
import {
  agentRuntime,
  deliveryLabel,
  initiallyExpandedAgentIds,
  runtimeTone,
} from '@/components/dashboard/agent-runtime';
import { FreshTelegramLink, isTelegramHttpUrl } from '@/components/dashboard/TelegramLink';
import type { Agent, Delivery } from '@/components/dashboard/types';

function delivery(over: Partial<Delivery> = {}): Delivery {
  return {
    mode: 'none',
    driver: null,
    target: null,
    url: null,
    url_set: false,
    url_path_last4: null,
    auth_type: null,
    secret_set: false,
    token: { set: false, last4: null },
    secret: { set: false, last4: null },
    headers: [],
    pane: null,
    ...over,
  };
}

function agent(over: Partial<Agent> & Pick<Agent, 'id' | 'name'>): Agent {
  return {
    description: null,
    created_at: '2026-11-01T12:00:00.000Z',
    revoked_at: null,
    delivery: delivery(),
    ...over,
  };
}

describe('agent runtime badges', () => {
  it('labels known delivery modes and drivers', () => {
    expect(agentRuntime(delivery({ mode: 'webhook', url: 'https://hooks.example:8443/wake' }))).toEqual({
      id: 'webhook',
      label: 'Webhook',
    });
    expect(agentRuntime(delivery({ mode: 'none' }))).toEqual({ id: 'poll', label: 'Poll' });
    expect(agentRuntime(delivery({ mode: 'local', driver: 'orca', target: 'tab:leaf' }))).toEqual({
      id: 'orca',
      label: 'Orca',
    });
    expect(agentRuntime(delivery({ mode: 'local', driver: 'herdr', target: 'reviewer' }))).toEqual({
      id: 'herdr',
      label: 'herdr',
    });
    expect(agentRuntime(delivery({ mode: 'herdr', driver: null, pane: 'reviewer' }))).toEqual({
      id: 'herdr',
      label: 'herdr',
    });
    expect(agentRuntime(delivery({ mode: 'local', driver: 'tmux', target: 'dev:0' }))).toEqual({
      id: 'tmux',
      label: 'tmux',
    });
    expect(agentRuntime(delivery({ mode: 'local', driver: null }))).toEqual({ id: 'local', label: 'Local' });
  });

  it('maps known ids to distinct tones and unknown drivers to other', () => {
    expect(runtimeTone('orca')).toBe('orca');
    expect(runtimeTone('herdr')).toBe('herdr');
    expect(runtimeTone('webhook')).toBe('webhook');
    expect(runtimeTone('poll')).toBe('poll');
    expect(runtimeTone('tmux')).toBe('other');
    expect(runtimeTone('local')).toBe('other');
  });

  it('keeps the expanded delivery label including host and pane', () => {
    expect(
      deliveryLabel(agent({ id: 'a', name: 'hooks', delivery: delivery({ mode: 'webhook', url: 'https://hooks.example:8443/w' }) })),
    ).toBe('Webhook · hooks.example:8443');
    expect(
      deliveryLabel(
        agent({ id: 'a', name: 'local', delivery: delivery({ mode: 'local', driver: 'orca', target: 'tab:leaf' }) }),
      ),
    ).toBe('Local · orca · tab:leaf');
    expect(deliveryLabel(agent({ id: 'a', name: 'idle', delivery: delivery({ mode: 'none' }) }))).toBe(
      'Checks Valetto for new tasks (nothing sent)',
    );
  });

  it('starts a lone agent expanded and a list collapsed', () => {
    expect(initiallyExpandedAgentIds([{ id: 'only' }])).toEqual(['only']);
    expect(initiallyExpandedAgentIds([{ id: 'a' }, { id: 'b' }])).toEqual([]);
    expect(initiallyExpandedAgentIds([])).toEqual([]);
  });
});

const noop = () => {};

function renderAgents(list: Agent[]) {
  return renderToStaticMarkup(createElement(Agents, { agents: list, keys: {}, onChange: noop, handle: 'acme' }));
}

describe('agent accordion', () => {
  const orca = agent({
    id: 'ag-orca',
    name: 'PlumberBot',
    description: 'Fixes leaks',
    delivery: delivery({ mode: 'local', driver: 'orca', target: 'tab:leaf' }),
  });
  const hooks = agent({
    id: 'ag-hook',
    name: 'Relay',
    delivery: delivery({ mode: 'webhook', url: 'https://hooks.example/w' }),
  });

  it('shows only the name and runtime badge when several agents start collapsed', () => {
    const html = renderAgents([orca, hooks]);
    expect(html).toContain('PlumberBot');
    expect(html).toContain('Relay');
    expect(html).toContain('dash-runtime-orca');
    expect(html).toContain('>Orca</span>');
    expect(html).toContain('dash-runtime-webhook');
    expect(html).toContain('>Webhook</span>');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-expanded="true"');
    expect(html).not.toContain('Fixes leaks');
    expect(html).not.toContain('Joined');
    expect(html).not.toContain('Edit delivery');
    expect(html).not.toContain('Revoke agent');
    expect(html).not.toContain('id="agent-body-ag-orca"');
    expect(html).not.toContain('Checks Valetto');
  });

  it('starts a single agent expanded with the existing details', () => {
    const html = renderAgents([orca]);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('id="agent-body-ag-orca"');
    expect(html).toContain('aria-controls="agent-body-ag-orca"');
    expect(html).toContain('Fixes leaks');
    expect(html).toContain('Joined');
    expect(html).toContain('Local · orca · tab:leaf');
    expect(html).toContain('Edit delivery');
    expect(html).toContain('Revoke agent');
    expect(html).toContain('>Orca</span>');
  });

  it('puts the toggle in a heading and keeps a type=button control', () => {
    const html = renderAgents([orca, hooks]);
    expect(html).toContain('<h3 class="dash-agent-title">');
    expect(html).toMatch(/<button type="button" class="dash-agent-toggle"[^>]*aria-expanded="false"/);
    expect(html).toContain('aria-controls="agent-body-ag-orca"');
  });
});

describe('fresh Telegram link', () => {
  it('accepts only https t.me and telegram.me URLs', () => {
    expect(isTelegramHttpUrl('https://t.me/valetto_tg_bot?start=vtg_abc')).toBe(true);
    expect(isTelegramHttpUrl('https://www.t.me/valetto_tg_bot?start=vtg_abc')).toBe(true);
    expect(isTelegramHttpUrl('https://telegram.me/valetto_tg_bot?start=vtg_abc')).toBe(true);
    expect(isTelegramHttpUrl('http://t.me/valetto_tg_bot?start=vtg_abc')).toBe(false);
    expect(isTelegramHttpUrl('https://example.com/t.me/foo')).toBe(false);
    expect(isTelegramHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isTelegramHttpUrl('not a url')).toBe(false);
  });

  it('renders a tappable t.me link next to the copy action', () => {
    const url = 'https://t.me/valetto_tg_bot?start=vtg_abc';
    const html = renderToStaticMarkup(createElement(FreshTelegramLink, { url, agentName: 'PlumberBot' }));
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Copy Telegram link');
    expect(html).toContain('Open or copy your Telegram link now');
    expect(html).toContain('PlumberBot');
    expect(html).not.toContain('<code');
  });

  it('does not turn a non-Telegram URL into a link', () => {
    const html = renderToStaticMarkup(
      createElement(FreshTelegramLink, { url: 'https://evil.example/phish', agentName: 'PlumberBot' }),
    );
    expect(html).not.toContain('href="https://evil.example/phish"');
    expect(html).toContain('https://evil.example/phish');
    expect(html).toContain('Copy Telegram link');
  });
});
