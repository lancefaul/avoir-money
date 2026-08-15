import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { createWrapper } from '../test/wrapper.js';

vi.mock('../lib/api.js', () => ({
  api: {
    healthcare: {
      years: vi.fn().mockResolvedValue([2025, 2026]),
      policies: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Aetna' }]),
      transactions: vi.fn().mockResolvedValue([{ id: 't1', amount: 100 }]),
      createPolicy: vi.fn().mockResolvedValue({ id: 'p2', name: 'Blue Cross' }),
      updatePolicy: vi.fn().mockResolvedValue({ id: 'p1', name: 'Aetna Updated' }),
      updateOverrides: vi.fn().mockResolvedValue({ id: 'p1', name: 'Aetna' }),
    },
  },
}));

import { api } from '../lib/api.js';
import {
  usePolicyYears,
  usePolicies,
  usePolicyTransactions,
  useCreatePolicy,
  useUpdatePolicy,
  useUpdateOverrides,
} from './useHealthcare.js';

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

describe('useHealthcare hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('usePolicyYears', () => {
    it('fetches years with correct query key', async () => {
      const { result } = renderHook(() => usePolicyYears(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.healthcare.years).toHaveBeenCalled();
      expect(result.current.data).toEqual([2025, 2026]);
    });
  });

  describe('usePolicies', () => {
    it('fetches policies for a given year', async () => {
      const { result } = renderHook(() => usePolicies(2026), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.healthcare.policies).toHaveBeenCalledWith(2026);
      expect(result.current.data).toEqual([{ id: 'p1', name: 'Aetna' }]);
    });

    it('is disabled when year is undefined', () => {
      const { result } = renderHook(() => usePolicies(undefined), { wrapper: createWrapper() });
      expect(result.current.fetchStatus).toBe('idle');
    });
  });

  describe('usePolicyTransactions', () => {
    it('fetches transactions for a given policy', async () => {
      const { result } = renderHook(() => usePolicyTransactions('p1'), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.healthcare.transactions).toHaveBeenCalledWith('p1');
      expect(result.current.data).toEqual([{ id: 't1', amount: 100 }]);
    });

    it('is disabled when policyId is undefined', () => {
      const { result } = renderHook(() => usePolicyTransactions(undefined), {
        wrapper: createWrapper(),
      });
      expect(result.current.fetchStatus).toBe('idle');
    });
  });

  describe('useCreatePolicy', () => {
    it('calls api.healthcare.createPolicy', async () => {
      const { result } = renderHook(() => useCreatePolicy(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate({ name: 'New Policy', deductible: 5000 });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.healthcare.createPolicy).toHaveBeenCalledWith({
        name: 'New Policy',
        deductible: 5000,
      });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useCreatePolicy(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ name: 'Test' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Policy created' });
    });

    it('invalidates healthcare caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useCreatePolicy(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ name: 'Test' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['healthcare-policies'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['healthcare-years'] });
    });
  });

  describe('useUpdatePolicy', () => {
    it('calls api.healthcare.updatePolicy with id and body', async () => {
      const { result } = renderHook(() => useUpdatePolicy(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate({ id: 'p1', body: { name: 'Updated' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.healthcare.updatePolicy).toHaveBeenCalledWith('p1', { name: 'Updated' });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useUpdatePolicy(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'p1', body: { name: 'Updated' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Policy updated' });
    });

    it('invalidates healthcare and dashboard caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useUpdatePolicy(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'p1', body: { name: 'Updated' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['healthcare-policies'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['healthcare-years'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    });
  });

  describe('useUpdateOverrides', () => {
    it('calls api.healthcare.updateOverrides with id and body', async () => {
      const { result } = renderHook(() => useUpdateOverrides(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate({ id: 'p1', body: { copay: 30 } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.healthcare.updateOverrides).toHaveBeenCalledWith('p1', { copay: 30 });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useUpdateOverrides(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'p1', body: { copay: 30 } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Override updated' });
    });

    it('invalidates healthcare, dashboard, and category-budgets caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useUpdateOverrides(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'p1', body: { copay: 30 } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['healthcare-policies'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['category-budgets'] });
    });
  });
});
