import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { budgetLinksApi } from './budget-links.js';

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const CATEGORY_BUDGET_ID = 'cb_123';

const mockLink = {
  id: 'link_1',
  categoryBudgetId: CATEGORY_BUDGET_ID,
  expenseId: 'exp_1',
  expenseName: 'Netflix',
  expenseAmount: 15.99,
  expenseFrequency: 'MONTHLY',
  monthlyEquivalent: 15.99,
  isPaused: false,
  isArchived: false,
  createdAt: '2026-01-15T00:00:00.000Z',
};

describe('budgetLinksApi', () => {
  describe('list', () => {
    it('calls GET /api/v1/category-budgets/:id/links', async () => {
      (fetch as Mock).mockResolvedValue(new Response(JSON.stringify([mockLink]), { status: 200 }));

      const result = await budgetLinksApi.list(CATEGORY_BUDGET_ID);

      expect(fetch).toHaveBeenCalledWith(
        `/api/v1/category-budgets/${CATEGORY_BUDGET_ID}/links`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
      expect(result).toEqual([mockLink]);
    });
  });

  describe('link', () => {
    it('calls POST /api/v1/category-budgets/:id/links with expenseId', async () => {
      (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockLink), { status: 201 }));

      const result = await budgetLinksApi.link(CATEGORY_BUDGET_ID, 'exp_1');

      expect(fetch).toHaveBeenCalledWith(
        `/api/v1/category-budgets/${CATEGORY_BUDGET_ID}/links`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ expenseId: 'exp_1' }),
        }),
      );
      expect(result).toEqual(mockLink);
    });
  });

  describe('bulkLink', () => {
    it('calls POST /api/v1/category-budgets/:id/links/bulk with expenseIds', async () => {
      const bulkResult = { results: [mockLink] };
      (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(bulkResult), { status: 200 }));

      const result = await budgetLinksApi.bulkLink(CATEGORY_BUDGET_ID, ['exp_1', 'exp_2']);

      expect(fetch).toHaveBeenCalledWith(
        `/api/v1/category-budgets/${CATEGORY_BUDGET_ID}/links/bulk`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ expenseIds: ['exp_1', 'exp_2'] }),
        }),
      );
      expect(result).toEqual(bulkResult);
    });

    it('handles mixed success/error results', async () => {
      const mixedResult = {
        results: [mockLink, { expenseId: 'exp_2', error: 'Already linked' }],
      };
      (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mixedResult), { status: 200 }));

      const result = await budgetLinksApi.bulkLink(CATEGORY_BUDGET_ID, ['exp_1', 'exp_2']);

      expect(result).toEqual(mixedResult);
    });
  });

  describe('unlink', () => {
    it('calls DELETE /api/v1/category-budgets/:id/links/:linkId', async () => {
      (fetch as Mock).mockResolvedValue(new Response(null, { status: 204 }));

      await budgetLinksApi.unlink(CATEGORY_BUDGET_ID, 'link_1');

      expect(fetch).toHaveBeenCalledWith(
        `/api/v1/category-budgets/${CATEGORY_BUDGET_ID}/links/link_1`,
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });
});
