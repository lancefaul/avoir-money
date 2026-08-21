import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createWrapper } from '../../test/wrapper.js';
import {
  invalidateTransactionCaches,
  TRANSACTION_QUERY_KEYS,
} from '../../lib/cache-invalidation.js';

// Mock the api module so hooks can be rendered without real network calls
vi.mock('../../lib/api.js', () => ({
  api: {
    transactions: {
      create: vi.fn().mockResolvedValue({ id: '1' }),
      update: vi.fn().mockResolvedValue({ id: '1' }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

import {
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
} from '../useTransactionMutations.js';

describe('invalidateTransactionCaches', () => {
  it('calls invalidateQueries for each key in TRANSACTION_QUERY_KEYS', () => {
    const mockQc = { invalidateQueries: vi.fn() };
    invalidateTransactionCaches(mockQc as any);

    expect(mockQc.invalidateQueries).toHaveBeenCalledTimes(TRANSACTION_QUERY_KEYS.length);

    for (const key of TRANSACTION_QUERY_KEYS) {
      expect(mockQc.invalidateQueries).toHaveBeenCalledWith({
        queryKey: [key],
      });
    }
  });

  it('covers all required keys: transactions, investments, investment-history, accounts, dashboard, debts', () => {
    const required = [
      'transactions',
      'investments',
      'investment-history',
      'accounts',
      'dashboard',
      'debts',
    ];
    for (const key of required) {
      expect(TRANSACTION_QUERY_KEYS).toContain(key);
    }
  });
});

describe('useTransactionMutations hooks', () => {
  it('useCreateTransaction returns a mutation with mutate', () => {
    const { result } = renderHook(() => useCreateTransaction(), {
      wrapper: createWrapper(),
    });
    expect(result.current.mutate).toBeDefined();
    expect(result.current.mutateAsync).toBeDefined();
  });

  it('useUpdateTransaction returns a mutation with mutate', () => {
    const { result } = renderHook(() => useUpdateTransaction(), {
      wrapper: createWrapper(),
    });
    expect(result.current.mutate).toBeDefined();
    expect(result.current.mutateAsync).toBeDefined();
  });

  it('useDeleteTransaction returns a mutation with mutate', () => {
    const { result } = renderHook(() => useDeleteTransaction(), {
      wrapper: createWrapper(),
    });
    expect(result.current.mutate).toBeDefined();
    expect(result.current.mutateAsync).toBeDefined();
  });
});
