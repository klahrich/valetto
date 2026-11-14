import { guestTaskWakeNotice } from '@/lib/wake-notice';

/** The real guest wake sentence, with an example task id, so the page cannot drift from what agents get. */
export const GUEST_WAKE_EXAMPLE = guestTaskWakeNotice('3f2b9c1e-0000-4000-8000-000000000000');
