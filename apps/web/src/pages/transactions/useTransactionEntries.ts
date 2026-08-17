import { useMemo } from 'react';
import {
  sortTransactionLog,
  type TransactionLogEntry,
  type Anticipation,
} from '@budget-tracker/core';
import type { Transaction } from './types.js';
import type { SearchSummaryData } from './transactionsPageUtils.js';

interface TxPageTotals {
  totalSpent?: number;
  totalEarned?: number;
}

interface UseTransactionEntriesArgs {
  rawTransactions: Transaction[];
  stableAnticipations: Anticipation[];
  sortOrder: 'newest' | 'oldest';
  filterCategoryIds: string[];
  filterAccountIds: string[];
  filterTypes: string[];
  filterLinkedToRecurring: boolean | undefined;
  filterDatePreset: string | undefined;
  searchQuery: string;
  debouncedSearch: string | undefined;
  txData: { pages: TxPageTotals[] } | undefined;
}

export interface UseTransactionEntriesReturn {
  filteredEntries: TransactionLogEntry[];
  transactions: Transaction[];
  searchSummary: SearchSummaryData | null;
  hasActiveFilters: boolean;
}

/**
 * Derives the merged/sorted/filtered transaction log and the search summary from
 * the raw transactions, anticipations and active filters. Extracted from
 * Transactions.tsx — all logic is memoized exactly as it was inline.
 */
export function useTransactionEntries({
  rawTransactions,
  stableAnticipations,
  sortOrder,
  filterCategoryIds,
  filterAccountIds,
  filterTypes,
  filterLinkedToRecurring,
  filterDatePreset,
  searchQuery,
  debouncedSearch,
  txData,
}: UseTransactionEntriesArgs): UseTransactionEntriesReturn {
  const sortedEntries = useMemo(() => {
    const now = new Date();
    const threeDaysOut = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
    const filtered = stableAnticipations.filter(
      (a) => a.status !== 'UPCOMING' || new Date(a.occurrenceDate) <= threeDaysOut,
    );
    const entries: TransactionLogEntry[] = [
      ...rawTransactions.map((tx) => ({
        kind: 'transaction' as const,
        data: {
          ...tx,
          date: new Date(tx.date),
          createdAt: new Date(),
          payPeriodId: null,
          type: tx.type as 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'REFUND' | 'TRADE',
        },
      })),
      ...filtered.map((a) => ({
        kind: 'anticipation' as const,
        data: {
          ...a,
          occurrenceDate: new Date(a.occurrenceDate),
          status: a.status as 'DUE' | 'OVERDUE' | 'UPCOMING',
        },
      })),
    ];
    return sortTransactionLog(entries);
  }, [rawTransactions, stableAnticipations]);

  const allTransactions = useMemo(
    () =>
      rawTransactions.toSorted((a, b) => {
        const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
        return sortOrder === 'oldest' ? diff : -diff;
      }),
    [rawTransactions, sortOrder],
  );

  const filteredEntries = useMemo(() => {
    const hasFilters = !!(
      filterCategoryIds.length ||
      filterAccountIds.length ||
      filterTypes.length ||
      filterLinkedToRecurring !== undefined ||
      filterDatePreset ||
      searchQuery
    );
    let result = sortedEntries;
    if (hasFilters)
      result = result.filter((e) => !(e.kind === 'anticipation' && e.data.status === 'UPCOMING'));
    if (filterCategoryIds.length) {
      result = result.filter((e) => {
        if (e.kind === 'anticipation') {
          return filterCategoryIds.includes(e.data.budgetId);
        }
        // Transactions are already filtered server-side via budgetIds param
        return true;
      });
    }
    if (filterAccountIds.length) {
      result = result.filter((e) => {
        if (e.kind === 'anticipation') {
          return e.data.accountId != null && filterAccountIds.includes(e.data.accountId);
        }
        if (e.kind !== 'transaction') return true;
        const d = e.data as Record<string, unknown>;
        const accId = 'accountId' in d ? (d.accountId as string | null) : null;
        const toAccId = 'toAccountId' in d ? (d.toAccountId as string | null) : null;
        return (
          (accId != null && filterAccountIds.includes(accId)) ||
          (toAccId != null && filterAccountIds.includes(toAccId))
        );
      });
    }
    if (filterTypes.length) {
      result = result.filter((e) => {
        if (e.kind === 'anticipation') {
          // Anticipations from expenses map to EXPENSE type, from income to INCOME type
          const mappedType = e.data.sourceType === 'expense' ? 'EXPENSE' : 'INCOME';
          return filterTypes.includes(mappedType);
        }
        const type = 'type' in e.data ? ((e.data as Record<string, unknown>).type as string) : null;
        return type ? filterTypes.includes(type) : false;
      });
    }
    if (debouncedSearch) {
      const searchLower = debouncedSearch.toLowerCase();
      result = result.filter((e) => {
        if (e.kind === 'anticipation') {
          return e.data.name.toLowerCase().includes(searchLower);
        }
        // Transactions are already server-filtered by search
        return true;
      });
    }
    return result;
  }, [
    sortedEntries,
    filterCategoryIds,
    filterAccountIds,
    filterTypes,
    filterLinkedToRecurring,
    filterDatePreset,
    searchQuery,
    debouncedSearch,
  ]);

  const transactions = useMemo(() => {
    let result = allTransactions;
    // Budget filtering is now server-side via budgetIds query param
    if (filterAccountIds.length)
      result = result.filter(
        (tx) =>
          (tx.accountId && filterAccountIds.includes(tx.accountId)) ||
          (tx.toAccountId && filterAccountIds.includes(tx.toAccountId)),
      );
    if (filterTypes.length) result = result.filter((tx) => filterTypes.includes(tx.type));
    return result;
  }, [allTransactions, filterAccountIds, filterTypes]);

  const hasActiveFilters = !!(
    filterCategoryIds.length ||
    filterAccountIds.length ||
    filterTypes.length ||
    filterLinkedToRecurring !== undefined ||
    filterDatePreset ||
    debouncedSearch
  );

  const searchSummary = useMemo(() => {
    if (!hasActiveFilters) return null;
    // Use server-computed totals from the first page response
    const totalSpent = txData?.pages[0]?.totalSpent ?? 0;
    const totalEarned = txData?.pages[0]?.totalEarned ?? 0;
    const dates: number[] = [];
    for (const tx of transactions) {
      dates.push(new Date(tx.date).getTime());
    }
    let months = 1;
    if (dates.length >= 2) {
      const min = Math.min(...dates);
      const max = Math.max(...dates);
      const diffMs = max - min;
      months = Math.max(1, diffMs / (30.44 * 24 * 60 * 60 * 1000));
    }
    return {
      totalSpent,
      totalEarned,
      avgSpent: totalSpent / months,
      avgEarned: totalEarned / months,
    };
  }, [hasActiveFilters, txData, transactions]);

  return { filteredEntries, transactions, searchSummary, hasActiveFilters };
}
