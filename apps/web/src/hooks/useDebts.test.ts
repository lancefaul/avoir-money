import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { createWrapper } from '../test/wrapper.js';

vi.mock('../lib/api.js', () => ({
  api: {
    debts: {
      list: vi.fn().mockResolvedValue([{ id: 'd1', name: 'Mortgage', balance: 250000 }]),
      summary: vi.fn().mockResolvedValue({ totalBalance: 300000, monthlyPayment: 2500 }),
      amortization: vi.fn().mockResolvedValue([{ month: 1, principal: 500, interest: 1200 }]),
      create: vi.fn().mockResolvedValue({ id: 'd2', name: 'Auto Loan' }),
      update: vi.fn().mockResolvedValue({ id: 'd1', name: 'Mortgage Updated' }),
      delete: vi.fn().mockResolvedValue(undefined),
      listEscrow: vi.fn().mockResolvedValue([{ id: 'e1', monthlyAmount: 350 }]),
      createEscrow: vi.fn().mockResolvedValue({ id: 'e2', monthlyAmount: 400 }),
    },
  },
}));

import { api } from '../lib/api.js';
import {
  useDebts,
  useDebtSummary,
  useDebtAmortization,
  useCreateDebt,
  useUpdateDebt,
  useDeleteDebt,
  useEscrowHistory,
  useCreateEscrowRecord,
} from './useDebts.js';

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

describe('useDebts hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useDebts query', () => {
    it('fetches debts with no params', async () => {
      const { result } = renderHook(() => useDebts(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.debts.list).toHaveBeenCalledWith(undefined);
      expect(result.current.data).toEqual([{ id: 'd1', name: 'Mortgage', balance: 250000 }]);
    });

    it('passes params to API and includes them in query key', async () => {
      const params = { type: 'MORTGAGE' } as Parameters<typeof api.debts.list>[0];
      const { result } = renderHook(() => useDebts(params), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.debts.list).toHaveBeenCalledWith(params);
    });
  });

  describe('useDebtSummary query', () => {
    it('uses ["debts", "summary"] as query key', async () => {
      const { result } = renderHook(() => useDebtSummary(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.debts.summary).toHaveBeenCalled();
      expect(result.current.data).toEqual({ totalBalance: 300000, monthlyPayment: 2500 });
    });
  });

  describe('useDebtAmortization query', () => {
    it('fetches amortization with id and extraPayment', async () => {
      const { result } = renderHook(() => useDebtAmortization('d1', 100), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.debts.amortization).toHaveBeenCalledWith('d1', 100);
    });

    it('defaults extraPayment to 0', async () => {
      const { result } = renderHook(() => useDebtAmortization('d1'), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.debts.amortization).toHaveBeenCalledWith('d1', 0);
    });

    it('is disabled when id is empty', () => {
      const { result } = renderHook(() => useDebtAmortization(''), { wrapper: createWrapper() });
      expect(result.current.fetchStatus).toBe('idle');
    });
  });

  describe('useCreateDebt', () => {
    it('calls api.debts.create', async () => {
      const { result } = renderHook(() => useCreateDebt(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate({ name: 'Auto Loan', balance: 25000 });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.debts.create).toHaveBeenCalledWith({ name: 'Auto Loan', balance: 25000 });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useCreateDebt(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ name: 'Test' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Debt created' });
    });

    it('invalidates debts cache on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useCreateDebt(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ name: 'Test' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['debts'] });
    });
  });

  describe('useUpdateDebt', () => {
    it('calls api.debts.update with id and body', async () => {
      const { result } = renderHook(() => useUpdateDebt(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate({ id: 'd1', body: { name: 'Updated' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.debts.update).toHaveBeenCalledWith('d1', { name: 'Updated' });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useUpdateDebt(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'd1', body: { name: 'Updated' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Debt updated' });
    });

    it('invalidates debts, transactions, and accounts caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useUpdateDebt(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'd1', body: { name: 'Updated' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['debts'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['accounts'] });
    });
  });

  describe('useDeleteDebt', () => {
    it('calls api.debts.delete with id', async () => {
      const { result } = renderHook(() => useDeleteDebt(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate('d1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.debts.delete).toHaveBeenCalledWith('d1');
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useDeleteDebt(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('d1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Debt deleted' });
    });

    it('invalidates debts, transactions, and accounts caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useDeleteDebt(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('d1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['debts'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['accounts'] });
    });
  });

  describe('useEscrowHistory query', () => {
    it('fetches escrow records for a debt', async () => {
      const { result } = renderHook(() => useEscrowHistory('d1'), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.debts.listEscrow).toHaveBeenCalledWith('d1');
      expect(result.current.data).toEqual([{ id: 'e1', monthlyAmount: 350 }]);
    });

    it('is disabled when debtId is undefined', () => {
      const { result } = renderHook(() => useEscrowHistory(undefined), {
        wrapper: createWrapper(),
      });
      expect(result.current.fetchStatus).toBe('idle');
    });
  });

  describe('useCreateEscrowRecord', () => {
    it('calls api.debts.createEscrow with debtId and body', async () => {
      const body = {
        monthlyAmount: 400,
        periodStartDate: '2026-01-01',
        periodEndDate: '2026-12-31',
      };
      const { result } = renderHook(() => useCreateEscrowRecord(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate({ debtId: 'd1', body });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.debts.createEscrow).toHaveBeenCalledWith('d1', body);
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useCreateEscrowRecord(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({
          debtId: 'd1',
          body: { monthlyAmount: 400, periodStartDate: '2026-01-01', periodEndDate: '2026-12-31' },
        });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Escrow record created' });
    });

    it('invalidates escrow and debts caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useCreateEscrowRecord(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({
          debtId: 'd1',
          body: { monthlyAmount: 400, periodStartDate: '2026-01-01', periodEndDate: '2026-12-31' },
        });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['escrow'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['debts'] });
    });
  });
});
