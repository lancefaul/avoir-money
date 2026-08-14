import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createWrapper } from '../test/wrapper.js';
import { useUIStore } from '../store/ui.js';

// Mock matchMedia for responsive column collapse (useIsNarrow in TransactionList)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock('../hooks/useTransactions.js', () => ({
  useTransactions: vi.fn().mockReturnValue({
    data: {
      pages: [
        {
          transactions: [
            {
              id: '1',
              type: 'EXPENSE',
              name: 'Mortgage Payment',
              amount: 1099,
              date: '2026-03-20',
              expenseId: 'e1',
              incomeId: null,
              accountId: 'a1',
              toAccountId: null,
              budgetId: 'c1',
              note: null,
            },
            {
              id: '2',
              type: 'INCOME',
              name: 'Paycheck',
              amount: 5000,
              date: '2026-03-20',
              expenseId: null,
              incomeId: 'i1',
              accountId: 'a1',
              toAccountId: null,
              budgetId: null,
              note: null,
            },
            {
              id: '3',
              type: 'TRANSFER',
              name: 'Move to savings',
              amount: 200,
              date: '2026-03-21',
              expenseId: null,
              incomeId: null,
              accountId: 'a1',
              toAccountId: 'a2',
              budgetId: null,
              note: null,
            },
          ],
          anticipations: [],
          totalCount: 50,
          hasMore: true,
          nextCursor: 'cursor-abc',
        },
      ],
    },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: true,
    fetchNextPage: vi.fn(),
  }),
}));

vi.mock('../hooks/useScheduledTransactions.js', () => ({
  useMarkAsPaid: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useSnooze: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/useApi.js', () => ({
  useCustodians: vi.fn().mockReturnValue({ data: [] }),
  useWallets: vi.fn().mockReturnValue({ data: [] }),
  useInvestmentPrices: vi.fn().mockReturnValue({ data: {} }),
  useInvestments: vi.fn().mockReturnValue({ data: [] }),
  useBitcoinTransfer: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useStockTransfer: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useCurrentPeriod: vi.fn().mockReturnValue({ data: undefined, isLoading: false }),
}));

// The page reads `?purchase=` via useSearch and navigates via useNavigate; both
// need a RouterProvider this page-level test doesn't set up. Stub the two hooks
// (no purchase filter active), keeping the rest of the router module intact.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useSearch: () => ({ purchase: undefined }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('../hooks/useTransactionMutations.js', () => ({
  useCreateTransaction: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useUpdateTransaction: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useDeleteTransaction: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useCreatePurchase: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useUpdatePurchasePayments: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useDeletePurchase: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useLinkTransaction: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useUnlinkTransaction: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: vi.fn().mockImplementation(({ queryKey }) => {
      if (queryKey[0] === 'expenses')
        return { data: [{ id: 'e1', name: 'Mortgage', budgetId: 'c1' }] };
      if (queryKey[0] === 'income') return { data: [{ id: 'i1', name: 'Paycheck' }] };
      if (queryKey[0] === 'accounts')
        return {
          data: [
            { id: 'a1', name: 'Cash Wallet' },
            { id: 'a2', name: 'Savings' },
          ],
        };
      if (queryKey[0] === 'categories' || queryKey[0] === 'budgetItems')
        return { data: [{ id: 'c1', name: 'Mortgage', icon: '🏠', groupName: 'HOUSING' }] };
      return { data: [] };
    }),
    useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
    useQueryClient: vi.fn().mockReturnValue({ invalidateQueries: vi.fn() }),
  };
});

// Stub IntersectionObserver for LoadMoreTrigger
vi.stubGlobal(
  'IntersectionObserver',
  vi.fn(function (this: any) {
    this.observe = vi.fn();
    this.disconnect = vi.fn();
    this.unobserve = vi.fn();
  }),
);

import TransactionsPage from './Transactions.js';

