import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createWrapper } from '../test/wrapper.js';

// Mock the api module
vi.mock('../lib/api.js', () => ({
  api: {
    dashboard: {
      currentPeriod: vi.fn().mockResolvedValue({ totalIncome: 5000 }),
      ytd: vi.fn().mockResolvedValue({ year: 2026, totalIncome: 60000 }),
      incomeTrend: vi.fn().mockResolvedValue([]),
      spendPrediction: vi.fn().mockResolvedValue({}),
    },
    income: {
      list: vi.fn().mockResolvedValue([{ id: '1', name: 'Paycheck' }]),
      create: vi.fn().mockResolvedValue({ id: '2' }),
      update: vi.fn().mockResolvedValue({ id: '1' }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    expenses: {
      list: vi.fn().mockResolvedValue([{ id: '1', name: 'Rent' }]),
      create: vi.fn().mockResolvedValue({ id: '2' }),
      update: vi.fn().mockResolvedValue({ id: '1' }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    budgetItems: {
      list: vi.fn().mockResolvedValue([]),
      groups: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: '1' }),
      createGroup: vi.fn().mockResolvedValue({ id: '1' }),
      update: vi.fn().mockResolvedValue({ id: '1' }),
      updateGroup: vi.fn().mockResolvedValue({ id: '1' }),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteGroup: vi.fn().mockResolvedValue(undefined),
      reassign: vi.fn().mockResolvedValue({ reassigned: 1 }),
    },
    accounts: { list: vi.fn().mockResolvedValue([]) },
    utilities: {
      listProviders: vi.fn().mockResolvedValue([]),
      createProvider: vi.fn().mockResolvedValue({ id: '1' }),
      updateProvider: vi.fn().mockResolvedValue({ id: '1' }),
      deleteProvider: vi.fn().mockResolvedValue(undefined),
      listServices: vi.fn().mockResolvedValue([]),
      createService: vi.fn().mockResolvedValue({ id: '1' }),
      updateService: vi.fn().mockResolvedValue({ id: '1' }),
      deleteService: vi.fn().mockResolvedValue(undefined),
      linkService: vi.fn().mockResolvedValue(undefined),
      unlinkService: vi.fn().mockResolvedValue(undefined),
      listReadings: vi.fn().mockResolvedValue([]),
      createReading: vi.fn().mockResolvedValue({ id: '1' }),
      updateReading: vi.fn().mockResolvedValue({ id: '1' }),
      deleteReading: vi.fn().mockResolvedValue(undefined),
    },
    healthcare: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: '1' }),
    },
    investments: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: '1' }),
      update: vi.fn().mockResolvedValue({ id: '1' }),
      snapshot: vi.fn().mockResolvedValue({}),
      prices: vi.fn().mockResolvedValue({}),
      custodians: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: '1' }),
        update: vi.fn().mockResolvedValue({ id: '1' }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      wallets: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: '1' }),
        update: vi.fn().mockResolvedValue({ id: '1' }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    },
    paySchedules: {
      list: vi.fn().mockResolvedValue([]),
      generate: vi.fn().mockResolvedValue({}),
    },
  },
}));

import {
  useCurrentPeriod,
  useYTD,
  useIncomeTrend,
  useIncome,
  useCreateIncome,
  useUpdateIncome,
  useDeleteIncome,
  useExpenses,
  useCreateExpense,
  useBudgetItems,
  useBudgetItemGroups,
  useReassignBudgetItem,
  useAccounts,
  useUtilities,
  useInvestments,
  useInvestmentPrices,
  useCustodians,
  useWallets,
  usePaySchedules,
} from './useApi.js';

describe('useApi hooks', () => {
  describe('Dashboard hooks', () => {
    it('useCurrentPeriod fetches current period', async () => {
      const { result } = renderHook(() => useCurrentPeriod(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual({ totalIncome: 5000 });
    });

    it('useYTD fetches year-to-date data', async () => {
      const { result } = renderHook(() => useYTD(2026), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual({ year: 2026, totalIncome: 60000 });
    });

    it('useIncomeTrend fetches trend data', async () => {
      const { result } = renderHook(() => useIncomeTrend(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
  });

  describe('Income hooks', () => {
    it('useIncome fetches income list', async () => {
      const { result } = renderHook(() => useIncome(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([{ id: '1', name: 'Paycheck' }]);
    });

    it('useCreateIncome returns a mutation', () => {
      const { result } = renderHook(() => useCreateIncome(), { wrapper: createWrapper() });
      expect(result.current.mutate).toBeDefined();
    });

    it('useUpdateIncome returns a mutation', () => {
      const { result } = renderHook(() => useUpdateIncome(), { wrapper: createWrapper() });
      expect(result.current.mutate).toBeDefined();
    });

    it('useDeleteIncome returns a mutation', () => {
      const { result } = renderHook(() => useDeleteIncome(), { wrapper: createWrapper() });
      expect(result.current.mutate).toBeDefined();
    });
  });

  describe('Expense hooks', () => {
    it('useExpenses fetches expense list', async () => {
      const { result } = renderHook(() => useExpenses(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([{ id: '1', name: 'Rent' }]);
    });

    it('useCreateExpense returns a mutation', () => {
      const { result } = renderHook(() => useCreateExpense(), { wrapper: createWrapper() });
      expect(result.current.mutate).toBeDefined();
    });
  });

  describe('Budget Item hooks', () => {
    it('useBudgetItems fetches budget items', async () => {
      const { result } = renderHook(() => useBudgetItems(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('useBudgetItemGroups fetches groups', async () => {
      const { result } = renderHook(() => useBudgetItemGroups(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('useReassignBudgetItem returns a mutation', () => {
      const { result } = renderHook(() => useReassignBudgetItem(), { wrapper: createWrapper() });
      expect(result.current.mutate).toBeDefined();
    });
  });

  describe('Other hooks', () => {
    it('useAccounts fetches accounts', async () => {
      const { result } = renderHook(() => useAccounts(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('useUtilities fetches utilities', async () => {
      const { result } = renderHook(() => useUtilities(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('useInvestments fetches investments', async () => {
      const { result } = renderHook(() => useInvestments(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('useInvestmentPrices fetches prices', async () => {
      const { result } = renderHook(() => useInvestmentPrices(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('useCustodians fetches custodians', async () => {
      const { result } = renderHook(() => useCustodians(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('useWallets fetches wallets', async () => {
      const { result } = renderHook(() => useWallets(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('usePaySchedules fetches pay schedules', async () => {
      const { result } = renderHook(() => usePaySchedules(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
  });
});
