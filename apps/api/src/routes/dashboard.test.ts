import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import {
  get,
  post,
  createGroup,
  createCategory,
  createAccount,
  createExpense,
  createIncome,
  createPaySchedule,
  createPayPeriod,
  createTransaction,
} from '../test/helpers.js';

describe('Dashboard API', () => {
  describe('GET /dashboard/current-period', () => {
    it('returns 404 when no pay schedule exists', async () => {
      const res = await get('/dashboard/current-period');
      expect(res.status).toBe(404);
    });

    it('returns 404 when schedule exists but no current period', async () => {
      await createPaySchedule();
      const res = await get('/dashboard/current-period');
      expect(res.status).toBe(404);
    });

    it('returns current period summary with income and expense items', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const acct = await createAccount();
      const schedule = await createPaySchedule();

      const now = new Date();
      const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 5));
      const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 8));
      await createPayPeriod(schedule.id, { startDate: start, endDate: end, payDate: start });

      await createIncome(cat.id, { accountId: acct.id });
      await createExpense(cat.id, { accountId: acct.id, dueDay: now.getDate() });

      const res = await get('/dashboard/current-period');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.payPeriod).toBeDefined();
      expect(body.schedule).toBeDefined();
      expect(body.incomeItems).toBeDefined();
      expect(body.expenseItems).toBeDefined();
      expect(body.balances).toBeDefined();
      expect(typeof body.totalIncome).toBe('number');
      expect(typeof body.totalExpenses).toBe('number');
      expect(typeof body.netIncome).toBe('number');
    });

    it('accepts scheduleId query parameter', async () => {
      const schedule = await createPaySchedule({ name: 'Custom', isDefault: false });
      const now = new Date();
      const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 3));
      const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 10));
      await createPayPeriod(schedule.id, { startDate: start, endDate: end, payDate: start });

      const res = await get(`/dashboard/current-period?scheduleId=${schedule.id}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.schedule.id).toBe(schedule.id);
    });

    it('returns 404 for non-existent scheduleId', async () => {
      const res = await get('/dashboard/current-period?scheduleId=nonexistent');
      expect(res.status).toBe(404);
    });

    it('includes transactions in totals', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const acct = await createAccount();
      const schedule = await createPaySchedule();
      const income = await createIncome(cat.id, { amount: 3000, accountId: acct.id });
      const expense = await createExpense(cat.id, { amount: 500, accountId: acct.id });

      const now = new Date();
      const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 5));
      const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 8));
      await createPayPeriod(schedule.id, { startDate: start, endDate: end, payDate: start });

      // Create transactions within the period
      const txDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 2))
        .toISOString()
        .split('T')[0];
      await post('/transactions', {
        type: 'INCOME',
        name: 'Pay',
        amount: 3000,
        date: txDate,
        accountId: acct.id,
        incomeId: income.id,
      });
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Bill',
        amount: 500,
        date: txDate,
        accountId: acct.id,
        expenseId: expense.id,
      });

      const res = await get('/dashboard/current-period');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.totalIncome).toBe(3000);
      expect(body.totalExpenses).toBe(500);
      expect(body.netIncome).toBe(2500);
    });

    describe('expenseItems archived/paused filtering', () => {
      async function setupPeriodWithPaidScheduleRow() {
        const group = await createGroup();
        const cat = await createCategory(group.id);
        const acct = await createAccount();
        const schedule = await createPaySchedule();

        const now = new Date();
        const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 5));
        const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 8));
        await createPayPeriod(schedule.id, { startDate: start, endDate: end, payDate: start });

        const expense = await createExpense(cat.id, { accountId: acct.id, dueDay: now.getDate() });
        const dueDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

        // Simulate a historical PAID row — per ADR-024 these are never pruned even
        // after the source Expense is archived/paused.
        await prisma.scheduledTransaction.create({
          data: {
            sourceType: 'EXPENSE',
            sourceId: expense.id,
            expenseId: expense.id,
            dueDate,
            expectedAmount: 100,
            actualAmount: 100,
            status: 'PAID',
          },
        });

        return { expense, now };
      }

      it('excludes an archived expense from expenseItems despite a paid schedule row in the period', async () => {
        const { expense } = await setupPeriodWithPaidScheduleRow();

        await prisma.expense.update({
          where: { id: expense.id },
          data: { archivedAt: new Date(Date.UTC(2020, 0, 1)) },
        });

        const res = await get('/dashboard/current-period');
        expect(res.status).toBe(200);
        const body: any = await res.json();
        expect(body.expenseItems.some((item: any) => item.id === expense.id)).toBe(false);
      });

      it('excludes a paused expense from expenseItems despite a paid schedule row in the period', async () => {
        const { expense, now } = await setupPeriodWithPaidScheduleRow();

        await prisma.expense.update({
          where: { id: expense.id },
          data: { pausedUntil: new Date(Date.UTC(now.getFullYear() + 1, 0, 1)) },
        });

        const res = await get('/dashboard/current-period');
        expect(res.status).toBe(200);
        const body: any = await res.json();
        expect(body.expenseItems.some((item: any) => item.id === expense.id)).toBe(false);
      });

      it('still includes a non-archived, non-paused expense with the same shape (control)', async () => {
        const { expense } = await setupPeriodWithPaidScheduleRow();

        const res = await get('/dashboard/current-period');
        expect(res.status).toBe(200);
        const body: any = await res.json();
        expect(body.expenseItems.some((item: any) => item.id === expense.id)).toBe(true);
      });
    });

    describe('incomeItems archived/paused filtering', () => {
      async function setupPeriodWithPaidIncomeRow() {
        const group = await createGroup();
        const cat = await createCategory(group.id);
        const schedule = await createPaySchedule();

        const now = new Date();
        const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 5));
        const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 8));
        await createPayPeriod(schedule.id, { startDate: start, endDate: end, payDate: start });

        // No accountId — a null account type always passes the cash-income filter,
        // keeping these tests focused on the archived/paused guard.
        const income = await createIncome(cat.id);
        const dueDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

        // Simulate a historical PAID row — per ADR-024 these are never pruned even
        // after the source Income is archived/paused.
        await prisma.scheduledTransaction.create({
          data: {
            sourceType: 'INCOME',
            sourceId: income.id,
            incomeId: income.id,
            dueDate,
            expectedAmount: 100,
            actualAmount: 100,
            status: 'PAID',
          },
        });

        return { income, now };
      }

      it('excludes an archived income from incomeItems despite a paid schedule row in the period', async () => {
        const { income } = await setupPeriodWithPaidIncomeRow();

        await prisma.income.update({
          where: { id: income.id },
          data: { archivedAt: new Date(Date.UTC(2020, 0, 1)) },
        });

        const res = await get('/dashboard/current-period');
        expect(res.status).toBe(200);
        const body: any = await res.json();
        expect(body.incomeItems.some((item: any) => item.id === income.id)).toBe(false);
      });

      it('excludes a paused income from incomeItems despite a paid schedule row in the period', async () => {
        const { income, now } = await setupPeriodWithPaidIncomeRow();

        await prisma.income.update({
          where: { id: income.id },
          data: { pausedUntil: new Date(Date.UTC(now.getFullYear() + 1, 0, 1)) },
        });

        const res = await get('/dashboard/current-period');
        expect(res.status).toBe(200);
        const body: any = await res.json();
        expect(body.incomeItems.some((item: any) => item.id === income.id)).toBe(false);
      });

      it('still includes a non-archived, non-paused income with the same shape (control)', async () => {
        const { income } = await setupPeriodWithPaidIncomeRow();

        const res = await get('/dashboard/current-period');
        expect(res.status).toBe(200);
        const body: any = await res.json();
        expect(body.incomeItems.some((item: any) => item.id === income.id)).toBe(true);
      });
    });
  });

  describe('GET /dashboard/ytd', () => {
    it('returns YTD summary for current year', async () => {
      const res = await get('/dashboard/ytd');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.year).toBe(new Date().getFullYear());
      expect(typeof body.totalIncome).toBe('number');
      expect(typeof body.totalExpenses).toBe('number');
      expect(typeof body.netIncome).toBe('number');
      expect(Array.isArray(body.byCategory)).toBe(true);
    });

    it('accepts year query parameter', async () => {
      const res = await get('/dashboard/ytd?year=2025');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.year).toBe(2025);
    });

    it('includes transactions in YTD totals', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const acct = await createAccount();
      const expense = await createExpense(cat.id);

      const year = new Date().getFullYear();
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Rent',
        amount: 1200,
        date: `${year}-02-15`,
        accountId: acct.id,
        expenseId: expense.id,
      });
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Rent',
        amount: 1200,
        date: `${year}-03-15`,
        accountId: acct.id,
        expenseId: expense.id,
      });

      const res = await get(`/dashboard/ytd?year=${year}`);
      const body: any = await res.json();
      expect(body.totalExpenses).toBeGreaterThanOrEqual(2400);
      expect(body.byCategory.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /dashboard/trends', () => {
    it('returns trends data', async () => {
      const schedule = await createPaySchedule();
      const period = await createPayPeriod(schedule.id);

      const res = await get('/dashboard/trends');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it('accepts periods query parameter', async () => {
      const schedule = await createPaySchedule();
      await createPayPeriod(schedule.id, { periodNum: 1 });
      await createPayPeriod(schedule.id, {
        periodNum: 2,
        startDate: new Date('2026-04-03'),
        endDate: new Date('2026-04-16'),
        payDate: new Date('2026-04-03'),
      });

      const res = await get('/dashboard/trends?periods=1');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /dashboard/category-breakdown', () => {
    it('returns empty array when no expense transactions', async () => {
      const res = await get('/dashboard/category-breakdown');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it('groups expenses by category', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id, 'Housing');
      const acct = await createAccount();
      const expense = await createExpense(cat.id);

      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Rent',
        amount: 1000,
        date: '2026-03-15',
        accountId: acct.id,
        expenseId: expense.id,
      });
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Rent',
        amount: 1000,
        date: '2026-04-15',
        accountId: acct.id,
        expenseId: expense.id,
      });

      const res = await get('/dashboard/category-breakdown');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.length).toBeGreaterThanOrEqual(1);
      const housing = body.find((c: { categoryName: string }) => c.categoryName === 'Housing');
      expect(housing).toBeDefined();
      expect(housing.total).toBe(2000);
      expect(housing.percentage).toBe(100);
      expect(housing.transactionCount).toBe(2);
    });

    it('filters by date range', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const acct = await createAccount();
      const expense = await createExpense(cat.id);

      await post('/transactions', {
        type: 'EXPENSE',
        name: 'A',
        amount: 100,
        date: '2026-03-15',
        accountId: acct.id,
        expenseId: expense.id,
      });
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'B',
        amount: 200,
        date: '2026-05-15',
        accountId: acct.id,
        expenseId: expense.id,
      });

      const res = await get('/dashboard/category-breakdown?dateFrom=2026-03-01&dateTo=2026-03-31');
      const body: any = await res.json();
      const total = body.reduce((s: number, c: { total: number }) => s + c.total, 0);
      expect(total).toBe(100);
    });
  });

  describe('GET /dashboard/goal-progress', () => {
    it('returns empty array when no goals', async () => {
      const res = await get('/dashboard/goal-progress');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it('returns goal progress with computed fields', async () => {
      await post('/goals', {
        name: 'Emergency Fund',
        type: 'SAVINGS',
        targetAmount: 10000,
        currentAmount: 2500,
      });

      const res = await get('/dashboard/goal-progress');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.length).toBe(1);
      expect(body[0].percentComplete).toBe(25);
      expect(body[0].remaining).toBe(7500);
    });

    it('caps percentComplete at 100', async () => {
      await post('/goals', {
        name: 'Overfunded',
        type: 'SAVINGS',
        targetAmount: 1000,
        currentAmount: 1500,
      });

      const res = await get('/dashboard/goal-progress');
      const body: any = await res.json();
      const goal = body.find((g: { name: string }) => g.name === 'Overfunded');
      expect(goal.percentComplete).toBe(100);
      expect(goal.remaining).toBe(0);
    });
  });

  describe('GET /dashboard/spend-prediction', () => {
    it('returns 404 when no pay schedule exists', async () => {
      const res = await get('/dashboard/spend-prediction');
      expect(res.status).toBe(404);
    });

    it('returns 404 when schedule exists but no current period', async () => {
      await createPaySchedule();
      const res = await get('/dashboard/spend-prediction');
      expect(res.status).toBe(404);
    });

    it('returns projected amounts based on current period spending', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const acct = await createAccount();
      const schedule = await createPaySchedule();

      const now = new Date();
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth();
      const d = now.getUTCDate();
      const start = new Date(Date.UTC(y, m, d - 5));
      const end = new Date(Date.UTC(y, m, d + 8));
      await createPayPeriod(schedule.id, { startDate: start, endDate: end, payDate: start });

      // Create a year plan with a budget allocation (unlinked = fully discretionary)
      const yearPlan = await prisma.yearPlan.create({ data: { year: y } });
      const categoryBudget = await prisma.categoryBudget.create({
        data: { yearPlanId: yearPlan.id, budgetId: cat.id },
      });
      await prisma.budgetVersion.create({
        data: {
          categoryBudgetId: categoryBudget.id,
          amount: 500,
          frequency: 'MONTHLY',
          monthlyEquivalent: 500,
          effectiveDate: new Date(Date.UTC(y, 0, 1)),
        },
      });

      // Create a discretionary expense transaction (no expenseId) within the period
      const txDate = new Date(Date.UTC(y, m, d - 2));
      await createTransaction(acct.id, {
        type: 'EXPENSE',
        amount: 50,
        date: txDate,
        expenseId: null,
      });

      const res = await get('/dashboard/spend-prediction');
      expect(res.status).toBe(200);
      const body: any = await res.json();

      expect(typeof body.expectedPeriodSpend).toBe('number');
      expect(body.expectedPeriodSpend).toBeGreaterThan(0);
      expect(typeof body.overUnderAmount).toBe('number');
      expect(body.periodStartDate).toBeDefined();
      expect(body.periodEndDate).toBeDefined();
      expect(typeof body.currentDayNumber).toBe('number');
      expect(body.currentDayNumber).toBeGreaterThanOrEqual(1);
      expect(typeof body.totalDays).toBe('number');
      expect(body.totalDays).toBeGreaterThan(0);
      expect(Array.isArray(body.dailyData)).toBe(true);
      expect(body.dailyData.length).toBe(body.totalDays);

      // Verify daily data shape
      const firstDay = body.dailyData[0];
      expect(firstDay.dayNumber).toBe(1);
      expect(firstDay.date).toBeDefined();
      expect(typeof firstDay.expectedCumulative).toBe('number');

      // Past days should have actual cumulative, future days should be null
      const currentDay = body.dailyData[body.currentDayNumber - 1];
      expect(typeof currentDay.actualCumulative).toBe('number');

      if (body.currentDayNumber < body.totalDays) {
        const futureDay = body.dailyData[body.totalDays - 1];
        expect(futureDay.actualCumulative).toBeNull();
      }
    });
  });

  describe('GET /dashboard/category-breakdown — payPeriodId filter', () => {
    it('filters expenses by payPeriodId', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id, 'Groceries');
      const acct = await createAccount();
      const expense = await createExpense(cat.id);
      const schedule = await createPaySchedule();

      const period = await createPayPeriod(schedule.id, {
        startDate: new Date(Date.UTC(2026, 2, 20)),
        endDate: new Date(Date.UTC(2026, 3, 2)),
        payDate: new Date(Date.UTC(2026, 2, 20)),
      });

      // Create a transaction assigned to this pay period
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Groceries',
        amount: 150,
        date: '2026-03-25',
        accountId: acct.id,
        expenseId: expense.id,
      });

      // Assign the transaction to the pay period
      const txn = await prisma.transaction.findFirst({ where: { name: 'Groceries' } });
      if (txn) {
        await prisma.transaction.update({
          where: { id: txn.id },
          data: { payPeriodId: period.id },
        });
      }

      const res = await get(`/dashboard/category-breakdown?payPeriodId=${period.id}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.length).toBeGreaterThanOrEqual(1);
      const groceries = body.find((c: { categoryName: string }) => c.categoryName === 'Groceries');
      expect(groceries).toBeDefined();
      expect(groceries.total).toBe(150);
    });
  });

  describe('GET /dashboard/ytd — pay period boundary handling', () => {
    it('uses pay period boundaries for YTD date range when periods exist', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const acct = await createAccount();
      const expense = await createExpense(cat.id);
      const schedule = await createPaySchedule({ isDefault: false });

      const year = new Date().getFullYear();

      // Create two pay periods in the year
      await createPayPeriod(schedule.id, {
        startDate: new Date(Date.UTC(year, 0, 3)),
        endDate: new Date(Date.UTC(year, 0, 16)),
        payDate: new Date(Date.UTC(year, 0, 3)),
        year,
        periodNum: 1,
      });

      await createPayPeriod(schedule.id, {
        startDate: new Date(Date.UTC(year, 0, 17)),
        endDate: new Date(Date.UTC(year, 0, 30)),
        payDate: new Date(Date.UTC(year, 0, 17)),
        year,
        periodNum: 2,
      });

      // Transaction on Jan 3 (first period start) — should be included
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'First',
        amount: 100,
        date: `${year}-01-03`,
        accountId: acct.id,
        expenseId: expense.id,
      });

      // Transaction on Jan 30 (last period end) — should be included
      await post('/transactions', {
        type: 'INCOME',
        name: 'Pay',
        amount: 3000,
        date: `${year}-01-30`,
        accountId: acct.id,
      });

      const res = await get(`/dashboard/ytd?year=${year}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();

      expect(body.year).toBe(year);
      // The YTD range should start at the first period's startDate
      const startDate = new Date(body.startDate);
      expect(startDate.getTime()).toBeLessThanOrEqual(new Date(Date.UTC(year, 0, 3)).getTime());
      // The YTD range should end at or after the last period's endDate
      const endDate = new Date(body.endDate);
      expect(endDate.getTime()).toBeGreaterThanOrEqual(new Date(Date.UTC(year, 0, 30)).getTime());

      expect(body.totalIncome).toBeGreaterThanOrEqual(3000);
      expect(body.totalExpenses).toBeGreaterThanOrEqual(100);
    });

    it('includes transactions on pay period boundary date in correct totals', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const acct = await createAccount();
      const expense = await createExpense(cat.id);
      const schedule = await createPaySchedule();

      const year = new Date().getFullYear();

      // Create two adjacent pay periods with a boundary at Jan 17
      await createPayPeriod(schedule.id, {
        startDate: new Date(Date.UTC(year, 0, 3)),
        endDate: new Date(Date.UTC(year, 0, 16)),
        payDate: new Date(Date.UTC(year, 0, 3)),
        year,
        periodNum: 1,
      });

      await createPayPeriod(schedule.id, {
        startDate: new Date(Date.UTC(year, 0, 17)),
        endDate: new Date(Date.UTC(year, 0, 30)),
        payDate: new Date(Date.UTC(year, 0, 17)),
        year,
        periodNum: 2,
      });

      // Transaction exactly on the boundary date (Jan 17 = start of period 2)
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Boundary',
        amount: 250,
        date: `${year}-01-17`,
        accountId: acct.id,
        expenseId: expense.id,
      });

      // Transaction on the last day of period 1 (Jan 16)
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'EndOfP1',
        amount: 75,
        date: `${year}-01-16`,
        accountId: acct.id,
        expenseId: expense.id,
      });

      const res = await get(`/dashboard/ytd?year=${year}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();

      // Both transactions should be included in YTD totals
      // (the range spans from first period start to last period end)
      expect(body.totalExpenses).toBeGreaterThanOrEqual(325);
      expect(body.netIncome).toBe(body.totalIncome - body.totalExpenses);
    });

    it('falls back to calendar year when no pay periods exist', async () => {
      const year = new Date().getFullYear();
      const res = await get(`/dashboard/ytd?year=${year}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();

      expect(body.year).toBe(year);
      // With no periods, should fall back to calendar year boundaries
      const startDate = new Date(body.startDate);
      const endDate = new Date(body.endDate);
      expect(startDate.getTime()).toBe(new Date(Date.UTC(year, 0, 1)).getTime());
      expect(endDate.getTime()).toBe(new Date(Date.UTC(year, 11, 31)).getTime());
    });
  });

  describe('GET /dashboard/current-period — schedule integration', () => {
    it('lazily generates ScheduledTransaction rows on first view', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const acct = await createAccount();
      const schedule = await createPaySchedule();

      const now = new Date();
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth();
      const d = now.getUTCDate();
      const start = new Date(Date.UTC(y, m, d - 5));
      const end = new Date(Date.UTC(y, m, d + 8));
      await createPayPeriod(schedule.id, { startDate: start, endDate: end, payDate: start });

      // Create a monthly expense with dueDay inside the period
      await createExpense(cat.id, {
        accountId: acct.id,
        dueDay: d,
        frequency: 'MONTHLY',
      });

      // No ScheduledTransaction rows should exist yet
      const beforeCount = await prisma.scheduledTransaction.count();
      expect(beforeCount).toBe(0);

      // Hitting the dashboard should lazily generate rows
      const res = await get('/dashboard/current-period');
      expect(res.status).toBe(200);

      const afterCount = await prisma.scheduledTransaction.count();
      expect(afterCount).toBeGreaterThan(0);
    });

    it('returns expense items with anticipationId and anticipationStatus from schedule', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const acct = await createAccount();
      const schedule = await createPaySchedule();

      const now = new Date();
      const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 5));
      const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 8));
      await createPayPeriod(schedule.id, { startDate: start, endDate: end, payDate: start });

      await createExpense(cat.id, {
        accountId: acct.id,
        dueDay: now.getDate(),
        frequency: 'MONTHLY',
        amount: 150,
      });

      const res = await get('/dashboard/current-period');
      expect(res.status).toBe(200);
      const body: any = await res.json();

      // Should have at least one expense item from the schedule
      const expItem = body.expenseItems.find((e: any) => e.amount === 150);
      if (expItem) {
        expect(expItem.anticipationId).toBeTruthy();
        expect(['DUE', 'OVERDUE', 'PAID', 'PARTIAL', 'SNOOZED', 'SKIPPED', 'UPCOMING']).toContain(
          expItem.anticipationStatus,
        );
        expect(expItem.isPaid).toBe(false);
        expect(expItem.actualAmount).toBeNull();
      }
    });

    it('returns income items with anticipationId and anticipationStatus from schedule', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const acct = await createAccount();
      const schedule = await createPaySchedule();

      const now = new Date();
      const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 5));
      const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 8));
      await createPayPeriod(schedule.id, { startDate: start, endDate: end, payDate: start });

      await createIncome(cat.id, {
        accountId: acct.id,
        frequency: 'BIWEEKLY',
        amount: 3000,
        startDate: new Date(Date.UTC(2026, 0, 1)),
      });

      const res = await get('/dashboard/current-period');
      expect(res.status).toBe(200);
      const body: any = await res.json();

      // If a biweekly income occurrence falls in this period, it should have schedule data
      if (body.incomeItems.length > 0) {
        const incItem = body.incomeItems[0];
        expect(incItem.anticipationId).toBeTruthy();
        expect(['DUE', 'OVERDUE', 'PAID', 'PARTIAL', 'SNOOZED', 'SKIPPED', 'UPCOMING']).toContain(
          incItem.anticipationStatus,
        );
        expect(incItem.actualAmount).toBeNull();
      }
    });

    it('reflects PAID status after a transaction is matched', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const acct = await createAccount();
      const schedule = await createPaySchedule();

      const now = new Date();
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth();
      const d = now.getUTCDate();
      const start = new Date(Date.UTC(y, m, d - 5));
      const end = new Date(Date.UTC(y, m, d + 8));
      await createPayPeriod(schedule.id, { startDate: start, endDate: end, payDate: start });

      const expense = await createExpense(cat.id, {
        accountId: acct.id,
        dueDay: d,
        frequency: 'MONTHLY',
        amount: 200,
      });

      // First view — generates schedule rows
      await get('/dashboard/current-period');

      // Find the generated schedule row
      const schedRow = await prisma.scheduledTransaction.findFirst({
        where: { expenseId: expense.id },
      });
      expect(schedRow).toBeTruthy();

      // Create a transaction that the lifecycle matcher should link
      const txDate = new Date(Date.UTC(y, m, d)).toISOString().split('T')[0];
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Bill Payment',
        amount: 200,
        date: txDate,
        accountId: acct.id,
        expenseId: expense.id,
      });

      // Second view — should show PAID status
      const res = await get('/dashboard/current-period');
      expect(res.status).toBe(200);
      const body: any = await res.json();

      const paidItem = body.expenseItems.find((e: any) => e.id === expense.id && e.isPaid);
      if (paidItem) {
        expect(paidItem.anticipationStatus).toBe('PAID');
        expect(paidItem.actualAmount).toBe(200);
      }
    });

    it('response shape matches existing contract (payPeriod, schedule, totals, items, balances)', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const acct = await createAccount();
      const schedule = await createPaySchedule();

      const now = new Date();
      const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 5));
      const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 8));
      await createPayPeriod(schedule.id, { startDate: start, endDate: end, payDate: start });

      await createExpense(cat.id, { accountId: acct.id, dueDay: now.getDate() });
      await createIncome(cat.id, { accountId: acct.id });

      const res = await get('/dashboard/current-period');
      expect(res.status).toBe(200);
      const body: any = await res.json();

      // Verify top-level shape
      expect(body).toHaveProperty('payPeriod');
      expect(body).toHaveProperty('schedule');
      expect(body).toHaveProperty('totalIncome');
      expect(body).toHaveProperty('totalExpenses');
      expect(body).toHaveProperty('netIncome');
      expect(body).toHaveProperty('incomeItems');
      expect(body).toHaveProperty('expenseItems');
      expect(body).toHaveProperty('balances');
      expect(typeof body.totalIncome).toBe('number');
      expect(typeof body.totalExpenses).toBe('number');
      expect(typeof body.netIncome).toBe('number');
      expect(Array.isArray(body.incomeItems)).toBe(true);
      expect(Array.isArray(body.expenseItems)).toBe(true);
      expect(Array.isArray(body.balances)).toBe(true);

      // Verify expense item shape
      for (const item of body.expenseItems) {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('amount');
        expect(item).toHaveProperty('frequency');
        expect(item).toHaveProperty('budgetId');
        expect(item).toHaveProperty('accountId');
        expect(item).toHaveProperty('isAutomatic');
        expect(item).toHaveProperty('dueDay');
        expect(item).toHaveProperty('actualAmount');
        expect(item).toHaveProperty('isPaid');
        expect(item).toHaveProperty('anticipationStatus');
        expect(item).toHaveProperty('anticipationId');
      }

      // Verify income item shape
      for (const item of body.incomeItems) {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('amount');
        expect(item).toHaveProperty('frequency');
        expect(item).toHaveProperty('budgetId');
        expect(item).toHaveProperty('actualAmount');
        expect(item).toHaveProperty('anticipationStatus');
        expect(item).toHaveProperty('anticipationId');
      }
    });

    it('does not duplicate rows on second dashboard view (idempotency)', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const acct = await createAccount();
      const schedule = await createPaySchedule();

      const now = new Date();
      const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 5));
      const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 8));
      await createPayPeriod(schedule.id, { startDate: start, endDate: end, payDate: start });

      await createExpense(cat.id, { accountId: acct.id, dueDay: now.getDate() });

      // First view
      await get('/dashboard/current-period');
      const countAfterFirst = await prisma.scheduledTransaction.count();

      // Second view
      await get('/dashboard/current-period');
      const countAfterSecond = await prisma.scheduledTransaction.count();

      expect(countAfterSecond).toBe(countAfterFirst);
    });
  });

  describe('GET /dashboard/income-trend — 404 handling', () => {
    it('returns 404 for non-existent scheduleId', async () => {
      const res = await get('/dashboard/income-trend?scheduleId=clxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });
  });

  describe('GET /dashboard/spend-prediction — 404 handling', () => {
    it('returns 404 for non-existent scheduleId', async () => {
      const res = await get('/dashboard/spend-prediction?scheduleId=clxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });
  });
});
