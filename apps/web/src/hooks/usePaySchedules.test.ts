import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { createWrapper } from '../test/wrapper.js';

vi.mock('../lib/api.js', () => ({
  api: {
    paySchedules: {
      list: vi.fn().mockResolvedValue([{ id: 'ps1', frequency: 'BIWEEKLY' }]),
      create: vi.fn().mockResolvedValue({ id: 'ps2', frequency: 'MONTHLY' }),
      update: vi.fn().mockResolvedValue({ id: 'ps1', frequency: 'WEEKLY' }),
      generate: vi.fn().mockResolvedValue([{ id: 'pp1', startDate: '2026-01-01' }]),
    },
  },
}));

import { api } from '../lib/api.js';
import {
  usePaySchedules,
  useCreatePaySchedule,
  useUpdatePaySchedule,
  useGeneratePeriods,
} from './usePaySchedules.js';

const mockedApi = vi.mocked(api, { deep: true });

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

describe('usePaySchedules hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('usePaySchedules query', () => {
    it('uses ["pay-schedules"] as the query key and delegates to api.paySchedules.list', async () => {
      const { result } = renderHook(() => usePaySchedules(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.paySchedules.list).toHaveBeenCalled();
    });

    it('returns data from api.paySchedules.list()', async () => {
      const { result } = renderHook(() => usePaySchedules(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.data).toBeDefined());
      expect(result.current.data).toEqual([{ id: 'ps1', frequency: 'BIWEEKLY' }]);
    });

    it('exposes error state when API call fails', async () => {
      mockedApi.paySchedules.list.mockRejectedValueOnce(new Error('Network error'));
      const { result } = renderHook(() => usePaySchedules(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });

  describe('useCreatePaySchedule', () => {
    it('calls api.paySchedules.create with body', async () => {
      const { result } = renderHook(() => useCreatePaySchedule(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate({ frequency: 'MONTHLY', startDate: '2026-01-01' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.paySchedules.create).toHaveBeenCalledWith({
        frequency: 'MONTHLY',
        startDate: '2026-01-01',
      });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useCreatePaySchedule(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ frequency: 'MONTHLY' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Pay schedule created' });
    });

    it('invalidates pay-schedules, pay-periods, and dashboard caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useCreatePaySchedule(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ frequency: 'MONTHLY' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pay-schedules'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pay-periods'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    });
  });

  describe('useUpdatePaySchedule', () => {
    it('calls api.paySchedules.update with id and body', async () => {
      const { result } = renderHook(() => useUpdatePaySchedule(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate({ id: 'ps1', body: { frequency: 'WEEKLY' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.paySchedules.update).toHaveBeenCalledWith('ps1', { frequency: 'WEEKLY' });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useUpdatePaySchedule(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'ps1', body: { frequency: 'WEEKLY' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Pay schedule updated' });
    });

    it('invalidates pay-schedules, pay-periods, and dashboard caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useUpdatePaySchedule(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'ps1', body: { frequency: 'WEEKLY' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pay-schedules'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pay-periods'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    });
  });

  describe('useGeneratePeriods', () => {
    it('calls api.paySchedules.generate with id and body', async () => {
      const { result } = renderHook(() => useGeneratePeriods(), { wrapper: createWrapper() });
      await act(async () => {
        result.current.mutate({ id: 'ps1', body: { months: 3 } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.paySchedules.generate).toHaveBeenCalledWith('ps1', { months: 3 });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useGeneratePeriods(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'ps1', body: { months: 3 } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Pay periods generated' });
    });

    it('invalidates pay-periods and dashboard caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useGeneratePeriods(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'ps1', body: { months: 3 } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pay-periods'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    });
  });
});
