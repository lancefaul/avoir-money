import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import {
  useYearPlans,
  useActivePlan,
  useCreatePlan,
  useConfirmPlan,
  useCarryForward,
  useBudgets,
  useCreateBudget,
  useUpdateBudget,
  useDeleteBudget,
} from './useBudgets.js';

vi.mock('../lib/api.js', () => ({
  api: {
    budgets: {
      listPlans: vi.fn(),
      createPlan: vi.fn(),
      confirmPlan: vi.fn(),
      carryForward: vi.fn(),
      listBudgets: vi.fn(),
      createBudget: vi.fn(),
      updateBudget: vi.fn(),
      deleteBudget: vi.fn(),
      restoreBudget: vi.fn(),
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

const mockPlans = [
  { id: 'plan1', year: new Date().getFullYear(), status: 'ACTIVE', name: 'Current' },
  { id: 'plan2', year: new Date().getFullYear() - 1, status: 'ARCHIVED', name: 'Last Year' },
  { id: 'plan3', year: new Date().getFullYear(), status: 'DRAFT', name: 'Draft' },
];

const mockBudget = { id: 'budget1', name: 'Groceries', amount: 500 };

describe('useBudgets hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Year Plans Queries ───

  describe('useYearPlans', () => {
    it('uses correct query key and delegates to api.budgets.listPlans', async () => {
      (api.budgets.listPlans as Mock).mockResolvedValue(mockPlans);
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useYearPlans(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(api.budgets.listPlans).toHaveBeenCalledTimes(1);
      expect(result.current.data).toEqual(mockPlans);
    });
  });

  describe('useActivePlan', () => {
    it('returns the ACTIVE plan for the current year', async () => {
      (api.budgets.listPlans as Mock).mockResolvedValue(mockPlans);
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useActivePlan(), { wrapper });
      await waitFor(() => expect(result.current.data).toBeDefined());
      expect(result.current.data!.id).toBe('plan1');
      expect(result.current.data!.status).toBe('ACTIVE');
    });

    it('returns currentYearPlan as the first plan matching current year', async () => {
      (api.budgets.listPlans as Mock).mockResolvedValue(mockPlans);
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useActivePlan(), { wrapper });
      await waitFor(() => expect(result.current.plans).toBeDefined());
      expect(result.current.currentYearPlan!.id).toBe('plan1');
    });

    it('returns undefined data when no ACTIVE plan exists for current year', async () => {
      const plansNoActive = [
        { id: 'plan2', year: new Date().getFullYear() - 1, status: 'ARCHIVED', name: 'Old' },
      ];
      (api.budgets.listPlans as Mock).mockResolvedValue(plansNoActive);
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useActivePlan(), { wrapper });
      await waitFor(() => expect(result.current.plans).toBeDefined());
      expect(result.current.data).toBeUndefined();
    });
  });

  // ─── Year Plan Mutations ───

  describe('useCreatePlan', () => {
    it('has meta.successMessage and calls api.budgets.createPlan', async () => {
      const newPlan = { id: 'plan4', year: 2027, status: 'DRAFT', name: '2027' };
      (api.budgets.createPlan as Mock).mockResolvedValue(newPlan);

      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useCreatePlan(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ year: 2027 });
      });

      expect(api.budgets.createPlan).toHaveBeenCalledWith({ year: 2027 });
      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Year plan created' });
    });

    it('invalidates year-plans and budgets caches on success', async () => {
      (api.budgets.createPlan as Mock).mockResolvedValue({ id: 'plan4' });

      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useCreatePlan(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ year: 2027 });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['year-plans'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgets'] });
    });
  });

  describe('useConfirmPlan', () => {
    it('has meta.successMessage and calls api.budgets.confirmPlan', async () => {
      (api.budgets.confirmPlan as Mock).mockResolvedValue({ id: 'plan1', status: 'ACTIVE' });

      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useConfirmPlan(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('plan1');
      });

      expect(api.budgets.confirmPlan).toHaveBeenCalledWith('plan1');
      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Year plan confirmed' });
    });

    it('invalidates year-plans, budgets, and category-budgets caches on success', async () => {
      (api.budgets.confirmPlan as Mock).mockResolvedValue({ id: 'plan1' });

      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useConfirmPlan(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('plan1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['year-plans'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgets'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['category-budgets'] });
    });
  });

  describe('useCarryForward', () => {
    it('has meta.successMessage and calls api.budgets.carryForward', async () => {
      (api.budgets.carryForward as Mock).mockResolvedValue({ id: 'plan5', status: 'DRAFT' });

      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useCarryForward(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'plan1', body: { sourceYear: 2026 } });
      });

      expect(api.budgets.carryForward).toHaveBeenCalledWith('plan1', { sourceYear: 2026 });
      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({
        successMessage: 'Budgets carried forward',
      });
    });

    it('invalidates year-plans and budgets caches on success', async () => {
      (api.budgets.carryForward as Mock).mockResolvedValue({ id: 'plan5' });

      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useCarryForward(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'plan1', body: { sourceYear: 2026 } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['year-plans'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgets'] });
    });
  });

  // ─── Category Budgets Query ───

  describe('useBudgets', () => {
    it('uses correct query key with all parameters and delegates to API', async () => {
      (api.budgets.listBudgets as Mock).mockResolvedValue([mockBudget]);
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(
        () => useBudgets('plan1', 6, 2026, true, '2026-06-01', '2026-06-30', 'monthly'),
        { wrapper },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(api.budgets.listBudgets).toHaveBeenCalledWith(
        'plan1',
        6,
        2026,
        true,
        '2026-06-01',
        '2026-06-30',
        'monthly',
      );
    });

    it('is disabled when yearPlanId is undefined', () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useBudgets(undefined), { wrapper });
      expect(result.current.fetchStatus).toBe('idle');
    });
  });

  // ─── Category Budget Mutations ───

  describe('useCreateBudget', () => {
    it('has meta.successMessage and calls api.budgets.createBudget', async () => {
      (api.budgets.createBudget as Mock).mockResolvedValue(mockBudget);

      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useCreateBudget(), { wrapper });
      const body = { name: 'Groceries', amount: 500, yearPlanId: 'plan1', frequency: 'MONTHLY' };

      await act(async () => {
        await result.current.mutateAsync(body as never);
      });

      expect(api.budgets.createBudget).toHaveBeenCalledWith(body);
      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Budget created' });
    });

    it('invalidates budgets and category-budgets caches on success', async () => {
      (api.budgets.createBudget as Mock).mockResolvedValue(mockBudget);

      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useCreateBudget(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ name: 'Test', amount: 100 } as never);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgets'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['category-budgets'] });
    });
  });

  describe('useUpdateBudget', () => {
    it('has meta.successMessage and calls api.budgets.updateBudget', async () => {
      (api.budgets.updateBudget as Mock).mockResolvedValue({ ...mockBudget, amount: 600 });

      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useUpdateBudget(), { wrapper });
      const body = { amount: 600 };

      await act(async () => {
        await result.current.mutateAsync({ id: 'budget1', body: body as never });
      });

      expect(api.budgets.updateBudget).toHaveBeenCalledWith('budget1', body);
      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Budget updated' });
    });

    it('invalidates budgets and category-budgets caches on success', async () => {
      (api.budgets.updateBudget as Mock).mockResolvedValue(mockBudget);

      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useUpdateBudget(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'budget1', body: { amount: 600 } as never });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgets'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['category-budgets'] });
    });
  });

  describe('useDeleteBudget', () => {
    it('has meta.successMessage and calls api.budgets.deleteBudget', async () => {
      (api.budgets.deleteBudget as Mock).mockResolvedValue(undefined);

      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useDeleteBudget(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('budget1');
      });

      expect(api.budgets.deleteBudget).toHaveBeenCalledWith('budget1');
      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Budget deleted' });
    });

    it('invalidates budgets and category-budgets caches on success', async () => {
      (api.budgets.deleteBudget as Mock).mockResolvedValue(undefined);

      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useDeleteBudget(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('budget1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budgets'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['category-budgets'] });
    });
  });
});

