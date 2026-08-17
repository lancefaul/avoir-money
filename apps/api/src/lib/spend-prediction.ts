/**
 * Spend prediction computation — pure functions for pay-period budget proration
 * and expected-vs-actual spend calculation.
 *
 * The chart tracks DISCRETIONARY spending only:
 * - Expected line = budget remainders after recurring obligations are deducted,
 *   plus fully discretionary (unlinked) budgets
 * - Actual line = one-time/discretionary expense transactions only
 *   (recurring expense payments are excluded by the caller)
 *
 * All date handling uses UTC discipline via dates.ts helpers.
 */
import { localDate, makeDate } from './dates.js';

// ─── Interfaces ───

export interface SpendPredictionInput {
  periodStart: Date; // UTC midnight
  periodEnd: Date; // UTC midnight
  today: Date; // UTC midnight
  scheduleType: string; // PayScheduleType enum value
  /** Recurring expenses that fall in this period (already filtered by frequency) */
  periodExpenses: Array<{
    id: string;
    budgetId: string;
    amount: number;
  }>;
  /** All active budget allocations */
  budgetAllocations: Array<{
    budgetId: string;
    amount: number;
    period: 'MONTHLY' | 'YEARLY';
    activeMonths: number[] | null; // null = year-round
    hasLinkedExpenses: boolean;
  }>;
  /** Discretionary expense transactions within the period (recurring excluded by caller) */
  transactions: Array<{
    date: Date; // UTC midnight
    amount: number;
  }>;
}

export interface SpendPredictionResult {
  expectedPeriodSpend: number;
  overUnderAmount: number;
  periodStartDate: Date;
  periodEndDate: Date;
  currentDayNumber: number; // 1-indexed
  totalDays: number;
  dailyData: Array<{
    dayNumber: number; // 1-indexed
    date: Date;
    expectedCumulative: number;
    actualCumulative: number | null; // null for future days
  }>;
}

// ─── Divisors by schedule type ───

const SCHEDULE_DIVISORS: Record<string, number> = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMI_MONTHLY: 24,
  MONTHLY: 12,
};

// ─── prorateBudget ───

/**
 * Convert a budget allocation to its pay-period amount.
 *
 * - MONTHLY year-round:  amount × 12 / divisor
 * - YEARLY year-round:   amount / divisor
 * - Seasonal MONTHLY:    amount × activeMonths.length / divisor
 * - Seasonal with no overlapping months in the period: 0
 */
export function prorateBudget(
  amount: number,
  budgetPeriod: 'MONTHLY' | 'YEARLY',
  activeMonths: number[] | null,
  scheduleType: string,
  periodStart: Date,
  periodEnd: Date,
): number {
  const divisor = SCHEDULE_DIVISORS[scheduleType];
  if (!divisor) return 0;

  const isSeasonal = activeMonths !== null && activeMonths.length > 0;

  // For seasonal budgets, check if any active month overlaps the period
  if (isSeasonal) {
    const startMonth = localDate(periodStart).month + 1; // 1-indexed
    const endMonth = localDate(periodEnd).month + 1; // 1-indexed

    const hasOverlap = activeMonths.some((m) => {
      if (startMonth <= endMonth) {
        // Period within same year (e.g., Jan 15 – Feb 14)
        return m >= startMonth && m <= endMonth;
      }
      // Period spans year boundary (e.g., Dec 20 – Jan 3)
      return m >= startMonth || m <= endMonth;
    });

    if (!hasOverlap) return 0;
  }

  if (budgetPeriod === 'MONTHLY') {
    return (amount * 12) / divisor;
  }

  // YEARLY
  return amount / divisor;
}

// ─── computeSpendPrediction ───

/**
 * Compute expected-vs-actual spend prediction for a pay period.
 *
 * Discretionary-only model:
 * - Linked budgets: contribution = max(0, prorated_budget - recurring_expenses).
 *   The recurring portion is "spoken for"; only the remainder is discretionary.
 * - Unlinked budgets: contribution = prorated_budget (fully discretionary).
 * - Budgets with only recurring expenses and no allocation: contribute $0
 *   (they're fully mandatory with no discretionary remainder).
 *
 * The caller is responsible for filtering transactions to exclude recurring
 * expense payments (those with a non-null expenseId).
 */
