import { handle } from '@/lib/http';
import { handleTelegramWebhook } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Telegram bot webhook. 404 unless TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and TELEGRAM_BOT_USERNAME are set. */
export function POST(req: Request) {
  return handle(() => handleTelegramWebhook(req));
}