/**
 * Budgets are the domain where "restore the captured record" does NOT work,
 * because the editable values are nested under `version` rather than sitting at
 * the top level. These pin the rebuild, since a patch built from the wrong
 * shape sends a body the server ignores — changing nothing while reporting
 * success, which is the quiet failure the whole feature exists to avoid.
 */
describe('undo', () => {
  const metaOf = (qc: QueryClient) =>
    qc.getMutationCache().getAll().at(-1)?.options.meta as
      | {
          undo?: (d: unknown, v: unknown, c: unknown) => Promise<unknown>;
          canUndo?: (d: unknown, v: unknown, c: unknown) => boolean;
        }
      | undefined;

  const wrapperFor = (qc: QueryClient) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: qc }, children);
    };

  const client = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  it('rebuilds the patch from the nested version, and omits effectiveMonth', async () => {
    // effectiveMonth is left out on purpose: the update replaces the CURRENT
    // month's version, so omitting it overwrites the version the edit just
    // wrote. Sending the old version's month would edit that older row instead
    // and leave the new one standing, so the amount would never revert.
    vi.mocked(api.budgets.updateBudget).mockResolvedValue({ id: 'b1' } as never);
    const qc = client();
    qc.setQueryData(
      ['budgets', 'plan-1'],
      [{ id: 'b1', doneForYear: false, version: { amount: 200, frequency: 'MONTHLY' } }],
    );
    const { result } = renderHook(() => useUpdateBudget(), { wrapper: wrapperFor(qc) });
    await act(async () => {
      result.current.mutate({ id: 'b1', body: { amount: 350 } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const context = {
      before: { id: 'b1', doneForYear: false, version: { amount: 200, frequency: 'MONTHLY' } },
    };
    await metaOf(qc)?.undo?.(null, { id: 'b1' }, context);

    expect(api.budgets.updateBudget).toHaveBeenLastCalledWith('b1', {
      amount: 200,
      frequency: 'MONTHLY',
      doneForYear: false,
    });
  });

  it('undoes a delete by restoring the same row', async () => {
    // The soft delete makes this a true inverse — id, history and every
    // reference survive, so nothing is approximated.
    vi.mocked(api.budgets.deleteBudget).mockResolvedValue(undefined as never);
    const qc = client();
    const { result } = renderHook(() => useDeleteBudget(), { wrapper: wrapperFor(qc) });
    await act(async () => {
      result.current.mutate('b1');
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await metaOf(qc)?.undo?.(null, 'b1', undefined);
    expect(api.budgets.restoreBudget).toHaveBeenCalledWith('b1');
  });

  it('offers no undo for the one-way plan steps', async () => {
    // Recorded as a decision: no plan delete exists, DRAFT→ACTIVE is one-way,
    // and carryForward returns no manifest of what it created.
    vi.mocked(api.budgets.confirmPlan).mockResolvedValue({ id: 'p1' } as never);
    const qc = client();
    const { result } = renderHook(() => useConfirmPlan(), { wrapper: wrapperFor(qc) });
    await act(async () => {
      result.current.mutate('p1');
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(metaOf(qc)?.undo).toBeUndefined();
  });
});
