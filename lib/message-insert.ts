import type { Db } from '@/db';
import { messages, type MessageRow } from '@/db/schema';
import { HttpError } from './errors';
import { enqueueWake } from './wakes';

/**
 * The one write path for a Valetto message: insert the row and record the recipient's wake (nudge, webhook, wake URL
 * marker), with message_id on the wake. send_message and the Telegram channel both go through here. The caller runs
 * afterWake(wakeId) once its transaction commits.
 */
export async function insertMessageWithWake(
  tx: Db,
  input: {
    workspaceId: string;
    fromAgentId: string;
    toAgentId: string;
    body: string;
    taskId?: string | null;
    inReplyTo?: string | null;
  },
): Promise<{ message: MessageRow; wakeId: string | null }> {
  const [message] = await tx
    .insert(messages)
    .values({
      workspaceId: input.workspaceId,
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      body: input.body,
      taskId: input.taskId ?? null,
      inReplyTo: input.inReplyTo ?? null,
    })
    .returning();
  if (!message) throw new HttpError(500, 'internal_error', 'Something went wrong.');
  const wakeId = await enqueueWake(tx, {
    workspaceId: input.workspaceId,
    agentId: input.toAgentId,
    reason: 'message',
    taskId: input.taskId ?? null,
    messageId: message.id,
  });
  return { message, wakeId };
}
