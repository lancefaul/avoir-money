import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from './api.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(data: unknown, status = 200) {
  return { ok: status < 400, status, json: () => Promise.resolve(data), statusText: 'OK' };
}

// ─── Schema-compliant mock fixtures ───
const now = new Date().toISOString();

const mockIncome = {
  id: '1',
  name: 'Test',
  amount: 100,
  frequency: 'MONTHLY',
  budgetId: 'cat1',
  accountId: null,
  amountSchedule: null,
  startDate: null,
  endDate: null,
  pausedUntil: null,
  archivedAt: null,
  note: null,
  managementUrl: null,
  createdAt: now,
  updatedAt: now,
};

const mockCurrentPeriod = {
  payPeriod: {
    id: 'pp1',
    scheduleId: 's1',
    startDate: now,
    endDate: now,
    payDate: now,
    year: 2025,
    periodNum: 1,
  },
  schedule: {
    id: 's1',
    name: 'Primary',
    type: 'BIWEEKLY',
    anchorDate: now,
    firstPayDay: null,
    secondPayDay: null,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  },
  totalIncome: 0,
  totalExpenses: 0,
  netIncome: 0,
  incomeItems: [],
  expenseItems: [],
  balances: [],
  cashFlowSummary: {
    cashExpenses: 0,
    creditExpenses: 0,
    previousPeriodCreditExpenses: 0,
    cashNeeded: 0,
    creditCardPayments: 0,
  },
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe('api client', () => {
  describe('income', () => {
    it('list calls GET /income', async () => {
      mockFetch.mockResolvedValue(mockResponse([]));
      await api.income.list();
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/income',
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it('create calls POST /income', async () => {
      mockFetch.mockResolvedValue(mockResponse(mockIncome));
      await api.income.create({ name: 'Test', amount: 100 });
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe('/api/v1/income');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ name: 'Test', amount: 100 });
    });

    it('update calls PUT /income/:id', async () => {
      mockFetch.mockResolvedValue(mockResponse(mockIncome));
      await api.income.update('abc', { name: 'Updated' });
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe('/api/v1/income/abc');
      expect(init.method).toBe('PUT');
    });

    it('delete calls DELETE /income/:id', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.resolve(undefined),
        statusText: 'No Content',
      });
      await api.income.delete('abc');
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe('/api/v1/income/abc');
      expect(init.method).toBe('DELETE');
    });
  });

  describe('expenses', () => {
    it('list with filters', async () => {
      mockFetch.mockResolvedValue(mockResponse([]));
      await api.expenses.list({ accountId: 'x', frequency: 'MONTHLY' });
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain('accountId=x');
      expect(url).toContain('frequency=MONTHLY');
    });
  });

  describe('budgetItems', () => {
    it('groups calls GET /budgets/groups', async () => {
      mockFetch.mockResolvedValue(mockResponse([]));
      await api.budgetItems.groups();
      expect(mockFetch.mock.calls[0]![0]).toBe('/api/v1/budgets/groups');
    });

    it('reassign calls POST /budgets/:id/reassign', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ reassigned: 1, budgetsDeleted: 0, deleted: true }),
      );
      await api.budgetItems.reassign('a', 'b');
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe('/api/v1/budgets/a/reassign');
      expect(JSON.parse(init.body)).toEqual({ targetBudgetId: 'b' });
    });
  });

  describe('dashboard', () => {
    it('currentPeriod calls correct URL', async () => {
      mockFetch.mockResolvedValue(mockResponse(mockCurrentPeriod));
      await api.dashboard.currentPeriod();
      expect(mockFetch.mock.calls[0]![0]).toBe('/api/v1/dashboard/current-period');
    });

    it('currentPeriod with scheduleId', async () => {
      mockFetch.mockResolvedValue(mockResponse(mockCurrentPeriod));
      await api.dashboard.currentPeriod('xyz');
      expect(mockFetch.mock.calls[0]![0]).toBe('/api/v1/dashboard/current-period?scheduleId=xyz');
    });
  });

  describe('error handling', () => {
    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Not found' }),
        statusText: 'Not Found',
      });
      await expect(api.income.get('bad')).rejects.toThrow('Not found');
    });
  });
});
