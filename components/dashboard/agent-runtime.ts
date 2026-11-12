import type { Agent, Delivery } from './types';

/** Visual tone for a collapsed-row runtime badge. Unknown drivers share `other`. */
export type RuntimeTone = 'orca' | 'herdr' | 'webhook' | 'poll' | 'other';

export type AgentRuntime = {
  /** Driver or mode id. Known values: orca, herdr, webhook, poll, local. */
  id: string;
  label: string;
};

export function agentRuntime(delivery: Delivery): AgentRuntime {
  if (delivery.mode === 'webhook') return { id: 'webhook', label: 'Webhook' };
  if (delivery.mode === 'none') return { id: 'poll', label: 'Poll' };
  const driver = (delivery.driver ?? (delivery.mode === 'herdr' ? 'herdr' : '')).trim();
  if (driver === 'orca') return { id: 'orca', label: 'Orca' };
  if (driver === 'herdr') return { id: 'herdr', label: 'herdr' };
  if (driver) return { id: driver, label: driver };
  return { id: 'local', label: 'Local' };
}

export function runtimeTone(id: string): RuntimeTone {
  if (id === 'orca' || id === 'herdr' || id === 'webhook' || id === 'poll') return id;
  return 'other';
}

/** Expanded-row delivery summary, including host or pane when present. */
export function deliveryLabel(a: Agent): string {
  if (a.delivery.mode === 'webhook') {
    let host = '';
    try {
      host = a.delivery.url ? new URL(a.delivery.url).host : '';
    } catch {
      host = '';
    }
    return `Webhook${host ? ` · ${host}` : ''}`;
  }
  if (a.delivery.mode === 'local' || a.delivery.mode === 'herdr') {
    const driver = a.delivery.driver ?? (a.delivery.mode === 'herdr' ? 'herdr' : '');
    const target = a.delivery.target ?? a.delivery.pane;
    return `Local${driver ? ` · ${driver}` : ''}${target ? ` · ${target}` : ''}`;
  }
  return 'Checks Valetto for new tasks (nothing sent)';
}

/** One agent starts open; a list starts fully collapsed. */
export function initiallyExpandedAgentIds(agents: { id: string }[]): string[] {
  return agents.length === 1 ? [agents[0]!.id] : [];
}
