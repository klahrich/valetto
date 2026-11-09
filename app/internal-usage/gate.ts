import { notFound } from 'next/navigation';
import { currentUser } from '@/components/dashboard/session';
import type { SessionUser } from '@/lib/auth';
import { isUsageOwner } from '@/lib/usage-gate';

/**
 * Second check behind proxy.ts, which only rewrites the owner here. Signed out, a bad or expired
 * session, an unverified email and any account outside the owner allowlist all get not-found here too.
 */
export async function requireUsageOwner(
  loadUser: () => Promise<SessionUser | null> = currentUser,
): Promise<SessionUser> {
  const user = await loadUser();
  if (!isUsageOwner(user)) notFound();
  return user;
}
