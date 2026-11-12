import { createRoot } from 'react-dom/client';
import { Agents } from '@/components/dashboard/Agents';
import type { Agent, AgentKey, Delivery } from '@/components/dashboard/types';

const longName = 'A'.repeat(64);

function delivery(over: Partial<Delivery> = {}): Delivery {
  return {
    mode: 'webhook',
    driver: null,
    target: null,
    url: 'https://hooks.example.invalid/' + 'w'.repeat(48),
    url_set: true,
    url_path_last4: 'wwww',
    auth_type: null,
    secret_set: false,
    token: { set: false, last4: null },
    secret: { set: false, last4: null },
    headers: [],
    pane: null,
    ...over,
  };
}

const agent: Agent = {
  id: 'ag-long',
  name: longName,
  description: 'Longdesc' + 'x'.repeat(48),
  created_at: '2026-11-01T12:00:00.000Z',
  revoked_at: null,
  shared: true,
  delivery: delivery(),
  last_delivered_at: '2026-11-02T12:00:00.000Z',
  last_failed_at: '2026-11-03T12:00:00.000Z',
  last_error: 'connection_refused_' + 'e'.repeat(40),
};

const keys: Record<string, AgentKey[]> = {
  'ag-long': [
    {
      id: 'k1',
      prefix: 'vk_live_' + 'p'.repeat(28),
      created_at: '2026-11-01T12:00:00.000Z',
      revoked_at: null,
      last_used_at: null,
    },
  ],
};

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <div className="dash">
    <main className="dash-main">
      <Agents agents={[agent]} keys={keys} onChange={() => {}} handle="acmeworkspace" />
    </main>
  </div>,
);
