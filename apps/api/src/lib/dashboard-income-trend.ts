/**
 * Income vs expenses trend aggregation for the current calendar year, extracted
 * from routes/dashboard.ts. Read-only (schedule generation is idempotent).
 */
import type { z } from 'zod';
import { prisma } from '@budget-tracker/db';
import type { IncomeTrendResponseSchema } from '@budget-tracker/core';
import { generateSchedule } from './schedule-generator.js';
import { localDate, makeDate, today as todayLocal, dayAfter } from './dates.js';
import { ensurePeriodsExist } from './pay-periods.js';
import {
  classifyPeriod,
  computePastPeriodTotals,
  computeCurrentPeriodTotals,
  computeFuturePeriodTotals,
  prorateBudgetToPeriod,
  getPeriodsPerYear,
  isSeasonalBudgetActiveForPeriod,
} from './income-trend.js';

export type IncomeTrendOutcome =
  | { ok: false; error: string }
  | { ok: true; result: z.infer<typeof IncomeTrendResponseSchema> };

/** Compute the per-pay-period income/expense/budget trend for the current year. */
export async function computeIncomeTrend(query: {
  scheduleId?: string;
}): Promise<IncomeTrendOutcome> {
  const today = todayLocal();
  const { year } = localDate(today);

  // 1. Resolve PaySchedule
  let schedule;
  if (query.scheduleId) {
    schedule = await prisma.paySchedule.findUnique({ where: { id: query.scheduleId } });
    if (!schedule) return { ok: false as const, error: 'Pay schedule not found' };
  } else {
    schedule = await prisma.paySchedule.findFirst({ where: { isDefault: true } });
    if (!schedule) {
      schedule = await prisma.paySchedule.findFirst({ orderBy: { createdAt: 'asc' } });
    }
    if (!schedule) return { ok: false as const, error: 'No pay schedule found' };
  }

  // 2. Ensure periods exist for the full current calendar year
  await ensurePeriodsExist();

  // 3. Query all PayPeriods for the current year, ordered by startDate ascending
  const yearStart = makeDate(year, 0, 1);
  const yearEnd = makeDate(year, 11, 31);
  const periods = await prisma.payPeriod.findMany({
    where: {
      scheduleId: schedule.id,
      startDate: { lte: yearEnd },
      endDate: { gte: yearStart },
    },
    orderBy: { startDate: 'asc' },
  });

  // 4. Query unlinked budgets: current year's YearPlan → budget allocations with no BudgetExpenseLink
  const yearPlan = await prisma.yearPlan.findUnique({ where: { year } });
  const periodsPerYear = getPeriodsPerYear(schedule.type);

  // Pre-compute unlinked budget data (latest version per budget)
  const unlinkedBudgetData: Array<{ monthlyEquivalent: number; activeMonths: number[] }> = [];
  // Pre-compute ALL budget data for total period budget projection
  const allBudgetData: Array<{ monthlyEquivalent: number; activeMonths: number[] }> = [];
  if (yearPlan) {
    const allBudgetAllocations = await prisma.categoryBudget.findMany({
      where: {
        yearPlanId: yearPlan.id,
        removedAt: null,
        doneForYear: false,
      },
      include: {
        versions: { orderBy: { effectiveDate: 'desc' }, take: 1 },
        _count: { select: { budgetExpenseLinks: true } },
      },
    });

    for (const cb of allBudgetAllocations) {
      const latestVersion = cb.versions[0];
      if (!latestVersion) continue;
      const entry = {
        monthlyEquivalent: Number(latestVersion.monthlyEquivalent),
        activeMonths: latestVersion.activeMonths.map((m) => m - 1),
      };
      allBudgetData.push(entry);
      if (cb._count.budgetExpenseLinks === 0) {
        unlinkedBudgetData.push(entry);
      }
    }
  }

  // 5. Lazy-generate ScheduledTransaction rows for the full year in one call
  //    (avoids the per-day cache in generateSchedule skipping subsequent periods)
  if (periods.length > 0) {
    const firstStart = periods[0]!.startDate;
    const lastEnd = periods[periods.length - 1]!.endDate;
    await generateSchedule({ periodStart: firstStart, periodEnd: lastEnd });
  }

  // 6. Build account type map for filtering non-cash income
  const allAccounts = await prisma.account.findMany({ select: { id: true, type: true } });
  const accountTypeMap = new Map(allAccounts.map((a) => [a.id, a.type]));

  // 7. Build data points for each period
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const dataPoints: z.infer<typeof IncomeTrendResponseSchema> = [];

  for (const period of periods) {
    const periodStart = period.startDate;
    const periodEnd = period.endDate;

    // Query actual Transactions within the period date range
    const transactions = await prisma.transaction.findMany({
      where: { date: { gte: periodStart, lt: dayAfter(periodEnd) }, parentId: null },
      select: { amount: true, netAmount: true, type: true, date: true, accountId: true },
    });

    // Query ScheduledTransactions within the period date range
    const scheduledTxns = await prisma.scheduledTransaction.findMany({
      where: { dueDate: { gte: periodStart, lt: dayAfter(periodEnd) } },
      select: {
        expectedAmount: true,
        sourceType: true,
        status: true,
        dueDate: true,
        income: { select: { accountId: true } },
      },
    });

    // Classify period and compute totals
    const classification = classifyPeriod(periodStart, periodEnd, today);

    // Filter out income that doesn't hit Checking/Savings/Cash accounts
    const cashAccountTypes = new Set(['Checking', 'Savings', 'Cash']);
    const txData = transactions
      .filter((t) => {
        if (t.type !== 'INCOME') return true;
        const acctType = accountTypeMap.get(t.accountId ?? '') ?? null;
        return acctType === null || cashAccountTypes.has(acctType);
      })
      .map((t) => ({
        amount: Number(t.amount),
        netAmount: Number(t.netAmount),
        type: t.type,
        parentId: null as string | null,
        date: t.date,
      }));

    const stData = scheduledTxns
      .filter((s) => {
        if (s.sourceType !== 'INCOME') return true;
        const acctType = accountTypeMap.get(s.income?.accountId ?? '') ?? null;
        return acctType === null || cashAccountTypes.has(acctType);
      })
      .map((s) => ({
        expectedAmount: Number(s.expectedAmount),
        sourceType: s.sourceType as 'INCOME' | 'EXPENSE',
        status: s.status,
        dueDate: s.dueDate,
      }));

    let income: number;
    let expenses: number;
    let trades: number;

    if (classification.type === 'past') {
      const totals = computePastPeriodTotals(txData, periodStart, periodEnd);
      income = totals.income;
      expenses = totals.expenses;
      trades = totals.trades;
    } else if (classification.type === 'current') {
      const totals = computeCurrentPeriodTotals(txData, stData, periodStart, periodEnd);
      income = totals.income;
      expenses = totals.expenses;
      trades = totals.trades;
    } else {
      const totals = computeFuturePeriodTotals(stData, periodStart, periodEnd);
      income = totals.income;
      expenses = totals.expenses;
      trades = 0;
    }

    // Compute budgetExpenses: total budget allocation for the period.
    // - Past periods: $0 (actuals only)
    // - Current/Future periods: use total budget as projected expenses,
    //   replacing the actual/scheduled expenses with the budget projection.
    //   net = income - budgetExpenses gives the true projected savings.
    let budgetExpenses = 0;
    if (classification.type !== 'past') {
      let totalBudgetProjection = 0;
      for (const budget of allBudgetData) {
        if (isSeasonalBudgetActiveForPeriod(budget.activeMonths, periodStart, periodEnd)) {
          totalBudgetProjection += prorateBudgetToPeriod(budget.monthlyEquivalent, periodsPerYear);
        }
      }
      // For current/future: budget projection replaces expenses entirely
      // so that net = income - expenses - trades - budgetExpenses
      // becomes income - 0 - trades - totalBudget = income - trades - totalBudget
      budgetExpenses = totalBudgetProjection;
      expenses = 0; // zero out expenses since budget covers everything
    }

    // Format periodLabel from payDate (e.g., "Jan 6")
    const pd = localDate(period.payDate);
    const periodLabel = `${monthNames[pd.month]} ${pd.day}`;

    dataPoints.push({
      periodLabel,
      startDate: periodStart,
      endDate: periodEnd,
      income: Math.round(income * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      trades: Math.round(trades * 100) / 100,
      budgetExpenses: Math.round(budgetExpenses * 100) / 100,
      projected: classification.projected,
    });
  }

  return { ok: true as const, result: dataPoints };
}
