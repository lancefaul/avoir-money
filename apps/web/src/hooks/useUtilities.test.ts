import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';

vi.mock('../lib/api.js', () => ({
  api: {
    utilities: {
      listProviders: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Electric Co' }]),
      createProvider: vi.fn().mockResolvedValue({ id: 'p2', name: 'Gas Co' }),
      updateProvider: vi.fn().mockResolvedValue({ id: 'p1', name: 'Updated' }),
      deleteProvider: vi.fn().mockResolvedValue(undefined),
      listServices: vi.fn().mockResolvedValue([{ id: 's1', serviceType: 'ELECTRIC' }]),
      createService: vi.fn().mockResolvedValue({ id: 's2', serviceType: 'GAS' }),
      updateService: vi.fn().mockResolvedValue({ id: 's1', metering: 'FLAT' }),
      deleteService: vi.fn().mockResolvedValue(undefined),
      linkService: vi.fn().mockResolvedValue(undefined),
      unlinkService: vi.fn().mockResolvedValue(undefined),
      listReadings: vi.fn().mockResolvedValue([{ id: 'r1', amount: 120 }]),
      createReading: vi.fn().mockResolvedValue({ id: 'r2', amount: 95 }),
      updateReading: vi.fn().mockResolvedValue({ id: 'r1', amount: 130 }),
      deleteReading: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

import { api } from '../lib/api.js';
import {
  useProviders,
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
  useServices,
  useCreateService,
  useUpdateService,
  useDeleteService,
  useLinkService,
  useUnlinkService,
  useUtilities,
  useCreateUtility,
  useUpdateUtility,
  useDeleteUtility,
} from './useUtilities.js';

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

describe('useUtilities hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Query hooks ─────────────────────────────────────────────────────────

  describe('useProviders', () => {
    it('uses query key ["utility-providers"] and calls api.utilities.listProviders', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useProviders(), { wrapper: createWrapperWithClient(qc) });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.listProviders).toHaveBeenCalled();
      expect(result.current.data).toEqual([{ id: 'p1', name: 'Electric Co' }]);
    });
  });

  describe('useServices', () => {
    it('uses query key ["utility-services", providerId] and calls api.utilities.listServices', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useServices('p1'), {
        wrapper: createWrapperWithClient(qc),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.listServices).toHaveBeenCalledWith('p1');
      expect(result.current.data).toEqual([{ id: 's1', serviceType: 'ELECTRIC' }]);
    });

    it('is disabled when providerId is undefined', () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useServices(undefined), {
        wrapper: createWrapperWithClient(qc),
      });
      expect(result.current.fetchStatus).toBe('idle');
    });
  });

  describe('useUtilities', () => {
    it('uses query key ["utilities", params] and calls api.utilities.listReadings', async () => {
      const params = { serviceId: 's1' };
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useUtilities(params), {
        wrapper: createWrapperWithClient(qc),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.listReadings).toHaveBeenCalledWith(params);
      expect(result.current.data).toEqual([{ id: 'r1', amount: 120 }]);
    });

    it('passes undefined params when none provided', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useUtilities(), { wrapper: createWrapperWithClient(qc) });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.listReadings).toHaveBeenCalledWith(undefined);
    });
  });

  // ─── Provider mutations ──────────────────────────────────────────────────

  describe('useCreateProvider', () => {
    it('calls api.utilities.createProvider with body', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useCreateProvider(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ name: 'Gas Co' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.createProvider).toHaveBeenCalledWith({ name: 'Gas Co' });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useCreateProvider(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ name: 'Gas Co' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Provider created' });
    });

    it('invalidates utility-providers cache on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useCreateProvider(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ name: 'Gas Co' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utility-providers'] });
    });
  });

  describe('useUpdateProvider', () => {
    it('calls api.utilities.updateProvider with id and body', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useUpdateProvider(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'p1', body: { name: 'Updated' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.updateProvider).toHaveBeenCalledWith('p1', { name: 'Updated' });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useUpdateProvider(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'p1', body: { name: 'Updated' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Provider updated' });
    });

    it('invalidates utility-providers cache on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useUpdateProvider(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'p1', body: { name: 'Updated' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utility-providers'] });
    });
  });

  describe('useDeleteProvider', () => {
    it('calls api.utilities.deleteProvider with id', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useDeleteProvider(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('p1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.deleteProvider).toHaveBeenCalledWith('p1');
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useDeleteProvider(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('p1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Provider deleted' });
    });

    it('invalidates provider, service, and reading caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useDeleteProvider(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('p1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utility-providers'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utility-services'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utilities'] });
    });
  });

  // ─── Service mutations ───────────────────────────────────────────────────

  describe('useCreateService', () => {
    it('calls api.utilities.createService with providerId and body', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useCreateService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({
          providerId: 'p1',
          body: { serviceType: 'GAS', metering: 'METERED' },
        });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.createService).toHaveBeenCalledWith('p1', {
        serviceType: 'GAS',
        metering: 'METERED',
      });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useCreateService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({
          providerId: 'p1',
          body: { serviceType: 'GAS', metering: 'METERED' },
        });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Service created' });
    });

    it('invalidates service and reading caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useCreateService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({
          providerId: 'p1',
          body: { serviceType: 'GAS', metering: 'METERED' },
        });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utility-services'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utilities'] });
    });
  });

  describe('useUpdateService', () => {
    it('calls api.utilities.updateService with id and body', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useUpdateService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 's1', body: { metering: 'FLAT' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.updateService).toHaveBeenCalledWith('s1', { metering: 'FLAT' });
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useUpdateService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 's1', body: { metering: 'FLAT' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Service updated' });
    });

    it('invalidates service and reading caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useUpdateService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 's1', body: { metering: 'FLAT' } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utility-services'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utilities'] });
    });
  });

  describe('useDeleteService', () => {
    it('calls api.utilities.deleteService with id', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useDeleteService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('s1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.deleteService).toHaveBeenCalledWith('s1');
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useDeleteService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('s1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Service deleted' });
    });

    it('invalidates service and reading caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => useDeleteService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('s1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utility-services'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utilities'] });
    });
  });

  // ─── Link/Unlink mutations ───────────────────────────────────────────────

  describe('useLinkService', () => {
    it('calls api.utilities.linkService with id and expenseId', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useLinkService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 's1', expenseId: 'exp1' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.linkService).toHaveBeenCalledWith('s1', 'exp1');
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useLinkService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 's1', expenseId: 'exp1' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({
        successMessage: 'Service linked to expense',
      });
    });

    it('invalidates link-related caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const removeSpy = vi.spyOn(qc, 'removeQueries');
      const { result } = renderHook(() => useLinkService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 's1', expenseId: 'exp1' });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utility-services'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scheduled-transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
      expect(removeSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    });
  });

  describe('useUnlinkService', () => {
    it('calls api.utilities.unlinkService with id', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useUnlinkService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('s1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.unlinkService).toHaveBeenCalledWith('s1');
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useUnlinkService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('s1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({
        successMessage: 'Service unlinked from expense',
      });
    });

    it('invalidates link-related caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const removeSpy = vi.spyOn(qc, 'removeQueries');
      const { result } = renderHook(() => useUnlinkService(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('s1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utility-services'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scheduled-transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
      expect(removeSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    });
  });

  // ─── Reading mutations ───────────────────────────────────────────────────

  describe('useCreateUtility', () => {
    it('calls api.utilities.createReading with body', async () => {
      const qc = createTestQueryClient();
      const body = { serviceId: 's1', amount: 95, date: '2026-06-01' };
      const { result } = renderHook(() => useCreateUtility(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate(body);
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.createReading).toHaveBeenCalledWith(body);
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useCreateUtility(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ amount: 50 });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Reading created' });
    });

    it('invalidates reading-related caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const removeSpy = vi.spyOn(qc, 'removeQueries');
      const { result } = renderHook(() => useCreateUtility(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ amount: 50 });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utilities'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scheduled-transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
      expect(removeSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    });
  });

  describe('useUpdateUtility', () => {
    it('calls api.utilities.updateReading with id and body', async () => {
      const qc = createTestQueryClient();
      const body = { amount: 130 };
      const { result } = renderHook(() => useUpdateUtility(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'r1', body });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.updateReading).toHaveBeenCalledWith('r1', body);
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useUpdateUtility(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'r1', body: { amount: 130 } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Reading updated' });
    });

    it('invalidates reading-related caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const removeSpy = vi.spyOn(qc, 'removeQueries');
      const { result } = renderHook(() => useUpdateUtility(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate({ id: 'r1', body: { amount: 130 } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utilities'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scheduled-transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
      expect(removeSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    });
  });

  describe('useDeleteUtility', () => {
    it('calls api.utilities.deleteReading with id', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useDeleteUtility(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('r1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockedApi.utilities.deleteReading).toHaveBeenCalledWith('r1');
    });

    it('has successMessage in meta', async () => {
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useDeleteUtility(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('r1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const mutations = qc.getMutationCache().getAll();
      expect(mutations[0]?.options.meta).toMatchObject({ successMessage: 'Reading deleted' });
    });

    it('invalidates reading-related caches on success', async () => {
      const qc = createTestQueryClient();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const removeSpy = vi.spyOn(qc, 'removeQueries');
      const { result } = renderHook(() => useDeleteUtility(), {
        wrapper: createWrapperWithClient(qc),
      });
      await act(async () => {
        result.current.mutate('r1');
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['utilities'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scheduled-transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
      expect(removeSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    });
  });
});
