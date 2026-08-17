import { createRoute } from '@hono/zod-openapi';
import type { z } from 'zod';
import { prisma } from '@budget-tracker/db';
import {
  CurrentPeriodSummarySchema,
  CurrentPeriodQuerySchema,
  YTDSummarySchema,
  YTDQuerySchema,
  TrendsSummarySchema,
  TrendsQuerySchema,
  BudgetBreakdownSchema,
  BudgetBreakdownQuerySchema,
  GoalProgressListSchema,
  IncomeTrendQuerySchema,
  IncomeTrendResponseSchema,
  SpendPredictionResponseSchema,
  SpendPredictionQuerySchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { generateSchedule } from '../lib/schedule-generator.js';
import { localDate, today as todayLocal, dayAfter } from '../lib/dates.js';
import { computeSpendPrediction } from '../lib/spend-prediction.js';
import { NOT_PAYMENT_LEG } from '../lib/purchase-group.js';
import { resolveEffectiveVersion } from '../lib/budget.js';
import { computeCurrentPeriodSummary } from '../lib/dashboard-current-period.js';
import { computeYtdSummary } from '../lib/dashboard-ytd.js';
import { computeIncomeTrend } from '../lib/dashboard-income-trend.js';
import { spendAmount } from '../lib/dashboard-shared.js';

type TrendsSummary = z.infer<typeof TrendsSummarySchema>;
type BudgetBreakdown = z.infer<typeof BudgetBreakdownSchema>;
type GoalProgressList = z.infer<typeof GoalProgressListSchema>;

const app = createRouter();

// ─── GET /current-period ───

const currentPeriodRoute = createRoute({
  method: 'get',
  path: '/current-period',
  tags: ['Dashboard'],
  summary: 'Get current pay period summary',
  request: { query: CurrentPeriodQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: CurrentPeriodSummarySchema } },
      description: 'Current period summary',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'No current pay period found',
    },
  },
});

app.openapi(currentPeriodRoute, async (c) => {
  const query = c.req.valid('query');
  const outcome = await computeCurrentPeriodSummary(query);
  if (!outcome.ok) return c.json({ error: outcome.error }, 404);
  return c.json(outcome.result, 200);
});

// ─── GET /ytd ───

const ytdRoute = createRoute({
  method: 'get',
  path: '/ytd',
  tags: ['Dashboard'],
  summary: 'Year-to-date summary',
  request: { query: YTDQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: YTDSummarySchema } },
      description: 'YTD summary',
    },
  },
});

app.openapi(ytdRoute, async (c) => {
  const query = c.req.valid('query');
  return c.json(await computeYtdSummary(query), 200);
});

// ─── GET /trends ───

const trendsRoute = createRoute({
  method: 'get',
  path: '/trends',
  tags: ['Dashboard'],
  summary: 'Income vs expenses trends over recent pay periods',
  request: { query: TrendsQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: TrendsSummarySchema } },
      description: 'Trends data',
    },
  },
});

app.openapi(trendsRoute, async (c) => {
  const query = c.req.valid('query');

  const where: Record<string, unknown> = {};
  if (query.scheduleId) where['scheduleId'] = query.scheduleId;
  if (query.dateFrom || query.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (query.dateFrom) dateFilter['gte'] = query.dateFrom;
    if (query.dateTo) dateFilter['lte'] = query.dateTo;
    where['payDate'] = dateFilter;
  }

  // Fetch most-recent N periods
  const periods = await prisma.payPeriod.findMany({
    where,
    orderBy: { payDate: 'desc' },
    take: query.periods,
  });

  // For each period, sum transactions
  const dataPoints = await Promise.all(
    periods.map(async (period) => {
      const txs = await prisma.transaction.findMany({
        where: { payPeriodId: period.id },
        select: { amount: true, netAmount: true, incomeId: true, expenseId: true },
      });

      const income = txs
        .filter((t) => t.incomeId != null)
        .reduce((sum, t) => sum + Number(t.amount), 0);
      const expenses = txs
        .filter((t) => t.expenseId != null)
        .reduce((sum, t) => sum + spendAmount(t), 0);

      // Format label: "Mar 6"
      const label = period.payDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });

      return {
        periodLabel: label,
        payDate: period.payDate,
        income,
        expenses,
        net: income - expenses,
      };
    }),
  );

  // Sort chronologically (ascending payDate)
  const result: TrendsSummary = dataPoints.sort(
    (a, b) => a.payDate.getTime() - b.payDate.getTime(),
  );

  return c.json(result, 200);
});

