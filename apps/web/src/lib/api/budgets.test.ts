import { describe, it, expect, vi, beforeEach } from 'vitest';
import { budgetsApi } from './budgets.js';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

// ─── Fixtures ───

const yearPlan = {
  id: 'yp_1',
  year: 2026,
  status: 'ACTIVE' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const budgetVersion = {
  id: 'bv_1',
  amount: 500,
  frequency: 'MONTHLY' as const,
  monthlyEquivalent: 500,
  activeMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  effectiveDate: '2026-01-01',
  manualOverride: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const categoryBudget = {
  id: 'cb_1',
  yearPlanId: 'yp_1',
  budgetId: 'b_1',
  categoryName: 'Groceries',
  categoryGroup: 'Essentials',
  removedAt: null,
  seasonal: false,
  highWaterMark: 500,
  doneForYear: false,
  linkedExpenseCount: 2,
  version: budgetVersion,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const budgetStatus = {
  ...categoryBudget,
  actualSpending: 320,
  effectiveExpected: 500,
  status: 'under' as const,
};

const budgetHistory = {
  id: 'bh_1',
  categoryBudgetId: 'cb_1',
  versions: [budgetVersion],
};

function lastCall(): [string, RequestInit] {
  return mockFetch.mock.calls[0] as [string, RequestInit];
}

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function emptyResponse() {
  return Promise.resolve(new Response(null, { status: 204 }));
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── Year Plans ───

describe('budgetsApi — Year Plans', () => {
  it('listPlans calls GET /year-plans', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([yearPlan]));

    const result = await budgetsApi.listPlans();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = lastCall();
    expect(url).toBe('/api/v1/year-plans');
    expect(init.method).toBeUndefined();
    expect(result).toEqual([yearPlan]);
  });

  it('createPlan calls POST /year-plans with body', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(yearPlan));

    const result = await budgetsApi.createPlan({ year: 2026 });

    const [url, init] = lastCall();
    expect(url).toBe('/api/v1/year-plans');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ year: 2026 });
    expect(result).toEqual(yearPlan);
  });

  it('getPlan calls GET /year-plans/:id', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(yearPlan));

    const result = await budgetsApi.getPlan('yp_1');

    const [url, init] = lastCall();
    expect(url).toBe('/api/v1/year-plans/yp_1');
    expect(init.method).toBeUndefined();
    expect(result).toEqual(yearPlan);
  });

  it('confirmPlan calls POST /year-plans/:id/confirm', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(yearPlan));

    const result = await budgetsApi.confirmPlan('yp_1');

    const [url, init] = lastCall();
    expect(url).toBe('/api/v1/year-plans/yp_1/confirm');
    expect(init.method).toBe('POST');
    expect(result).toEqual(yearPlan);
  });

  it('carryForward calls POST /year-plans/:id/carry-forward with body', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(yearPlan));

    const result = await budgetsApi.carryForward('yp_1', { sourceYear: 2025 });

    const [url, init] = lastCall();
    expect(url).toBe('/api/v1/year-plans/yp_1/carry-forward');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ sourceYear: 2025 });
    expect(result).toEqual(yearPlan);
  });
});

// ─── Category Budgets ───

describe('budgetsApi — Category Budgets', () => {
  it('listBudgets calls GET /category-budgets with yearPlanId', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([budgetStatus]));

    const result = await budgetsApi.listBudgets('yp_1');

    const [url] = lastCall();
    expect(url).toBe('/api/v1/category-budgets?yearPlanId=yp_1');
    expect(result).toEqual([budgetStatus]);
  });

  it('listBudgets includes optional query params', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([budgetStatus]));

    await budgetsApi.listBudgets('yp_1', 3, 2026, true, '2026-03-01', '2026-03-31', 'monthly');

    const [url] = lastCall();
    expect(url).toContain('yearPlanId=yp_1');
    expect(url).toContain('month=3');
    expect(url).toContain('year=2026');
    expect(url).toContain('includeSeasonal=true');
    expect(url).toContain('periodStart=2026-03-01');
    expect(url).toContain('periodEnd=2026-03-31');
    expect(url).toContain('viewMode=monthly');
  });

  it('createBudget calls POST /category-budgets', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(categoryBudget));

    const body = {
      yearPlanId: 'yp_1',
      budgetId: 'b_1',
      amount: 500,
      frequency: 'MONTHLY' as const,
      effectiveMonth: 1,
    };
    const result = await budgetsApi.createBudget(body);

    const [url, init] = lastCall();
    expect(url).toBe('/api/v1/category-budgets');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(result).toEqual(categoryBudget);
  });

  it('updateBudget calls PUT /category-budgets/:id', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(categoryBudget));

    const body = { amount: 600 };
    const result = await budgetsApi.updateBudget('cb_1', body);

    const [url, init] = lastCall();
    expect(url).toBe('/api/v1/category-budgets/cb_1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(result).toEqual(categoryBudget);
  });

  it('deleteBudget calls DELETE /category-budgets/:id', async () => {
    mockFetch.mockReturnValueOnce(emptyResponse());

    await budgetsApi.deleteBudget('cb_1');

    const [url, init] = lastCall();
    expect(url).toBe('/api/v1/category-budgets/cb_1');
    expect(init.method).toBe('DELETE');
  });

  it('restoreBudget calls POST /category-budgets/:id/restore', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(categoryBudget));

    const result = await budgetsApi.restoreBudget('cb_1');

    const [url, init] = lastCall();
    expect(url).toBe('/api/v1/category-budgets/cb_1/restore');
    expect(init.method).toBe('POST');
    expect(result).toEqual(categoryBudget);
  });

  it('getBudgetHistory calls GET /category-budgets/:id/history', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(budgetHistory));

    const result = await budgetsApi.getBudgetHistory('cb_1');

    const [url, init] = lastCall();
    expect(url).toBe('/api/v1/category-budgets/cb_1/history');
    expect(init.method).toBeUndefined();
    expect(result).toEqual(budgetHistory);
  });
});
