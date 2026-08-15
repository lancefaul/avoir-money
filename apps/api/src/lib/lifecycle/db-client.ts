import type { prisma } from '@budget-tracker/db';

/**
 * The Prisma client the ledger gate and its hooks run their queries against.
 *
 * It is either the global client or an interactive-transaction client. Every
 * gate function and every hook takes one (defaulting to the global `prisma`), so
 * a multi-row write — a payment-split purchase group — can run all of its rows
 * AND all of their hook side effects (balances, holdings, schedule) inside one
 * `prisma.$transaction`, and roll back as a unit. Without the client reaching
 * the hooks, a rollback would undo the rows but leave the balances moved.
 *
 * Matches the type derivation already used in `lib/transfers.ts` and
 * `lib/healthcare.ts`, so the whole codebase names the transaction client the
 * same way.
 */
export type DbClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
