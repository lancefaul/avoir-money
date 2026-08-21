import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { incomeApi } from './income.js';

const INCOME_FIXTURE = {
  id: 'clx1234567890',
  name: 'Salary',
  amount: 5000,
  frequency: 'MONTHLY',
  budgetId: 'clxbudget001',
  accountId: 'clxaccount001',
  amountSchedule: null,
  startDate: '2024-01-01T00:00:00.000Z',
  endDate: null,
  pausedUntil: null,
  archivedAt: null,
  note: null,
  managementUrl: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function mockFetchResponse(body: unknown, status = 200) {
  (globalThis.fetch as Mock).mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('incomeApi', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('list', () => {
    it('calls GET /api/v1/income with no params', async () => {
      mockFetchResponse([INCOME_FIXTURE]);
      await incomeApi.list();
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/income',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: expect.any(String) }),
        }),
      );
      // No explicit method means GET (fetch default)
      const callInit = (fetch as Mock).mock.calls[0]![1];
      expect(callInit.method).toBeUndefined();
    });

    it('appends query params when provided', async () => {
      mockFetchResponse([INCOME_FIXTURE]);
      await incomeApi.list({
        frequency: 'MONTHLY',
        budgetId: 'b1',
        limit: 50,
        offset: 10,
        archived: 'true',
      });
      const url = (fetch as Mock).mock.calls[0]![0] as string;
      expect(url).toContain('/api/v1/income?');
      expect(url).toContain('frequency=MONTHLY');
      expect(url).toContain('budgetId=b1');
      expect(url).toContain('limit=50');
      expect(url).toContain('offset=10');
      expect(url).toContain('archived=true');
    });

    it('returns parsed income array', async () => {
      mockFetchResponse([INCOME_FIXTURE]);
      const result = await incomeApi.list();
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('clx1234567890');
    });
  });

  describe('create', () => {
    it('calls POST /api/v1/income with body', async () => {
      mockFetchResponse(INCOME_FIXTURE);
      const body = { name: 'Salary', amount: 5000, frequency: 'MONTHLY', budgetId: 'clxbudget001' };
      await incomeApi.create(body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/income',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
    });

    it('returns parsed income response', async () => {
      mockFetchResponse(INCOME_FIXTURE);
      const result = await incomeApi.create({
        name: 'Salary',
        amount: 5000,
        frequency: 'MONTHLY',
        budgetId: 'clxbudget001',
      });
      expect(result.id).toBe('clx1234567890');
      expect(result.name).toBe('Salary');
    });
  });

  describe('update', () => {
    it('calls PUT /api/v1/income/:id with body', async () => {
      mockFetchResponse(INCOME_FIXTURE);
      const body = { name: 'Updated Salary' };
      await incomeApi.update('clx1234567890', body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/income/clx1234567890',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(body),
        }),
      );
    });

    it('returns parsed income response', async () => {
      mockFetchResponse({ ...INCOME_FIXTURE, name: 'Updated Salary' });
      const result = await incomeApi.update('clx1234567890', { name: 'Updated Salary' });
      expect(result.name).toBe('Updated Salary');
    });
  });

  describe('delete', () => {
    it('calls DELETE /api/v1/income/:id', async () => {
      mockFetchResponse(null);
      await incomeApi.delete('clx1234567890');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/income/clx1234567890',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('archive', () => {
    it('calls POST /api/v1/income/:id/archive', async () => {
      mockFetchResponse({ ...INCOME_FIXTURE, archivedAt: '2024-06-01T00:00:00.000Z' });
      await incomeApi.archive('clx1234567890');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/income/clx1234567890/archive',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({}),
        }),
      );
    });

    it('returns income with archivedAt set', async () => {
      mockFetchResponse({ ...INCOME_FIXTURE, archivedAt: '2024-06-01T00:00:00.000Z' });
      const result = await incomeApi.archive('clx1234567890');
      expect(result.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe('restore', () => {
    it('calls POST /api/v1/income/:id/restore', async () => {
      mockFetchResponse(INCOME_FIXTURE);
      await incomeApi.restore('clx1234567890');
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/income/clx1234567890/restore',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({}),
        }),
      );
    });

    it('returns income with archivedAt null', async () => {
      mockFetchResponse(INCOME_FIXTURE);
      const result = await incomeApi.restore('clx1234567890');
      expect(result.archivedAt).toBeNull();
    });
  });

  describe('pause', () => {
    it('calls POST /api/v1/income/:id/pause with duration body', async () => {
      const pausedIncome = { ...INCOME_FIXTURE, pausedUntil: '2024-07-01T00:00:00.000Z' };
      mockFetchResponse(pausedIncome);
      const body = { duration: 30, unit: 'days', indefinite: false };
      await incomeApi.pause('clx1234567890', body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/income/clx1234567890/pause',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
    });

    it('calls POST with indefinite pause', async () => {
      const pausedIncome = { ...INCOME_FIXTURE, pausedUntil: '9999-12-31T00:00:00.000Z' };
      mockFetchResponse(pausedIncome);
      const body = { indefinite: true };
      await incomeApi.pause('clx1234567890', body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/income/clx1234567890/pause',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
    });
  });

  describe('resume', () => {
    it('calls POST /api/v1/income/:id/resume with immediately flag', async () => {
      mockFetchResponse(INCOME_FIXTURE);
      const body = { immediately: true };
      await incomeApi.resume('clx1234567890', body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/income/clx1234567890/resume',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
    });

    it('calls POST with resumeDate', async () => {
      mockFetchResponse(INCOME_FIXTURE);
      const body = { resumeDate: '2024-08-01' };
      await incomeApi.resume('clx1234567890', body);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/income/clx1234567890/resume',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
    });

    it('returns income with pausedUntil null', async () => {
      mockFetchResponse(INCOME_FIXTURE);
      const result = await incomeApi.resume('clx1234567890', { immediately: true });
      expect(result.pausedUntil).toBeNull();
    });
  });
});
