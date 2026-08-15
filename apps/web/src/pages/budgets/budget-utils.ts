import type { BudgetStatusResponse } from '@budget-tracker/core';
import type { CategoryWithBudget, CategoryBudgetGroup, DisplayFrequency } from './types.js';

// ─── Frequency Conversion ───

const FREQUENCY_TO_MONTHLY: Record<DisplayFrequency, number> = {
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  SEMI_MONTHLY: 2,
  MONTHLY: 1,
  QUARTERLY: 1 / 3,
  BIANNUAL: 1 / 6,
  ANNUAL: 1 / 12,
};

/**
 * Convert a monthly-equivalent amount to the target display frequency.
 * Inverse of the to-monthly multipliers: WEEKLY × (12/52), BIWEEKLY × (12/26), etc.
 */
export function convertToFrequency(
  monthlyAmount: number,
  targetFrequency: DisplayFrequency,
): number {
  return monthlyAmount / FREQUENCY_TO_MONTHLY[targetFrequency];
}

/**
 * Convert an amount in the given source frequency back to its monthly equivalent.
 */
export function convertFromFrequency(amount: number, sourceFrequency: DisplayFrequency): number {
  return amount * FREQUENCY_TO_MONTHLY[sourceFrequency];
}

// ─── Row Transform ───

interface CategoryRow {
  id: string;
  name: string;
  groupId: string;
  groupName?: string;
  groupColor?: string;
  icon: string | null;
}

/**
 * Merge a category record with its budget status into a single UI row.
 * `budgetStatus` is null when the category has no budget for the current period.
 */
export function transformBudgetRow(
  category: CategoryRow,
  budgetStatus: BudgetStatusResponse | null,
  previousVersionId?: string | null,
): CategoryWithBudget {
  const monthlyEquivalent = budgetStatus?.version?.monthlyEquivalent ?? 0;
  const actualSpending = budgetStatus?.actualSpending ?? 0;
  const currentVersionId = budgetStatus?.version?.id ?? null;
  // When effectiveExpected is provided (pay period mode), use it directly
  // It's already in pay-period terms with max(recurring, prorated budget) applied
  const effectiveExpected = (budgetStatus as { effectiveExpected?: number })?.effectiveExpected;
  const budgetAmount = effectiveExpected ?? monthlyEquivalent;

  return {
    id: category.id,
    name: category.name,
    groupId: category.groupId,
    groupName: category.groupName ?? '',
    groupColor: category.groupColor ?? '#6b7280',
    icon: category.icon,
    budgetId: budgetStatus?.id ?? null,
    monthlyEquivalent: budgetAmount,
    nativeAmount: budgetStatus?.version?.amount ?? 0,
    budgetFrequency: budgetStatus?.version?.frequency ?? 'MONTHLY',
    activeMonths: budgetStatus?.version?.activeMonths ?? [],
    actualSpending,
    remaining: budgetAmount - actualSpending,
    status: budgetStatus?.status ?? null,
    isVersionChanged: detectVersionChange(currentVersionId, previousVersionId ?? null),
    seasonal: budgetStatus?.seasonal ?? false,
    versionId: currentVersionId,
    linkedExpenseCount: budgetStatus?.linkedExpenseCount ?? 0,
    manualOverride: budgetStatus?.version?.manualOverride ?? false,
  };
}

// ─── Grouping ───

/**
 * Group flat category-budget rows by their categoryGroup and compute subtotals.
 */
export function groupCategoriesWithBudgets(rows: CategoryWithBudget[]): CategoryBudgetGroup[] {
  const map = new Map<string, CategoryBudgetGroup>();

  for (const row of rows) {
    let group = map.get(row.groupId);
    if (!group) {
      group = {
        groupName: row.groupName,
        groupColor: row.groupColor,
        rows: [],
        subtotalBudgeted: 0,
        subtotalActual: 0,
        subtotalRemaining: 0,
      };
      map.set(row.groupId, group);
    }
    group.rows.push(row);
    group.subtotalBudgeted += row.monthlyEquivalent;
    group.subtotalActual += row.actualSpending;
    group.subtotalRemaining += row.remaining;
  }

  return Array.from(map.values());
}

// ─── Overall Totals ───

export function computeOverallTotals(groups: CategoryBudgetGroup[]): {
  totalBudgeted: number;
  totalActual: number;
  totalRemaining: number;
} {
  let totalBudgeted = 0;
  let totalActual = 0;
  let totalRemaining = 0;

  for (const g of groups) {
    totalBudgeted += g.subtotalBudgeted;
    totalActual += g.subtotalActual;
    totalRemaining += g.subtotalRemaining;
  }

  return { totalBudgeted, totalActual, totalRemaining };
}

// ─── Version Change Detection ───

/**
 * Returns true when the current and previous version IDs differ,
 * including transitions from null → non-null or vice-versa.
 */
export function detectVersionChange(
  currentVersionId: string | null,
  previousVersionId: string | null,
): boolean {
  return currentVersionId !== previousVersionId;
}
