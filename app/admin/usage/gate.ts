import { notFound } from 'next/navigation';
import { currentUser } from '@/components/dashboard/session';
import type { SessionUser } from '@/lib/auth';
import { isUsageOwnerEmail } from '@/lib/internal-accounts';

/**
 * The signed-in owner, or a 404. Signed out, a bad or expired session, an unverified email and any account outside
 * USAGE_OWNER_EMAILS all get the same not-found page, so the route does not reveal that it exists.
 */
export async function requireUsageOwner(
  loadUser: () => Promise<SessionUser | null> = currentUser,
): Promise<SessionUser> {
  const user = await loadUser();
  if (!user || !user.emailVerifiedAt || !isUsageOwnerEmail(user.email)) notFound();
  return user;
}
