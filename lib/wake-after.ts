import { deliverWebhookWake } from './wakes';

/** After the message's transaction commits: push its webhook wake, if it has one. */
export async function afterWakeDelivery(wakeId: string | null): Promise<void> {
  if (!wakeId) return;
  await deliverWebhookWake(wakeId);
}
