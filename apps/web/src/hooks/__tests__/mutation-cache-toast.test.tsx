import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  MutationCache,
  useMutation,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useToastStore } from '../../store/toast.js';

/**
 * Integration test: MutationCache → toast flow
 *
 * Replicates the same MutationCache setup from App.tsx and verifies that
 * mutation errors produce error toasts and mutation successes with
 * meta.successMessage produce success toasts.
 *
 * Requirements: 3.1, 3.2, 3.3
 */

function createTestClient() {
  const mutationCache = new MutationCache({
    onError: (error: Error) => {
      useToastStore.getState().addToast('error', error.message);
    },
    onSuccess: (_data, _variables, _context, mutation) => {
      const meta = mutation.options.meta as { successMessage?: string } | undefined;
      if (meta?.successMessage) {
        useToastStore.getState().addToast('success', meta.successMessage);
      }
    },
  });

  return new QueryClient({
    mutationCache,
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('MutationCache → toast integration', () => {
  beforeEach(() => {
    // Reset toast store between tests
    useToastStore.setState({ toasts: [] });
  });

  it('shows an error toast when a mutation fails', async () => {
    const queryClient = createTestClient();
    const wrapper = createWrapper(queryClient);

    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: async () => {
            throw new Error('Server error: something went wrong');
          },
        }),
      { wrapper },
    );

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.severity).toBe('error');
    expect(toasts[0]!.title).toBe('Server error: something went wrong');
  });

  it('shows a success toast when a mutation succeeds with meta.successMessage', async () => {
    const queryClient = createTestClient();
    const wrapper = createWrapper(queryClient);

    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: async () => ({ id: '1' }),
          meta: { successMessage: 'Expense created' },
        }),
      { wrapper },
    );

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.severity).toBe('success');
    expect(toasts[0]!.title).toBe('Expense created');
  });

  it('does not show a success toast when mutation succeeds without meta', async () => {
    const queryClient = createTestClient();
    const wrapper = createWrapper(queryClient);

    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: async () => ({ id: '1' }),
        }),
      { wrapper },
    );

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(0);
  });
});
