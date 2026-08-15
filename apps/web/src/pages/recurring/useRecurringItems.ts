import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import type { ExpenseRecord } from '../expenses/types.js';
import type { IncomeRecord } from '../income/types.js';
import { type RecurringItem, FREQUENCY_ORDER } from './types.js';

interface UseRecurringItemsArgs {
  activeExpenseData: unknown;
  archivedExpenseData: unknown;
  activeIncomeData: unknown;
  archivedIncomeData: unknown;
  searchQuery: string;
  filterAccount: string[];
  filterType: string[];
  filterBudgetIds: string[];
}

/**
 * Builds the unified recurring item list (expenses + income, active + archived),
 * applies the page filters, classifies by status, groups active items by
 * frequency, and resolves each source's next due date/amount from the persisted
 * schedule. Extracted verbatim from Recurring.tsx.
 */
export function useRecurringItems({
  activeExpenseData,
  archivedExpenseData,
  activeIncomeData,
  archivedIncomeData,
  searchQuery,
  filterAccount,
  filterType,
  filterBudgetIds,
}: UseRecurringItemsArgs) {
  // ── Scheduled transactions for next due dates ──
  const periodStart = new Date().toISOString().split('T')[0]!;
  const periodEndDate = new Date();
  periodEndDate.setFullYear(periodEndDate.getFullYear() + 2);
  const periodEnd = periodEndDate.toISOString().split('T')[0]!;
  const { data: scheduledTxs } = useQuery({
    queryKey: ['scheduled-transactions', 'ALL', periodStart, periodEnd],
    queryFn: () => api.scheduledTransactions.list({ periodStart, periodEnd }),
  });

  // Earliest pending scheduled transaction per source. Captures both the next
  // due date and the backend-resolved `expectedAmount`, which correctly reflects
  // a by-month `amountSchedule` (month/biweekly/semi-monthly aware) — unlike the
  // static base `amount` stored on the record.
  const nextDueMap = useMemo(() => {
    const map = new Map<string, { date: Date; amount: number }>();
    if (!scheduledTxs) return map;
    const pending = scheduledTxs
      .filter((st) => st.status === 'PENDING')
      .toSorted((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    for (const st of pending) {
      if (!map.has(st.sourceId)) {
        map.set(st.sourceId, { date: new Date(st.dueDate), amount: st.expectedAmount });
      }
    }
    return map;
  }, [scheduledTxs]);

  // ── Build unified items ──
  const allExpenses = useMemo(
    () =>
      [
        ...((activeExpenseData ?? []) as ExpenseRecord[]),
        ...((archivedExpenseData ?? []) as ExpenseRecord[]),
      ].filter((r) => r.frequency !== 'ONE_TIME'),
    [activeExpenseData, archivedExpenseData],
  );

  const allIncome = useMemo(
    () =>
      [
        ...((activeIncomeData ?? []) as IncomeRecord[]),
        ...((archivedIncomeData ?? []) as IncomeRecord[]),
      ].filter((r) => r.frequency !== 'ONE_TIME'),
    [activeIncomeData, archivedIncomeData],
  );

  const allItems: RecurringItem[] = useMemo(() => {
    const expenses: RecurringItem[] = allExpenses.map((e) => ({
      id: e.id,
      type: 'expense',
      name: e.name,
      amount: e.amount,
      frequency: e.frequency,
      budgetId: e.budgetId,
      accountId: e.accountId,
      pausedUntil: e.pausedUntil,
      archivedAt: e.archivedAt,
      managementUrl: e.managementUrl,
      original: e,
    }));
    const income: RecurringItem[] = allIncome.map((i) => ({
      id: i.id,
      type: 'income',
      name: i.name,
      amount: i.amount,
      frequency: i.frequency,
      budgetId: i.budgetId,
      accountId: i.accountId,
      pausedUntil: i.pausedUntil,
      archivedAt: i.archivedAt,
      managementUrl: i.managementUrl,
      original: i,
    }));
    return [...expenses, ...income];
  }, [allExpenses, allIncome]);

  // Apply filters
  const filtered = useMemo(() => {
    let items = allItems;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter((r) => r.name.toLowerCase().includes(q));
    }
    if (filterAccount.length > 0) {
      items = items.filter((r) => r.accountId != null && filterAccount.includes(r.accountId));
    }
    if (filterType.length > 0) {
      items = items.filter((r) => filterType.includes(r.type));
    }
    if (filterBudgetIds.length > 0) {
      items = items.filter((r) => filterBudgetIds.includes(r.budgetId));
    }
    return items;
  }, [allItems, searchQuery, filterAccount, filterType, filterBudgetIds]);

  // Classify
  const active = filtered.filter((r) => !r.archivedAt && !r.pausedUntil);
  const paused = filtered.filter((r) => !r.archivedAt && r.pausedUntil);
  const archived = filtered.filter((r) => r.archivedAt);

  // Group active by frequency
  const activeByFrequency = useMemo(() => {
    const groups: { freq: string; items: RecurringItem[] }[] = [];
    for (const freq of FREQUENCY_ORDER) {
      const items = active.filter((r) => r.frequency === freq);
      if (items.length > 0) groups.push({ freq, items });
    }
    return groups;
  }, [active]);

  return { nextDueMap, filtered, active, paused, archived, activeByFrequency };
}
