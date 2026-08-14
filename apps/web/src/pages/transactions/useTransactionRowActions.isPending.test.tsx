/**
 * useTransactionRowActions behaviours (payment-split, ADR-030):
 * - The combined `isPending` guard must include the purchase (split) create
 *   mutation. It drives the transaction form's disabled submit button; if
 *   createPurchase.isPending is omitted, a split create isn't guarded and can be
 *   double-submitted.
 * - `onResplit` fetches the group's legs before opening the drawer; a failed
 *   fetch must surface an error toast, not fail silently or leave an unhandled
 *   rejection.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// createPurchase is the mutation under test; the rest are idle stubs. addToast is
// spied on to assert the onResplit failure path surfaces a toast.
const h = vi.hoisted(() => ({
  useCreatePurchase: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  addToast: vi.fn(),
}));

vi.mock('../../hooks/useTransactionMutations.js', () => ({
  useCreateTransaction: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTransaction: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTransaction: () => ({ mutate: vi.fn(), isPending: false }),
  useCreatePurchase: h.useCreatePurchase,
  useUpdatePurchasePayments: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePurchase: () => ({ mutate: vi.fn(), isPending: false }),
  useLinkTransaction: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlinkTransaction: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/useApi.js', () => ({
  useCustodians: () => ({ data: [] }),
  useWallets: () => ({ data: [] }),
  useInvestmentPrices: () => ({ data: {} }),
  useInvestments: () => ({ data: [] }),
  useBitcoinTransfer: () => ({ mutate: vi.fn(), isPending: false }),
  useStockTransfer: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../lib/api.js', () => ({
  api: {
    expenses: { list: vi.fn().mockResolvedValue([]) },
    income: { list: vi.fn().mockResolvedValue([]) },
    accounts: { list: vi.fn().mockResolvedValue([]) },
    budgetItems: { list: vi.fn().mockResolvedValue([]) },
    transactions: { list: vi.fn().mockResolvedValue({ transactions: [] }) },
  },
}));

// The form hook is heavy (react-hook-form) and irrelevant to the pending guard.
vi.mock('./useTransactionForm.js', () => ({
  useTransactionForm: () => ({
    txType: 'EXPENSE',
    openCreate: vi.fn(),
    openEdit: vi.fn(),
    openDuplicate: vi.fn(),
    openResplit: vi.fn(),
  }),
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

vi.mock('../../store/toast.js', () => ({
  useToastStore: { getState: () => ({ addToast: h.addToast }) },
}));

import { useTransactionRowActions } from './useTransactionRowActions.js';
import { api } from '../../lib/api.js';
import type { Transaction as CoreTransaction } from '@budget-tracker/core';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useTransactionRowActions — isPending guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is true while a split (purchase) create is pending', () => {
    h.useCreatePurchase.mockReturnValue({ mutate: vi.fn(), isPending: true });
    const { result } = renderHook(() => useTransactionRowActions({ transactions: [] }), {
      wrapper,
    });
    expect(result.current.isPending).toBe(true);
  });

  it('is false when no mutation is pending', () => {
    h.useCreatePurchase.mockReturnValue({ mutate: vi.fn(), isPending: false });
    const { result } = renderHook(() => useTransactionRowActions({ transactions: [] }), {
      wrapper,
    });
    expect(result.current.isPending).toBe(false);
  });
});

describe('useTransactionRowActions — onResplit', () => {
  beforeEach(() => vi.clearAllMocks());

  const anchor = { purchaseGroupId: 'g1' } as unknown as CoreTransaction;

  it('surfaces an error toast when the split legs fail to load', async () => {
    vi.mocked(api.transactions.list).mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useTransactionRowActions({ transactions: [] }), {
      wrapper,
    });

    await act(async () => {
      await result.current.onResplit(anchor);
    });

    expect(h.addToast).toHaveBeenCalledWith('error', expect.stringContaining("Couldn't load"));
  });

  it('does not toast on a successful load', async () => {
    vi.mocked(api.transactions.list).mockResolvedValueOnce({ transactions: [] } as never);
    const { result } = renderHook(() => useTransactionRowActions({ transactions: [] }), {
      wrapper,
    });

    await act(async () => {
      await result.current.onResplit(anchor);
    });

    expect(h.addToast).not.toHaveBeenCalled();
  });
});
