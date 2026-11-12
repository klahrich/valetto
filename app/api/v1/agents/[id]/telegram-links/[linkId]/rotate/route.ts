import { handle, json, requireUuid } from '@/lib/http';
import { requireTelegramLinkOwner, rotateTelegramLink, serializeTelegramLink } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' };

/** Replace a Telegram link (owner session only). The old one stops working and its chats are disconnected. */
export function POST(req: Request, context: { params: Promise<{ id: string; linkId: string }> }) {
  return handle(async () => {
    const { id, linkId } = await context.params;
    const subject = await requireTelegramLinkOwner(req, requireUuid(id, 'agent'), { issue: true });
    const { row, url, revoked } = await rotateTelegramLink(subject, requireUuid(linkId, 'Telegram link'));
    return json(
      { telegram_link: { ...serializeTelegramLink(row, 0), url }, revoked: serializeTelegramLink(revoked) },
      200,
      NO_STORE,
    );
  });
}
