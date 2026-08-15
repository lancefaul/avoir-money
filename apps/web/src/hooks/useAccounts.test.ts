import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createWrapper } from '../test/wrapper.js';

vi.mock('../lib/api.js', () => ({
  api: {
    accounts: {
      list: vi.fn().mockResolvedValue([
        { id: 'acc1', name: 'Checking', balance: 1500 },
        { id: 'acc2', name: 'Savings', balance: 10000 },
      ]),
    },
  },
}));

import { api } from '../lib/api.js';
import { useAccounts } from './useAccounts.js';

describe('useAccounts', () => {
  it('uses ["accounts"] as the query key', async () => {
    const { result } = renderHook(() => useAccounts(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.accounts.list).toHaveBeenCalled();
  });

  it('returns data from api.accounts.list()', async () => {
    const { result } = renderHook(() => useAccounts(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([
      { id: 'acc1', name: 'Checking', balance: 1500 },
      { id: 'acc2', name: 'Savings', balance: 10000 },
    ]);
  });

  it('exposes loading state before data resolves', () => {
    const { result } = renderHook(() => useAccounts(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('exposes error state when API call fails', async () => {
    vi.mocked(api.accounts.list).mockRejectedValueOnce(new Error('Network error'));
    const { result } = renderHook(() => useAccounts(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe('Network error');
  });
});
