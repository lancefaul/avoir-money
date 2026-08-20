/**
 * Integration tests for escrow API routes.
 * Tests CRUD lifecycle, validation, ordering, debt integration, and amortization.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { get, post, put, del } from '../../test/helpers.js';

// ─── Helpers ───

let counter = 0;
function uid(prefix = '') {
  return `${prefix}${++counter}_${Date.now()}`;
}

/** Create a MORTGAGE debt for escrow testing. */
async function createMortgage(overrides: Record<string, unknown> = {}) {
  return prisma.debt.create({
    data: {
      name: uid('MORTGAGE_'),
      type: 'MORTGAGE',
      originalBalance: 300000,
      currentBalance: 280000,
      apr: 6.5,
      minimumPayment: 1900,
      frequency: 'MONTHLY',
      startDate: new Date('2024-01-01'),
      escrowEnabled: true,
      ...overrides,
    },
  });
}

/** Create a non-mortgage debt (AUTO_LOAN). */
async function createAutoLoan() {
  return prisma.debt.create({
    data: {
      name: uid('AUTO_'),
      type: 'AUTO_LOAN',
      originalBalance: 25000,
      currentBalance: 20000,
      apr: 5.0,
      minimumPayment: 450,
      frequency: 'MONTHLY',
      startDate: new Date('2024-06-01'),
    },
  });
}

const validEscrow = {
  monthlyAmount: 250.0,
  periodStartDate: '2025-01-01',
  periodEndDate: '2025-12-31',
};

// ─── CRUD Lifecycle ───

describe('Escrow CRUD lifecycle', () => {
  let debtId: string;

  beforeEach(async () => {
    const debt = await createMortgage();
    debtId = debt.id;
  });

  it('creates an escrow record and returns 201', async () => {
    const res = await post(`/debts/${debtId}/escrow`, validEscrow);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      debtId,
      monthlyAmount: 250.0,
    });
    expect(body['id']).toBeDefined();
    expect(body['createdAt']).toBeDefined();
    expect(body['updatedAt']).toBeDefined();
  });

  it('lists escrow records for a debt', async () => {
    await post(`/debts/${debtId}/escrow`, validEscrow);
    const res = await get(`/debts/${debtId}/escrow`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]!['monthlyAmount']).toBe(250.0);
  });

  it('updates an escrow record', async () => {
    const createRes = await post(`/debts/${debtId}/escrow`, validEscrow);
    const created = (await createRes.json()) as { id: string };

    const res = await put(`/debts/${debtId}/escrow/${created.id}`, {
      monthlyAmount: 350.0,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['monthlyAmount']).toBe(350.0);
  });

  it('deletes an escrow record', async () => {
    const createRes = await post(`/debts/${debtId}/escrow`, validEscrow);
    const created = (await createRes.json()) as { id: string };

    const res = await del(`/debts/${debtId}/escrow/${created.id}`);
    expect(res.status).toBe(204);

    // Verify it's gone
    const listRes = await get(`/debts/${debtId}/escrow`);
    const body = (await listRes.json()) as unknown[];
    expect(body).toHaveLength(0);
  });

  it('retains previous records when creating a new one (history preserved)', async () => {
    await post(`/debts/${debtId}/escrow`, validEscrow);
    await post(`/debts/${debtId}/escrow`, {
      monthlyAmount: 350.0,
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-12-31',
    });

    const res = await get(`/debts/${debtId}/escrow`);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(2);
  });
});

// ─── Ordering ───

describe('Escrow history ordering', () => {
  it('returns records ordered by periodStartDate DESC', async () => {
    const debt = await createMortgage();

    await post(`/debts/${debt.id}/escrow`, {
      monthlyAmount: 300,
      periodStartDate: '2024-01-01',
      periodEndDate: '2024-12-31',
    });
    await post(`/debts/${debt.id}/escrow`, {
      monthlyAmount: 350,
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-12-31',
    });
    await post(`/debts/${debt.id}/escrow`, {
      monthlyAmount: 325,
      periodStartDate: '2025-01-01',
      periodEndDate: '2025-12-31',
    });

    const res = await get(`/debts/${debt.id}/escrow`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ monthlyAmount: number; periodStartDate: string }>;
    expect(body).toHaveLength(3);

    // Most recent first
    const dates = body.map((r) => new Date(r.periodStartDate).getTime());
    for (let i = 0; i < dates.length - 1; i++) {
      expect(dates[i]!).toBeGreaterThan(dates[i + 1]!);
    }
    expect(body[0]!.monthlyAmount).toBe(350);
    expect(body[1]!.monthlyAmount).toBe(325);
    expect(body[2]!.monthlyAmount).toBe(300);
  });
});

// ─── Debt response includes escrow data ───

