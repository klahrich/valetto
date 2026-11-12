'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorText } from './api';
import { LocalTime } from './LocalTime';
import { CopyButton } from './CopyButton';
import type { TelegramLink } from './types';

/** True for https://t.me/... and https://telegram.me/... only. */
export function isTelegramHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 't.me' || host === 'www.t.me' || host === 'telegram.me' || host === 'www.telegram.me';
  } catch {
    return false;
  }
}

/** The one-time Telegram URL, shown as a tappable t.me link plus a copy button. */
export function FreshTelegramLink({ url, agentName }: { url: string; agentName: string }) {
  const href = isTelegramHttpUrl(url) ? url : null;
  return (
    <div className="dash-secret" role="region" aria-label="Open or copy your Telegram link now. It won’t be shown again.">
      <p className="dash-secret-title">Open or copy your Telegram link now. It won’t be shown again.</p>
      <div className="dash-secret-row">
        {href ? (
          <a
            className="dash-secret-value dash-secret-link"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            translate="no"
          >
            {url}
          </a>
        ) : (
          <code translate="no" className="dash-secret-value">
            {url}
          </code>
        )}
        <CopyButton value={url} label="Copy Telegram link" />
      </div>
      <p className="dash-secret-help">
        Send it to the people who should reach {agentName}. If you lose it, get a new link below.
      </p>
    </div>
  );
}

async function fetchLinks(agentId: string): Promise<TelegramLink[] | null> {
  try {
    const { telegram_links } = await api<{ telegram_links: TelegramLink[] }>(`/api/v1/agents/${agentId}/telegram-links`);
    return telegram_links;
  } catch (err) {
    // 404: Telegram is not set up on this server. Show nothing.
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * One agent's Telegram link: create, copy once, replace, turn off. Only a hash of the link is stored, so the full link
 * is shown only when it is created or replaced. Hidden entirely when the server has no Telegram bot set up.
 */
export function TelegramLinkPanel({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [enabled, setEnabled] = useState(false);
  const [active, setActive] = useState<TelegramLink | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null);
  const [confirming, setConfirming] = useState<'rotate' | 'revoke' | null>(null);
  const [busy, setBusy] = useState<'create' | 'rotate' | 'revoke' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const apply = useCallback((list: TelegramLink[] | null) => {
    setEnabled(list !== null);
    setActive(list?.find((l) => l.status === 'active') ?? null);
    setLoaded(true);
  }, []);

  const load = useCallback(() => fetchLinks(agentId).then(apply), [agentId, apply]);

  useEffect(() => {
    let cancelled = false;
    fetchLinks(agentId).then(
      (list) => {
        if (!cancelled) apply(list);
      },
      (err: unknown) => {
        if (cancelled) return;
        setEnabled(true);
        setError(errorText(err));
        setLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [agentId, apply]);

  async function run(kind: 'create' | 'rotate' | 'revoke', fn: () => Promise<void>) {
    setBusy(kind);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'telegram_link_exists' || err.code === 'telegram_link_not_active')) {
        await load().catch(() => {});
      }
      setError(errorText(err));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  const create = () =>
    run('create', async () => {
      const { telegram_link } = await api<{ telegram_link: TelegramLink }>(`/api/v1/agents/${agentId}/telegram-links`, {
        method: 'POST',
      });
      setActive(telegram_link);
      if (telegram_link.url) setFresh({ id: telegram_link.id, url: telegram_link.url });
    });

  const rotate = (current: TelegramLink) =>
    run('rotate', async () => {
      const { telegram_link } = await api<{ telegram_link: TelegramLink }>(
        `/api/v1/agents/${agentId}/telegram-links/${current.id}/rotate`,
        { method: 'POST' },
      );
      setActive(telegram_link);
      if (telegram_link.url) setFresh({ id: telegram_link.id, url: telegram_link.url });
      setNotice('New link ready. The old one no longer works, and chats that used it are disconnected.');
    });

  const revoke = (current: TelegramLink) =>
    run('revoke', async () => {
      await api(`/api/v1/agents/${agentId}/telegram-links/${current.id}/revoke`, { method: 'POST' });
      setActive(null);
      setFresh(null);
      setNotice('Telegram link turned off. Chats that used it are disconnected.');
    });

  if (!loaded || !enabled) return null;
  const shown = fresh && active && fresh.id === active.id ? fresh.url : null;
  const chats = active?.connected_chats ?? 0;

  return (
    <div className="dash-wake" role="group" aria-labelledby={`tg-h-${agentId}`}>
      <div className="dash-wake-head">
        <h4 id={`tg-h-${agentId}`}>Telegram</h4>
        {active ? <span className="dash-pill dash-pill-done">On</span> : null}
      </div>
      <p className="dash-muted dash-wake-help">
        Share this link so people can message <span translate="no">{agentName}</span> on Telegram. They tap it, then tap
        Start. Anyone with the link can send messages, so share it only with people you trust.
      </p>

      {active ? (
        <>
          {shown ? <FreshTelegramLink url={shown} agentName={agentName} /> : null}
          <p className="dash-muted dash-wake-meta">
            <code translate="no">{active.prefix}…</code> · Created <LocalTime iso={active.created_at} /> ·{' '}
            {chats === 1 ? '1 chat connected' : `${chats} chats connected`}
          </p>
          {confirming === 'rotate' ? (
            <div className="dash-confirm" role="group" aria-label={`Get a new Telegram link for ${agentName}`}>
              <p>Get a new link? The current one stops working right away, and chats that used it are disconnected.</p>
              <div className="dash-actions">
                <button type="button" className="dash-textbtn" disabled={busy !== null} onClick={() => rotate(active)}>
                  {busy === 'rotate' ? 'Getting new link…' : 'Yes, get a new link'}
                </button>
                <button type="button" className="dash-textbtn" disabled={busy !== null} onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : confirming === 'revoke' ? (
            <div className="dash-confirm" role="group" aria-label={`Turn off the Telegram link for ${agentName}`}>
              <p>Turn off this link? Chats that used it are disconnected. You can create a new one later.</p>
              <div className="dash-actions">
                <button
                  type="button"
                  className="dash-textbtn dash-danger"
                  disabled={busy !== null}
                  onClick={() => revoke(active)}
                >
                  {busy === 'revoke' ? 'Turning off…' : 'Yes, turn it off'}
                </button>
                <button type="button" className="dash-textbtn" disabled={busy !== null} onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="dash-actions dash-wake-actions">
              <button type="button" className="dash-textbtn" disabled={busy !== null} onClick={() => setConfirming('rotate')}>
                Get a new link
              </button>
              <button
                type="button"
                className="dash-textbtn dash-danger"
                disabled={busy !== null}
                onClick={() => setConfirming('revoke')}
              >
                Turn off link
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="dash-wake-actions">
          <button type="button" className="dash-btn dash-btn-line dash-btn-sm" disabled={busy !== null} onClick={create}>
            {busy === 'create' ? 'Creating…' : 'Create Telegram link'}
          </button>
        </div>
      )}

      <p className="dash-wake-notice" role="status" aria-live="polite">
        {notice}
      </p>
      {error ? (
        <p className="dash-err" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
