import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import {
  useBudgetItems,
  useBudgetItemGroups,
  useCreateBudgetItemGroup,
  useUpdateBudgetItemGroup,
  useDeleteBudgetItemGroup,
  useCreateBudgetItem,
  useUpdateBudgetItem,
  useDeleteBudgetItem,
  useReassignBudgetItem,
} from './useBudgetItems.js';

vi.mock('../lib/api.js', () => ({
  api: {
    budgetItems: {
      list: vi.fn(),
      groups: vi.fn(),
      createGroup: vi.fn(),
      updateGroup: vi.fn(),
      deleteGroup: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      reassign: vi.fn(),
    },
  },
}));

import { api } from '../lib/api.js';
import type { Mock } from 'vitest';

function createTestWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper, queryClient };
}

const mockItems = [
  { id: 'bi1', name: 'Groceries', amount: 500 },
  { id: 'bi2', name: 'Gas', amount: 200 },
];

const mockGroups = [
  { id: 'g1', name: 'Essentials', items: [] },
  { id: 'g2', name: 'Discretionary', items: [] },
];

describe('useBudgetItems hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Query Hooks ───

  describe('useBudgetItems', () => {
    it('uses ["budgetItems"] query key and delegates to api.budgetItems.list', async () => {
      (api.budgetItems.list as Mock).mockResolvedValue(mockItems);
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useBudgetItems(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(api.budgetItems.list).toHaveBeenCalledTimes(1);
      expect(result.current.data).toEqual(mockItems);
    });
  });

  describe('useBudgetItemGroups', () => {
    it('uses ["budgetItems", "groups"] query key and delegates to api.budgetItems.groups', async () => {
      (api.budgetItems.groups as Mock).mockResolvedValue(mockGroups);
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useBudgetItemGroups(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(api.budgetItems.groups).toHaveBeenCalledTimes(1);
      expect(result.current.data).toEqual(mockGroups);
    });
  });

  // ─── Group Mutations ───

  describe('useCreateBudgetItemGroup', () => {
    it('has meta.successMessage and calls api.budgetItems.createGroup', async () => {
      (api.budgetItems.createGroup as Mock).mockResolvedValue({ id: 'g3', name: 'New Group' });
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useCreateBudgetItemGroup(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ name: 'New Group' });
      });

      expect(api.budgetItems.createGroup).toHaveBeenCalledWith({ name: 'New Group' });
      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Budget group created' });
    });

    it('invalidates budgetItems and budgets caches on success', async () => {
      (api.budgetItems.createGroup as Mock).mockResolvedValue({ id: 'g3' });
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useCreateBudgetItemGroup(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ name: 'New Group' });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgetItems'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgets'] });
    });
  });

  describe('useUpdateBudgetItemGroup', () => {
    it('has meta.successMessage and calls api.budgetItems.updateGroup', async () => {
      (api.budgetItems.updateGroup as Mock).mockResolvedValue({ id: 'g1', name: 'Renamed' });
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useUpdateBudgetItemGroup(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'g1', body: { name: 'Renamed' } });
      });

      expect(api.budgetItems.updateGroup).toHaveBeenCalledWith('g1', { name: 'Renamed' });
      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Budget group updated' });
    });

    it('invalidates budgetItems and budgets caches on success', async () => {
      (api.budgetItems.updateGroup as Mock).mockResolvedValue({ id: 'g1' });
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useUpdateBudgetItemGroup(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'g1', body: { name: 'Renamed' } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgetItems'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgets'] });
    });
  });

  describe('useDeleteBudgetItemGroup', () => {
    it('has meta.successMessage and calls api.budgetItems.deleteGroup', async () => {
      (api.budgetItems.deleteGroup as Mock).mockResolvedValue(undefined);
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useDeleteBudgetItemGroup(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('g1');
      });

      expect(api.budgetItems.deleteGroup).toHaveBeenCalledWith('g1');
      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Budget group deleted' });
    });

    it('invalidates budgetItems and budgets caches on success', async () => {
      (api.budgetItems.deleteGroup as Mock).mockResolvedValue(undefined);
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useDeleteBudgetItemGroup(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('g1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgetItems'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgets'] });
    });
  });

  // ─── Budget Item Mutations ───

  describe('useCreateBudgetItem', () => {
    it('has meta.successMessage and calls api.budgetItems.create', async () => {
      (api.budgetItems.create as Mock).mockResolvedValue({ id: 'bi3', name: 'Dining' });
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useCreateBudgetItem(), { wrapper });
      const body = { name: 'Dining', amount: 300 };

      await act(async () => {
        await result.current.mutateAsync(body);
      });

      expect(api.budgetItems.create).toHaveBeenCalledWith(body);
      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Budget created' });
    });

    it('invalidates budgetItems and budgets caches on success', async () => {
      (api.budgetItems.create as Mock).mockResolvedValue({ id: 'bi3' });
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useCreateBudgetItem(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ name: 'Dining', amount: 300 });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgetItems'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgets'] });
    });
  });

  describe('useUpdateBudgetItem', () => {
    it('has meta.successMessage and calls api.budgetItems.update', async () => {
      (api.budgetItems.update as Mock).mockResolvedValue({
        id: 'bi1',
        name: 'Groceries',
        amount: 600,
      });
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useUpdateBudgetItem(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'bi1', body: { amount: 600 } });
      });

      expect(api.budgetItems.update).toHaveBeenCalledWith('bi1', { amount: 600 });
      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Budget updated' });
    });

    it('invalidates budgetItems and budgets caches on success', async () => {
      (api.budgetItems.update as Mock).mockResolvedValue({ id: 'bi1' });
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useUpdateBudgetItem(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'bi1', body: { amount: 600 } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgetItems'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgets'] });
    });
  });

  describe('useDeleteBudgetItem', () => {
    it('has meta.successMessage and calls api.budgetItems.delete with default hard mode', async () => {
      (api.budgetItems.delete as Mock).mockResolvedValue(undefined);
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useDeleteBudgetItem(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'bi1' });
      });

      expect(api.budgetItems.delete).toHaveBeenCalledWith('bi1', 'hard');
      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Budget deleted' });
    });

    it('passes soft mode when specified', async () => {
      (api.budgetItems.delete as Mock).mockResolvedValue(undefined);
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useDeleteBudgetItem(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'bi1', mode: 'soft' });
      });

      expect(api.budgetItems.delete).toHaveBeenCalledWith('bi1', 'soft');
    });

    it('invalidates budgetItems and budgets caches on success', async () => {
      (api.budgetItems.delete as Mock).mockResolvedValue(undefined);
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useDeleteBudgetItem(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'bi1' });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgetItems'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgets'] });
    });
  });

  describe('useReassignBudgetItem', () => {
    it('has meta.successMessage and calls api.budgetItems.reassign', async () => {
      (api.budgetItems.reassign as Mock).mockResolvedValue({ id: 'bi1', groupId: 'g2' });
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useReassignBudgetItem(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'bi1', targetBudgetId: 'bi2' });
      });

      expect(api.budgetItems.reassign).toHaveBeenCalledWith('bi1', 'bi2');
      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Budget reassigned' });
    });

    it('invalidates budgetItems and budgets caches on success', async () => {
      (api.budgetItems.reassign as Mock).mockResolvedValue({ id: 'bi1' });
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useReassignBudgetItem(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'bi1', targetBudgetId: 'bi2' });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgetItems'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgets'] });
    });
  });
});
