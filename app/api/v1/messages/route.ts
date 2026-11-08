import { listMessages, parseInboxListQuery, requireInboxKey } from '@/lib/inbox';
import { handle, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The caller's standalone inbox. Agent key only. Same rules as MCP list_messages. */
export function GET(req: Request) {
  return handle(async () => {
    const caller = await requireInboxKey(req);
    const query = parseInboxListQuery(new URL(req.url));
    return json(await listMessages(caller, query));
  });
}
