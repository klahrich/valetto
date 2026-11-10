import { z } from 'zod';
import { markMessagesRead, requireInboxKey } from '@/lib/inbox';
import { handle, json, parseBody, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.strictObject({
  message_ids: z.array(z.uuid()).min(1).max(100),
});

/** Mark named inbox messages read. Agent key only. Same rules as MCP mark_messages_read. */
export function POST(req: Request) {
  return handle(async () => {
    const caller = await requireInboxKey(req);
    const body = parseBody(bodySchema, await readJson(req));
    return json(await markMessagesRead(caller, body.message_ids));
  });
}
