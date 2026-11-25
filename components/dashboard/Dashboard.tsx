'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Bot, ClipboardList, Plus, Settings2, Share2 } from 'lucide-react';
import { Agents } from './Agents';
import { ConnectedApps } from './ConnectedApps';
import { api, errorText, SIGNED_OUT_EVENT } from './api';
import { EmailPrefs } from './EmailPrefs';
import { JoinCodes, type DocPaths } from './JoinCodes';
import { SetupChecklist } from './SetupChecklist';
import { Sharing } from './Sharing';
import { Tabs } from './Tabs';
import { Tasks } from './Tasks';
import { WatcherKeys } from './WatcherKeys';
import { WorkspaceName } from './WorkspaceName';
import type { Agent, AgentKey, JoinCode } from './types';

type Workspace = { name: string; handle: string | null };

type Loaded = { agents: Agent[]; keys: Record<string, AgentKey[]>; codes: JoinCode[] };

async function fetchAll(): Promise<Loaded> {
  const [{ agents }, { join_codes }] = await Promise.all([
    api<{ agents: Agent[] }>('/api/v1/agents'),
    api<{ join_codes: JoinCode[] }>('/api/v1/join-codes'),
  ]);
  const keyLists = await Promise.all(
    agents.map((a) => api<{ keys: AgentKey[] }>(`/api/v1/agents/${a.id}/keys`).then((r) => [a.id, r.keys] as const)),
  );
  return { agents, keys: Object.fromEntries(keyLists), codes: join_codes };
}

export function Dashboard({
  workspace,
  marketingOptIn,
  origin,
  paths,
  guestLimit,
}: {
  workspace: Workspace;
  /** user.marketing_opt_in, the same value GET /api/v1/auth/me returns. */
  marketingOptIn: boolean;
  origin: string;
  paths: DocPaths;
  /** Free-plan guest workspaces per shared agent, or null when the plan has no cap. */
  guestLimit: number | null;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [handle, setHandle] = useState(workspace.handle);
  const [keys, setKeys] = useState<Record<string, AgentKey[]>>({});
  const [codes, setCodes] = useState<JoinCode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  const router = useRouter();

  useEffect(() => {
    const onSignedOut = () => router.replace('/sign-in');
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [router]);

  const apply = useCallback((data: Loaded | Error) => {
    if (data instanceof Error) {
      setError(errorText(data));
    } else {
      setAgents(data.agents);
      setKeys(data.keys);
      setCodes(data.codes);
      setError('');
    }
    setLoaded(true);
  }, []);

  const load = useCallback(() => fetchAll().then(apply, (err: Error) => apply(err)), [apply]);

  useEffect(() => {
    let cancelled = false;
    fetchAll().then(
      (data) => {
        if (!cancelled) apply(data);
      },
      (err: Error) => {
        if (!cancelled) apply(err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const refresh = () => {
    void load();
    setTick((t) => t + 1);
  };

  const activeAgents = agents.filter((agent) => !agent.revoked_at);
  const localAgents = activeAgents.filter((agent) => agent.delivery.mode === 'local' || agent.delivery.mode === 'herdr');
  const online = localAgents.filter((agent) => agent.watcher_online).length;

  return (
    <>
      <section className="dash-hero dash-workspace-hero" aria-labelledby="ws-h">
        <div className="dash-workspace-identity">
          <WorkspaceName initialName={workspace.name} />
          {handle ? <a className="dash-workspace-handle" href="#sharing" title="Manage workspace sharing">@{handle}</a> : null}
        </div>
        <a className="dash-connect-button" href="#connect"><Plus size={17} aria-hidden="true" /> Connect agent</a>
      </section>
      {error ? (
        <p className="dash-err" role="alert">
          {error}{' '}
          <button type="button" className="dash-textbtn" onClick={refresh}>
            Try again
          </button>
        </p>
      ) : null}
      <Tabs
        label="Dashboard sections"
        tabs={[
          {
            id: 'workspace',
            label: 'Agents',
            icon: <Bot size={17} aria-hidden="true" />,
            anchors: ['agents', 'connect', 'jc-h', 'jc-pending-h'],
            content: (
              <div className="dash-overview-grid">
                <div className="dash-stack">
                  {loaded ? <Agents agents={agents} keys={keys} onChange={refresh} handle={handle} /> : (
                    <section className="dash-card" id="agents" aria-busy="true">
                      <h2>Agents</h2><p className="dash-muted">Loading agents…</p>
                    </section>
                  )}
                  <JoinCodes codes={codes} agents={agents} origin={origin} paths={paths} onChange={refresh} />
                </div>
                {loaded && !error ? (
                  <aside className="dash-stack" aria-label="Workspace overview">
                    <section className="dash-card dash-delivery-summary" aria-labelledby="delivery-summary-h">
                      <h2 id="delivery-summary-h">Delivery overview</h2>
                      <dl>
                        <div><dt>Local watchers online</dt><dd>{online} / {localAgents.length}</dd></div>
                        <div><dt>Webhook agents</dt><dd>{activeAgents.filter((agent) => agent.delivery.mode === 'webhook').length}</dd></div>
                        <div><dt>Polling agents</dt><dd>{activeAgents.filter((agent) => agent.delivery.mode === 'none').length}</dd></div>
                      </dl>
                    </section>
                    <SetupChecklist handle={handle} agents={agents} codes={codes} />
                  </aside>
                ) : null}
              </div>
            ),
          },
          {
            id: 'tasks',
            label: 'Tasks',
            icon: <ClipboardList size={17} aria-hidden="true" />,
            anchors: ['tasks-h'],
            content: <Tasks refreshKey={tick} />,
          },
          {
            id: 'sharing',
            label: 'Sharing',
            icon: <Share2 size={17} aria-hidden="true" />,
            anchors: ['share-how-h', 'share-handle-h', 'share-agents-h'],
            content: loaded ? (
              <Sharing agents={agents} handle={handle} onHandleSaved={setHandle} guestLimit={guestLimit} onChange={refresh} />
            ) : null,
          },
          {
            id: 'settings',
            label: 'Settings',
            icon: <Settings2 size={17} aria-hidden="true" />,
            anchors: ['connected-apps', 'watchers', 'emails-h'],
            content: <><ConnectedApps /><WatcherKeys /><EmailPrefs initialOptIn={marketingOptIn} /></>,
          },
        ]}
      />
    </>
  );
}
