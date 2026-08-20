import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { scheduledTransactionsApi } from './scheduled-transactions.js';

describe('scheduledTransactionsApi', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockResponse(body: unknown, status = 200) {
    (fetch as Mock).mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  const fakeScheduledTx = {
    id: 'st1',
    sourceType: 'EXPENSE',
    sourceId: 'exp1',
    dueDate: '2024-06-15T00:00:00.000Z',
    expectedAmount: 150,
    actualAmount: null,
    status: 'PENDING',
    transactionId: null,
    snoozedUntil: null,
    note: null,
    expenseId: 'exp1',
    incomeId: null,
    createdAt: '2024-06-01T00:00:00.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
  };

  const fakeTransaction = {
    id: 'tx1',
    type: 'EXPENSE',
    name: 'Rent',
    amount: 1500,
    netAmount: 1500,
    date: '2024-06-15T00:00:00.000Z',
    payPeriodId: null,
    expenseId: 'exp1',
    incomeId: null,
    accountId: 'acc1',
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
    createdAt: '2024-06-15T00:00:00.000Z',
  };

  describe('list', () => {
    it('calls GET /scheduled-transactions with required params', async () => {
      mockResponse([fakeScheduledTx]);
      await scheduledTransactionsApi.list({ periodStart: '2024-06-01', periodEnd: '2024-06-30' });
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/scheduled-transactions?periodStart=2024-06-01&periodEnd=2024-06-30',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Bearer /),
          }),
        }),
      );
    });

    it('includes optional sourceType param when provided', async () => {
      mockResponse([fakeScheduledTx]);
      await scheduledTransactionsApi.list({
        periodStart: '2024-06-01',
        periodEnd: '2024-06-30',
        sourceType: 'EXPENSE',
      });
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/scheduled-transactions?periodStart=2024-06-01&periodEnd=2024-06-30&sourceType=EXPENSE',
        expect.anything(),
      );
    });

    it('returns parsed array of scheduled transactions', async () => {
      mockResponse([fakeScheduledTx]);
      const result = await scheduledTransactionsApi.list({
        periodStart: '2024-06-01',
        periodEnd: '2024-06-30',
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('st1');
      expect(result[0]!.status).toBe('PENDING');
    });
  });

  describe('markAsPaid', () => {
    it('calls POST /scheduled-transactions/:id/pay with body', async () => {
      mockResponse(fakeTransaction);
      const body = { amount: 1500, date: '2024-06-15', accountId: 'acc1' };
      await scheduledTransactionsApi.markAsPaid('st1', body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/scheduled-transactions/st1/pay',
        expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
      );
    });

    it('sends empty object when no body provided', async () => {
      mockResponse(fakeTransaction);
      await scheduledTransactionsApi.markAsPaid('st1');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/scheduled-transactions/st1/pay',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({}) }),
      );
    });

    it('returns parsed transaction response', async () => {
      mockResponse(fakeTransaction);
      const result = await scheduledTransactionsApi.markAsPaid('st1', { amount: 1500 });
      expect(result.id).toBe('tx1');
      expect(result.netAmount).toBe(1500);
    });
  });

  describe('snooze', () => {
    it('calls POST /scheduled-transactions/:id/snooze with days', async () => {
      const snoozed = {
        ...fakeScheduledTx,
        status: 'SNOOZED',
        snoozedUntil: '2024-06-22T00:00:00.000Z',
      };
      mockResponse(snoozed);
      await scheduledTransactionsApi.snooze('st1', { days: 7 });
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/scheduled-transactions/st1/snooze',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ days: 7 }) }),
      );
    });

    it('returns parsed snoozed scheduled transaction', async () => {
      const snoozed = {
        ...fakeScheduledTx,
        status: 'SNOOZED',
        snoozedUntil: '2024-06-22T00:00:00.000Z',
      };
      mockResponse(snoozed);
      const result = await scheduledTransactionsApi.snooze('st1', { days: 7 });
      expect(result.status).toBe('SNOOZED');
      expect(result.snoozedUntil).toBeInstanceOf(Date);
    });
  });

  describe('skip', () => {
    it('calls POST /scheduled-transactions/:id/skip', async () => {
      const skipped = { ...fakeScheduledTx, status: 'SKIPPED' };
      mockResponse(skipped);
      await scheduledTransactionsApi.skip('st1');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/scheduled-transactions/st1/skip',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns parsed skipped scheduled transaction', async () => {
      const skipped = { ...fakeScheduledTx, status: 'SKIPPED' };
      mockResponse(skipped);
      const result = await scheduledTransactionsApi.skip('st1');
      expect(result.status).toBe('SKIPPED');
      expect(result.id).toBe('st1');
    });
  });
});
