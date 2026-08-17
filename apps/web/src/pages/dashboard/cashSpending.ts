/**
 * The "Cash Spending" card's living cash-flow math, extracted as a pure function
 * so it can be unit-tested away from the table markup.
 *
 * The model (confirmed 2026-07-26): Cash Remaining is a LIVE balance, not a
 * projection. It starts from the available pool (previous-period checking +
 * savings + this period's income) and is drawn down ONLY by money that has
 * actually left a cash account:
 *
 *   - the previous-period credit-card bill (assumed paid off from cash),
 *   - recurring/one-time cash expenses that have actually been PAID (actual amt),
 *   - ad-hoc cash purchases not tied to a recurring bill.
 *
 * Upcoming (unpaid) expenses are listed on the card but do NOT reduce the
 * balance until they are paid.
 */

const round = (n: number) => Math.round(n * 100) / 100;

export interface CashRemainingInput {
  previousPeriodCheckingBalance: number;
  previousPeriodSavingsBalance: number;
  incomeItems: { amount: number; actualAmount: number | null }[];
  /** Recurring/one-time cash expense lines (not ad-hoc). */
  cashExpenses: { amount: number; actualAmount: number | null; isPaid: boolean }[];
  /** Previous period's credit-card bill — deducted up front (card assumed paid off). */
  previousPeriodCreditExpenses: number;
  /** Actual cash purchases this period with no linked recurring/one-time expense. */
  adHocCashSpending: number;
}

export interface CashRemainingResult {
  /** Available pool: previous checking + savings + income (actual once paid). */
  totalIncome: number;
  /** Sum of PAID cash expense lines (actual amounts) — what has left the account. */
  paidCashExpenses: number;
  /** Sum of still-upcoming (unpaid) cash expense lines — not yet deducted. */
  unpaidCashExpenses: number;
  /** paidCashExpenses + unpaidCashExpenses — every cash expense line, paid or not. */
  totalCashExpenses: number;
  /** Live cash left for the period (only actual outflows deducted). */
  cashRemaining: number;
  /** Projected cash once the still-upcoming expenses are also paid. */
  cashAfterExpenses: number;
}

export function computeCashRemaining(input: CashRemainingInput): CashRemainingResult {
  const incomeTotal = input.incomeItems.reduce(
    (sum, inc) => round(sum + (inc.actualAmount ?? inc.amount)),
    0,
  );
  const totalIncome = round(
    input.previousPeriodCheckingBalance + input.previousPeriodSavingsBalance + incomeTotal,
  );

  // Only expenses actually paid draw down cash; upcoming ones are listed but
  // don't reduce the balance until paid.
  const paidCashExpenses = input.cashExpenses.reduce(
    (sum, exp) => round(sum + (exp.isPaid ? (exp.actualAmount ?? exp.amount) : 0)),
    0,
  );
  const unpaidCashExpenses = input.cashExpenses.reduce(
    (sum, exp) => round(sum + (exp.isPaid ? 0 : (exp.actualAmount ?? exp.amount))),
    0,
  );
  const totalCashExpenses = round(paidCashExpenses + unpaidCashExpenses);

  const cashRemaining = round(
    totalIncome - input.previousPeriodCreditExpenses - paidCashExpenses - input.adHocCashSpending,
  );
  // Project forward: what's left once the still-upcoming expenses are paid too.
  const cashAfterExpenses = round(cashRemaining - unpaidCashExpenses);

  return {
    totalIncome,
    paidCashExpenses,
    unpaidCashExpenses,
    totalCashExpenses,
    cashRemaining,
    cashAfterExpenses,
  };
}
