/** Shared helpers for dashboard aggregations. */

/** Effective spend amount: full price minus rewards (free money). Gift card spend stays in. */
export function spendAmount(t: { netAmount: unknown }): number {
  // netAmount is what the account was actually charged. It equals amount since
  // the rewardsApplied discount was retired (rewards redemption is now a leg).
  return Number(t.netAmount);
}
