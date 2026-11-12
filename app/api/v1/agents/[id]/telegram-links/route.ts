import { handle, json, requireUuid } from '@/lib/http';
import { issueTelegramLink, listTelegramLinks, requireTelegramLinkOwner, serializeTelegramLink } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' };

/** The agent's Telegram links, newest first. Prefix only: the full link is shown once, when it is created or replaced. */
export function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params;
    const subject = await requireTelegramLinkOwner(req, requireUuid(id, 'agent'), { issue: false });
    return json({ telegram_links: await listTelegramLinks(subject) }, 200, NO_STORE);
  });
}

/** Create the agent's Telegram link (owner session only). 409 telegram_link_exists while one is active. */
export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params;
    const subject = await requireTelegramLinkOwner(req, requireUuid(id, 'agent'), { issue: true });
    const { row, url } = await issueTelegramLink(subject);
    return json({ telegram_link: { ...serializeTelegramLink(row, 0), url } }, 201, NO_STORE);
  });
}
