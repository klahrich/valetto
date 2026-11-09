import { sessionUser, type SessionUser } from './auth';
import { isUsageOwnerEmail } from './internal-accounts';

/** The owner allowed to open /admin/usage: a live session, a verified email and an exact allowlist match. */
export function isUsageOwner(user: SessionUser | null): user is SessionUser {
  return !!user && !!user.emailVerifiedAt && isUsageOwnerEmail(user.email);
}

/** True only for the owner's session. Any lookup error counts as not the owner. */
export async function isUsageOwnerRequest(req: Request): Promise<boolean> {
  try {
    return isUsageOwner(await sessionUser(req));
  } catch {
    return false;
  }
}
