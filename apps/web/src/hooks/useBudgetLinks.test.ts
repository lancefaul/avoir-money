import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createWrapper } from '../test/wrapper.js';

vi.mock('../lib/api.js', () => ({
  api: {
    budgetLinks: {
      list: vi
        .fn()
        .mockResolvedValue([{ id: 'link1', expenseId: 'exp1', categoryBudgetId: 'cb1' }]),
      link: vi.fn().mockResolvedValue({ id: 'link2', expenseId: 'exp2', categoryBudgetId: 'cb1' }),
      bulkLink: vi.fn().mockResolvedValue({ results: [{ id: 'link3' }] }),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

import { api } from '../lib/api.js';
import {
  useBudgetLinks,
  useLinkExpense,
  useBulkLinkExpenses,
  useUnlinkExpense,
} from './useBudgetLinks.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useBudgetLinks', () => {
  describe('query hook', () => {
    it('fetches budget links with correct query key when categoryBudgetId is provided', async () => {
      const { result } = renderHook(() => useBudgetLinks('cb1'), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(api.budgetLinks.list).toHaveBeenCalledWith('cb1');
      expect(result.current.data).toEqual([
        { id: 'link1', expenseId: 'exp1', categoryBudgetId: 'cb1' },
      ]);
    });

    it('does not fetch when categoryBudgetId is undefined', () => {
      const { result } = renderHook(() => useBudgetLinks(undefined), { wrapper: createWrapper() });
      expect(result.current.fetchStatus).toBe('idle');
      expect(api.budgetLinks.list).not.toHaveBeenCalled();
    });
  });

  describe('useLinkExpense', () => {
    it('has successMessage meta', () => {
      const { result } = renderHook(() => useLinkExpense(), { wrapper: createWrapper() });
      expect(result.current.mutate).toBeDefined();
    });

    it('calls api.budgetLinks.link and invalidates caches on success', async () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useLinkExpense(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ categoryBudgetId: 'cb1', expenseId: 'exp2' });
      });

      expect(api.budgetLinks.link).toHaveBeenCalledWith('cb1', 'exp2');
    });
  });

  describe('useBulkLinkExpenses', () => {
    it('has successMessage meta', () => {
      const { result } = renderHook(() => useBulkLinkExpenses(), { wrapper: createWrapper() });
      expect(result.current.mutate).toBeDefined();
    });

    it('calls api.budgetLinks.bulkLink and invalidates caches on success', async () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useBulkLinkExpenses(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ categoryBudgetId: 'cb1', expenseIds: ['exp1', 'exp2'] });
      });

      expect(api.budgetLinks.bulkLink).toHaveBeenCalledWith('cb1', ['exp1', 'exp2']);
    });
  });

  describe('useUnlinkExpense', () => {
    it('has successMessage meta', () => {
      const { result } = renderHook(() => useUnlinkExpense(), { wrapper: createWrapper() });
      expect(result.current.mutate).toBeDefined();
    });

    it('calls api.budgetLinks.unlink and invalidates caches on success', async () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useUnlinkExpense(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ categoryBudgetId: 'cb1', linkId: 'link1' });
      });

      expect(api.budgetLinks.unlink).toHaveBeenCalledWith('cb1', 'link1');
    });
  });
});
