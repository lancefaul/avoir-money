/**
 * Pure helper functions for the income-trend endpoint.
 *
 * All functions are side-effect-free (no DB access) and exported for testing.
 * Date handling follows UTC discipline — see utc-discipline.md.
 */
import { localDate } from './dates.js';

// ─── Period Classification ───

export function classifyPeriod(
  periodStart: Date,
  periodEnd: Date,
  today: Date,
): { type: 'past' | 'current' | 'future'; projected: boolean } {
  const endTime = periodEnd.getTime();
  const startTime = periodStart.getTime();
  const todayTime = today.getTime();

  if (endTime < todayTime) {
    return { type: 'past', projected: false };
  }
  if (startTime > todayTime) {
    return { type: 'future', projected: true };
  }
  return { type: 'current', projected: true };
}

// ─── Past Period Totals ───

export function computePastPeriodTotals(
  transactions: Array<{
    amount: number;
    netAmount: number;
    type: string;
    parentId: string | null;
    date: Date;
  }>,
  periodStart: Date,
  periodEnd: Date,
): { income: number; expenses: number; trades: number } {
  const startTime = periodStart.getTime();
  const endNextDay = new Date(periodEnd.getTime() + 86_400_000).getTime();

  let income = 0;
  let expenses = 0;
  let trades = 0;

  for (const tx of transactions) {
    if (tx.parentId !== null) continue; // skip child line items
    const txTime = tx.date.getTime();
    if (txTime < startTime || txTime >= endNextDay) continue;

    const effective = tx.netAmount;
    if (tx.type === 'INCOME') income += tx.amount;
    else if (tx.type === 'EXPENSE') expenses += effective;
    else if (tx.type === 'TRADE') trades += tx.amount;
    else if (tx.type === 'REFUND') expenses -= effective;
  }

  return { income, expenses, trades };
}

// ─── Current Period Totals ───

export function computeCurrentPeriodTotals(
  transactions: Array<{
    amount: number;
    netAmount: number;
    type: string;
    parentId: string | null;
    date: Date;
  }>,
  scheduledTransactions: Array<{
    expectedAmount: number;
    sourceType: 'INCOME' | 'EXPENSE';
    status: string;
    dueDate: Date;
  }>,
  periodStart: Date,
  periodEnd: Date,
): { income: number; expenses: number; trades: number } {
  const startTime = periodStart.getTime();
  const endNextDay = new Date(periodEnd.getTime() + 86_400_000).getTime();

  let income = 0;
  let expenses = 0;
  let trades = 0;

  // Actual transactions within the period
  for (const tx of transactions) {
    if (tx.parentId !== null) continue; // skip child line items
    const txTime = tx.date.getTime();
    if (txTime < startTime || txTime >= endNextDay) continue;

    const effective = tx.netAmount;
    if (tx.type === 'INCOME') income += tx.amount;
    else if (tx.type === 'EXPENSE') expenses += effective;
    else if (tx.type === 'TRADE') trades += tx.amount;
    else if (tx.type === 'REFUND') expenses -= effective;
  }

  // PENDING scheduled transactions within the period
  for (const st of scheduledTransactions) {
    if (st.status !== 'PENDING') continue;
    const dueTime = st.dueDate.getTime();
    if (dueTime < startTime || dueTime >= endNextDay) continue;

    if (st.sourceType === 'INCOME') income += st.expectedAmount;
    if (st.sourceType === 'EXPENSE') expenses += st.expectedAmount;
  }

  return { income, expenses, trades };
}

// ─── Future Period Totals ───

export function computeFuturePeriodTotals(
  scheduledTransactions: Array<{
    expectedAmount: number;
    sourceType: 'INCOME' | 'EXPENSE';
    status: string;
    dueDate: Date;
  }>,
  periodStart: Date,
  periodEnd: Date,
): { income: number; expenses: number } {
  const startTime = periodStart.getTime();
  const endNextDay = new Date(periodEnd.getTime() + 86_400_000).getTime();

  let income = 0;
  let expenses = 0;

  for (const st of scheduledTransactions) {
    if (st.status !== 'PENDING') continue;
    const dueTime = st.dueDate.getTime();
    if (dueTime < startTime || dueTime >= endNextDay) continue;

    if (st.sourceType === 'INCOME') income += st.expectedAmount;
    if (st.sourceType === 'EXPENSE') expenses += st.expectedAmount;
  }

  return { income, expenses };
}

// ─── Budget Proration ───

export function prorateBudgetToPeriod(monthlyEquivalent: number, periodsPerYear: number): number {
  return (monthlyEquivalent * 12) / periodsPerYear;
}

// ─── Schedule Type → Periods Per Year ───

export function getPeriodsPerYear(scheduleType: string): number {
  switch (scheduleType) {
    case 'WEEKLY':
      return 52;
    case 'BIWEEKLY':
      return 26;
    case 'SEMI_MONTHLY':
      return 24;
    case 'MONTHLY':
      return 12;
    default:
      return 26;
  }
}

// ─── Unlinked Budget Filtering ───

export function filterUnlinkedBudgets(
  budgetAllocations: Array<{
    id: string;
    removedAt: Date | null;
    budgetExpenseLinks: Array<unknown>;
  }>,
): Array<{ id: string }> {
  return budgetAllocations
    .filter((b) => b.removedAt === null && b.budgetExpenseLinks.length === 0)
    .map((b) => ({ id: b.id }));
}

// ─── Seasonal Budget Active Check ───

export function isSeasonalBudgetActiveForPeriod(
  activeMonths: number[],
  periodStart: Date,
  periodEnd: Date,
): boolean {
  if (activeMonths.length === 0) return true;

  const startMonth = localDate(periodStart).month;
  const endMonth = localDate(periodEnd).month;

  return activeMonths.includes(startMonth) || activeMonths.includes(endMonth);
}
