import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { transactionsApi } from './transactions.js';

// ─── Helpers ───

function mockFetchResponse(body: unknown, status = 200) {
  (globalThis.fetch as Mock).mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function mockFetch204() {
  (globalThis.fetch as Mock).mockResolvedValueOnce(new Response(null, { status: 204 }));
}

/** Extract the URL from the first fetch call */
function calledUrl(): string {
  return (fetch as Mock).mock.calls[0]![0] as string;
}

/** Extract the options from the first fetch call */
function calledOpts(): RequestInit {
  return (fetch as Mock).mock.calls[0]![1] as RequestInit;
}

const TRANSACTION_FIXTURE = {
  id: 'tx_1',
  type: 'EXPENSE',
  name: 'Groceries',
  amount: 50,
  netAmount: 50,
  date: '2026-01-15T00:00:00.000Z',
  payPeriodId: null,
  expenseId: null,
  incomeId: null,
  accountId: 'acc_1',
  toAccountId: null,
  budgetId: null,
  note: null,
  tradeMetadata: null,
  bitcoinMetadata: null,
  costBasisAllocated: null,
  balanceBefore: null,
  balanceAfter: null,
  toBalanceBefore: null,
  toBalanceAfter: null,
  parentId: null,
  childCount: 0,
  createdAt: '2026-01-15T12:00:00.000Z',
};

const PAGINATED_RESPONSE = {
  transactions: [TRANSACTION_FIXTURE],
  totalCount: 1,
  totalSpent: 50,
  totalEarned: 0,
  nextCursor: null,
  hasMore: false,
};

const CHILD_FIXTURE = {
  id: 'child_1',
  parentId: 'tx_1',
  budgetId: 'budget_1',
  preTaxAmount: 40,
  taxAmount: 4,
  taxRate: 0.1,
  lineTotal: 44,
  note: null,
  createdAt: '2026-01-15T12:00:00.000Z',
};

const CHILDREN_RESPONSE = {
  children: [CHILD_FIXTURE],
  remainingAmount: 6,
  parentAmount: 50,
};

// ─── Tests ───

describe('transactionsApi', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── list ───

  describe('list', () => {
    it('calls GET /api/v1/transactions with no params', async () => {
      mockFetchResponse(PAGINATED_RESPONSE);
      await transactionsApi.list();
      expect(calledUrl()).toBe('/api/v1/transactions');
      expect(calledOpts().method).toBeUndefined();
    });

    it('serializes string params into query string', async () => {
      mockFetchResponse(PAGINATED_RESPONSE);
      await transactionsApi.list({ search: 'coffee', accountId: 'acc_1' });
      expect(calledUrl()).toContain('search=coffee');
      expect(calledUrl()).toContain('accountId=acc_1');
    });

    it('serializes number params (limit) as string', async () => {
      mockFetchResponse(PAGINATED_RESPONSE);
      await transactionsApi.list({ limit: 50 });
      expect(calledUrl()).toContain('limit=50');
    });

    it('serializes boolean params as string', async () => {
      mockFetchResponse(PAGINATED_RESPONSE);
      await transactionsApi.list({ linkedToRecurring: true, skipGenerate: false });
      expect(calledUrl()).toContain('linkedToRecurring=true');
      expect(calledUrl()).toContain('skipGenerate=false');
    });

    it('omits undefined values from query string', async () => {
      mockFetchResponse(PAGINATED_RESPONSE);
      await transactionsApi.list({ search: undefined, accountId: 'acc_1' });
      expect(calledUrl()).not.toContain('search');
      expect(calledUrl()).toContain('accountId=acc_1');
    });

    it('omits null values from query string', async () => {
      mockFetchResponse(PAGINATED_RESPONSE);
      await transactionsApi.list({ cursor: undefined, type: undefined, accountId: 'acc_2' });
      expect(calledUrl()).not.toContain('cursor');
      expect(calledUrl()).not.toContain('type');
      expect(calledUrl()).toContain('accountId=acc_2');
    });

    it('passes budgetIds as a string (pre-joined by caller)', async () => {
      mockFetchResponse(PAGINATED_RESPONSE);
      await transactionsApi.list({ budgetIds: 'b1,b2,b3' });
      expect(calledUrl()).toContain('budgetIds=b1%2Cb2%2Cb3');
    });

    it('includes cursor and sortOrder params', async () => {
      mockFetchResponse(PAGINATED_RESPONSE);
      await transactionsApi.list({ cursor: 'abc123', sortOrder: 'oldest' });
      expect(calledUrl()).toContain('cursor=abc123');
      expect(calledUrl()).toContain('sortOrder=oldest');
    });

    it('includes date range params', async () => {
      mockFetchResponse(PAGINATED_RESPONSE);
      await transactionsApi.list({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
      expect(calledUrl()).toContain('dateFrom=2026-01-01');
      expect(calledUrl()).toContain('dateTo=2026-01-31');
    });

    it('returns parsed paginated response', async () => {
      mockFetchResponse(PAGINATED_RESPONSE);
      const result = await transactionsApi.list();
      expect(result.transactions).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });
  });

  // ─── create ───

  describe('create', () => {
    it('calls POST /api/v1/transactions with JSON body', async () => {
      mockFetchResponse(TRANSACTION_FIXTURE);
      const body = { type: 'EXPENSE', name: 'Test', amount: 100, date: '2026-01-15' };
      await transactionsApi.create(body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/transactions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
    });

    it('returns parsed transaction response', async () => {
      mockFetchResponse(TRANSACTION_FIXTURE);
      const result = await transactionsApi.create({
        type: 'EXPENSE',
        name: 'Test',
        amount: 100,
        date: '2026-01-15',
      });
      expect(result.id).toBe('tx_1');
      expect(result.name).toBe('Groceries');
    });
  });

  // ─── update ───

  describe('update', () => {
    it('calls PUT /api/v1/transactions/:id with JSON body', async () => {
      mockFetchResponse(TRANSACTION_FIXTURE);
      const body = { name: 'Updated' };
      await transactionsApi.update('tx_1', body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/transactions/tx_1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(body),
        }),
      );
    });

    it('returns parsed transaction response', async () => {
      mockFetchResponse({ ...TRANSACTION_FIXTURE, name: 'Updated' });
      const result = await transactionsApi.update('tx_1', { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });
  });

  // ─── delete ───

  describe('delete', () => {
    it('calls DELETE /api/v1/transactions/:id', async () => {
      mockFetch204();
      await transactionsApi.delete('tx_1');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/transactions/tx_1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // ─── deleteImported ───

  describe('deleteImported', () => {
    it('calls DELETE /api/v1/transactions/imported?confirm=true', async () => {
      mockFetchResponse({ deleted: 5 });
      const result = await transactionsApi.deleteImported();
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/transactions/imported?confirm=true',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(result.deleted).toBe(5);
    });
  });

  // ─── link ───

  describe('link', () => {
    it('calls POST /api/v1/transactions/:id/link with expenseId', async () => {
      mockFetchResponse(TRANSACTION_FIXTURE);
      await transactionsApi.link('tx_1', { expenseId: 'exp_1' });
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/transactions/tx_1/link',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ expenseId: 'exp_1' }),
        }),
      );
    });

    it('calls POST /api/v1/transactions/:id/link with incomeId', async () => {
      mockFetchResponse(TRANSACTION_FIXTURE);
      await transactionsApi.link('tx_1', { incomeId: 'inc_1' });
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/transactions/tx_1/link',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ incomeId: 'inc_1' }),
        }),
      );
    });

    it('returns parsed transaction response', async () => {
      mockFetchResponse({ ...TRANSACTION_FIXTURE, expenseId: 'exp_1' });
      const result = await transactionsApi.link('tx_1', { expenseId: 'exp_1' });
      expect(result.expenseId).toBe('exp_1');
    });
  });

  // ─── unlink ───

  describe('unlink', () => {
    it('calls DELETE /api/v1/transactions/:id/link', async () => {
      mockFetch204();
      await transactionsApi.unlink('tx_1');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/transactions/tx_1/link',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // ─── listChildren ───

  describe('listChildren', () => {
    it('calls GET /api/v1/transactions/:parentId/children', async () => {
      mockFetchResponse(CHILDREN_RESPONSE);
      await transactionsApi.listChildren('tx_1');
      expect(calledUrl()).toBe('/api/v1/transactions/tx_1/children');
      expect(calledOpts().method).toBeUndefined();
    });

    it('returns parsed children response', async () => {
      mockFetchResponse(CHILDREN_RESPONSE);
      const result = await transactionsApi.listChildren('tx_1');
      expect(result.children).toHaveLength(1);
      expect(result.remainingAmount).toBe(6);
      expect(result.parentAmount).toBe(50);
    });
  });

  // ─── createChild ───

  describe('createChild', () => {
    it('calls POST /api/v1/transactions/:parentId/children', async () => {
      mockFetchResponse(CHILD_FIXTURE);
      const body = { budgetId: 'budget_1', preTaxAmount: 40, taxAmount: 4 };
      await transactionsApi.createChild('tx_1', body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/transactions/tx_1/children',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
    });
  });

  // ─── updateChild ───

  describe('updateChild', () => {
    it('calls PUT /api/v1/transactions/:parentId/children/:childId', async () => {
      mockFetchResponse(CHILD_FIXTURE);
      const body = { preTaxAmount: 45 };
      await transactionsApi.updateChild('tx_1', 'child_1', body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/transactions/tx_1/children/child_1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(body),
        }),
      );
    });
  });

  // ─── deleteChild ───

  describe('deleteChild', () => {
    it('calls DELETE /api/v1/transactions/:parentId/children/:childId', async () => {
      mockFetch204();
      await transactionsApi.deleteChild('tx_1', 'child_1');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/transactions/tx_1/children/child_1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // ─── suggestBudget ───

  describe('suggestBudget', () => {
    it('calls GET /api/v1/transactions/suggest-budget with encoded description', async () => {
      mockFetchResponse({ suggestions: [{ budgetId: 'b1', budgetName: 'Food', count: 5 }] });
      await transactionsApi.suggestBudget('Whole Foods');
      expect(calledUrl()).toBe('/api/v1/transactions/suggest-budget?description=Whole%20Foods');
      expect(calledOpts().method).toBeUndefined();
    });

    it('returns parsed suggestions response', async () => {
      mockFetchResponse({ suggestions: [{ budgetId: 'b1', budgetName: 'Food', count: 5 }] });
      const result = await transactionsApi.suggestBudget('Whole Foods');
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]!.budgetName).toBe('Food');
    });
  });
});
