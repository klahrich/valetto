/**
 * Minimal Telegram Bot API client. The bot token is only ever part of the request URL; it is never logged or
 * returned. Errors are logged with the method and status only, and never thrown to the caller.
 */

/** Telegram rejects a sendMessage text longer than this. */
export const TELEGRAM_TEXT_MAX = 4096;
const TELEGRAM_TIMEOUT_MS = 10_000;
const API_BASE = 'https://api.telegram.org';

/**
 * Splits text into chunks of at most `max` characters (UTF-16 code units, which is how Telegram counts). Prefers a
 * paragraph break, then a line break, then a space, and never splits a surrogate pair.
 */
export function splitTelegramText(text: string, max = TELEGRAM_TEXT_MAX): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = -1;
    for (const sep of ['\n\n', '\n', ' ']) {
      const at = rest.lastIndexOf(sep, max - sep.length);
      if (at > max / 2) {
        cut = at + sep.length;
        break;
      }
    }
    if (cut === -1) {
      cut = max;
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0 || chunks.length === 0) chunks.push(rest);
  return chunks;
}

export type TelegramSendResult = { ok: boolean; sent: number; total: number; messageIds: number[] };

type CallResult = { ok: boolean; result?: unknown };

async function callTelegram(token: string, method: string, body: Record<string, unknown>): Promise<CallResult> {
  try {
    const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
    let data: { ok?: unknown; result?: unknown; description?: unknown } = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      // Body was not JSON. The status is enough.
    }
    if (!res.ok || data.ok === false) {
      const description = typeof data.description === 'string' ? ` ${data.description.slice(0, 200)}` : '';
      console.error(`telegram ${method} failed: ${res.status}${description}`);
      return { ok: false };
    }
    return { ok: true, result: data.result };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'error';
    console.error(`telegram ${method} failed: ${name}`);
    return { ok: false };
  }
}

export type InlineButton = { text: string; callback_data: string };

/**
 * Sends text to a chat as plain text, split into Telegram-sized parts in order. Every part starts with `prefix`
 * (for example "karim-codex: "). Buttons, when given, go on the last part. Stops at the first failed part.
 * Never throws.
 */
export async function sendTelegramText(
  token: string,
  chatId: number,
  text: string,
  options: { prefix?: string; buttons?: InlineButton[][] } = {},
): Promise<TelegramSendResult> {
  const prefix = options.prefix ?? '';
  const parts = splitTelegramText(text, TELEGRAM_TEXT_MAX - prefix.length);
  const messageIds: number[] = [];
  let sent = 0;
  for (const [i, part] of parts.entries()) {
    const last = i === parts.length - 1;
    const result = await callTelegram(token, 'sendMessage', {
      chat_id: chatId,
      text: `${prefix}${part}`,
      link_preview_options: { is_disabled: true },
      ...(last && options.buttons ? { reply_markup: { inline_keyboard: options.buttons } } : {}),
    });
    if (!result.ok) return { ok: false, sent, total: parts.length, messageIds };
    const id = (result.result as { message_id?: unknown } | undefined)?.message_id;
    if (typeof id === 'number' && Number.isSafeInteger(id)) messageIds.push(id);
    sent += 1;
  }
  return { ok: true, sent, total: parts.length, messageIds };
}

/** Stops the button's loading spinner, with an optional short toast. Never throws. */
export async function answerTelegramCallback(token: string, callbackQueryId: string, text?: string): Promise<void> {
  await callTelegram(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
}
