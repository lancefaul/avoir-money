import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface UseTransactionsParams {
  search?: string;
  accountId?: string;
  budgetIds?: string;
  purchaseGroupId?: string;
  type?: string;
  linkedToRecurring?: boolean;
  sortOrder?: 'newest' | 'oldest';
  dateFrom?: string;
  dateTo?: string;
  payPeriodId?: string;
  expenseId?: string;
  incomeId?: string;
  skipGenerate?: boolean;
  /**
   * Include upcoming scheduled rows. Server defaults to true; the Transactions
   * page passes the user's stored preference. Part of the query key, so
   * toggling it refetches rather than serving a cached page without them.
   */
  showAnticipations?: boolean;
  /** Also include snoozed anticipations. Server defaults to false. */
  showSnoozed?: boolean;
  /** Set to false to skip the query entirely (e.g. when a modal is closed). Defaults to true. */
  enabled?: boolean;
}

export function useTransactions(params: UseTransactionsParams) {
  const { enabled = true, ...queryParams } = params;
  return useInfiniteQuery({
    queryKey: ['transactions', queryParams],
    queryFn: ({ pageParam }) =>
      api.transactions.list({
        ...queryParams,
        cursor: pageParam ?? undefined,
        limit: 100,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    enabled,
  });
}
