import type { Prisma } from '@budget-tracker/db';

/**
 * A `Transaction` where-fragment that excludes **payment legs** — the
 * balance-visible members of a multi-account purchase group (payment-split,
 * ADR-030). A leg is a group member that has an account (`purchaseGroupId` and
 * `accountId` both set); the balance-neutral Anchor (a group member with no
 * account) and every ordinary transaction are kept.
 *
 * Use it only in "sum all spend" aggregations that filter by **neither** an
 * account nor a tracked budget — there a split purchase would otherwise be
 * counted twice (once via its Anchor, once via its legs). Aggregations that
 * already filter by tracked `budgetId` (budget rollup — the Payment allocation
 * is never a tracked category) or by `accountId` (per-account / cash-flow — the
 * null-account Anchor is excluded for free) separate the two partitions on their
 * own and must NOT add this.
 *
 * De Morgan: excluding a leg (`purchaseGroupId != null AND accountId != null`)
 * is `purchaseGroupId == null OR accountId == null`.
 */
export const NOT_PAYMENT_LEG: Prisma.TransactionWhereInput = {
  OR: [{ purchaseGroupId: null }, { accountId: null }],
};
