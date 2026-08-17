import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';

vi.mock('../lib/api.js', () => ({
  api: {
    scheduledTransactions: {
      markAsPaid: vi.fn().mockResolvedValue({ id: 'tx1', amount: 100 }),
      snooze: vi.fn().mockResolvedValue({ id: 'st1', snoozedUntil: '2026-06-10' }),
    },
  },
}));

import { api } from '../lib/api.js';
import { ApiError } from '../lib/api/request.js';
import { useMarkAsPaid, useSnooze } from './useScheduledTransactions.js';

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

describe('useScheduledTransactions hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useMarkAsPaid', () => {
    it('calls api.scheduledTransactions.markAsPaid with id and body', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useMarkAsPaid(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({
          id: 'st1',
          body: { amount: 50, date: '2026-06-01', accountId: 'acc1' },
        });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.scheduledTransactions.markAsPaid).toHaveBeenCalledWith('st1', {
        amount: 50,
        date: '2026-06-01',
        accountId: 'acc1',
      });
    });

    it('calls markAsPaid with undefined body when not provided', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useMarkAsPaid(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'st2' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.scheduledTransactions.markAsPaid).toHaveBeenCalledWith('st2', undefined);
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useMarkAsPaid(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'st1' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toEqual({
        successMessage: 'Marked as paid',
        notFoundMessage: 'That item was refreshed. Please try again.',
      });
    });

    it('invalidates schedule-related caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const refetchSpy = vi.spyOn(qc, 'refetchQueries');
      const { result } = renderHook(() => useMarkAsPaid(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'st1' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['accounts'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scheduled-transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['income-trend'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pay-periods'] });
      expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
    });

    it('self-heals by refetching the schedule when the row is gone (404)', async () => {
      vi.mocked(api.scheduledTransactions.markAsPaid).mockRejectedValueOnce(
        new ApiError('Scheduled transaction not found', 'POST …/pay → 404', 404),
      );
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useMarkAsPaid(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'stale-id' });
      });
      await waitFor(() => expect(result.current.isError).toBe(true));
      // Stale row cleared so the user can retry against fresh data
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scheduled-transactions'] });
    });
  });

  describe('useSnooze', () => {
    it('calls api.scheduledTransactions.snooze with id and days', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useSnooze(), { wrapper: createWrapperWithClient(qc) });
      await act(async () => {
        result.current.mutate({ id: 'st1', days: 7 });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.scheduledTransactions.snooze).toHaveBeenCalledWith('st1', { days: 7 });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useSnooze(), { wrapper: createWrapperWithClient(qc) });
      await act(async () => {
        result.current.mutate({ id: 'st1', days: 3 });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toEqual({
        successMessage: 'Snoozed',
        notFoundMessage: 'That item was refreshed. Please try again.',
      });
    });

    it('invalidates schedule-related caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const refetchSpy = vi.spyOn(qc, 'refetchQueries');
      const { result } = renderHook(() => useSnooze(), { wrapper: createWrapperWithClient(qc) });
      await act(async () => {
        result.current.mutate({ id: 'st1', days: 5 });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['accounts'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scheduled-transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['income-trend'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pay-periods'] });
      expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
    });
  });
});
