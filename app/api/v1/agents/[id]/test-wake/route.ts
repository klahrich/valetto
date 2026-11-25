import { requireUser } from '@/lib/auth';
import { handle, json, requireUuid } from '@/lib/http';
import { createTestWake, deliverWebhookWake, TEST_WAKE_RATE_LIMIT_MESSAGE } from '@/lib/wakes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const test = await createTestWake(user.workspace.id, requireUuid(id, 'agent'));
    if (test.limited) {
      return json(
        {
          error: {
            code: 'rate_limited',
            message: TEST_WAKE_RATE_LIMIT_MESSAGE,
            retry_after_seconds: test.retryAfterSeconds,
          },
        },
        429,
        { 'retry-after': String(test.retryAfterSeconds) },
      );
    }

    const { wakeId } = test;
    if (test.webhook) {
      const attempt = await deliverWebhookWake(wakeId);
      const ok = attempt.outcome === 'delivered';
      return json({
        ok,
        wake_id: wakeId,
        ...(attempt.statusCode !== undefined ? { status_code: attempt.statusCode } : {}),
        ...(!ok ? { error: attempt.error ?? 'delivery failed' } : {}),
      });
    }

    return json({ ok: true, pending: true, wake_id: wakeId });
  });
}
