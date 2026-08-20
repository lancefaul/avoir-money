import type { BudgetFrequency } from '@budget-tracker/core';

/**
 * Convert a monthly amount back to the budget's native frequency.
 * Inverse of computeMonthlyEquivalent.
 */
export function convertMonthlyToFrequency(
  monthlyAmount: number,
  frequency: BudgetFrequency,
  activeMonths?: number[],
): number {
  switch (frequency) {
    case 'WEEKLY':
      return monthlyAmount / (52 / 12);
    case 'BIWEEKLY':
      return monthlyAmount / (26 / 12);
    case 'SEMI_MONTHLY':
      return monthlyAmount / 2;
    case 'MONTHLY':
      return monthlyAmount;
    case 'QUARTERLY':
      return monthlyAmount * 3;
    case 'BIANNUAL':
      return monthlyAmount * 6;
    case 'ANNUAL':
    case 'YEARLY': {
      const months = activeMonths && activeMonths.length > 0 ? activeMonths.length : 12;
      return monthlyAmount * months;
    }
  }
}

/**
 * Convert a budget amount at a given frequency to its monthly equivalent.
 * For YEARLY seasonal budgets, divides by the number of active months instead of 12.
 */
export function computeMonthlyEquivalent(
  amount: number,
  frequency: BudgetFrequency,
  activeMonths?: number[],
): number {
  switch (frequency) {
    case 'WEEKLY':
      return amount * (52 / 12);
    case 'BIWEEKLY':
      return amount * (26 / 12);
    case 'SEMI_MONTHLY':
      return amount * 2;
    case 'MONTHLY':
      return amount;
    case 'QUARTERLY':
      return amount / 3;
    case 'BIANNUAL':
      return amount / 6;
    case 'ANNUAL':
    case 'YEARLY': {
      const divisor = activeMonths && activeMonths.length > 0 ? activeMonths.length : 12;
      return amount / divisor;
    }
  }
}

/**
 * Find the version with the latest effectiveDate on or before the first
 * of the target month/year. Returns null if no version qualifies.
 */
export function resolveEffectiveVersion<T extends { effectiveDate: Date }>(
  versions: T[],
  month: number,
  year: number,
): T | null {
  const targetUtc = Date.UTC(year, month - 1, 1);

  let best: T | null = null;
  let bestTime = -Infinity;

  for (const v of versions) {
    const t = v.effectiveDate.getTime();
    if (t <= targetUtc && t > bestTime) {
      best = v;
      bestTime = t;
    }
  }

  return best;
}

/**
 * Classify actual spending against the monthly budget equivalent.
 * under: < 80%, near: 80–100%, over: > 100%
 */
export function computeBudgetStatus(
  actual: number,
  monthlyEquivalent: number,
): 'under' | 'near' | 'over' | null {
  if (monthlyEquivalent === 0) return null;
  if (actual < 0.8 * monthlyEquivalent) return 'under';
  if (actual > monthlyEquivalent) return 'over';
  return 'near';
}

/**
 * Check whether a seasonal budget is active in a given month.
 * An empty activeMonths array means non-seasonal (always active).
 */
export function isSeasonalActiveInMonth(activeMonths: number[], month: number): boolean {
  if (activeMonths.length === 0) return true;
  return activeMonths.includes(month);
}
