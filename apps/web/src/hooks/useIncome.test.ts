import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { createWrapper } from '../test/wrapper.js';

function createTestWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper, queryClient };
}

const mockList = vi.fn().mockResolvedValue([{ id: '1', name: 'Salary' }]);
const mockCreate = vi.fn().mockResolvedValue({ id: '2', name: 'Freelance' });
const mockUpdate = vi.fn().mockResolvedValue({ id: '1', name: 'Salary Updated' });
const mockDelete = vi.fn().mockResolvedValue(undefined);
const mockArchive = vi.fn().mockResolvedValue({ id: '1', archivedAt: '2026-01-01' });
const mockRestore = vi.fn().mockResolvedValue({ id: '1', archivedAt: null });

vi.mock('../lib/api.js', () => ({
  api: {
    income: {
      list: (...args: unknown[]) => mockList(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
      archive: (...args: unknown[]) => mockArchive(...args),
      restore: (...args: unknown[]) => mockRestore(...args),
    },
  },
}));

import {
  useIncome,
  useCreateIncome,
  useUpdateIncome,
  useDeleteIncome,
  useArchiveIncome,
  useRestoreIncome,
} from './useIncome.js';

describe('useIncome hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useIncome query', () => {
    it('fetches income list with no params', async () => {
      const { result } = renderHook(() => useIncome(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockList).toHaveBeenCalledWith(undefined);
      expect(result.current.data).toEqual([{ id: '1', name: 'Salary' }]);
    });

    it('passes params to API and includes them in query key', async () => {
      const params = { frequency: 'monthly', archived: 'true' };
      const { result } = renderHook(() => useIncome(params), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockList).toHaveBeenCalledWith(params);
    });
  });

  describe('useCreateIncome', () => {
    it('calls api.income.create with the body', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useCreateIncome(), { wrapper });
      const body = { name: 'Freelance', amount: 1000 };

      await act(async () => {
        await result.current.mutateAsync(body);
      });

      expect(mockCreate).toHaveBeenCalledWith(body);
    });
  });

  describe('useUpdateIncome', () => {
    it('calls api.income.update with id and body', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useUpdateIncome(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'inc_1', body: { name: 'Updated' } });
      });

      expect(mockUpdate).toHaveBeenCalledWith('inc_1', { name: 'Updated' });
    });
  });

  describe('useDeleteIncome', () => {
    it('calls api.income.delete with id', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useDeleteIncome(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('inc_1');
      });

      expect(mockDelete).toHaveBeenCalledWith('inc_1');
    });
  });

  describe('useArchiveIncome', () => {
    it('calls api.income.archive with id', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useArchiveIncome(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('inc_1');
      });

      expect(mockArchive).toHaveBeenCalledWith('inc_1');
    });
  });

  describe('useRestoreIncome', () => {
    it('calls api.income.restore with id', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useRestoreIncome(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('inc_1');
      });

      expect(mockRestore).toHaveBeenCalledWith('inc_1');
    });
  });

  describe('cache invalidation', () => {
    it('useCreateIncome invalidates income, dashboard, transactions, and scheduled-transactions', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useCreateIncome(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ name: 'New' });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['income'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scheduled-transactions'] });
    });

    it('useUpdateIncome invalidates all caches', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUpdateIncome(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: '1', body: { name: 'Updated' } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['income'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scheduled-transactions'] });
    });

    it('useArchiveIncome invalidates income and transactions caches', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useArchiveIncome(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('inc_1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['income'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
    });

    it('useRestoreIncome invalidates income and transactions caches', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useRestoreIncome(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('inc_1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['income'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
    });
  });

  describe('mutation meta', () => {
    it('useCreateIncome has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useCreateIncome(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ name: 'Test' });
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Income created' });
    });

    it('useUpdateIncome has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useUpdateIncome(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: '1', body: { name: 'Test' } });
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Income updated' });
    });

    it('useDeleteIncome has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useDeleteIncome(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('1');
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      // Exact, deliberately: Transaction.incomeId is ON DELETE SET NULL, so a
      // recreate cannot re-adopt the history this delete detached.
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Income deleted' });
    });

    it('useArchiveIncome has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useArchiveIncome(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('1');
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Income archived' });
    });

    it('useRestoreIncome has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useRestoreIncome(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('1');
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Income restored' });
    });
  });
});
