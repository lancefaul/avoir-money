/**
 * Query-building + anticipation helpers for GET /transactions, extracted from
 * routes/transactions.ts to keep the route handler thin. Read-only — no ledger
 * mutations (the scheduled-transaction reads/generation are not the master ledger).
 */
import { prisma } from '@budget-tracker/db';
import type { z } from 'zod';
import type { AnticipationSchema } from '@budget-tracker/core';
import { generateSchedule } from './schedule-generator.js';
import { mapScheduleStatus } from './schedule-status-map.js';
import { today as todayLocal, localDate, makeDate } from './dates.js';

export interface TransactionListFilters {
  type?: string;
  payPeriodId?: string;
  expenseId?: string;
  incomeId?: string;
  linkedToRecurring?: boolean;
  accountId?: string;
  budgetIds?: string;
  purchaseGroupId?: string;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * Build the Prisma `where` clause for the transaction list from the query filters.
 * Async because the "Uncategorized" budget filter needs a lookup to also match
 * null budgetId.
 */
export async function buildTransactionListWhere(
  query: TransactionListFilters,
): Promise<Record<string, unknown>> {
  const where: Record<string, unknown> = {};
  where['parentId'] = null;
  if (query.type) where['type'] = query.type;
  if (query.payPeriodId) where['payPeriodId'] = query.payPeriodId;
  if (query.expenseId) where['expenseId'] = query.expenseId;
  if (query.incomeId) where['incomeId'] = query.incomeId;
  // Filter to a single purchase group (Anchor + every leg — both are top-level,
  // so `parentId: null` above keeps them). Powers the "Manage purchase" deep-link
  // from a leg on the account ledger; the collapsed view then folds to the Anchor.
  if (query.purchaseGroupId) where['purchaseGroupId'] = query.purchaseGroupId;
  if (query.linkedToRecurring !== undefined) {
    if (query.linkedToRecurring) {
      // Linked = has expenseId or incomeId
      const andArr = (where['AND'] as unknown[] | undefined) ?? [];
      andArr.push({ OR: [{ expenseId: { not: null } }, { incomeId: { not: null } }] });
      where['AND'] = andArr;
    } else {
      where['expenseId'] = null;
      where['incomeId'] = null;
    }
  }
  if (query.accountId)
    where['OR'] = [
      { accountId: query.accountId },
      { toAccountId: query.accountId, type: 'TRANSFER' },
    ];
  if (query.budgetIds) {
    const ids = query.budgetIds.split(',').filter(Boolean);
    if (ids.length > 0) {
      // Check if filtering includes the Uncategorized budget — also match null budgetId
      const uncatBudget = await prisma.budget.findFirst({
        where: { name: 'Uncategorized', isSystem: true },
        select: { id: true },
      });
      if (uncatBudget && ids.includes(uncatBudget.id)) {
        const andArr = (where['AND'] as unknown[] | undefined) ?? [];
        andArr.push({ OR: [{ budgetId: { in: ids } }, { budgetId: null }] });
        where['AND'] = andArr;
      } else {
        where['budgetId'] = { in: ids };
      }
    }
  }
  if (query.search) {
    const searchConditions: Record<string, unknown>[] = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { note: { contains: query.search, mode: 'insensitive' } },
      { account: { name: { contains: query.search, mode: 'insensitive' } } },
      { expense: { name: { contains: query.search, mode: 'insensitive' } } },
      { income: { name: { contains: query.search, mode: 'insensitive' } } },
    ];
    const numericSearch = parseFloat(query.search);
    if (!isNaN(numericSearch)) {
      /*
       * Both the purchase price and what the card was actually charged.
       *
       * Searching only `amount` meant a figure copied off a statement could
       * fail to find the transaction that produced it: a $40.00 basket with
       * $15.00 of rewards is charged $25.00, the bank prints $25.00, and
       * searching that returned nothing. Anyone reconciling works from the
       * bank's numbers, so those have to be findable.
       *
       * Range match: "963" finds 963.00–963.99, "963.59" finds exact.
       */
      if (query.search.includes('.')) {
        searchConditions.push({ amount: numericSearch }, { netAmount: numericSearch });
      } else {
        searchConditions.push(
          { amount: { gte: numericSearch, lt: numericSearch + 1 } },
          { netAmount: { gte: numericSearch, lt: numericSearch + 1 } },
        );
      }
    }
    // If accountId filter already set an OR, wrap both in AND
    if (where['OR']) {
      const andArr = (where['AND'] as unknown[] | undefined) ?? [];
      andArr.push({ OR: where['OR'] as unknown[] }, { OR: searchConditions });
      where['AND'] = andArr;
      delete where['OR'];
    } else {
      where['OR'] = searchConditions;
    }
  }
  if (query.dateFrom || query.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (query.dateFrom) dateFilter['gte'] = query.dateFrom;
    if (query.dateTo) dateFilter['lte'] = query.dateTo;
    where['date'] = dateFilter;
  }
  return where;
}