// ─── GET /category-breakdown ───

const categoryBreakdownRoute = createRoute({
  method: 'get',
  path: '/category-breakdown',
  tags: ['Dashboard'],
  summary: 'Expense breakdown by category',
  request: { query: BudgetBreakdownQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: BudgetBreakdownSchema } },
      description: 'Category breakdown',
    },
  },
});

app.openapi(categoryBreakdownRoute, async (c) => {
  const query = c.req.valid('query');

  const txWhere: Record<string, unknown> = {
    expenseId: { not: null },
  };
  if (query.payPeriodId) {
    txWhere['payPeriodId'] = query.payPeriodId;
  } else if (query.dateFrom || query.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (query.dateFrom) dateFilter['gte'] = query.dateFrom;
    if (query.dateTo) dateFilter['lte'] = query.dateTo;
    txWhere['date'] = dateFilter;
  }

  const transactions = await prisma.transaction.findMany({
    where: txWhere,
    include: { expense: { include: { budget: { include: { group: true } } } } },
  });

  // Filter by category group if provided
  const filtered = query.group
    ? transactions.filter((t) => t.expense?.budget?.group?.name === query.group)
    : transactions;

  // Group by category
  const categoryMap = new Map<
    string,
    {
      budgetId: string;
      categoryName: string;
      group: string;
      color: string | null;
      total: number;
      transactionCount: number;
    }
  >();

  for (const t of filtered) {
    if (!t.expense?.budget) continue;
    const cat = t.expense.budget;
    const existing = categoryMap.get(cat.id);
    if (existing) {
      existing.total += spendAmount(t);
      existing.transactionCount += 1;
    } else {
      categoryMap.set(cat.id, {
        budgetId: cat.id,
        categoryName: cat.name,
        group: cat.group?.name ?? 'Unknown',
        color: cat.group?.color ?? null,
        total: spendAmount(t),
        transactionCount: 1,
      });
    }
  }

  const grandTotal = Array.from(categoryMap.values()).reduce((sum, item) => sum + item.total, 0);

  const result: BudgetBreakdown = Array.from(categoryMap.values())
    .map((item) => ({
      budgetId: item.budgetId,
      categoryName: item.categoryName,
      group: item.group as BudgetBreakdown[number]['group'],
      color: item.color,
      total: item.total,
      percentage: grandTotal > 0 ? (item.total / grandTotal) * 100 : 0,
      transactionCount: item.transactionCount,
    }))
    .sort((a, b) => b.total - a.total);

  return c.json(result, 200);
});

// ─── GET /goal-progress ───

const goalProgressRoute = createRoute({
  method: 'get',
  path: '/goal-progress',
  tags: ['Dashboard'],
  summary: 'Progress toward all budget goals',
  responses: {
    200: {
      content: { 'application/json': { schema: GoalProgressListSchema } },
      description: 'Goal progress list',
    },
  },
});

app.openapi(goalProgressRoute, async (c) => {
  const goals = await prisma.budgetGoal.findMany({ orderBy: { createdAt: 'desc' } });

  const result: GoalProgressList = goals.map((goal) => {
    const targetAmount = Number(goal.targetAmount);
    const currentAmount = Number(goal.currentAmount);
    const percentComplete =
      targetAmount > 0 ? Math.min((currentAmount / targetAmount) * 100, 100) : 0;
    const remaining = Math.max(targetAmount - currentAmount, 0);

    return {
      id: goal.id,
      name: goal.name,
      type: goal.type as GoalProgressList[number]['type'],
      targetAmount,
      currentAmount,
      budgetId: goal.budgetId,
      deadline: goal.deadline,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      percentComplete,
      remaining,
    };
  });

  return c.json(result, 200);
});

// ─── GET /income-trend ───

const incomeTrendRoute = createRoute({
  method: 'get',
  path: '/income-trend',
  tags: ['Dashboard'],
  summary: 'Income vs expenses trend for the current calendar year',
  request: { query: IncomeTrendQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: IncomeTrendResponseSchema } },
      description: 'Income trend data points',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'No pay schedule found',
    },
  },
});

app.openapi(incomeTrendRoute, async (c) => {
  const query = c.req.valid('query');
  const outcome = await computeIncomeTrend(query);
  if (!outcome.ok) return c.json({ error: outcome.error }, 404);
  return c.json(outcome.result, 200);
});

// ─── GET /spend-prediction ───

