/**
 * Budget-recompute helper for expense records, extracted from
 * routes/expenses.ts. Budget baselines are recomputed via the budget-linking lib.
 */
import { prisma } from '@budget-tracker/db';
import { recomputeBudgetFromLinks } from './budget-linking.js';

/**
 * Look up whether an expense is linked to a budget and, if so,
 * recompute that budget's derived baseline. Failures are logged
 * but never propagate — the expense operation always succeeds.
 */
export async function triggerBudgetRecompute(expenseId: string): Promise<void> {
  try {
    const link = await prisma.budgetExpenseLink.findUnique({
      where: { expenseId },
    });
    if (link) {
      const currentMonth = new Date().getUTCMonth() + 1;
      await recomputeBudgetFromLinks(link.categoryBudgetId, currentMonth);
    }
  } catch (err) {
    console.warn('Failed to recompute budget from links:', err);
  }
}
