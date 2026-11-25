import type { Metadata } from 'next';
import { currentUser } from '@/components/dashboard/session';
import { isUsageOwner } from '@/lib/usage-gate';
import { loadUsageOverview } from '@/lib/usage-overview';
import { requireUsageOwner } from './gate';
import { UsageView } from './UsageView';
import './usage.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PRIVATE = { robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' } satisfies Metadata;

/** The real title only for the owner; anyone else sees the not-found title (proxy.ts normally stops them first). */
export async function generateMetadata(): Promise<Metadata> {
  const user = await currentUser();
  return { ...PRIVATE, title: { absolute: isUsageOwner(user) ? 'Usage · Valetto' : 'Page not found · Valetto' } };
}

export default async function UsagePage() {
  const owner = await requireUsageOwner();
  const usage = await loadUsageOverview();
  return <UsageView email={owner.email} usage={usage} />;
}
