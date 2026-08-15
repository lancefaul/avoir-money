/**
 * Year-to-date summary aggregation, extracted from routes/dashboard.ts. Read-only.
 */
import type { z } from 'zod';
import { prisma } from '@budget-tracker/db';
import type { YTDSummarySchema } from '@budget-tracker/core';
import { localDate, makeDate, today as todayLocal, dayAfter } from './dates.js';
import { spendAmount } from './dashboard-shared.js';

type YTDSummary = z.infer<typeof YTDSummarySchema>;

/** Compute the year-to-date summary over pay-period boundaries. */
export async function computeYtdSummary(query: { year?: number }): Promise<YTDSummary> {
  // UTC year — a local getter would report the wrong year near the Jan 1 boundary.
  const year = query.year ?? localDate(todayLocal()).year;

  // Use pay period boundaries instead of calendar year so YTD matches the savings outlook chart.
  // Find the first period whose startDate falls in this year, and the last period whose startDate
  // falls in this year. The date range spans from the first period's startDate to the last period's endDate.
  const calYearStart = makeDate(year, 0, 1);
  const calYearEnd = makeDate(year, 11, 31);

  const firstPeriod = await prisma.payPeriod.findFirst({
    where: { startDate: { gte: calYearStart, lte: calYearEnd } },
    orderBy: { startDate: 'asc' },
    select: { startDate: true },
  });
  const lastPeriod = await prisma.payPeriod.findFirst({
    where: { startDate: { gte: calYearStart, lte: calYearEnd } },
    orderBy: { startDate: 'desc' },
    select: { endDate: true },
  });

  // Fall back to calendar year if no periods exist
  const rangeStart = firstPeriod?.startDate ?? calYearStart;
  const rangeEnd = lastPeriod?.endDate ?? calYearEnd;

  const transactions = await prisma.transaction.findMany({
    where: {
      date: { gte: rangeStart, lt: dayAfter(rangeEnd) },
    },
    include: {
      expense: { include: { budget: { include: { group: true } } } },
      income: { include: { budget: { include: { group: true } } } },
    },
  });

  const incomeTxs = transactions.filter((t) => t.parentId == null && t.type === 'INCOME');
  const expenseTxs = transactions.filter((t) => t.parentId == null && t.expenseId != null);
  const refundTxs = transactions.filter((t) => t.parentId == null && t.type === 'REFUND');
  const allExpenseTypeTxs = transactions.filter((t) => t.parentId == null && t.type === 'EXPENSE');

  const totalIncome = incomeTxs.reduce((sum, t) => sum + Number(t.amount), 0);
  const totalExpenses =
    allExpenseTypeTxs.reduce((sum, t) => sum + spendAmount(t), 0) -
    refundTxs.reduce((sum, t) => sum + spendAmount(t), 0);

  // Group expenses by category
  const categoryMap = new Map<
    string,
    { budgetId: string; categoryName: string; group: string; total: number }
  >();

  for (const t of expenseTxs) {
    if (!t.expense?.budget) continue;
    const cat = t.expense.budget;
    const existing = categoryMap.get(cat.id);
    if (existing) {
      existing.total += spendAmount(t);
    } else {
      categoryMap.set(cat.id, {
        budgetId: cat.id,
        categoryName: cat.name,
        group: cat.group?.name ?? 'Unknown',
        total: spendAmount(t),
      });
    }
  }

  const byCategory = Array.from(categoryMap.values())
    .sort((a, b) => b.total - a.total)
    .map((item) => ({
      budgetId: item.budgetId,
      categoryName: item.categoryName,
      group: item.group as YTDSummary['byCategory'][number]['group'],
      total: item.total,
    }));

  const result: YTDSummary = {
    year,
    startDate: rangeStart,
    endDate: rangeEnd,
    totalIncome,
    totalExpenses,
    netIncome: totalIncome - totalExpenses,
    byCategory,
  };

  return result;
}
