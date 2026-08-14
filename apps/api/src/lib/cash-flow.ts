/**
 * Cash flow timing utilities.
 *
 * Pure functions for classifying expenses as cash vs credit and computing
 * the cash flow summary for a pay period, plus database helpers for
 * previous-period lookup and credit expense/payment summation.
 */
import type { Prisma } from '@budget-tracker/db';
import { prisma } from '@budget-tracker/db';
import { roundCurrency } from '@budget-tracker/core';
import { generateSchedule } from './schedule-generator.js';
import { transactionSumThrough } from './reconciliation/residual.js';

type PayPeriod = Prisma.PayPeriodGetPayload<Record<string, never>>;

// ─── Interfaces ───

export interface CashFlowExpenseItem {
  expenseType: 'cash' | 'credit' | 'excluded';
  amount: number;
  isPaid: boolean;
}

export interface CashFlowInput {
  expenseItems: CashFlowExpenseItem[];
  previousPeriodCreditTotal: number;
  previousPeriodBankBalance: number;
  creditCardPayments: number;
}

export interface CashFlowSummary {
  cashExpenses: number;
  creditExpenses: number;
  previousPeriodCreditExpenses: number;
  previousPeriodBankBalance: number;
  cashNeeded: number;
  creditCardPayments: number;
}

// ─── Pure Functions ───

/**
 * Account types whose balances are NOT spendable cash. They never count as cash
 * income, cash spending, or part of the cash pool:
 *   - "HSA" — trapped, medical-only cash.
 *   - "Rewards" — a rewards account (child of a card): holds redeemable rewards,
 *     not cash; redeeming them is a leg on this account, not cash spending.
 */
export const CASH_EXCLUDED_TYPES = new Set(['HSA', 'Rewards']);

/**
 * Classify an expense as "cash", "credit", or "excluded" from the cash-flow
 * cards, based on the linked account type.
 *
 * - "credit" — accountType is exactly "Credit Card".
 * - "excluded" — accountType is in `CASH_EXCLUDED_TYPES` (HSA, Rewards): not
 *   spendable cash, so it draws down neither the cash balance nor counts as
 *   credit spending. It falls on neither card.
 * - "cash" — everything else, including null, "Checking", "Savings", "Gift Card",
 *   and any unknown string.
 */
export function classifyExpense(accountType: string | null): 'cash' | 'credit' | 'excluded' {
  if (accountType === 'Credit Card') return 'credit';
  if (accountType != null && CASH_EXCLUDED_TYPES.has(accountType)) return 'excluded';
  return 'cash';
}

/**
 * Compute the cash flow summary for a pay period.
 *
 * This is a pure function with no database calls. It partitions expense
 * amounts by type, passes through the previous-period credit total and
 * credit card payments, and derives cashNeeded.
 */
export function computeCashFlowSummary(input: CashFlowInput): CashFlowSummary {
  let cashExpenses = 0;
  let creditExpenses = 0;

  for (const item of input.expenseItems) {
    if (item.expenseType === 'cash') {
      cashExpenses += item.amount;
    } else if (item.expenseType === 'credit') {
      creditExpenses += item.amount;
    }
    // 'excluded' (HSA — trapped cash) counts toward neither total.
  }

  const previousPeriodCreditExpenses = input.previousPeriodCreditTotal;
  const previousPeriodBankBalance = input.previousPeriodBankBalance;
  const creditCardPayments = input.creditCardPayments;
  const cashNeeded = cashExpenses + previousPeriodCreditExpenses;

  return {
    cashExpenses,
    creditExpenses,
    previousPeriodCreditExpenses,
    previousPeriodBankBalance,
    cashNeeded,
    creditCardPayments,
  };
}

// ─── Database Helpers ───

/**
 * Find the pay period immediately preceding the current one within the
 * same schedule.
 *
 * Queries for the PayPeriod with the highest endDate that is still
 * earlier than the current period's startDate. Returns null when no
 * previous period exists (e.g., the very first period in a schedule).
 */
export async function findPreviousPeriod(
  scheduleId: string,
  currentPeriodStartDate: Date,
): Promise<PayPeriod | null> {
  return prisma.payPeriod.findFirst({
    where: {
      scheduleId,
      endDate: { lt: currentPeriodStartDate },
    },
    orderBy: { endDate: 'desc' },
  });
}

