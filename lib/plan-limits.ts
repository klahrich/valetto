/** Free-plan numbers with no server imports, so site copy and client code can show them. lib/plans.ts enforces them. */

export const PLAN_LIMITS = {
  free: { agents: 10, tasksPerMonth: 1000 },
  unlimited: { agents: null, tasksPerMonth: null },
} as const;

/**
 * Guests (customers) per shared agent on the free plan. Counts approved shares plus pending
 * invite_guest and agent-invite shares; a pending customer request counts only toward
 * MAX_PENDING_PER_BOT. Unlimited workspaces skip this.
 */
export const FREE_CUSTOMERS_PER_BOT = 250;
/** Old name, kept so existing imports and the plan_limit `guest_workspaces` wording stay stable. */
export const FREE_GUEST_WORKSPACES = FREE_CUSTOMERS_PER_BOT;