const spendPredictionRoute = createRoute({
  method: 'get',
  path: '/spend-prediction',
  tags: ['Dashboard'],
  summary: 'Spend prediction for the current pay period',
  request: { query: SpendPredictionQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: SpendPredictionResponseSchema } },
      description: 'Spend prediction data',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'No current pay period found',
    },
  },
});

app.openapi(spendPredictionRoute, async (c) => {
  const query = c.req.valid('query');
  const today = todayLocal();

  // 1. Resolve pay schedule (same logic as /current-period)
  let schedule;
  if (query.scheduleId) {
    schedule = await prisma.paySchedule.findUnique({ where: { id: query.scheduleId } });
    if (!schedule) return c.json({ error: 'Pay schedule not found' }, 404);
  } else {
    schedule = await prisma.paySchedule.findFirst({ where: { isDefault: true } });
    if (!schedule) {
      schedule = await prisma.paySchedule.findFirst({ orderBy: { createdAt: 'asc' } });
    }
    if (!schedule) return c.json({ error: 'No pay schedule found' }, 404);
  }

  // 2. Find current pay period
  const period = await prisma.payPeriod.findFirst({
    where: {
      scheduleId: schedule.id,
      startDate: { lte: today },
      endDate: { gte: today },
    },
  });
  if (!period) {
    return c.json({ error: 'No current pay period found for this schedule' }, 404);
  }

  const periodStart = period.startDate;
  const periodEnd = period.endDate;

  // 3. Lazy-generate ScheduledTransaction rows for this period
  await generateSchedule({ periodStart, periodEnd });

  // 4. Query recurring expenses via ScheduledTransaction rows (expense-sourced, in period)
  const scheduleRows = await prisma.scheduledTransaction.findMany({
    where: {
      dueDate: { gte: periodStart, lt: dayAfter(periodEnd) },
      sourceType: 'EXPENSE',
    },
    include: { expense: true },
  });

  const periodExpenses = scheduleRows
    .filter((r) => r.expense != null)
    .map((r) => ({
      id: r.expense!.id,
      budgetId: r.expense!.budgetId,
      amount: Number(r.expectedAmount),
    }));

  // 5. Query budget allocations (current year, active, version effective for current month)
  const nd = localDate(today);
  const currentMonth = nd.month + 1; // 1-indexed
  const yearPlan = await prisma.yearPlan.findUnique({ where: { year: nd.year } });

  const budgetAllocations: Array<{
    budgetId: string;
    amount: number;
    period: 'MONTHLY' | 'YEARLY';
    activeMonths: number[] | null;
    hasLinkedExpenses: boolean;
  }> = [];

  if (yearPlan) {
    const budgets = await prisma.categoryBudget.findMany({
      where: { yearPlanId: yearPlan.id, removedAt: null },
      include: { versions: true, _count: { select: { budgetExpenseLinks: true } } },
    });

    for (const cb of budgets) {
      const v = resolveEffectiveVersion(cb.versions, currentMonth, nd.year);
      if (!v) continue;
      // monthlyEquivalent is already the monthly amount; treat as MONTHLY for proration
      budgetAllocations.push({
        budgetId: cb.budgetId,
        amount: Number(v.monthlyEquivalent),
        period: 'MONTHLY',
        activeMonths: v.activeMonths.length > 0 ? v.activeMonths : null,
        hasLinkedExpenses: cb._count.budgetExpenseLinks > 0,
      });
    }
  }

  // 6. Query DISCRETIONARY expense transactions in the period date range
  // Exclude transactions linked to recurring expenses (non-null expenseId) —
  // those are mandatory payments already accounted for in the budget deductions.
  const transactions = await prisma.transaction.findMany({
    where: {
      date: { gte: periodStart, lt: dayAfter(periodEnd) },
      type: 'EXPENSE',
      expenseId: null,
      // Count a split purchase once, via its Anchor — not again via its legs.
      // This query filters by neither account nor tracked budget, so without
      // this a group would double-count. See NOT_PAYMENT_LEG.
      ...NOT_PAYMENT_LEG,
    },
    select: { date: true, amount: true },
  });

  const txData = transactions.map((t) => ({
    date: t.date,
    amount: Number(t.amount),
  }));

  // 7. Compute and return
  const result = computeSpendPrediction({
    periodStart,
    periodEnd,
    today,
    scheduleType: schedule.type,
    periodExpenses,
    budgetAllocations,
    transactions: txData,
  });

  return c.json(result, 200);
});

export default app;