/**
 * Sum net credit card spending from the previous pay period.
 *
 * Queries actual EXPENSE transactions (excluding child line items to
 * avoid double-counting split transactions) on credit card accounts,
 * then subtracts REFUND transactions on those same accounts.
 *
 * Also includes expected amounts from unpaid scheduled credit expenses
 * so the estimate accounts for recurring bills that haven't posted yet.
 *
 * Returns 0 when the previous period has no credit card spending.
 */
export async function sumPreviousPeriodCreditExpenses(
  previousPeriod: PayPeriod,
  accountTypeMap: Map<string, string>,
): Promise<number> {
  const { startDate: periodStart, endDate: periodEnd } = previousPeriod;

  // Credit card account IDs
  const creditCardAccountIds: string[] = [];
  for (const [accountId, type] of accountTypeMap) {
    if (type === 'Credit Card') creditCardAccountIds.push(accountId);
  }

  // If no credit card accounts exist, short-circuit
  if (creditCardAccountIds.length === 0) return 0;

  // Sum EXPENSE transactions (parent-only, no children to avoid double-counting splits)
  const expenses = await prisma.transaction.findMany({
    where: {
      type: 'EXPENSE',
      date: { gte: periodStart, lte: periodEnd },
      accountId: { in: creditCardAccountIds },
      parentId: null,
    },
    select: { netAmount: true },
  });

  let total = expenses.reduce((sum, t) => sum + Number(t.netAmount), 0);

  // Subtract refunds on credit card accounts
  const refunds = await prisma.transaction.findMany({
    where: {
      type: 'REFUND',
      date: { gte: periodStart, lte: periodEnd },
      accountId: { in: creditCardAccountIds },
      parentId: null,
    },
    select: { netAmount: true },
  });

  total -= refunds.reduce((sum, t) => sum + Number(t.netAmount), 0);

  // Also add expected amounts from unpaid scheduled credit expenses,
  // so the estimate includes recurring bills that haven't posted yet
  await generateSchedule({ periodStart, periodEnd });

  const scheduledRows = await prisma.scheduledTransaction.findMany({
    where: {
      sourceType: 'EXPENSE',
      dueDate: { gte: periodStart, lte: periodEnd },
      status: { in: ['PENDING', 'SNOOZED'] },
    },
    include: { expense: true },
  });

  for (const row of scheduledRows) {
    if (!row.expense) continue;
    const accountType = accountTypeMap.get(row.expense.accountId ?? '') ?? null;
    if (classifyExpense(accountType) === 'credit') {
      total += Number(row.expectedAmount);
    }
  }

  return total;
}

/**
 * Sum credit card payment transfers within a pay period.
 *
 * Queries TRANSFER transactions in the date range whose destination
 * account (`toAccount`) is a credit card. Returns the total amount
 * of those transfers, or 0 when none exist.
 *
 * Requirements: 5.1, 5.2, 5.3
 */
export async function sumCreditCardPayments(periodStart: Date, periodEnd: Date): Promise<number> {
  const transfers = await prisma.transaction.findMany({
    where: {
      type: 'TRANSFER',
      date: { gte: periodStart, lte: periodEnd },
      toAccountId: { not: null },
    },
    include: { toAccount: { select: { type: true } } },
  });

  return transfers
    .filter((t) => t.toAccount?.type === 'Credit Card')
    .reduce((sum, t) => sum + Number(t.amount), 0);
}

/**
 * Split the previous period's closing bank balance into Checking and Savings.
 *
 * Computed live from the ledger for each account — `openingBalance + SUM(signed
 * transactions dated on or before the period's end)` — rather than a
 * point-in-time snapshot taken whenever the period first rolled over. See
 * `sumPreviousPeriodCreditBalance` for why a frozen snapshot is the wrong
 * shape here: it captures whatever the ledger looked like at that instant and
 * never revisits it, so an incomplete import or a correction still in flight
 * freezes in wrong forever. This recomputes on every call and is anchored to
 * the period's own `endDate` — not "now" — so spending or transferring money
 * DURING the current period is dated after that cutoff and never moves it.
 *
 * The two account types are kept separate so the dashboard can show one line
 * each. The combined total is simply `checking + savings`. Returns zeroes when
 * there are no Checking/Savings accounts.
 */
