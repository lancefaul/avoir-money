import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { debtsApi } from './debts.js';

describe('debtsApi', () => {
  const mockDebt = {
    id: 'clx_debt1',
    name: 'Home Mortgage',
    type: 'MORTGAGE',
    originalBalance: 300000,
    currentBalance: 275000,
    apr: 6.5,
    minimumPayment: 1900,
    frequency: 'MONTHLY',
    startDate: '2023-01-15T00:00:00.000Z',
    maturityDate: '2053-01-15T00:00:00.000Z',
    termMonths: 360,
    linkedExpenseId: null,
    linkedAccountId: null,
    paidOff: false,
    escrowEnabled: true,
    note: null,
    managementUrl: null,
    createdAt: '2023-01-15T00:00:00.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
    monthlyPayment: 2346,
  };

  const mockSummary = {
    totalBalance: 275000,
    totalMinimumMonthly: 1900,
    debtFreeDate: '2053-01-15T00:00:00.000Z',
    activeCount: 1,
    paidOffCount: 0,
  };

  const mockAmortization = {
    debtId: 'clx_debt1',
    entries: [
      {
        month: 1,
        paymentAmount: 1900,
        principalAmount: 412,
        interestAmount: 1488,
        escrowAmount: 0,
        remainingBalance: 274588,
      },
    ],
    totalInterest: 384000,
    totalPayments: 684000,
    totalEscrow: 0,
    payoffDate: '2053-01-15T00:00:00.000Z',
    monthsRemaining: 348,
    isNegativelyAmortizing: false,
  };

  const mockEscrow = {
    id: 'clx_escrow1',
    debtId: 'clx_debt1',
    monthlyAmount: 450,
    periodStartDate: '2024-01-01T00:00:00.000Z',
    periodEndDate: '2024-12-31T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── List ──────────────────────────────────────────────────────────────

  it('list — calls GET /api/v1/debts with no params', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify([mockDebt]), { status: 200 }));
    const result = await debtsApi.list();
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/debts',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('clx_debt1');
  });

  it('list — appends query params when provided', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify([mockDebt]), { status: 200 }));
    await debtsApi.list({ type: 'MORTGAGE', paidOff: 'false', limit: 50 });
    const url = (fetch as Mock).mock.calls[0]![0] as string;
    expect(url).toContain('/api/v1/debts?');
    expect(url).toContain('type=MORTGAGE');
    expect(url).toContain('paidOff=false');
    expect(url).toContain('limit=50');
  });

  it('list — omits undefined/null params', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    await debtsApi.list({ type: undefined, paidOff: 'true' });
    const url = (fetch as Mock).mock.calls[0]![0] as string;
    expect(url).toContain('paidOff=true');
    expect(url).not.toContain('type=');
  });

  // ─── Get ───────────────────────────────────────────────────────────────

  it('get — calls GET /api/v1/debts/:id', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockDebt), { status: 200 }));
    const result = await debtsApi.get('clx_debt1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/debts/clx_debt1',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result.name).toBe('Home Mortgage');
  });

  // ─── Create ────────────────────────────────────────────────────────────

  it('create — calls POST /api/v1/debts with body', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockDebt), { status: 201 }));
    const body = {
      name: 'Home Mortgage',
      type: 'MORTGAGE',
      originalBalance: 300000,
      currentBalance: 275000,
      apr: 6.5,
      minimumPayment: 1900,
      frequency: 'MONTHLY',
      startDate: '2023-01-15',
    };
    const result = await debtsApi.create(body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/debts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
    expect(result.id).toBe('clx_debt1');
  });

  // ─── Update ────────────────────────────────────────────────────────────

  it('update — calls PUT /api/v1/debts/:id with body', async () => {
    const updated = { ...mockDebt, currentBalance: 270000 };
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }));
    const body = { currentBalance: 270000 };
    const result = await debtsApi.update('clx_debt1', body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/debts/clx_debt1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    );
    expect(result.currentBalance).toBe(270000);
  });

  // ─── Delete ────────────────────────────────────────────────────────────

  it('delete — calls DELETE /api/v1/debts/:id', async () => {
    (fetch as Mock).mockResolvedValue(new Response(null, { status: 204 }));
    await debtsApi.delete('clx_debt1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/debts/clx_debt1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  // ─── Summary ───────────────────────────────────────────────────────────

  it('summary — calls GET /api/v1/debts/summary', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockSummary), { status: 200 }));
    const result = await debtsApi.summary();
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/debts/summary',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result.totalBalance).toBe(275000);
    expect(result.activeCount).toBe(1);
  });

  // ─── Amortization ─────────────────────────────────────────────────────

  it('amortization — calls GET /api/v1/debts/:id/amortization', async () => {
    (fetch as Mock).mockResolvedValue(
      new Response(JSON.stringify(mockAmortization), { status: 200 }),
    );
    const result = await debtsApi.amortization('clx_debt1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/debts/clx_debt1/amortization',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result.monthsRemaining).toBe(348);
  });

  it('amortization — appends extraPayment query param', async () => {
    (fetch as Mock).mockResolvedValue(
      new Response(JSON.stringify(mockAmortization), { status: 200 }),
    );
    await debtsApi.amortization('clx_debt1', 200);
    const url = (fetch as Mock).mock.calls[0]![0] as string;
    expect(url).toBe('/api/v1/debts/clx_debt1/amortization?extraPayment=200');
  });

  // ─── Escrow CRUD ──────────────────────────────────────────────────────

  it('listEscrow — calls GET /api/v1/debts/:id/escrow', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify([mockEscrow]), { status: 200 }));
    const result = await debtsApi.listEscrow('clx_debt1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/debts/clx_debt1/escrow',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.monthlyAmount).toBe(450);
  });

  it('createEscrow — calls POST /api/v1/debts/:id/escrow with body', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockEscrow), { status: 201 }));
    const body = { monthlyAmount: 450, periodStartDate: '2024-01-01', periodEndDate: '2024-12-31' };
    const result = await debtsApi.createEscrow('clx_debt1', body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/debts/clx_debt1/escrow',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
    expect(result.id).toBe('clx_escrow1');
  });

  it('updateEscrow — calls PUT /api/v1/debts/:id/escrow/:escrowId with body', async () => {
    const updated = { ...mockEscrow, monthlyAmount: 500 };
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }));
    const body = { monthlyAmount: 500 };
    const result = await debtsApi.updateEscrow('clx_debt1', 'clx_escrow1', body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/debts/clx_debt1/escrow/clx_escrow1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    );
    expect(result.monthlyAmount).toBe(500);
  });

  it('deleteEscrow — calls DELETE /api/v1/debts/:id/escrow/:escrowId', async () => {
    (fetch as Mock).mockResolvedValue(new Response(null, { status: 204 }));
    await debtsApi.deleteEscrow('clx_debt1', 'clx_escrow1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/debts/clx_debt1/escrow/clx_escrow1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
