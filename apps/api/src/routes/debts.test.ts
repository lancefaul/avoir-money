import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import {
  get,
  post,
  put,
  del,
  createGroup,
  createCategory,
  createAccount,
  createExpense,
} from '../test/helpers.js';

// ─── Helpers ───

const VALID_DEBT = {
  name: 'Test Mortgage',
  type: 'MORTGAGE',
  originalBalance: 200000,
  currentBalance: 195000,
  apr: 6.5,
  minimumPayment: 1200,
  frequency: 'MONTHLY',
  startDate: '2024-01-01T00:00:00.000Z',
};

async function createDebt(overrides: Record<string, unknown> = {}) {
  const res = await post('/debts', { ...VALID_DEBT, ...overrides });
  return { res, body: (await res.json()) as any };
}

/** Create a debt directly via Prisma (needed when setting paidOff or other non-API fields) */
async function createDebtDirect(overrides: Record<string, unknown> = {}) {
  return prisma.debt.create({
    data: {
      name: 'Direct Debt',
      type: 'OTHER',
      originalBalance: 10000,
      currentBalance: 0,
      apr: 5,
      minimumPayment: 200,
      frequency: 'MONTHLY',
      startDate: new Date('2024-01-01'),
      ...overrides,
    },
  });
}

describe('Debts API', () => {
  // ─── CRUD ───

  describe('CRUD', () => {
    it('POST /debts creates a debt and returns 201 with all fields', async () => {
      const { res, body } = await createDebt();
      expect(res.status).toBe(201);
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Test Mortgage');
      expect(body.type).toBe('MORTGAGE');
      expect(body.originalBalance).toBe(200000);
      expect(body.currentBalance).toBe(195000);
      expect(body.apr).toBe(6.5);
      expect(body.minimumPayment).toBe(1200);
      expect(body.frequency).toBe('MONTHLY');
      expect(body.paidOff).toBe(false);
      expect(body.linkedExpenseId).toBeNull();
      expect(body.linkedAccountId).toBeNull();
      expect(body.note).toBeNull();
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();
    });

    it('GET /debts returns a list of debts', async () => {
      await createDebt({ name: 'Debt A' });
      await createDebt({ name: 'Debt B' });
      const res = await get('/debts');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body).toHaveLength(2);
    });

    it('GET /debts includes a computed estimatedPayoffDate per debt', async () => {
      await createDebt({ name: 'Active Debt' });
      await createDebt({ name: 'Settled Debt', currentBalance: 0 });
      const res = await get('/debts');
      expect(res.status).toBe(200);
      const body: any = await res.json();

      const active = body.find((d: any) => d.name === 'Active Debt');
      const settled = body.find((d: any) => d.name === 'Settled Debt');
      // Active debt with a term amortizes to a real future date
      expect(active.estimatedPayoffDate).not.toBeNull();
      expect(new Date(active.estimatedPayoffDate).getTime()).toBeGreaterThan(Date.now());
      // Zero balance → nothing left to pay off
      expect(settled.estimatedPayoffDate).toBeNull();
    });

    it('GET /debts/:id returns a single debt with progress fields', async () => {
      const { body: created } = await createDebt();
      const res = await get(`/debts/${created.id}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.id).toBe(created.id);
      expect(body.name).toBe('Test Mortgage');
      expect(typeof body.totalPrincipalPaid).toBe('number');
      expect(typeof body.totalInterestPaid).toBe('number');
      // estimatedPayoffDate can be a date string or null
      expect(body).toHaveProperty('estimatedPayoffDate');
      expect(typeof body.monthsRemaining).toBe('number');
    });

    it('GET /debts/:id returns 404 for unknown id', async () => {
      const res = await get('/debts/nonexistent_id_xyz');
      expect(res.status).toBe(404);
    });

    it('PUT /debts/:id updates fields and returns 200', async () => {
      const { body: created } = await createDebt();
      const res = await put(`/debts/${created.id}`, { name: 'Updated Mortgage', apr: 5.0 });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.name).toBe('Updated Mortgage');
      expect(body.apr).toBe(5.0);
      // Unchanged fields stay the same
      expect(body.originalBalance).toBe(200000);
    });

    it('PUT /debts/:id returns 404 for unknown id', async () => {
      const res = await put('/debts/nonexistent_id_xyz', { name: 'Nope' });
      expect(res.status).toBe(404);
    });

    it('DELETE /debts/:id returns 204 and removes the record', async () => {
      const { body: created } = await createDebt();
      const delRes = await del(`/debts/${created.id}`);
      expect(delRes.status).toBe(204);
      const getRes = await get(`/debts/${created.id}`);
      expect(getRes.status).toBe(404);
    });

    it('DELETE /debts/:id returns 404 for unknown id', async () => {
      const res = await del('/debts/nonexistent_id_xyz');
      expect(res.status).toBe(404);
    });
  });

  // ─── Validation ───

  describe('Validation', () => {
    it('POST /debts with negative originalBalance returns 400', async () => {
      const { res } = await createDebt({ originalBalance: -100 });
      expect(res.status).toBe(400);
    });

    it('POST /debts with apr > 100 returns 400', async () => {
      const { res } = await createDebt({ apr: 101 });
      expect(res.status).toBe(400);
    });

    it('POST /debts with empty name returns 400', async () => {
      const { res } = await createDebt({ name: '' });
      expect(res.status).toBe(400);
    });

    it('POST /debts with name > 200 chars returns 400', async () => {
      const { res } = await createDebt({ name: 'A'.repeat(201) });
      expect(res.status).toBe(400);
    });
  });

  // ─── Amortization ───

  describe('Amortization', () => {
    it('GET /debts/:id/amortization returns a valid schedule', async () => {
      const { body: debt } = await createDebt({
        currentBalance: 10000,
        apr: 5,
        minimumPayment: 500,
      });
      const res = await get(`/debts/${debt.id}/amortization`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.debtId).toBe(debt.id);
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.entries.length).toBeGreaterThan(0);
      expect(typeof body.totalInterest).toBe('number');
      expect(typeof body.totalPayments).toBe('number');
      expect(typeof body.monthsRemaining).toBe('number');
      expect(typeof body.isNegativelyAmortizing).toBe('boolean');
    });

    it('GET /debts/:id/amortization with ?extraPayment=200 returns a shorter schedule', async () => {
      const { body: debt } = await createDebt({
        currentBalance: 50000,
        apr: 6,
        minimumPayment: 600,
      });
      const [noExtra, withExtra]: any[] = await Promise.all([
        get(`/debts/${debt.id}/amortization`).then((r) => r.json()),
        get(`/debts/${debt.id}/amortization?extraPayment=200`).then((r) => r.json()),
      ]);
      expect(withExtra.monthsRemaining).toBeLessThan(noExtra.monthsRemaining);
    });

    it('GET /debts/:id/amortization for paid-off debt (balance=0) returns empty entries', async () => {
      const debt = await createDebtDirect({ currentBalance: 0, paidOff: true });
      const res = await get(`/debts/${debt.id}/amortization`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.entries).toHaveLength(0);
      expect(body.monthsRemaining).toBe(0);
    });

    it('GET /debts/:id/amortization returns 404 for unknown id', async () => {
      const res = await get('/debts/nonexistent_id_xyz/amortization');
      expect(res.status).toBe(404);
    });
  });

  // ─── Summary ───

  describe('Summary', () => {
    it('GET /debts/summary returns correct totals', async () => {
      await createDebt({ name: 'Active 1', currentBalance: 10000, minimumPayment: 200, apr: 5 });
      await createDebt({ name: 'Active 2', currentBalance: 5000, minimumPayment: 100, apr: 3 });
      await createDebtDirect({
        name: 'Paid Off',
        currentBalance: 0,
        paidOff: true,
        minimumPayment: 0,
      });

      const res = await get('/debts/summary');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.totalBalance).toBe(15000);
      expect(body.totalMinimumMonthly).toBe(300);
      expect(body.activeCount).toBe(2);
      expect(body.paidOffCount).toBe(1);
    });

    it('GET /debts/summary with no active debts returns zeroes', async () => {
      await createDebtDirect({ name: 'Paid', currentBalance: 0, paidOff: true, minimumPayment: 0 });
      const res = await get('/debts/summary');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.totalBalance).toBe(0);
      expect(body.totalMinimumMonthly).toBe(0);
      expect(body.activeCount).toBe(0);
      expect(body.paidOffCount).toBe(1);
    });
  });

  // ─── Monthly payment (recorded P&I + escrow) ───

  describe('Monthly payment', () => {
    it('GET /debts reports the recorded payment, not one reconstructed from the terms', async () => {
      // The regression this pins: with these real production figures the PMT
      // formula derives 661.29 while the lender charges 653.52, and the page
      // showed a payment that had never been made. `termMonths: 71` is what
      // makes the two differ.
      const { body: debt } = await createDebt({
        name: 'PMT Auto Loan',
        originalBalance: 40000,
        currentBalance: 30000,
        apr: 5.5,
        minimumPayment: 653.52,
        termMonths: 71,
        frequency: 'MONTHLY',
      });
      const res = await get('/debts');
      const body: any = await res.json();
      const found = body.find((d: any) => d.id === debt.id);
      expect(found.monthlyPayment).toBeCloseTo(653.52, 2);
      expect(found.monthlyPayment).not.toBeCloseTo(661.29, 2);
    });

    it('GET /debts falls back to the loan terms when no payment is recorded', async () => {
      const { body: debt } = await createDebt({
        name: 'Termed Mortgage',
        originalBalance: 200000,
        currentBalance: 175000,
        apr: 4.0,
        minimumPayment: 0, // nothing recorded → reconstruct from the terms
        termMonths: 360,
        frequency: 'MONTHLY',
      });
      const res = await get('/debts');
      const body: any = await res.json();
      const found = body.find((d: any) => d.id === debt.id);
      // Derived fixed P&I for a $200,000 / 4% / 360mo loan
      expect(found.monthlyPayment).toBeCloseTo(954.83, 2);
    });

    it('GET /debts adds current escrow on top of P&I', async () => {
      const { body: debt } = await createDebt({
        name: 'Escrow Mortgage',
        originalBalance: 200000,
        currentBalance: 175000,
        apr: 4.0,
        // The mortgage form stores the derived P&I here, never the PITI.
        minimumPayment: 954.83,
        termMonths: 360,
        escrowEnabled: true,
      });
      await post(`/debts/${debt.id}/escrow`, {
        monthlyAmount: 250.0,
        periodStartDate: '2026-01-01',
        periodEndDate: '2026-12-31',
      });
      const res = await get('/debts');
      const body: any = await res.json();
      const found = body.find((d: any) => d.id === debt.id);
      // 954.83 P&I + 250.00 escrow
      expect(found.monthlyPayment).toBeCloseTo(1204.83, 2);
    });

    it('GET /debts falls back to minimumPayment for debts without a term (revolving)', async () => {
      const { body: card } = await createDebt({
        name: 'Credit Card',
        type: 'CREDIT_CARD',
        originalBalance: 5000,
        currentBalance: 3000,
        apr: 19.99,
        minimumPayment: 150,
        // no termMonths → no amortization → uses minimumPayment
      });
      const res = await get('/debts');
      const body: any = await res.json();
      const found = body.find((d: any) => d.id === card.id);
      expect(found.monthlyPayment).toBe(150);
    });

    it('GET /debts cannot hold two escrow records for one period', async () => {
      // Originally this seeded two rows sharing a period start and asserted the
      // read's createdAt tie-break picked the newer one (ADR-032). That state is
      // now unrepresentable — `(debtId, periodStartDate)` is unique — so the
      // scenario cannot be constructed, and the guarantee worth pinning is the
      // stronger one: the duplicate cannot be created at all. The tie-break
      // itself is kept as defence in depth and is simply unreachable.
      const { body: debt } = await createDebt({
        name: 'Tied Escrow Mortgage',
        originalBalance: 200000,
        currentBalance: 175000,
        apr: 4.0,
        minimumPayment: 954.83,
        termMonths: 360,
        escrowEnabled: true,
      });

      const period = {
        debtId: debt.id,
        periodStartDate: new Date(Date.UTC(2026, 7, 1)),
        periodEndDate: new Date(Date.UTC(2027, 7, 2)),
      };
      await prisma.escrowRecord.create({ data: { ...period, monthlyAmount: 250.0 } });
      await expect(
        prisma.escrowRecord.create({ data: { ...period, monthlyAmount: 275.0 } }),
      ).rejects.toThrow(/Unique constraint/i);

      // And a revision through the API updates that one row rather than adding
      // a second, so the figure the page reports is the one just saved.
      await post(`/debts/${debt.id}/escrow`, {
        monthlyAmount: 275.0,
        periodStartDate: '2026-08-01',
        periodEndDate: '2027-08-02',
      });
      expect(await prisma.escrowRecord.count({ where: { debtId: debt.id } })).toBe(1);

      const body: any = await (await get('/debts')).json();
      const found = body.find((d: any) => d.id === debt.id);
      // 954.83 P&I + 275.00 escrow, not the superseded 250.00.
      expect(found.monthlyPayment).toBeCloseTo(1229.83, 2);
      expect(found.monthlyPayment).not.toBeCloseTo(1204.83, 2);
    });

    it('GET /debts/summary totalMinimumMonthly agrees with the per-debt figures it sums', async () => {
      // The summary and the rows appear on the same page, so the number worth
      // pinning is not just its value but that the two cannot disagree — they
      // resolve the payment through one shared helper for exactly that reason.
      const { body: debt } = await createDebt({
        name: 'Summary Mortgage',
        originalBalance: 200000,
        currentBalance: 175000,
        apr: 4.0,
        minimumPayment: 954.83, // stored P&I, as the mortgage form writes it
        termMonths: 360,
        escrowEnabled: true,
      });
      await post(`/debts/${debt.id}/escrow`, {
        monthlyAmount: 250.0,
        periodStartDate: '2026-01-01',
        periodEndDate: '2026-12-31',
      });

      const summary: any = await (await get('/debts/summary')).json();
      expect(summary.totalMinimumMonthly).toBeCloseTo(1204.83, 2); // 954.83 + 250.00

      const debts: any = await (await get('/debts')).json();
      const sumOfRows = debts
        .filter((d: any) => !d.paidOff)
        .reduce((s: number, d: any) => s + Number(d.monthlyPayment), 0);
      expect(summary.totalMinimumMonthly).toBeCloseTo(sumOfRows, 2);
    });
  });

  // ─── Transaction Hook (debt payment) ───

  describe('Transaction Hook', () => {
    async function setupLinkedDebt() {
      const group = await createGroup();
      const cat = await createCategory(group.id, 'Debt Payments');
      const acct = await createAccount('Checking', 'CHECKING');
      const expense = await createExpense(cat.id, { name: 'Mortgage Payment', amount: 1200 });
      const { body: debt } = await createDebt({
        name: 'Mortgage',
        currentBalance: 100000,
        apr: 6,
        minimumPayment: 1200,
        linkedExpenseId: expense.id,
      });
      return { group, cat, acct, expense, debt };
    }

    it('creating a transaction against a linked expense creates a DebtPayment and reduces balance', async () => {
      const { acct, expense, debt } = await setupLinkedDebt();

      const txRes = await post('/transactions', {
        type: 'EXPENSE',
        name: 'Mortgage Payment',
        amount: 1200,
        date: '2026-04-01T00:00:00.000Z',
        accountId: acct.id,
        expenseId: expense.id,
      });
      expect(txRes.status).toBe(201);

      // Check debt balance decreased
      const debtRes = await get(`/debts/${debt.id}`);
      const updatedDebt: any = await debtRes.json();
      expect(updatedDebt.currentBalance).toBeLessThan(100000);
      expect(updatedDebt.totalPrincipalPaid).toBeGreaterThan(0);
      expect(updatedDebt.totalInterestPaid).toBeGreaterThan(0);

      // DebtPayment record exists
      const payments = await prisma.debtPayment.findMany({ where: { debtId: debt.id } });
      expect(payments).toHaveLength(1);
      expect(payments[0]!.transactionId).toBeDefined();
    });

    it('if payment covers full remaining balance, paidOff is set to true', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id, 'Debt');
      const acct = await createAccount('Checking', 'CHECKING');
      const expense = await createExpense(cat.id, { name: 'Final Payment', amount: 600 });
      // Small remaining balance with 0% APR so all payment goes to principal
      const { body: debt } = await createDebt({
        name: 'Small Debt',
        currentBalance: 500,
        originalBalance: 5000,
        apr: 0,
        minimumPayment: 500,
        linkedExpenseId: expense.id,
      });

      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Final Payment',
        amount: 600,
        date: '2026-04-01T00:00:00.000Z',
        accountId: acct.id,
        expenseId: expense.id,
      });

      const debtRes = await get(`/debts/${debt.id}`);
      const updatedDebt: any = await debtRes.json();
      expect(updatedDebt.currentBalance).toBe(0);
      expect(updatedDebt.paidOff).toBe(true);
    });

    it('deleting a transaction with a linked DebtPayment restores the debt balance', async () => {
      const { acct, expense, debt } = await setupLinkedDebt();

      const txRes = await post('/transactions', {
        type: 'EXPENSE',
        name: 'Mortgage Payment',
        amount: 1200,
        date: '2026-04-01T00:00:00.000Z',
        accountId: acct.id,
        expenseId: expense.id,
      });
      const tx: any = await txRes.json();

      // Balance should have decreased
      const midDebt: any = await (await get(`/debts/${debt.id}`)).json();
      expect(midDebt.currentBalance).toBeLessThan(100000);

      // Delete the transaction
      const delRes = await del(`/transactions/${tx.id}`);
      expect(delRes.status).toBe(204);

      // Balance should be restored (within interest tolerance)
      const restoredDebt: any = await (await get(`/debts/${debt.id}`)).json();
      expect(restoredDebt.currentBalance).toBeCloseTo(100000, 0);
      expect(restoredDebt.paidOff).toBe(false);

      // DebtPayment should be gone
      const payments = await prisma.debtPayment.findMany({ where: { debtId: debt.id } });
      expect(payments).toHaveLength(0);
    });
  });

  // ─── Linked expense unlinking ───

  describe('Linked expense unlinking', () => {
    it('after changing linkedExpenseId to null, new transactions against old expense do not create DebtPayments', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id, 'Debts');
      const acct = await createAccount('Checking', 'CHECKING');
      const expense = await createExpense(cat.id, { name: 'Car Payment', amount: 500 });
      const { body: debt } = await createDebt({
        name: 'Car Loan',
        currentBalance: 20000,
        apr: 4,
        minimumPayment: 500,
        linkedExpenseId: expense.id,
      });

      // Unlink the expense directly via Prisma (UpdateDebtSchema doesn't accept null for linkedExpenseId)
      await prisma.debt.update({ where: { id: debt.id }, data: { linkedExpenseId: null } });
      const unlinkedDebt: any = await (await get(`/debts/${debt.id}`)).json();
      expect(unlinkedDebt.linkedExpenseId).toBeNull();

      // Create a transaction against the old expense
      await post('/transactions', {
        type: 'EXPENSE',
        name: 'Car Payment',
        amount: 500,
        date: '2026-04-01T00:00:00.000Z',
        accountId: acct.id,
        expenseId: expense.id,
      });

      // No DebtPayment should exist
      const payments = await prisma.debtPayment.findMany({ where: { debtId: debt.id } });
      expect(payments).toHaveLength(0);

      // Balance unchanged
      const debtRes = await get(`/debts/${debt.id}`);
      const finalDebt: any = await debtRes.json();
      expect(finalDebt.currentBalance).toBe(20000);
    });
  });
});