describe('Debt response includes escrow data', () => {
  it('GET /debts includes escrowEnabled flag', async () => {
    const debt = await createMortgage({ escrowEnabled: true });
    await createMortgage({ escrowEnabled: false, name: uid('MORT_NO_ESC_') });

    const res = await get('/debts');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; escrowEnabled: boolean }>;

    const withEscrow = body.find((d) => d.id === debt.id);
    expect(withEscrow).toBeDefined();
    expect(withEscrow!.escrowEnabled).toBe(true);
  });

  it('GET /debts/:id includes escrowEnabled and currentEscrowRecord', async () => {
    const debt = await createMortgage({ escrowEnabled: true });
    await post(`/debts/${debt.id}/escrow`, validEscrow);

    const res = await get(`/debts/${debt.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      escrowEnabled: boolean;
      currentEscrowRecord: { monthlyAmount: number } | null;
    };
    expect(body.escrowEnabled).toBe(true);
    expect(body.currentEscrowRecord).not.toBeNull();
    expect(body.currentEscrowRecord!.monthlyAmount).toBe(250.0);
  });

  it('GET /debts/:id returns null currentEscrowRecord when escrow disabled', async () => {
    const debt = await createMortgage({ escrowEnabled: false });

    const res = await get(`/debts/${debt.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { escrowEnabled: boolean; currentEscrowRecord: unknown };
    expect(body.escrowEnabled).toBe(false);
    expect(body.currentEscrowRecord).toBeNull();
  });

  it('PUT /debts/:id can toggle escrowEnabled', async () => {
    const debt = await createMortgage({ escrowEnabled: false });

    const res = await put(`/debts/${debt.id}`, { escrowEnabled: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { escrowEnabled: boolean };
    expect(body.escrowEnabled).toBe(true);
  });
});

// ─── Amortization with escrow ───

describe('Amortization includes escrow', () => {
  it('includes escrowAmount and totalEscrow when escrow is enabled', async () => {
    const debt = await createMortgage({ escrowEnabled: true });
    await post(`/debts/${debt.id}/escrow`, validEscrow);

    const res = await get(`/debts/${debt.id}/amortization`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totalEscrow: number;
      entries: Array<{
        escrowAmount: number;
        paymentAmount: number;
        principalAmount: number;
        interestAmount: number;
      }>;
    };

    expect(body.totalEscrow).toBeGreaterThan(0);
    expect(body.entries.length).toBeGreaterThan(0);

    // Every entry should have escrowAmount = 250.00
    for (const entry of body.entries) {
      expect(entry.escrowAmount).toBeCloseTo(250.0, 2);
      // paymentAmount = principal + interest + escrow
      expect(entry.paymentAmount).toBeCloseTo(
        entry.principalAmount + entry.interestAmount + entry.escrowAmount,
        2,
      );
    }
  });

  it('escrowAmount is 0 when escrow is disabled', async () => {
    const debt = await createMortgage({ escrowEnabled: false });

    const res = await get(`/debts/${debt.id}/amortization`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totalEscrow: number;
      entries: Array<{ escrowAmount: number }>;
    };

    expect(body.totalEscrow).toBe(0);
    for (const entry of body.entries) {
      expect(entry.escrowAmount).toBe(0);
    }
  });

  it('escrowAmount query param overrides active escrow record', async () => {
    const debt = await createMortgage({ escrowEnabled: true });
    await post(`/debts/${debt.id}/escrow`, validEscrow);

    const res = await get(`/debts/${debt.id}/amortization?escrowAmount=500`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ escrowAmount: number }>;
    };

    for (const entry of body.entries) {
      expect(entry.escrowAmount).toBeCloseTo(500, 2);
    }
  });
});

// ─── Validation errors ───

describe('Escrow validation errors', () => {
  let debtId: string;

  beforeEach(async () => {
    const debt = await createMortgage();
    debtId = debt.id;
  });

  it('rejects negative monthlyAmount', async () => {
    const res = await post(`/debts/${debtId}/escrow`, {
      monthlyAmount: -100,
      periodStartDate: '2025-01-01',
      periodEndDate: '2025-12-31',
    });
    expect(res.status).toBe(400);
  });

  it('rejects start date >= end date', async () => {
    const res = await post(`/debts/${debtId}/escrow`, {
      monthlyAmount: 300,
      periodStartDate: '2025-12-31',
      periodEndDate: '2025-01-01',
    });
    expect(res.status).toBe(400);
  });

  it('rejects same start and end date', async () => {
    const res = await post(`/debts/${debtId}/escrow`, {
      monthlyAmount: 300,
      periodStartDate: '2025-06-15',
      periodEndDate: '2025-06-15',
    });
    expect(res.status).toBe(400);
  });

  it('rejects period exceeding 366 days', async () => {
    const res = await post(`/debts/${debtId}/escrow`, {
      monthlyAmount: 300,
      periodStartDate: '2025-01-01',
      periodEndDate: '2026-01-03', // 367 days
    });
    expect(res.status).toBe(400);
  });

  it('accepts period of exactly 366 days', async () => {
    const res = await post(`/debts/${debtId}/escrow`, {
      monthlyAmount: 300,
      periodStartDate: '2025-01-01',
      periodEndDate: '2026-01-02', // 366 days
    });
    expect(res.status).toBe(201);
  });
});

// ─── Non-MORTGAGE debt rejection ───

describe('Escrow rejected for non-MORTGAGE debts', () => {
  it('returns 400 when creating escrow on an AUTO_LOAN', async () => {
    const loan = await createAutoLoan();
    const res = await post(`/debts/${loan.id}/escrow`, validEscrow);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/mortgage/i);
  });
});

// ─── 404 handling ───

describe('Escrow 404 handling', () => {
  it('returns 404 for non-existent debt on create', async () => {
    const res = await post('/debts/nonexistent-id/escrow', validEscrow);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 404 for non-existent debt on list', async () => {
    const res = await get('/debts/nonexistent-id/escrow');
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent escrow record on update', async () => {
    const debt = await createMortgage();
    const res = await put(`/debts/${debt.id}/escrow/nonexistent-id`, {
      monthlyAmount: 400,
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 404 for non-existent escrow record on delete', async () => {
    const debt = await createMortgage();
    const res = await del(`/debts/${debt.id}/escrow/nonexistent-id`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 404 for non-existent debt on update', async () => {
    const res = await put('/debts/nonexistent-id/escrow/some-id', {
      monthlyAmount: 400,
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent debt on delete', async () => {
    const res = await del('/debts/nonexistent-id/escrow/some-id');
    expect(res.status).toBe(404);
  });
});
