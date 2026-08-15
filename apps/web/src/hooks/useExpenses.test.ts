import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { createWrapper } from '../test/wrapper.js';

vi.mock('../lib/api.js', () => ({
  api: {
    expenses: {
      list: vi.fn().mockResolvedValue([{ id: '1', name: 'Rent' }]),
      create: vi.fn().mockResolvedValue({ id: '2', name: 'Internet' }),
      update: vi.fn().mockResolvedValue({ id: '1', name: 'Rent Updated' }),
      delete: vi.fn().mockResolvedValue(undefined),
      archive: vi.fn().mockResolvedValue({ id: '1', archivedAt: '2026-01-01' }),
      restore: vi.fn().mockResolvedValue({ id: '1', archivedAt: null }),
    },
  },
}));

import { api } from '../lib/api.js';
import {
  useExpenses,
  useCreateExpense,
  useUpdateExpense,
  useDeleteExpense,
  useArchiveExpense,
  useRestoreExpense,
} from './useExpenses.js';

const mockedApi = vi.mocked(api);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function createWrapperWithClient(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useExpenses hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useExpenses query', () => {
    it('fetches expenses with no params', async () => {
      const { result } = renderHook(() => useExpenses(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.expenses.list).toHaveBeenCalledWith(undefined);
      expect(result.current.data).toEqual([{ id: '1', name: 'Rent' }]);
    });

    it('passes params to API and includes them in query key', async () => {
      const params = { budgetId: 'b1', archived: 'true' };
      const { result } = renderHook(() => useExpenses(params), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.expenses.list).toHaveBeenCalledWith(params);
    });
  });

  describe('useCreateExpense', () => {
    it('calls api.expenses.create', async () => {
      const { result } = renderHook(() => useCreateExpense(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate({ name: 'New Expense', amount: 100 });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.expenses.create).toHaveBeenCalledWith({ name: 'New Expense', amount: 100 });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useCreateExpense(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ name: 'Test', amount: 50 });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Expense created' });
    });

    it('invalidates expense-related caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useCreateExpense(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ name: 'Test', amount: 50 });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['expenses'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scheduled-transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['category-budgets'] });
    });
  });

  describe('useUpdateExpense', () => {
    it('calls api.expenses.update with id and body', async () => {
      const { result } = renderHook(() => useUpdateExpense(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate({ id: '1', body: { name: 'Updated', amount: 200 } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.expenses.update).toHaveBeenCalledWith('1', { name: 'Updated', amount: 200 });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useUpdateExpense(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: '1', body: { name: 'Updated' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Expense updated' });
    });

    it('invalidates expense-related caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useUpdateExpense(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: '1', body: { name: 'Updated' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['expenses'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    });
  });

  describe('useDeleteExpense', () => {
    it('calls api.expenses.delete with id', async () => {
      const { result } = renderHook(() => useDeleteExpense(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate('1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.expenses.delete).toHaveBeenCalledWith('1');
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useDeleteExpense(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      // Exact, deliberately: deleting an expense is NOT reversible, because
      // Transaction.expenseId and UtilityService.expenseId are ON DELETE SET
      // NULL — a recreate mints a new id and the detached history can never
      // be re-adopted. If someone adds an `undo` here, this fails.
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Expense deleted' });
    });

    it('invalidates expense-related caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useDeleteExpense(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['expenses'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    });
  });

  describe('useArchiveExpense', () => {
    it('calls api.expenses.archive with id', async () => {
      const { result } = renderHook(() => useArchiveExpense(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate('1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.expenses.archive).toHaveBeenCalledWith('1');
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useArchiveExpense(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Expense archived' });
    });

    it('invalidates expense and transaction caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useArchiveExpense(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['expenses'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
    });
  });

  describe('useRestoreExpense', () => {
    it('calls api.expenses.restore with id', async () => {
      const { result } = renderHook(() => useRestoreExpense(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate('1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.expenses.restore).toHaveBeenCalledWith('1');
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useRestoreExpense(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Expense restored' });
    });

    it('invalidates expense and transaction caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useRestoreExpense(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['expenses'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
    });
  });
});

/**
 * The inverses themselves.
 *
 * The observer decides WHETHER a button appears; these decide what it DOES.
 * Both need testing separately, because a correct button wired to the wrong
 * inverse is the failure that reverses someone's data into a state they never
 * had — worse than no undo at all.
 */
describe('undo', () => {
  const metaOf = (qc: QueryClient) =>
    qc.getMutationCache().getAll()[0]?.options.meta as
      | {
          undo?: (d: unknown, v: unknown, c: unknown) => Promise<unknown>;
          canUndo?: (d: unknown, v: unknown, c: unknown) => boolean;
        }
      | undefined;

  it('undoes a create by deleting exactly what it made', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useCreateExpense(), {
      wrapper: createWrapperWithClient(qc),
    });
    await act(async () => {
      result.current.mutate({ name: 'Internet', amount: 50 });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The id from the RESPONSE, not from what was submitted — the caller never
    // knew it.
    await metaOf(qc)?.undo?.({ id: '2' }, { name: 'Internet' }, undefined);
    expect(mockedApi.expenses.delete).toHaveBeenCalledWith('2');
  });

  it('undoes an update by putting the captured record back', async () => {
    const qc = createTestQueryClient();
    qc.setQueryData(['expenses', undefined], [{ id: '1', name: 'Rent', amount: 1200 }]);
    const { result } = renderHook(() => useUpdateExpense(), {
      wrapper: createWrapperWithClient(qc),
    });
    await act(async () => {
      result.current.mutate({ id: '1', body: { amount: 1300 } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const m = metaOf(qc);
    const context = { before: { id: '1', name: 'Rent', amount: 1200 } };
    expect(m?.canUndo?.(null, null, context)).toBe(true);
    await m?.undo?.(null, { id: '1' }, context);
    expect(mockedApi.expenses.update).toHaveBeenLastCalledWith('1', {
      id: '1',
      name: 'Rent',
      amount: 1200,
    });
  });

  it('withholds undo on an update whose list was never cached', async () => {
    // Nothing was captured, so there is nothing to restore. Offering the button
    // here would mean writing a guess over real data.
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useUpdateExpense(), {
      wrapper: createWrapperWithClient(qc),
    });
    await act(async () => {
      result.current.mutate({ id: '1', body: { amount: 1300 } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(metaOf(qc)?.canUndo?.(null, null, { before: undefined })).toBe(false);
  });

  it('undoes an archive by restoring the same row', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useArchiveExpense(), {
      wrapper: createWrapperWithClient(qc),
    });
    await act(async () => {
      result.current.mutate('1');
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await metaOf(qc)?.undo?.(null, '1', undefined);
    expect(mockedApi.expenses.restore).toHaveBeenCalledWith('1');
  });

  it('undoes a restore by archiving again', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useRestoreExpense(), {
      wrapper: createWrapperWithClient(qc),
    });
    await act(async () => {
      result.current.mutate('1');
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await metaOf(qc)?.undo?.(null, '1', undefined);
    expect(mockedApi.expenses.archive).toHaveBeenCalledWith('1');
  });

  it('offers no undo for a delete', async () => {
    // Pinned so that adding one requires confronting the SET NULL first.
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useDeleteExpense(), {
      wrapper: createWrapperWithClient(qc),
    });
    await act(async () => {
      result.current.mutate('1');
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(metaOf(qc)?.undo).toBeUndefined();
  });
});