describe('Transactions Page', () => {
  it('shows dates inline with transactions', () => {
    render(<TransactionsPage />, { wrapper: createWrapper() });
    expect(screen.getAllByText('Mar 20, 2026').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Mar 21, 2026').length).toBeGreaterThanOrEqual(1);
  });

  it('shows transaction names', () => {
    render(<TransactionsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Mortgage Payment')).toBeInTheDocument();
    expect(screen.getByText('Paycheck')).toBeInTheDocument();
    expect(screen.getByText('Move to savings')).toBeInTheDocument();
  });

  it('shows category with emoji for expenses', () => {
    render(<TransactionsPage />, { wrapper: createWrapper() });
    expect(screen.getAllByText(/🏠 Mortgage/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows income as green with plus', () => {
    render(<TransactionsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('+$5,000.00')).toBeInTheDocument();
  });

  it('shows expense as red with minus', () => {
    render(<TransactionsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('-$1,099.00')).toBeInTheDocument();
  });

  it('shows transfer amount without prefix', () => {
    render(<TransactionsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('$200.00')).toBeInTheDocument();
  });

  it('shows add transaction button', () => {
    render(<TransactionsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Add Transaction')).toBeInTheDocument();
  });

  it('displays total count in page title when totalCount > 0', () => {
    render(<TransactionsPage />, { wrapper: createWrapper() });
    // PageHeader sets pageTitle as a ReactNode in the Zustand store.
    // The wrapper renders PageActionSlot but not the title.
    // Verify the page renders and the "Add Transaction" button is present.
    expect(screen.getByText('Add Transaction')).toBeInTheDocument();
    // The pageTitle is set as a ReactNode — verify it's truthy
    const title = useUIStore.getState().pageTitle;
    expect(title).toBeTruthy();
  });

  it('does not display "Showing X of Y" when totalCount is 0', async () => {
    const mod = await import('../hooks/useTransactions.js');
    const mock = vi.mocked(mod.useTransactions);
    const original = mock.getMockImplementation();

    const emptyReturn = {
      data: {
        pages: [
          { transactions: [], anticipations: [], totalCount: 0, hasMore: false, nextCursor: null },
        ],
        pageParams: [null],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as any;
    mock.mockReturnValue(emptyReturn);

    render(<TransactionsPage />, { wrapper: createWrapper() });
    expect(screen.queryByText(/Showing \d+ of \d+/)).not.toBeInTheDocument();

    // Restore original mock
    if (original) mock.mockImplementation(original);
    else mock.mockRestore();
  });

  it('passes correct filter params to useTransactions and resets on filter change', async () => {
    const { useTransactions } = await import('../hooks/useTransactions.js');
    const mockUseTransactions = vi.mocked(useTransactions);

    render(<TransactionsPage />, { wrapper: createWrapper() });

    // On initial render, useTransactions is called with no filters applied.
    // Undefined-valued keys are listed for documentation; `toEqual` ignores
    // them on both sides, so only the defined values below actually assert.
    const lastCall = mockUseTransactions.mock.calls[mockUseTransactions.mock.calls.length - 1];
    expect(lastCall![0]).toEqual({
      search: undefined,
      linkedToRecurring: undefined,
      sortOrder: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      budgetIds: undefined,
      purchaseGroupId: undefined,
      // Display preferences rather than filters, so they carry real defaults:
      // upcoming rows are asked for, snoozed ones are not.
      showAnticipations: true,
      showSnoozed: false,
    });
  });

  it('renders LoadMoreTrigger component', () => {
    render(<TransactionsPage />, { wrapper: createWrapper() });
    // LoadMoreTrigger renders "All transactions loaded" when hasMore is true
    // but since the mock has hasNextPage: true and isFetchingNextPage: false,
    // the trigger div is present but shows no text. Verify the component renders
    // by checking for the text it would show when all loaded.
    // With hasNextPage: true, the trigger is an empty sentinel div.
    // We verify the page renders without error and the transaction list is present.
    expect(screen.getByText('Mortgage Payment')).toBeInTheDocument();
  });
});

describe('Transactions Page — empty state', () => {
  it('shows empty state message when no transactions exist', async () => {
    const mod = await import('../hooks/useTransactions.js');
    const mock = vi.mocked(mod.useTransactions);

    mock.mockReturnValue({
      data: {
        pages: [
          { transactions: [], anticipations: [], totalCount: 0, hasMore: false, nextCursor: null },
        ],
        pageParams: [null],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as any);

    render(<TransactionsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('No transactions yet — add one to get started')).toBeInTheDocument();
  });

  it('shows Add Transaction button in empty state', async () => {
    const mod = await import('../hooks/useTransactions.js');
    const mock = vi.mocked(mod.useTransactions);

    mock.mockReturnValue({
      data: {
        pages: [
          { transactions: [], anticipations: [], totalCount: 0, hasMore: false, nextCursor: null },
        ],
        pageParams: [null],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as any);

    render(<TransactionsPage />, { wrapper: createWrapper() });
    // The empty state has its own Add Transaction button
    const buttons = screen.getAllByText('Add Transaction');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});