export function computeSpendPrediction(input: SpendPredictionInput): SpendPredictionResult {
  const {
    periodStart,
    periodEnd,
    today,
    scheduleType,
    periodExpenses,
    budgetAllocations,
    transactions,
  } = input;

  // ── totalDays: inclusive count from periodStart to periodEnd ──
  const msPerDay = 86_400_000;
  const totalDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / msPerDay) + 1;

  // ── currentDayNumber: 1-indexed, clamped to totalDays ──
  const currentDayNumber = Math.min(
    Math.round((today.getTime() - periodStart.getTime()) / msPerDay) + 1,
    totalDays,
  );

  // ── Per-budget recurring expense sums ──
  const recurringByBudget = new Map<string, number>();
  for (const exp of periodExpenses) {
    recurringByBudget.set(exp.budgetId, (recurringByBudget.get(exp.budgetId) ?? 0) + exp.amount);
  }

  // ── Per-budget prorated allocation amounts ──
  const allocationByBudget = new Map<string, number>();
  const linkedBudgets = new Set<string>();
  for (const cb of budgetAllocations) {
    const prorated = prorateBudget(
      cb.amount,
      cb.period,
      cb.activeMonths,
      scheduleType,
      periodStart,
      periodEnd,
    );
    allocationByBudget.set(cb.budgetId, (allocationByBudget.get(cb.budgetId) ?? 0) + prorated);
    if (cb.hasLinkedExpenses) linkedBudgets.add(cb.budgetId);
  }

  // ── expectedPeriodSpend: discretionary budget only ──
  // Linked: remainder after recurring obligations = max(0, budget - recurring)
  // Unlinked: full prorated budget (no recurring to deduct)
  // Recurring-only (no budget allocation): $0 discretionary
  const allBudgetIds = new Set([...recurringByBudget.keys(), ...allocationByBudget.keys()]);
  let expectedPeriodSpend = 0;
  for (const bId of allBudgetIds) {
    const recurring = recurringByBudget.get(bId) ?? 0;
    const budget = allocationByBudget.get(bId) ?? 0;

    if (linkedBudgets.has(bId)) {
      // Linked: budget minus recurring obligations (floor at 0)
      expectedPeriodSpend += Math.max(0, budget - recurring);
    } else if (budget > 0) {
      // Unlinked with a budget allocation: fully discretionary
      expectedPeriodSpend += budget;
    }
    // else: recurring expense with no budget allocation → $0 discretionary
  }

  // ── expectedDailyRate ──
  const expectedDailyRate = totalDays > 0 ? expectedPeriodSpend / totalDays : 0;

  // ── Aggregate transactions by day number ──
  const txByDay = new Map<number, number>();
  for (const tx of transactions) {
    const dayNum = Math.round((tx.date.getTime() - periodStart.getTime()) / msPerDay) + 1;
    if (dayNum >= 1 && dayNum <= totalDays) {
      txByDay.set(dayNum, (txByDay.get(dayNum) ?? 0) + tx.amount);
    }
  }

  // ── Generate daily data points ──
  const startComponents = localDate(periodStart);
  const dailyData: SpendPredictionResult['dailyData'] = [];
  let runningActual = 0;

  for (let i = 0; i < totalDays; i++) {
    const dayNumber = i + 1;
    const date = makeDate(startComponents.year, startComponents.month, startComponents.day + i);
    const expectedCumulative = expectedDailyRate * dayNumber;

    let actualCumulative: number | null;
    if (dayNumber <= currentDayNumber) {
      runningActual += txByDay.get(dayNumber) ?? 0;
      actualCumulative = runningActual;
    } else {
      actualCumulative = null;
    }

    dailyData.push({ dayNumber, date, expectedCumulative, actualCumulative });
  }

  // ── overUnderAmount: actual minus expected for the current day ──
  const currentDayData = dailyData[currentDayNumber - 1];
  const overUnderAmount = currentDayData
    ? (currentDayData.actualCumulative ?? 0) - currentDayData.expectedCumulative
    : 0;

  return {
    expectedPeriodSpend,
    overUnderAmount,
    periodStartDate: periodStart,
    periodEndDate: periodEnd,
    currentDayNumber,
    totalDays,
    dailyData,
  };
}
