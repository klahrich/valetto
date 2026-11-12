'use client';

import { useEffect, useRef, useState } from 'react';
import { api, errorText } from './api';
import { agentRuntime, deliveryLabel, initiallyExpandedAgentIds, runtimeTone, type AgentRuntime, type RuntimeTone } from './agent-runtime';
import { LocalTime } from './LocalTime';
import { OnceSecret } from './CopyButton';
import { DeliveryPanel } from './DeliveryPanel';
import { TelegramLinkPanel } from './TelegramLink';
import { WakeUrlPanel } from './WakeUrl';
import type { Agent, AgentKey, NewAgentKey } from './types';

function RuntimeIcon({ tone }: { tone: RuntimeTone }) {
  const common = { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true as const, focusable: false };
  if (tone === 'orca') {
    return (
      <svg {...common}>
        <rect x="2.5" y="3" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5 6.5h6M5 9h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (tone === 'herdr') {
    return (
      <svg {...common}>
        <circle cx="8" cy="5" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="4.5" cy="11" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="11.5" cy="11" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  if (tone === 'webhook') {
    return (
      <svg {...common}>
        <path d="M4 8h8M9.5 5.5 12 8l-2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === 'poll') {
    return (
      <svg {...common}>
        <path d="M12.5 8A4.5 4.5 0 1 1 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M8 2v3l2.2-.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="3" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function RuntimeBadge({ runtime }: { runtime: AgentRuntime }) {
  const tone = runtimeTone(runtime.id);
  return (
    <span className={`dash-runtime dash-runtime-${tone}`}>
      <RuntimeIcon tone={tone} />
      {runtime.label}
    </span>
  );
}

/** Last wake outcome per agent, from GET /api/v1/agents. Shows nothing until a wake has been attempted. */
function DeliveryHealth({ a }: { a: Agent }) {
  if (!a.last_delivered_at && !a.last_failed_at) {
    return a.delivery.mode === 'none' ? null : <p className="dash-muted dash-health">No wakes sent yet.</p>;
  }
  const failedLast =
    !!a.last_failed_at && (!a.last_delivered_at || new Date(a.last_failed_at).getTime() > new Date(a.last_delivered_at).getTime());
  return (
    <p className="dash-muted dash-health">
      <span>Last delivered <LocalTime iso={a.last_delivered_at} /></span>
      {a.last_failed_at ? (
        <>
          {' · '}
          <span className={failedLast ? 'dash-health-bad' : undefined}>
            Last failed <LocalTime iso={a.last_failed_at} />
            {a.last_error ? (
              <>
                : <span translate="no">{a.last_error}</span>
              </>
            ) : null}
          </span>
        </>
      ) : null}
    </p>
  );
}

export function Agents({
  agents,
  keys,
  onChange,
  handle,
}: {
  agents: Agent[];
  keys: Record<string, AgentKey[]>;
  onChange: () => void;
  /** Workspace handle, for a shared agent's @handle/name address. */
  handle: string | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [newKey, setNewKey] = useState<{ agentId: string; key: NewAgentKey } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(initiallyExpandedAgentIds(agents)));
  const toggled = useRef(false);

  useEffect(() => {
    if (toggled.current || agents.length !== 1) return;
    const only = agents[0]!.id;
    setOpenIds((prev) => (prev.has(only) ? prev : new Set([only])));
  }, [agents]);

  function toggleOpen(id: string) {
    toggled.current = true;
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (err) {
      setError({ id, text: errorText(err) });
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  const sorted = [...agents].sort((a, b) => Number(!!a.revoked_at) - Number(!!b.revoked_at));

  return (
    <section className="dash-card" id="agents" aria-labelledby="ag-h">
      <div className="dash-card-head">
        <div>
          <h2 id="ag-h">Agents</h2>
          <p className="dash-muted">
            Each agent signs its calls with its own key. Keys are stored as hashes, so only the prefix is shown here.
          </p>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="dash-empty">No agents yet. Create a join code above and give it to your first agent.</p>
      ) : (
        <ul className="dash-agents">
          {sorted.map((a) => {
            const agentKeys = keys[a.id] ?? [];
            const revoked = !!a.revoked_at;
            const expanded = openIds.has(a.id);
            const runtime = agentRuntime(a.delivery);
            const panelId = `agent-body-${a.id}`;
            const toggleId = `agent-toggle-${a.id}`;
            return (
              <li key={a.id} className={`${revoked ? 'dash-agent is-revoked' : 'dash-agent'}${expanded ? ' is-open' : ''}`}>
                <h3 className="dash-agent-title">
                  <button
                    type="button"
                    className="dash-agent-toggle"
                    id={toggleId}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => toggleOpen(a.id)}
                  >
                    <span className="dash-agent-toggle-main">
                      <span translate="no">{a.name}</span>
                      {revoked ? <span className="dash-pill dash-pill-failed">revoked</span> : null}
                      <RuntimeBadge runtime={runtime} />
                    </span>
                    <span className="dash-agent-chevron" aria-hidden="true" />
                  </button>
                </h3>
                {expanded ? (
                <div className="dash-agent-body" id={panelId} role="region" aria-labelledby={toggleId}>
                <div className="dash-agent-head">
                  <div>
                    {a.description ? <p className="dash-agent-desc">{a.description}</p> : null}
                    <p className="dash-muted">
                      Joined <LocalTime iso={a.created_at} /> · {deliveryLabel(a)}
                    </p>
                    {!revoked && a.shared && handle ? (
                      <p className="dash-muted">
                        <span className="dash-pill dash-pill-done">shared</span> as{' '}
                        <code translate="no">
                          @{handle}/{a.name}
                        </code>{' '}
                        ·{' '}
                        <a className="link" href="#sharing">
                          Manage sharing
                        </a>
                      </p>
                    ) : null}
                    <DeliveryHealth a={a} />
                  </div>
                  {!revoked ? (
                    <div className="dash-actions">
                      <button
                        type="button"
                        className="dash-textbtn"
                        aria-expanded={renaming === a.id}
                        aria-controls={`rename-${a.id}`}
                        onClick={() => {
                          if (renaming === a.id) {
                            setRenaming(null);
                            return;
                          }
                          setEditing(null);
                          setRenameDraft(a.name);
                          setError(null);
                          setRenaming(a.id);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="dash-textbtn"
                        aria-expanded={editing === a.id}
                        aria-controls={`delivery-${a.id}`}
                        onClick={() => {
                          setRenaming(null);
                          setEditing(editing === a.id ? null : a.id);
                        }}
                      >
                        Edit delivery
                      </button>
                      <button
                        type="button"
                        className="dash-textbtn"
                        disabled={busy !== null}
                        onClick={() =>
                          run(a.id + 'k', async () => {
                            const { key } = await api<{ key: NewAgentKey }>(`/api/v1/agents/${a.id}/keys`, {
                              method: 'POST',
                            });
                            setNewKey({ agentId: a.id, key });
                          })
                        }
                      >
                        {busy === a.id + 'k' ? 'Creating…' : 'New key'}
                      </button>
                    </div>
                  ) : null}
                </div>

                {renaming === a.id && !revoked ? (
                  <form
                    id={`rename-${a.id}`}
                    className="dash-rename"
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      const next = renameDraft.trim();
                      if (next === a.name) {
                        setRenaming(null);
                        return;
                      }
                      void run(a.id + 'r', async () => {
                        await api(`/api/v1/agents/${a.id}`, { method: 'PATCH', body: { name: next } });
                        setRenaming(null);
                      });
                    }}
                    noValidate
                  >
                    <label htmlFor={`rename-input-${a.id}`}>Agent name</label>
                    <div className="dash-rename-row">
                      <input
                        id={`rename-input-${a.id}`}
                        name="name"
                        type="text"
                        maxLength={64}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={renameDraft}
                        readOnly={busy === a.id + 'r'}
                        onChange={(e) => {
                          setRenameDraft(e.target.value);
                          if (error?.id === a.id + 'r') setError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape' && busy !== a.id + 'r') setRenaming(null);
                        }}
                        aria-invalid={error?.id === a.id + 'r' ? true : undefined}
                        aria-describedby={`rename-hint-${a.id} rename-msg-${a.id}`}
                      />
                      <button className="btn" type="submit" disabled={busy !== null}>
                        {busy === a.id + 'r' ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="dash-textbtn"
                        onClick={() => setRenaming(null)}
                        disabled={busy === a.id + 'r'}
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="dash-hint" id={`rename-hint-${a.id}`}>
                      Start with a letter. Then letters, numbers, underscores, or hyphens, up to 64 characters.
                      {a.shared && handle
                        ? ` This agent is shared as @${handle}/${a.name}. Saving a new name changes that address to @${handle}/${renameDraft.trim() || 'new-name'}. Existing grants, invite links, and customer links stay valid. Anyone still using the old address will need the new one.`
                        : ''}
                    </p>
                    <p
                      className={error?.id === a.id + 'r' ? 'form-msg err' : 'form-msg'}
                      id={`rename-msg-${a.id}`}
                      role="status"
                      aria-live="polite"
                    >
                      {error?.id === a.id + 'r' ? error.text : ''}
                    </p>
                  </form>
                ) : null}

                {editing === a.id && !revoked ? (
                  <DeliveryPanel agent={a} onSaved={onChange} onClose={() => setEditing(null)} />
                ) : null}

                {error && error.id !== a.id && error.id.startsWith(a.id) ? (
                  <p className="dash-err" role="alert">
                    {error.text}
                  </p>
                ) : null}

                {newKey?.agentId === a.id ? (
                  <OnceSecret title={`New key for ${a.name}. Copy it now: it won’t be shown again.`} secret={newKey.key.secret}>
                    <p className="dash-secret-help">
                      Give it to {a.name} as <code translate="no">Authorization: Bearer …</code> on its MCP connection.
                    </p>
                  </OnceSecret>
                ) : null}

                {agentKeys.length ? (
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <caption className="vh">Keys for {a.name}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Key</th>
                          <th scope="col">Created</th>
                          <th scope="col">Last used</th>
                          <th scope="col">
                            <span className="vh">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {agentKeys.map((k) => (
                          <tr key={k.id} className={k.revoked_at ? 'is-revoked' : undefined}>
                            <td data-label="Key">
                              <code translate="no">{k.prefix}…</code>
                            </td>
                            <td data-label="Created"><LocalTime iso={k.created_at} /></td>
                            <td data-label={k.revoked_at ? 'Revoked' : 'Last used'}>{k.revoked_at ? <>Revoked <LocalTime iso={k.revoked_at} /></> : <LocalTime iso={k.last_used_at} />}</td>
                            <td className="dash-td-actions">
                              <div className="dash-actions">
                                {!k.revoked_at && !revoked ? (
                                  <button
                                    type="button"
                                    className="dash-textbtn dash-danger"
                                    disabled={busy !== null}
                                    onClick={() =>
                                      run(a.id + k.id, async () => {
                                        await api(`/api/v1/agents/${a.id}/keys/${k.id}/revoke`, { method: 'POST' });
                                      })
                                    }
                                  >
                                    {busy === a.id + k.id ? 'Revoking…' : 'Revoke key'}
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="dash-muted">No keys.</p>
                )}

                {!revoked ? <WakeUrlPanel agentId={a.id} agentName={a.name} /> : null}

                {!revoked ? <TelegramLinkPanel agentId={a.id} agentName={a.name} /> : null}

                {!revoked ? (
                  <div className="dash-agent-danger">
                    {confirming === a.id ? (
                      // The question comes first, so a second tap where "Revoke agent" was lands on text, not on the confirm.
                      <div className="dash-confirm" role="group" aria-label={`Revoke ${a.name}`}>
                        <p>
                          Revoke <span translate="no">{a.name}</span>? Its keys stop working and it can’t get new tasks.
                          You can’t undo this.
                        </p>
                        <div className="dash-actions">
                          <button
                            type="button"
                            className="dash-textbtn dash-danger"
                            disabled={busy !== null}
                            onClick={() =>
                              run(a.id, async () => {
                                await api(`/api/v1/agents/${a.id}/revoke`, { method: 'POST' });
                              })
                            }
                          >
                            {busy === a.id ? 'Revoking…' : `Yes, revoke ${a.name}`}
                          </button>
                          <button
                            type="button"
                            className="dash-textbtn"
                            disabled={busy !== null}
                            onClick={() => setConfirming(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="dash-textbtn dash-danger"
                        disabled={busy !== null}
                        onClick={() => setConfirming(a.id)}
                      >
                        Revoke agent
                      </button>
                    )}
                    {error?.id === a.id ? (
                      <p className="dash-err" role="alert">
                        {error.text}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
