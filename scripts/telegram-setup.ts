/**
 * One-time Telegram bot setup for Valetto. Run after TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are set.
 *
 *   npx tsx scripts/telegram-setup.ts          Point the bot at https://valetto.tech/api/telegram/webhook and set its command menu.
 *   npx tsx scripts/telegram-setup.ts info     Show the bot's current webhook status.
 *
 * Reads the two env vars from the environment or from .env. VALETTO_URL overrides the site (default https://valetto.tech).
 * Prints Telegram's answers only. Never prints the token or the secret.
 */
import { existsSync, readFileSync } from 'node:fs';

function loadEnvFile(): void {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function call(token: string, method: string, body?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json()) as { ok?: boolean; result?: unknown; description?: string };
  if (!data.ok) throw new Error(`${method} failed: ${data.description ?? res.status}`);
  return data.result;
}

async function main(): Promise<void> {
  loadEnvFile();
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!token) throw new Error('Set TELEGRAM_BOT_TOKEN first.');
  const mode = process.argv[2] ?? 'set';
  if (mode === 'info') {
    const info = (await call(token, 'getWebhookInfo')) as Record<string, unknown>;
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  if (mode !== 'set') throw new Error('Use no argument (set up the webhook) or "info".');
  if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    throw new Error('Set TELEGRAM_WEBHOOK_SECRET to 1-256 letters, numbers, _ or -.');
  }
  const site = (process.env.VALETTO_URL?.trim() || 'https://valetto.tech').replace(/\/+$/, '');
  const url = `${site}/api/telegram/webhook`;
  await call(token, 'setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    max_connections: 20,
  });
  await call(token, 'setMyCommands', {
    commands: [
      { command: 'agents', description: 'See which agents you can talk to' },
      { command: 'stop', description: 'Remove an agent: /stop name, or /stop for all' },
      { command: 'help', description: 'How this bot works' },
    ],
  });
  const me = (await call(token, 'getMe')) as { username?: string };
  console.log(`Webhook set to ${url} for @${me.username ?? 'your bot'}.`);
  console.log(`Set TELEGRAM_BOT_USERNAME to ${me.username ?? 'the bot username'} if you have not yet.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
