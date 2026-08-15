import type { BudgetFrequency, Frequency } from '@budget-tracker/core';
import { prisma } from '@budget-tracker/db';
import { convertMonthlyToFrequency } from './budget.js';

/**
 * Convert an expense amount at any Frequency to its monthly equivalent.
 * ONE_TIME expenses return 0 (excluded from recurring baselines).
 * Results are rounded to 2 decimal places.
 */
export function computeExpenseMonthlyEquivalent(amount: number, frequency: Frequency): number {
  let result: number;
  switch (frequency) {
    case 'WEEKLY':
      result = amount * (52 / 12);
      break;
    case 'BIWEEKLY':
      result = amount * (26 / 12);
      break;
    case 'SEMI_MONTHLY':
      result = amount * 2;
      break;
    case 'MONTHLY':
      result = amount;
      break;
    case 'QUARTERLY':
      result = amount / 3;
      break;
    case 'BIANNUAL':
      result = amount / 6;
      break;
    case 'ANNUAL':
      result = amount / 12;
      break;
    case 'ONE_TIME':
      return 0;
  }
  return Math.round(result * 100) / 100;
}

/**
 * Resolve the current amount for an expense in a given month.
 * If the expense has an amountSchedule with an entry for the month, use it.
 * Otherwise, fall back to the base amount.
 */
export function resolveCurrentAmount(
  expense: { amount: number; amountSchedule: Record<string, number> | null },
  month: number,
): number {
  if (expense.amountSchedule) {
    const key = String(month);
    if (key in expense.amountSchedule) {
      return expense.amountSchedule[key] ?? expense.amount;
    }
  }
  return expense.amount;
}

/**
 * Compute the derived baseline from a set of linked expenses for a given month.
 * Only active expenses (not paused, not archived) contribute to the sum.
 * Each active expense's current amount is resolved and converted to a monthly equivalent.
 * The result is rounded to 2 decimal places.
 */
export function computeDerivedBaseline(
  linkedExpenses: Array<{
    amount: number;
    frequency: Frequency;
    amountSchedule: Record<string, number> | null;
    pausedUntil: Date | null;
    archivedAt: Date | null;
  }>,
  month: number,
): number {
  const sum = linkedExpenses.reduce((total, expense) => {
    if (expense.pausedUntil !== null || expense.archivedAt !== null) {
      return total;
    }
    const currentAmount = resolveCurrentAmount(expense, month);
    return total + computeExpenseMonthlyEquivalent(currentAmount, expense.frequency);
  }, 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Apply the high-water mark policy: the effective amount is the maximum
 * of the derived baseline and the current high-water mark.
 */
export function applyHighWaterMark(
  derivedBaseline: number,
  currentHighWaterMark: number,
): { effectiveAmount: number; highWaterMark: number } {
  const value = Math.max(derivedBaseline, currentHighWaterMark);
  return { effectiveAmount: value, highWaterMark: value };
}

/**
 * Recompute a budget's amount from its linked expenses.
 *
 * Steps:
 * 1. Fetch the CategoryBudget with linked expenses and latest BudgetVersion
 * 2. If no linked expenses, return early
 * 3. If latest version has manualOverride = true, return early
 * 4. Compute derived baseline from linked expenses
 * 5. Apply high-water mark policy
 * 6. Update CategoryBudget.highWaterMark if changed
 * 7. Update the latest BudgetVersion amount and monthlyEquivalent
 */
export async function recomputeBudgetFromLinks(
  categoryBudgetId: string,
  month: number,
): Promise<void> {
  const budget = await prisma.categoryBudget.findUnique({
    where: { id: categoryBudgetId },
    include: {
      budgetExpenseLinks: {
        include: {
          expense: true,
        },
      },
      versions: {
        orderBy: { effectiveDate: 'desc' },
        take: 1,
      },
    },
  });

  if (!budget) return;

  // No linked expenses → nothing to recompute
  if (budget.budgetExpenseLinks.length === 0) return;

  const latestVersion = budget.versions[0];
  if (!latestVersion) return;

  // Skip auto-adjustment if the latest version was manually overridden
  if (latestVersion.manualOverride) return;

  // Build the linked expenses array for computeDerivedBaseline
  const linkedExpenses = budget.budgetExpenseLinks.map((link) => ({
    amount: link.expense.amount.toNumber(),
    frequency: link.expense.frequency as Frequency,
    amountSchedule: link.expense.amountSchedule as Record<string, number> | null,
    pausedUntil: link.expense.pausedUntil,
    archivedAt: link.expense.archivedAt,
  }));

  const derivedBaseline = computeDerivedBaseline(linkedExpenses, month);
  const currentHWM = budget.highWaterMark.toNumber();
  // Use the current budget amount as a floor so linking a smaller expense doesn't reduce the budget
  const currentBudgetAmount = latestVersion.monthlyEquivalent.toNumber();
  const effectiveHWM = Math.max(currentHWM, currentBudgetAmount);
  const { effectiveAmount, highWaterMark: newHWM } = applyHighWaterMark(
    derivedBaseline,
    effectiveHWM,
  );

  // Recalculate monthlyEquivalent for the version based on its frequency
  const frequency = latestVersion.frequency as BudgetFrequency;
  const activeMonths = latestVersion.activeMonths;

  // effectiveAmount is in monthly terms (from computeDerivedBaseline).
  const monthlyEquivalent = effectiveAmount;

  // When all active expenses share the same frequency as the budget, sum their
  // native amounts directly to avoid rounding errors from the monthly round-trip.
  const activeExpenses = linkedExpenses.filter(
    (e) => e.pausedUntil === null && e.archivedAt === null,
  );
  const allSameFreq =
    activeExpenses.length > 0 &&
    activeExpenses.every(
      (e) => e.frequency === frequency || (frequency === 'YEARLY' && e.frequency === 'ANNUAL'),
    );
  let nativeAmount: number;
  if (allSameFreq) {
    const nativeSum =
      Math.round(activeExpenses.reduce((sum, e) => sum + resolveCurrentAmount(e, month), 0) * 100) /
      100;
    nativeAmount = Math.max(
      nativeSum,
      convertMonthlyToFrequency(
        currentHWM,
        frequency,
        activeMonths.length > 0 ? activeMonths : undefined,
      ),
    );
  } else {
    nativeAmount = convertMonthlyToFrequency(
      monthlyEquivalent,
      frequency,
      activeMonths.length > 0 ? activeMonths : undefined,
    );
  }

  // Update highWaterMark on CategoryBudget and amount on BudgetVersion
  await prisma.$transaction([
    prisma.categoryBudget.update({
      where: { id: categoryBudgetId },
      data: { highWaterMark: newHWM },
    }),
    prisma.budgetVersion.update({
      where: { id: latestVersion.id },
      data: { amount: nativeAmount, monthlyEquivalent },
    }),
  ]);
}
