/**
 * List-with-status computation for category budgets, extracted from the GET /
 * handler in routes/category-budgets.ts. Resolves each budget to a specific
 * month, computes actual spending (net of refunds, split-aware) and the
 * pay-period effective-expected figure. Read-only — no ledger mutations.
 */
import { prisma } from '@budget-tracker/db';
import type { z } from 'zod';
import type { BudgetStatusResponseSchema } from '@budget-tracker/core';
import { resolveEffectiveVersion, computeBudgetStatus, isSeasonalActiveInMonth } from './budget.js';
import { localDate, today } from './dates.js';
import { generateSchedule } from './schedule-generator.js';
import { prorateBudget } from './spend-prediction.js';
import { serializeCategoryBudget, budgetInclude } from './category-budget-serialization.js';

export interface ListBudgetStatusesQuery {
  yearPlanId: string;
  month?: number;
  year?: number;
  includeSeasonal: boolean;
  periodStart?: Date;
  periodEnd?: Date;
  viewMode?: 'PAY_PERIOD' | 'MONTHLY' | 'ANNUAL';
}

type BudgetStatusResponse = z.infer<typeof BudgetStatusResponseSchema>;

/**
 * Compute the status list for a year plan's budgets. Returns `null` when the
 * year plan does not exist.
 */