export async function sumPreviousPeriodBankBalanceByType(
  previousPeriod: PayPeriod,
): Promise<{ checking: number; savings: number }> {
  const accounts = await prisma.account.findMany({
    where: { type: { in: ['Checking', 'Savings'] } },
    select: { id: true, type: true, openingBalance: true },
  });

  if (accounts.length === 0) return { checking: 0, savings: 0 };

  let checking = 0;
  let savings = 0;
  for (const account of accounts) {
    const balance =
      Number(account.openingBalance) +
      (await transactionSumThrough(account.id, previousPeriod.endDate));
    if (account.type === 'Checking') checking = roundCurrency(checking + balance);
    else if (account.type === 'Savings') savings = roundCurrency(savings + balance);
  }

  return { checking, savings };
}

/**
 * Sum ad-hoc cash spending within a pay period — real cash purchases that are
 * NOT one of the recurring/one-time expenses already shown as their own lines.
 *
 * "Cash" = any account that is not a Credit Card and not in
 * `CASH_EXCLUDED_TYPES` (HSA, Rewards). Those hold trapped or non-cash balances —
 * an HSA can only pay medical bills, a Rewards account holds redeemable rewards —
 * so they never draw down the spendable cash pool (which is why the pool and
 * income classification already exclude them), and their spending is not "cash
 * spending" here either. "Ad-hoc" = `expenseId: null`: a
 * paid recurring or one-time bill carries an `expenseId` and is rendered as its
 * own (zeroed-out) line, so excluding those here is what prevents
 * double-counting. Parent-only (`parentId: null`) to avoid double-counting split
 * children. Nets EXPENSE minus REFUND. Returns 0 when there are no cash accounts.
 */
export async function sumAdHocCashSpending(
  periodStart: Date,
  periodEnd: Date,
  accountTypeMap: Map<string, string>,
): Promise<number> {
  const cashAccountIds: string[] = [];
  for (const [accountId, type] of accountTypeMap) {
    if (type !== 'Credit Card' && !CASH_EXCLUDED_TYPES.has(type)) cashAccountIds.push(accountId);
  }
  if (cashAccountIds.length === 0) return 0;

  const expenses = await prisma.transaction.findMany({
    where: {
      type: 'EXPENSE',
      date: { gte: periodStart, lte: periodEnd },
      accountId: { in: cashAccountIds },
      parentId: null,
      expenseId: null,
    },
    select: { netAmount: true },
  });
  let total = expenses.reduce((sum, t) => roundCurrency(sum + Number(t.netAmount)), 0);

  const refunds = await prisma.transaction.findMany({
    where: {
      type: 'REFUND',
      date: { gte: periodStart, lte: periodEnd },
      accountId: { in: cashAccountIds },
      parentId: null,
      expenseId: null,
    },
    select: { netAmount: true },
  });
  total = roundCurrency(
    total - refunds.reduce((sum, t) => roundCurrency(sum + Number(t.netAmount)), 0),
  );

  return total;
}

/**
 * Sum the balances owed on all Credit Card accounts at the end of the
 * previous pay period.
 *
 * Computed live for each account — `openingBalance + SUM(signed transactions
 * dated on or before the period's end)` — the same live pattern the
 * reconciler already trusts for "balance as of a date" (`transactionSumThrough`
 * in `reconciliation/residual.ts`). This used to read a `BalanceSnapshot` row
 * written once, the first time a period's dashboard was ever viewed, from
 * whatever `Account.balance` happened to be at that exact instant — and never
 * revisited. If the ledger was still incomplete then (a late import, a
 * correction still being entered), the wrong figure was frozen permanently;
 * nothing ever re-read it. Recomputing live means a later correction to a
 * transaction dated within or before the period is picked up automatically on
 * the next load — no manual fix, ever.
 *
 * The cutoff is the period's own `endDate`, not "now": a purchase or payoff
 * made DURING the current period is dated after that cutoff and is excluded,
 * so this figure stays stable for the whole period regardless of what happens
 * to the account meanwhile — it only changes if a transaction dated on or
 * before the period end is added, edited, or removed, or once the period
 * itself rolls over.
 *
 * Credit card balances are negative (amount owed); returns the absolute value
 * (the total you need to pay off). Returns 0 when there are no credit cards.
 */
export async function sumPreviousPeriodCreditBalance(previousPeriod: PayPeriod): Promise<number> {
  const accounts = await prisma.account.findMany({
    where: { type: 'Credit Card' },
    select: { id: true, openingBalance: true },
  });

  if (accounts.length === 0) return 0;

  let total = 0;
  for (const account of accounts) {
    const balance =
      Number(account.openingBalance) +
      (await transactionSumThrough(account.id, previousPeriod.endDate));
    total = roundCurrency(total + Math.abs(balance));
  }

  return total;
}
