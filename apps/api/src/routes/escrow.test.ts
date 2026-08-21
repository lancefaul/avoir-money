/**
 * One escrow record per period.
 *
 * Editing a mortgage re-posts its escrow with the period already sitting in the
 * form, and that write used to insert unconditionally, so a single period
 * accumulated rows — production reached five for 2026-08-01, two of them the
 * same edit made twice. Because the "current escrow" read then ordered by
 * `periodStartDate` alone and all five tied, SQL returned an arbitrary (stale)
 * one and an escrow edit appeared not to have saved at all.
 *
 * The write now upserts and `(debtId, periodStartDate)` is unique, so the
 * duplicate state is unrepresentable rather than merely handled.
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { get, post, put } from '../test/helpers.js';

const MORTGAGE = {
  name: 'Escrow Test Mortgage',
  type: 'MORTGAGE',
  originalBalance: 200000,
  currentBalance: 195000,
  apr: 6.5,
  minimumPayment: 1200,
  frequency: 'MONTHLY',
  startDate: '2024-01-01T00:00:00.000Z',
  escrowEnabled: true,
};

async function mortgage() {
  const res = await post('/debts', MORTGAGE);
  return (await res.json()) as { id: string };
}

const PERIOD = { periodStartDate: '2026-08-01', periodEndDate: '2027-08-01' };

describe('POST /debts/:id/escrow', () => {
  it('creates the first record for a period', async () => {
    const debt = await mortgage();

    const res = await post(`/debts/${debt.id}/escrow`, { monthlyAmount: 250.0, ...PERIOD });
    expect(res.status).toBe(201);

    const rows = await prisma.escrowRecord.findMany({ where: { debtId: debt.id } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.monthlyAmount)).toBe(250.0);
  });

  it('updates in place when the same period is posted again', async () => {
    // Exactly what editing a mortgage does: re-post the period already in the
    // form. This is the regression — it used to add a second row.
    const debt = await mortgage();
    await post(`/debts/${debt.id}/escrow`, { monthlyAmount: 250.0, ...PERIOD });
    await post(`/debts/${debt.id}/escrow`, { monthlyAmount: 266.11, ...PERIOD });

    const rows = await prisma.escrowRecord.findMany({ where: { debtId: debt.id } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.monthlyAmount)).toBe(266.11);
  });

  it('survives being posted repeatedly — the write is idempotent', async () => {
    // Five saves is what production actually accumulated.
    const debt = await mortgage();
    for (let i = 0; i < 5; i++) {
      await post(`/debts/${debt.id}/escrow`, { monthlyAmount: 300, ...PERIOD });
    }
    const rows = await prisma.escrowRecord.findMany({ where: { debtId: debt.id } });
    expect(rows).toHaveLength(1);
  });

  it('still inserts for a genuinely new period', async () => {
    // The update modal starts the next period where the last one ended, and
    // that must remain an insert rather than overwriting history.
    const debt = await mortgage();
    await post(`/debts/${debt.id}/escrow`, { monthlyAmount: 250.0, ...PERIOD });
    await post(`/debts/${debt.id}/escrow`, {
      monthlyAmount: 266.11,
      periodStartDate: '2027-08-01',
      periodEndDate: '2028-08-01',
    });

    const rows = await prisma.escrowRecord.findMany({ where: { debtId: debt.id } });
    expect(rows).toHaveLength(2);
  });

  it('keeps periods separate across debts', async () => {
    // The constraint is on the pair, not the date — two mortgages may share a
    // period start without conflicting.
    const a = await mortgage();
    const b = await mortgage();
    await post(`/debts/${a.id}/escrow`, { monthlyAmount: 100, ...PERIOD });
    const res = await post(`/debts/${b.id}/escrow`, { monthlyAmount: 200, ...PERIOD });

    expect(res.status).toBe(201);
    expect(await prisma.escrowRecord.count({ where: { debtId: a.id } })).toBe(1);
    expect(await prisma.escrowRecord.count({ where: { debtId: b.id } })).toBe(1);
  });

  it('is the figure the debt then reports', async () => {
    // The whole point: what was saved is what the page shows. 1200 stored P&I
    // (revolving fallback is not in play here) + 266.11 escrow.
    const debt = await mortgage();
    await post(`/debts/${debt.id}/escrow`, { monthlyAmount: 250.0, ...PERIOD });
    await post(`/debts/${debt.id}/escrow`, { monthlyAmount: 266.11, ...PERIOD });

    const body: any = await (await get('/debts')).json();
    const found = body.find((d: any) => d.id === debt.id);
    expect(found.monthlyPayment).toBeCloseTo(1200 + 266.11, 2);
  });
});

describe('PUT /debts/:id/escrow/:escrowId', () => {
  it('rejects moving a record onto a period another record already covers', async () => {
    const debt = await mortgage();
    await post(`/debts/${debt.id}/escrow`, { monthlyAmount: 250.0, ...PERIOD });
    const second: any = await (
      await post(`/debts/${debt.id}/escrow`, {
        monthlyAmount: 266.11,
        periodStartDate: '2027-08-01',
        periodEndDate: '2028-08-01',
      })
    ).json();

    const res = await put(`/debts/${debt.id}/escrow/${second.id}`, {
      periodStartDate: '2026-08-01T00:00:00.000Z',
    });

    // 409, not a 500: a collision is an ordinary, explainable conflict, and it
    // only became reachable once the pair was made unique.
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already exists for that period/i);
  });

  it('still allows an ordinary amount edit', async () => {
    const debt = await mortgage();
    const rec: any = await (
      await post(`/debts/${debt.id}/escrow`, { monthlyAmount: 250.0, ...PERIOD })
    ).json();

    const res = await put(`/debts/${debt.id}/escrow/${rec.id}`, { monthlyAmount: 266.11 });
    expect(res.status).toBe(200);

    const row = await prisma.escrowRecord.findUnique({ where: { id: rec.id } });
    expect(Number(row!.monthlyAmount)).toBe(266.11);
  });
});