type Anticipation = z.infer<typeof AnticipationSchema>;

/**
 * Lazily generate schedule rows up to a 7-day lookahead and return the DUE /
 * OVERDUE / UPCOMING anticipations mapped to the API shape. Only called on the
 * first page (no cursor) when generation isn't skipped.
 *
 * `showSnoozed` additionally returns rows the user has snoozed. They are
 * excluded by default — a snooze is a deliberate "not now" — but excluding them
 * unconditionally left them unreachable from this page, so an accidental snooze
 * could only be undone by finding the row somewhere else.
 */
export async function buildUpcomingAnticipations({
  showSnoozed = false,
}: { showSnoozed?: boolean } = {}): Promise<Anticipation[]> {
  const todayNorm = todayLocal();

  // Lookahead: generate and return anticipations up to 7 days from now
  const { year, month, day } = localDate(todayNorm);
  const lookahead = makeDate(year, month, day + 7);

  // Lazy-generate schedule rows up to the lookahead date
  const START = new Date(Date.UTC(2026, 0, 1));
  try {
    await generateSchedule({ periodStart: START, periodEnd: lookahead });
  } catch (err) {
    // Schedule generation failure should not block the transactions response
    console.error('[Transactions] generateSchedule failed:', err);
  }

  // Query persisted ScheduledTransaction rows including upcoming (within lookahead)
  const scheduleRows = await prisma.scheduledTransaction.findMany({
    where: {
      status: { in: ['PENDING', 'SNOOZED', 'PARTIAL'] },
      dueDate: { lte: lookahead },
    },
    include: {
      expense: {
        select: {
          id: true,
          name: true,
          budgetId: true,
          accountId: true,
          isAutomatic: true,
          frequency: true,
        },
      },
      income: {
        select: { id: true, name: true, budgetId: true, accountId: true, frequency: true },
      },
    },
  });

  // Map ScheduledTransaction rows to AnticipationSchema shape
  return scheduleRows
    .map((row) => {
      const displayStatus = mapScheduleStatus(
        row.status as Parameters<typeof mapScheduleStatus>[0],
        row.dueDate,
        row.snoozedUntil,
        todayNorm,
      );

      // DUE / OVERDUE / UPCOMING always; SNOOZED only when asked for, since a
      // still-active snooze is something the user chose to silence.
      const visible =
        displayStatus === 'DUE' ||
        displayStatus === 'OVERDUE' ||
        displayStatus === 'UPCOMING' ||
        (showSnoozed && displayStatus === 'SNOOZED');
      if (!visible) return null;

      if (row.sourceType === 'EXPENSE' && row.expense) {
        return {
          id: row.id,
          sourceType: 'expense' as const,
          sourceId: row.sourceId,
          name: row.expense.name,
          amount: Number(row.expectedAmount),
          occurrenceDate: row.dueDate,
          status: displayStatus as 'DUE' | 'OVERDUE' | 'UPCOMING' | 'SNOOZED',
          budgetId: row.expense.budgetId,
          accountId: row.expense.accountId,
          isAutomatic: row.expense.isAutomatic,
          frequency: row.expense.frequency,
        };
      } else if (row.sourceType === 'INCOME' && row.income) {
        return {
          id: row.id,
          sourceType: 'income' as const,
          sourceId: row.sourceId,
          name: row.income.name,
          amount: Number(row.expectedAmount),
          occurrenceDate: row.dueDate,
          status: displayStatus as 'DUE' | 'OVERDUE' | 'UPCOMING' | 'SNOOZED',
          budgetId: row.income.budgetId,
          accountId: row.income.accountId,
          isAutomatic: false,
          frequency: row.income.frequency,
        };
      }
      return null;
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);
}
