import { getEmailSender, type SignupAlertEmail } from './email';
import { isExcludedWorkspace, runAfterResponse } from './first-agent-alert';
import { isInternalEmail } from './internal-accounts';

export type SignupKind = SignupAlertEmail['kind'];

export type SignupNotice = Omit<SignupAlertEmail, 'to'> & { workspaceId: string };

/**
 * Emails ALERT_EMAIL after the response when an outside person completes their first sign-in (the one that creates
 * or claims their workspace). Uses the same after-response scheduler as the first-agent alert. Skips when
 * ALERT_EMAIL is unset, the email is internal (lib/internal-accounts), or the workspace is in
 * STATS_EXCLUDE_WORKSPACE_IDS. A send failure is logged without the address and does not affect sign-in.
 */
export function queueSignupAlert(notice: SignupNotice): void {
  const to = process.env.ALERT_EMAIL?.trim() ?? '';
  if (!to) return;
  if (isInternalEmail(notice.email)) return;
  if (isExcludedWorkspace(notice.workspaceId)) return;
  const message: SignupAlertEmail = {
    to,
    email: notice.email,
    workspaceName: notice.workspaceName,
    kind: notice.kind,
    signupSource: notice.signupSource,
    wantsSharing: notice.wantsSharing,
    createdAt: notice.createdAt,
  };
  runAfterResponse(async () => {
    try {
      await getEmailSender().sendSignupAlert(message);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      console.error(`[replyslip] signup alert failed: ${reason}`);
    }
  });
}
