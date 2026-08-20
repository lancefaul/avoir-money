import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { expensesApi } from './expenses.js';

describe('expensesApi', () => {
  const mockExpense = {
    id: 'clx_exp1',
    name: 'Netflix',
    amount: 15.99,
    frequency: 'MONTHLY',
    budgetId: 'clx_bud1',
    accountId: 'clx_acc1',
    isAutomatic: true,
    skipWeekend: true,
    dueDay: 15,
    dueWeekday: null,
    dueOrdinal: null,
    amountSchedule: null,
    startDate: '2024-01-01T00:00:00.000Z',
    endDate: null,
    pausedUntil: null,
    archivedAt: null,
    note: null,
    managementUrl: null,
    linkedDebtId: null,
    isLinkedToBudget: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('list — calls GET /api/v1/expenses', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify([mockExpense]), { status: 200 }));
    const result = await expensesApi.list();
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/expenses',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('clx_exp1');
  });

  it('list — passes query params', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify([mockExpense]), { status: 200 }));
    await expensesApi.list({ budgetId: 'clx_bud1', archived: 'true' });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/expenses?'),
      expect.anything(),
    );
    const url = (fetch as Mock).mock.calls[0]![0] as string;
    expect(url).toContain('budgetId=clx_bud1');
    expect(url).toContain('archived=true');
  });

  it('get — calls GET /api/v1/expenses/:id', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockExpense), { status: 200 }));
    const result = await expensesApi.get('clx_exp1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/expenses/clx_exp1',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result.name).toBe('Netflix');
  });

  it('create — calls POST /api/v1/expenses with body', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockExpense), { status: 201 }));
    const body = { name: 'Netflix', amount: 15.99, frequency: 'MONTHLY', budgetId: 'clx_bud1' };
    const result = await expensesApi.create(body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/expenses',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
    expect(result.name).toBe('Netflix');
  });

  it('update — calls PUT /api/v1/expenses/:id with body', async () => {
    const updated = { ...mockExpense, amount: 19.99 };
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }));
    const body = { amount: 19.99 };
    const result = await expensesApi.update('clx_exp1', body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/expenses/clx_exp1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    );
    expect(result.amount).toBe(19.99);
  });

  it('delete — calls DELETE /api/v1/expenses/:id', async () => {
    (fetch as Mock).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await expensesApi.delete('clx_exp1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/expenses/clx_exp1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('archive — calls POST /api/v1/expenses/:id/archive', async () => {
    const archived = { ...mockExpense, archivedAt: '2024-06-01T00:00:00.000Z' };
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(archived), { status: 200 }));
    const result = await expensesApi.archive('clx_exp1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/expenses/clx_exp1/archive',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    expect(result.archivedAt).toBeTruthy();
  });

  it('restore — calls POST /api/v1/expenses/:id/restore', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockExpense), { status: 200 }));
    const result = await expensesApi.restore('clx_exp1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/expenses/clx_exp1/restore',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    expect(result.archivedAt).toBeNull();
  });

  it('pause — calls POST /api/v1/expenses/:id/pause with body', async () => {
    const paused = { ...mockExpense, pausedUntil: '2024-07-01T00:00:00.000Z' };
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(paused), { status: 200 }));
    const body = { duration: 30, unit: 'days', indefinite: false };
    const result = await expensesApi.pause('clx_exp1', body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/expenses/clx_exp1/pause',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
    expect(result.pausedUntil).toBeTruthy();
  });

  it('resume — calls POST /api/v1/expenses/:id/resume with body', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockExpense), { status: 200 }));
    const body = { immediately: true };
    const result = await expensesApi.resume('clx_exp1', body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/expenses/clx_exp1/resume',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
    expect(result.pausedUntil).toBeNull();
  });
});
