/**
 * Current pay period summary aggregation, extracted from routes/dashboard.ts.
 * Read-only — no ledger mutations (schedule generation is idempotent).
 */
import type { z } from 'zod';
import { prisma } from '@budget-tracker/db';
import type { CurrentPeriodSummarySchema } from '@budget-tracker/core';
import {
  classifyExpense,
  computeCashFlowSummary,
  findPreviousPeriod,
  sumCreditCardPayments,
  sumPreviousPeriodBankBalanceByType,
  sumAdHocCashSpending,
  sumPreviousPeriodCreditBalance,
} from './cash-flow.js';
import type { CashFlowExpenseItem } from './cash-flow.js';
import { generateSchedule } from './schedule-generator.js';
import { mapScheduleStatus } from './schedule-status-map.js';
import { localDate, makeDate, today as todayLocal, dayAfter } from './dates.js';
import { isPaused } from './pause.js';
import { spendAmount } from './dashboard-shared.js';

type CurrentPeriodSummary = z.infer<typeof CurrentPeriodSummarySchema>;

export type CurrentPeriodOutcome =
  | { ok: false; error: string }
  | { ok: true; result: CurrentPeriodSummary };

/** Compute the current pay period summary (schedule, items, balances, cash flow). */
export async function computeCurrentPeriodSummary(query: {
  scheduleId?: string;
}): Promise<CurrentPeriodOutcome> {
  // syncUtilityTransactionAmounts disabled — amounts set at creation time.

  const today = todayLocal();

  // 1. Find schedule
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

  // 2. Find current pay period
  const period = await prisma.payPeriod.findFirst({
    where: {
      scheduleId: schedule.id,
      startDate: { lte: today },
      endDate: { gte: today },
    },
  });
  if (!period) {
    return { ok: false as const, error: 'No current pay period found for this schedule' };
  }

  // 3. Transactions for this period (by date range, not payPeriodId)
  const transactions = await prisma.transaction.findMany({
    where: {
      date: { gte: period.startDate, lt: dayAfter(period.endDate) },
    },
  });

  // 5. Lazy-generate ScheduledTransaction rows for this period (Req 6.3, 10.1)
  const periodStart = period.startDate;
  const periodEnd = period.endDate;
  await generateSchedule({ periodStart, periodEnd });

  // 6. Query persisted ScheduledTransaction rows for the period (Req 6.1, 6.2)
  // Sort by dueDate ascending so dashboard cards show soonest-due items first
  const scheduleRows = await prisma.scheduledTransaction.findMany({
    where: {
      dueDate: { gte: periodStart, lt: dayAfter(periodEnd) },
    },
    orderBy: { dueDate: 'asc' },
    include: {
      expense: true,
      income: true,
      transaction: { select: { date: true } },
    },
  });

  // 6b. Fetch all accounts to build accountTypeMap (accountId → type) for cash flow classification
  const allAccounts = await prisma.account.findMany({ select: { id: true, type: true } });
  const accountTypeMap = new Map(allAccounts.map((a) => [a.id, a.type]));

  // 7. Map ScheduledTransaction rows to income/expense line items using mapScheduleStatus()
  const incomeItems: CurrentPeriodSummary['incomeItems'] = [];
  const expenseItems: CurrentPeriodSummary['expenseItems'] = [];

  for (const row of scheduleRows) {
    const displayStatus = mapScheduleStatus(
      row.status as Parameters<typeof mapScheduleStatus>[0],
      row.dueDate,
      row.snoozedUntil,
      today,
    );

    if (row.sourceType === 'INCOME' && row.income) {
      // Archived/paused income keeps its historical ScheduledTransaction rows
      // (PAID/PARTIAL/SKIPPED/SNOOZED are never pruned — see ADR-024), but it
      // must never surface on the dashboard's income cards once archived/paused.
      if (row.income.archivedAt != null || isPaused(row.income.pausedUntil, today)) {
        continue;
      }
      // Only include income that deposits into Checking, Savings, or Cash accounts
      const incomeAccountType = accountTypeMap.get(row.income.accountId ?? '') ?? null;
      const isCashIncome =
        incomeAccountType === null ||
        incomeAccountType === 'Checking' ||
        incomeAccountType === 'Savings' ||
        incomeAccountType === 'Cash';
      if (isCashIncome) {
        incomeItems.push({
          id: row.income.id,
          name: row.income.name,
          amount: Number(row.expectedAmount),
          frequency: row.income
            .frequency as CurrentPeriodSummary['incomeItems'][number]['frequency'],
          budgetId: row.income.budgetId,
          actualAmount: row.actualAmount != null ? Number(row.actualAmount) : null,
          anticipationStatus: displayStatus,
          anticipationId: row.id,
        });
      }
    } else if (row.sourceType === 'EXPENSE' && row.expense) {
      // Archived/paused expenses keep their historical ScheduledTransaction rows
      // (PAID/PARTIAL/SKIPPED/SNOOZED are never pruned — see ADR-024), but they
      // must never surface on the dashboard's spending cards once archived/paused.
      if (row.expense.archivedAt != null || isPaused(row.expense.pausedUntil, today)) {
        continue;
      }
      expenseItems.push({
        id: row.expense.id,
        name: row.expense.name,
        amount: Number(row.expectedAmount),
        frequency: row.expense
          .frequency as CurrentPeriodSummary['expenseItems'][number]['frequency'],
        budgetId: row.expense.budgetId,
        accountId: row.expense.accountId,
        isAutomatic: row.expense.isAutomatic,
        dueDay: localDate(row.dueDate).day,
        actualAmount: row.actualAmount != null ? Number(row.actualAmount) : null,
        isPaid: row.status === 'PAID',
        anticipationStatus: displayStatus,
        anticipationId: row.id,
        paidDate: row.transaction?.date ?? null,
        expenseType: classifyExpense(accountTypeMap.get(row.expense.accountId ?? '') ?? null),
      });
    }
  }

  // Also include ONE_TIME expenses that have transactions in this period
  const oneTimeExpenses = await prisma.expense.findMany({
    where: {
      frequency: 'ONE_TIME',
      AND: [
        { OR: [{ endDate: null }, { endDate: { gte: periodStart } }] },
        { OR: [{ startDate: null }, { startDate: { lte: periodEnd } }] },
      ],
    },
  });
  for (const exp of oneTimeExpenses) {
    const tx = transactions.find((t) => t.expenseId === exp.id);
    if (tx) {
      expenseItems.push({
        id: exp.id,
        name: exp.name,
        amount: Number(exp.amount),
        frequency: exp.frequency as CurrentPeriodSummary['expenseItems'][number]['frequency'],
        budgetId: exp.budgetId,
        accountId: exp.accountId,
        isAutomatic: exp.isAutomatic,
        dueDay: exp.dueDay,
        actualAmount: spendAmount(tx),
        isPaid: true,
        anticipationStatus: 'PAID',
        anticipationId: null,
        paidDate: tx.date,
        expenseType: classifyExpense(accountTypeMap.get(exp.accountId ?? '') ?? null),
      });
    }
  }

  // 8b. Sort expense items by due date (soonest first) within the period.
  //     Resolve dueDay to an actual date within [periodStart, periodEnd].
  //     Items with null dueDay sort to the end.
  const pStartParts = localDate(periodStart);
  function resolveDueDate(dueDay: number | null): number {
    if (dueDay == null) return Infinity;
    for (let offset = 0; offset <= 1; offset++) {
      const m = pStartParts.month + offset;
      const y = pStartParts.year + Math.floor(m / 12);
      const normalizedMonth = ((m % 12) + 12) % 12;
      const daysInMonth = new Date(Date.UTC(y, normalizedMonth + 1, 0)).getUTCDate();
      const candidateDay = Math.min(dueDay, daysInMonth);
      const candidate = makeDate(y, normalizedMonth, candidateDay);
      if (candidate >= periodStart && candidate <= periodEnd) {
        return candidate.getTime();
      }
    }
    return dueDay; // fallback: sort by raw day number
  }
  expenseItems.sort((a, b) => resolveDueDate(a.dueDay) - resolveDueDate(b.dueDay));

  // 9. Balance snapshots for this period
  const snapshots = await prisma.balanceSnapshot.findMany({
    where: { payPeriodId: period.id },
  });

  // 10. Fetch account names for snapshots (no Prisma relation on BalanceSnapshot)
  const accountIds = [...new Set(snapshots.map((s) => s.accountId))];
  const accounts =
    accountIds.length > 0
      ? await prisma.account.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, name: true },
        })
      : [];
  const accountNameMap = new Map(accounts.map((a) => [a.id, a.name]));

  const balances: CurrentPeriodSummary['balances'] = snapshots.map((s) => ({
    accountId: s.accountId,
    accountName: accountNameMap.get(s.accountId) ?? 'Unknown',
    openingBalance: Number(s.openingBalance),
    closingBalance: Number(s.closingBalance),
    totalIncome: Number(s.totalIncome),
    totalExpenses: Number(s.totalExpenses),
  }));

  // Totals from actual transactions (type-based, excluding child line items)
  const totalIncome = transactions
    .filter((t) => t.parentId == null && t.type === 'INCOME')
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const totalExpenses =
    transactions
      .filter((t) => t.parentId == null && t.type === 'EXPENSE')
      .reduce((sum, t) => sum + spendAmount(t), 0) -
    transactions
      .filter((t) => t.parentId == null && t.type === 'REFUND')
      .reduce((sum, t) => sum + spendAmount(t), 0);

  // 11. Cash flow: find previous period, sum balances (live — see cash-flow.ts)
  const previousPeriod = await findPreviousPeriod(schedule.id, period.startDate);
  const previousPeriodCreditTotal = previousPeriod
    ? await sumPreviousPeriodCreditBalance(previousPeriod)
    : 0;
  const previousPeriodBank = previousPeriod
    ? await sumPreviousPeriodBankBalanceByType(previousPeriod)
    : { checking: 0, savings: 0 };
  const previousPeriodCheckingBalance = previousPeriodBank.checking;
  const previousPeriodSavingsBalance = previousPeriodBank.savings;
  const previousPeriodBankBalance = previousPeriodBank.checking + previousPeriodBank.savings;
  const creditCardPayments = await sumCreditCardPayments(period.startDate, period.endDate);
  // Live cash-remaining input: actual cash purchases this period that aren't a
  // recurring/one-time bill (those show as their own paid lines).
  const adHocCashSpending = await sumAdHocCashSpending(
    period.startDate,
    period.endDate,
    accountTypeMap,
  );

  // 12. Build CashFlowExpenseItem[] from annotated expense items
  const cashFlowExpenseItems: CashFlowExpenseItem[] = expenseItems.map((item) => ({
    expenseType: item.expenseType,
    amount: item.isPaid && item.actualAmount != null ? item.actualAmount : item.amount,
    isPaid: item.isPaid,
  }));

  // 13. Compute cash flow summary (+ the split bank balance and live ad-hoc spend)
  const cashFlowSummary = {
    ...computeCashFlowSummary({
      expenseItems: cashFlowExpenseItems,
      previousPeriodCreditTotal,
      previousPeriodBankBalance,
      creditCardPayments,
    }),
    previousPeriodCheckingBalance,
    previousPeriodSavingsBalance,
    adHocCashSpending,
  };

  const result: CurrentPeriodSummary = {
    payPeriod: {
      id: period.id,
      scheduleId: period.scheduleId,
      startDate: period.startDate,
      endDate: period.endDate,
      payDate: period.payDate,
      year: period.year,
      periodNum: period.periodNum,
    },
    schedule: {
      id: schedule.id,
      name: schedule.name,
      type: schedule.type as CurrentPeriodSummary['schedule']['type'],
      anchorDate: schedule.anchorDate,
      firstPayDay: schedule.firstPayDay,
      secondPayDay: schedule.secondPayDay,
      isDefault: schedule.isDefault,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
    },
    totalIncome,
    totalExpenses,
    netIncome: totalIncome - totalExpenses,
    incomeItems,
    expenseItems,
    balances,
    cashFlowSummary,
  };

  return { ok: true as const, result };
}