export async function listBudgetStatuses(
  query: ListBudgetStatusesQuery,
): Promise<BudgetStatusResponse[] | null> {
  const now = today();
  const nd = localDate(now);
  const month = query.month ?? nd.month + 1;
  const year = query.year ?? nd.year;

  const yearPlan = await prisma.yearPlan.findUnique({ where: { id: query.yearPlanId } });
  if (!yearPlan) return null;

  const budgets = await prisma.categoryBudget.findMany({
    where: { yearPlanId: query.yearPlanId, removedAt: null },
    include: budgetInclude,
  });

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  // Use pay period dates if provided, otherwise calendar month
  const spendStart = query.periodStart ?? monthStart;
  const spendEnd = query.periodEnd ?? monthEnd;
  const isPeriodMode = !!(query.periodStart && query.periodEnd) && query.viewMode !== 'ANNUAL';

  // In pay period mode, compute recurring expense totals per category
  // using the same logic as the spend prediction
  const recurringByCategory = new Map<string, number>();
  let scheduleType = 'BIWEEKLY';
  if (isPeriodMode) {
    await generateSchedule({ periodStart: spendStart, periodEnd: spendEnd });

    // Get the pay schedule type for proration
    const schedule =
      (await prisma.paySchedule.findFirst({ where: { isDefault: true } })) ??
      (await prisma.paySchedule.findFirst({ orderBy: { createdAt: 'asc' } }));
    if (schedule) scheduleType = schedule.type;

    // Sum recurring expenses per category from ScheduledTransaction rows
    const scheduleRows = await prisma.scheduledTransaction.findMany({
      where: {
        dueDate: { gte: spendStart, lte: spendEnd },
        sourceType: 'EXPENSE',
      },
      include: { expense: { select: { id: true, budgetId: true } } },
    });
    for (const row of scheduleRows) {
      if (!row.expense?.budgetId) continue;
      const catId = row.expense.budgetId;
      recurringByCategory.set(
        catId,
        (recurringByCategory.get(catId) ?? 0) + Number(row.expectedAmount),
      );
    }
  }

  // Batch query: actual spending per category for the period
  // Net spending = expenses minus refunds tagged to the same budget
  // Split transaction handling:
  //   - Non-split transactions (no children): count full amount toward their budgetId
  //   - Child transactions: count their amount toward their budgetId
  //   - Split parents (have children): count (parent.amount - sum(children.amount)) toward parent's budgetId
  //     This "remainder" is the portion the user kept on the original category (row 1 in the split modal)
  const categoryIds = budgets.map((b) => b.budgetId);
  const spendingByCategory = new Map<string, number>();
  if (categoryIds.length > 0) {
    // 1. Sum all non-parent transactions (unsplit + children) per budgetId
    const [spendingRows, refundRows] = await Promise.all([
      prisma.transaction.groupBy({
        by: ['budgetId'],
        _sum: { amount: true },
        where: {
          type: 'EXPENSE',
          budgetId: { in: categoryIds },
          date: { gte: spendStart, lt: spendEnd },
          NOT: { children: { some: {} } },
        },
      }),
      prisma.transaction.groupBy({
        by: ['budgetId'],
        _sum: { amount: true },
        where: {
          type: 'REFUND',
          budgetId: { in: categoryIds },
          date: { gte: spendStart, lt: spendEnd },
          NOT: { children: { some: {} } },
        },
      }),
    ]);
    for (const row of spendingRows) {
      spendingByCategory.set(row.budgetId!, row._sum.amount?.toNumber() ?? 0);
    }
    for (const row of refundRows) {
      const current = spendingByCategory.get(row.budgetId!) ?? 0;
      spendingByCategory.set(row.budgetId!, current - (row._sum.amount?.toNumber() ?? 0));
    }

    // 2. For split parents: add the remainder (parent.amount - sum(children.amount)) to parent's budgetId
    const splitParents = await prisma.transaction.findMany({
      where: {
        type: 'EXPENSE',
        budgetId: { in: categoryIds },
        date: { gte: spendStart, lt: spendEnd },
        children: { some: {} },
      },
      select: { id: true, amount: true, budgetId: true, children: { select: { amount: true } } },
    });
    for (const parent of splitParents) {
      const childSum = parent.children.reduce((sum, ch) => sum + Number(ch.amount), 0);
      const remainder = Number(parent.amount) - childSum;
      if (remainder > 0 && parent.budgetId) {
        const current = spendingByCategory.get(parent.budgetId) ?? 0;
        spendingByCategory.set(parent.budgetId, current + remainder);
      }
    }
  }

  const results: BudgetStatusResponse[] = [];

  for (const budget of budgets) {
    const effectiveVersion = resolveEffectiveVersion(budget.versions, month, year);
    if (
      !query.includeSeasonal &&
      effectiveVersion &&
      effectiveVersion.activeMonths.length > 0 &&
      !isSeasonalActiveInMonth(effectiveVersion.activeMonths, month)
    )
      continue;

    const actualSpending = spendingByCategory.get(budget.budgetId) ?? 0;

    // In pay period mode, determine effectiveExpected based on whether the budget
    // has linked recurring expenses:
    // - Linked expenses exist AND some are due: max(recurring, prorated budget)
    // - Linked expenses exist but none due this period: $0
    // - No linked expenses (discretionary): prorated budget
    let effectiveExpected: number | undefined;
    if (isPeriodMode && effectiveVersion) {
      const recurringTotal = recurringByCategory.get(budget.budgetId) ?? 0;
      const hasLinkedExpenses = budget._count.budgetExpenseLinks > 0;
      const monthlyBudget = effectiveVersion.monthlyEquivalent.toNumber();
      const activeMonths =
        effectiveVersion.activeMonths.length > 0 ? effectiveVersion.activeMonths : null;
      const proratedBudget = prorateBudget(
        monthlyBudget,
        'MONTHLY',
        activeMonths,
        scheduleType,
        spendStart,
        spendEnd,
      );

      if (hasLinkedExpenses) {
        // Mandatory: driven by recurring schedule
        if (recurringTotal > 0) {
          effectiveExpected = Math.max(recurringTotal, proratedBudget);
        } else {
          // No recurring expenses due this period — still show prorated budget
          effectiveExpected = proratedBudget;
        }
      } else {
        // Discretionary: prorated budget applies every period
        effectiveExpected = proratedBudget;
      }
    }

    // Determine if this seasonal budget is inactive for the current month
    const isInactiveSeasonal =
      effectiveVersion &&
      effectiveVersion.activeMonths.length > 0 &&
      !isSeasonalActiveInMonth(effectiveVersion.activeMonths, month);

    /*
     * Seasonal zeroing is a statement about THIS MONTH, so it has no business in
     * the annual view. A summer-only budget is genuinely zero in December —
     * looking at December. Looking at the YEAR it had a real allocation and real
     * spending, and zeroing drops it out of the annual totals entirely. Same for
     * `doneForYear`: finished is not the same as never budgeted.
     */
    const isAnnual = query.viewMode === 'ANNUAL';
    const isZeroed = !isAnnual && (isInactiveSeasonal || budget.doneForYear);

    /*
     * The ANNUAL view compares a YEAR of spending, so it compares against a YEAR
     * of budget — x12, matching `convertToFrequency(monthly, 'ANNUAL')` in the
     * web app. Without it the status badge measured months of spending against
     * one month's allocation and read "over" on nearly everything, while the
     * card beside it drew its progress bar against x12: two numbers on one card
     * disagreeing about what period they described.
     */
    const monthly = effectiveVersion ? effectiveVersion.monthlyEquivalent.toNumber() : 0;
    // A seasonal budget has (active months) of annual allowance, not twelve —
    // judging three months of budget against a year calls it wildly under-spent.
    const annualMonths =
      effectiveVersion && effectiveVersion.activeMonths.length > 0
        ? effectiveVersion.activeMonths.length
        : 12;
    const compareAmount = isZeroed
      ? 0
      : (effectiveExpected ?? (isAnnual ? monthly * annualMonths : monthly));
    const status = effectiveVersion ? computeBudgetStatus(actualSpending, compareAmount) : null;

    const serialized = serializeCategoryBudget(budget, effectiveVersion);
    // Zero out budget amounts for inactive seasonal or done-for-year budgets so totals are correct
    if (isZeroed && serialized.version) {
      serialized.version.monthlyEquivalent = 0;
    }
    const finalEffectiveExpected = isZeroed ? 0 : effectiveExpected;

    results.push({
      ...serialized,
      actualSpending,
      effectiveExpected: finalEffectiveExpected,
      status,
    });
  }

  return results;
}
