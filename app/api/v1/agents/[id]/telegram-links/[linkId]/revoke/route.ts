import { handle, json, requireUuid } from '@/lib/http';
import { requireTelegramLinkOwner, revokeTelegramLink, serializeTelegramLink } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Turn off a Telegram link. Every chat that joined through it is disconnected. Idempotent. */
export function POST(req: Request, context: { params: Promise<{ id: string; linkId: string }> }) {
  return handle(async () => {
    const { id, linkId } = await context.params;
    const subject = await requireTelegramLinkOwner(req, requireUuid(id, 'agent'), { issue: false });
    return json({ telegram_link: serializeTelegramLink(await revokeTelegramLink(subject, requireUuid(linkId, 'Telegram link'))) });
  });
}
