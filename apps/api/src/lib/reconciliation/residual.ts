/**
 * Residual computation — the number a reconciliation exists to drive to zero.
 *
 *     expected = openingBalance + SUM(signed netAmount of transactions ≤ periodEnd)
 *     residual = statementEndingBalance − expected
 *
 * `statementEndingBalance` is the only figure in the system that comes from
 * outside the app. Everything else is derived from the app's own data, so the
 * residual is the app's total disagreement with reality for one account and
 * period, expressed as a single number.
 *
 * See `.kiro/specs/reconciliation/design.md`.
 */

import { prisma } from '@budget-tracker/db';

/** Anything below this is treated as zero — a residual is money, so a cent matters. */
export const RESIDUAL_EPSILON = 0.005;

export interface ResidualResult {
  openingBalance: number;
  /** Signed sum of every transaction touching the account on or before periodEnd. */
  transactionSum: number;
  /** openingBalance + transactionSum — what the app believes the account held. */
  expectedBalance: number;
  /** The bank's figure, as entered by the user. */
  statementEndingBalance: number;
  /** statementEndingBalance − expectedBalance. */
  residual: number;
  /** True when |residual| < RESIDUAL_EPSILON. */
  isBalanced: boolean;
  /**
   * Signed sum of everything dated AFTER periodEnd.
   *
   * Deliberately NOT subtracted from the residual. It is context, not an
   * explanation: netting it out would let an error inside the period cancel an
   * equal and opposite error outside it, and both would disappear from the one
   * number this feature exists to keep honest.
   *
   * It is reported because the commonest reason a residual will not close is
   * that the statement export and the ending balance were taken at different
   * moments — an export through the 17th against a balance read on the 20th.
   * When this figure equals the residual, that is exactly what happened, and
   * the screen can say so instead of reporting the gap as unexplained.
   */
  activityAfterPeriodEnd: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Signed sums of everything touching an account, split at `periodEnd`:
 * `through` is dated on or before it, `after` is dated later.
 *
 * The `CASE` expression below is a deliberate independent restatement of the
 * sign rules — it also exists in `scripts/check-ledger-integrity.sh`, the
 * ledger-invariant property test, and the `openingBalance` backfill migration.
 * Importing a shared helper would let a bug in the production sign rules make
 * this check agree with it, which defeats the purpose of checking. Four copies;
 * if the sign rules change, all four change.
 */
export async function transactionSumsAround(
  accountId: string,
  periodEnd: Date,
): Promise<{ through: number; after: number }> {
  // Both sums come from ONE query with a FILTER rather than two queries with
  // two copies of the CASE. The independence that matters is from the checking
  // scripts, not from ourselves — and a second copy here could disagree with
  // this one, which is the defect class that produced the tens of thousands chain
  // drift earlier in the same codebase.
  const rows = await prisma.$queryRaw<{ through: string | null; after: string | null }[]>`
    SELECT
      SUM(
        CASE
          WHEN t.type IN ('INCOME', 'REFUND') THEN t."netAmount"
          WHEN t.type = 'EXPENSE' THEN -t."netAmount"
          WHEN t.type = 'TRANSFER' AND t."toAccountId" = ${accountId} THEN t."netAmount"
          WHEN t.type = 'TRANSFER' THEN -t."netAmount"
          WHEN t.type = 'TRADE' AND td.direction = 'BUY' THEN -t."netAmount"
          WHEN t.type = 'TRADE' AND td.direction = 'SELL' THEN t."netAmount"
          ELSE 0
        END
      ) FILTER (WHERE t.date <= ${periodEnd})::text AS through,
      SUM(
        CASE
          WHEN t.type IN ('INCOME', 'REFUND') THEN t."netAmount"
          WHEN t.type = 'EXPENSE' THEN -t."netAmount"
          WHEN t.type = 'TRANSFER' AND t."toAccountId" = ${accountId} THEN t."netAmount"
          WHEN t.type = 'TRANSFER' THEN -t."netAmount"
          WHEN t.type = 'TRADE' AND td.direction = 'BUY' THEN -t."netAmount"
          WHEN t.type = 'TRADE' AND td.direction = 'SELL' THEN t."netAmount"
          ELSE 0
        END
      ) FILTER (WHERE t.date > ${periodEnd})::text AS after
    FROM "Transaction" t
    LEFT JOIN "TradeDetail" td ON td."transactionId" = t.id
    WHERE t."parentId" IS NULL
      AND (t."accountId" = ${accountId} OR (t."toAccountId" = ${accountId} AND t.type = 'TRANSFER'))
  `;
  return {
    through: round2(Number(rows[0]?.through ?? 0)),
    after: round2(Number(rows[0]?.after ?? 0)),
  };
}

/** Sum through `periodEnd` only. Kept for callers that do not need the tail. */
export async function transactionSumThrough(accountId: string, periodEnd: Date): Promise<number> {
  return (await transactionSumsAround(accountId, periodEnd)).through;
}

/**
 * Compute the residual for a reconciliation session. Returns `null` when the
 * session does not exist.
 *
 * Always reads live data. Callers must never pass in a client-supplied residual
 * — the close endpoint's whole guarantee rests on this being recomputed from the
 * database at the moment of the decision.
 */
export async function computeResidual(sessionId: string): Promise<ResidualResult | null> {
  const session = await prisma.reconciliationSession.findUnique({
    where: { id: sessionId },
    select: {
      accountId: true,
      periodEnd: true,
      statementEndingBalance: true,
      account: { select: { openingBalance: true } },
    },
  });
  if (!session) return null;

  const openingBalance = round2(Number(session.account.openingBalance));
  const { through: transactionSum, after: activityAfterPeriodEnd } = await transactionSumsAround(
    session.accountId,
    session.periodEnd,
  );
  const expectedBalance = round2(openingBalance + transactionSum);
  const statementEndingBalance = round2(Number(session.statementEndingBalance));
  const residual = round2(statementEndingBalance - expectedBalance);

  return {
    openingBalance,
    transactionSum,
    expectedBalance,
    statementEndingBalance,
    residual,
    isBalanced: Math.abs(residual) < RESIDUAL_EPSILON,
    activityAfterPeriodEnd,
  };
}
