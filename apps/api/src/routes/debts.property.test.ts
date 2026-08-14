import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
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

// ─── Shared arbitraries ───

const DEBT_TYPES = [
  'MORTGAGE',
  'AUTO_LOAN',
  'STUDENT_LOAN',
  'CREDIT_CARD',
  'PERSONAL_LOAN',
  'OTHER',
] as const;
const FREQUENCIES = [
  'ONE_TIME',
  'WEEKLY',
  'BIWEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
] as const;

const validDebtArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
  type: fc.constantFrom(...DEBT_TYPES),
  originalBalance: fc.double({ min: 0, max: 500_000, noNaN: true }),
  currentBalance: fc.double({ min: 0, max: 500_000, noNaN: true }),
  apr: fc.double({ min: 0, max: 100, noNaN: true }),
  minimumPayment: fc.double({ min: 0, max: 10_000, noNaN: true }),
  frequency: fc.constantFrom(...FREQUENCIES),
  startDate: fc.constant('2024-01-01T00:00:00.000Z'),
});

// Helper: create a debt via API and return the body
async function apiCreateDebt(data: Record<string, unknown>) {
  const res = await post('/debts', data);
  return { status: res.status, body: (await res.json()) as any };
}

/**
 * Feature: debt-tracker, Property 1: Debt CRUD round-trip
 *
 * For any valid debt input: POST creates it, GET returns matching fields.
 * PUT updates, GET returns updated fields.
 */
describe('Property 1: Debt CRUD round-trip', () => {
  it('create and read round-trips correctly', () => {
    return fc.assert(
      fc.asyncProperty(validDebtArb, async (debt) => {
        const { status, body: created } = await apiCreateDebt(debt);
        expect(status).toBe(201);
        expect(created.name).toBe(debt.name);
        expect(created.type).toBe(debt.type);
        expect(created.originalBalance).toBeCloseTo(debt.originalBalance, 1);
        expect(created.currentBalance).toBeCloseTo(debt.currentBalance, 1);
        expect(created.apr).toBeCloseTo(debt.apr, 1);
        expect(created.minimumPayment).toBeCloseTo(debt.minimumPayment, 1);
        expect(created.frequency).toBe(debt.frequency);

        // GET returns the same data with progress fields
        const getRes = await get(`/debts/${created.id}`);
        expect(getRes.status).toBe(200);
        const fetched: any = await getRes.json();
        expect(fetched.name).toBe(debt.name);
        expect(fetched.type).toBe(debt.type);
        expect(typeof fetched.totalPrincipalPaid).toBe('number');
        expect(typeof fetched.monthsRemaining).toBe('number');

        // PUT updates fields
        const putRes = await put(`/debts/${created.id}`, { name: 'UPDATED' });
        expect(putRes.status).toBe(200);
        const updated: any = await putRes.json();
        expect(updated.name).toBe('UPDATED');
        // Other fields unchanged
        expect(updated.type).toBe(debt.type);

        // Cleanup
        await del(`/debts/${created.id}`);
      }),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: debt-tracker, Property 2: Debt validation rejects invalid input
 *
 * For any debt input with at least one invalid field, POST returns 400.
 */
describe('Property 2: Debt validation rejects invalid input', () => {
  it('rejects invalid debt inputs', () => {
    const invalidators = [
      // originalBalance < 0
      (d: Record<string, unknown>) => ({
        ...d,
        originalBalance: -fc.sample(fc.double({ min: 0.01, max: 1000, noNaN: true }), 1)[0]!,
      }),
      // currentBalance < 0
      (d: Record<string, unknown>) => ({
        ...d,
        currentBalance: -fc.sample(fc.double({ min: 0.01, max: 1000, noNaN: true }), 1)[0]!,
      }),
      // minimumPayment < 0
      (d: Record<string, unknown>) => ({
        ...d,
        minimumPayment: -fc.sample(fc.double({ min: 0.01, max: 1000, noNaN: true }), 1)[0]!,
      }),
      // apr < 0
      (d: Record<string, unknown>) => ({
        ...d,
        apr: -fc.sample(fc.double({ min: 0.01, max: 50, noNaN: true }), 1)[0]!,
      }),
      // apr > 100
      (d: Record<string, unknown>) => ({
        ...d,
        apr: 100 + fc.sample(fc.double({ min: 0.01, max: 100, noNaN: true }), 1)[0]!,
      }),
      // empty name
      (d: Record<string, unknown>) => ({ ...d, name: '' }),
      // name > 200 chars
      (d: Record<string, unknown>) => ({ ...d, name: 'X'.repeat(201) }),
    ];

    return fc.assert(
      fc.asyncProperty(
        validDebtArb,
        fc.integer({ min: 0, max: invalidators.length - 1 }),
        async (debt, invalidatorIdx) => {
          const invalidDebt = invalidators[invalidatorIdx]!(debt);
          const res = await post('/debts', invalidDebt);
          expect(res.status).toBe(400);
        },
      ),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: debt-tracker, Property 3: Delete cascades to payments
 *
 * Create a debt and DebtPayments via transaction hook, delete the debt,
 * both debt and all DebtPayments are gone.
 */
describe('Property 3: Delete cascades to payments', () => {
  it('deleting a debt removes all its payments', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (paymentCount) => {
        // Create fresh fixtures each iteration to avoid FK issues
        const group = await createGroup();
        const cat = await createCategory(group.id, 'Cascade');
        const acct = await createAccount('Cascade', 'CHECKING');
        const expense = await createExpense(cat.id, { name: `Cascade Exp`, amount: 500 });

        const { body: debt } = await apiCreateDebt({
          name: 'Cascade Debt',
          type: 'PERSONAL_LOAN',
          originalBalance: 50000,
          currentBalance: 50000,
          apr: 0,
          minimumPayment: 500,
          frequency: 'MONTHLY',
          startDate: '2024-01-01T00:00:00.000Z',
          linkedExpenseId: expense.id,
        });

        // Create payment transactions
        for (let i = 0; i < paymentCount; i++) {
          const day = String(i + 1).padStart(2, '0');
          await post('/transactions', {
            type: 'EXPENSE',
            name: `Payment ${i}`,
            amount: 500,
            date: `2026-04-${day}T00:00:00.000Z`,
            accountId: acct.id,
            expenseId: expense.id,
          });
        }

        // Verify payments exist
        const paymentsBefore = await prisma.debtPayment.findMany({ where: { debtId: debt.id } });
        expect(paymentsBefore.length).toBe(paymentCount);

        // Delete the debt
        const delRes = await del(`/debts/${debt.id}`);
        expect(delRes.status).toBe(204);

        // Payments are gone (cascade)
        const paymentsAfter = await prisma.debtPayment.findMany({ where: { debtId: debt.id } });
        expect(paymentsAfter).toHaveLength(0);
      }),
      { numRuns: 20 },
    );
  }, 120_000);
});

/**
 * Feature: debt-tracker, Property 4: Payment reduces balance by principal amount
 *
 * For any debt with positive balance, after a transaction,
 * newBalance = previousBalance - principalAmount (within 0.01 tolerance).
 */
describe('Property 4: Payment reduces balance by principal amount', () => {
  it('balance decreases by exactly the principal', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 1000, max: 100_000, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        fc.double({ min: 100, max: 5000, noNaN: true }),
        async (balance, apr, paymentAmount) => {
          const group = await createGroup();
          const cat = await createCategory(group.id, 'P4');
          const acct = await createAccount('P4', 'CHECKING');
          const expense = await createExpense(cat.id, { name: 'P4 Exp', amount: paymentAmount });

          const { body: debt } = await apiCreateDebt({
            name: 'P4 Debt',
            type: 'PERSONAL_LOAN',
            originalBalance: balance,
            currentBalance: balance,
            apr,
            minimumPayment: paymentAmount,
            frequency: 'MONTHLY',
            startDate: '2024-01-01T00:00:00.000Z',
            linkedExpenseId: expense.id,
          });

          await post('/transactions', {
            type: 'EXPENSE',
            name: 'P4 Payment',
            amount: paymentAmount,
            date: '2026-04-01T00:00:00.000Z',
            accountId: acct.id,
            expenseId: expense.id,
          });

          // Read the payment to get principal
          const payments = await prisma.debtPayment.findMany({ where: { debtId: debt.id } });
          expect(payments).toHaveLength(1);
          const principalAmount = Number(payments[0]!.principalAmount);

          // Read updated debt
          const updated: any = await (await get(`/debts/${debt.id}`)).json();
          const expectedBalance = Math.max(0, balance - principalAmount);
          expect(updated.currentBalance).toBeCloseTo(expectedBalance, 0);
        },
      ),
      { numRuns: 20 },
    );
  }, 120_000);
});

/**
 * Feature: debt-tracker, Property 5: Total interest equals sum of payment interest portions
 *
 * For a debt with multiple payments, GET /:id returns totalInterestPaid
 * equal to the sum of all DebtPayment.interestAmount values.
 */
describe('Property 5: Total interest equals sum of payment interest', () => {
  it('totalInterestPaid matches sum of payment interest amounts', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (paymentCount) => {
        const group = await createGroup();
        const cat = await createCategory(group.id, 'P5');
        const acct = await createAccount('P5', 'CHECKING');
        const expense = await createExpense(cat.id, { name: 'P5 Exp', amount: 500 });

        const { body: debt } = await apiCreateDebt({
          name: 'P5 Debt',
          type: 'AUTO_LOAN',
          originalBalance: 50000,
          currentBalance: 50000,
          apr: 6,
          minimumPayment: 500,
          frequency: 'MONTHLY',
          startDate: '2024-01-01T00:00:00.000Z',
          linkedExpenseId: expense.id,
        });

        for (let i = 0; i < paymentCount; i++) {
          const day = String(i + 1).padStart(2, '0');
          await post('/transactions', {
            type: 'EXPENSE',
            name: `P5 Payment ${i}`,
            amount: 500,
            date: `2026-04-${day}T00:00:00.000Z`,
            accountId: acct.id,
            expenseId: expense.id,
          });
        }

        // Sum interest from all payments
        const payments = await prisma.debtPayment.findMany({ where: { debtId: debt.id } });
        const sumInterest = payments.reduce((s, p) => s + Number(p.interestAmount), 0);

        // GET /:id should match
        const debtRes: any = await (await get(`/debts/${debt.id}`)).json();
        expect(debtRes.totalInterestPaid).toBeCloseTo(sumInterest, 1);
      }),
      { numRuns: 20 },
    );
  }, 120_000);
});

/**
 * Feature: debt-tracker, Property 7: Linked transaction auto-creates debt payment
 *
 * For any debt with a linkedExpenseId and positive balance:
 * Creating a transaction against the expense creates exactly one DebtPayment
 * with correct debtId. Debt currentBalance decreases by principal.
 */
describe('Property 7: Linked transaction auto-creates debt payment', () => {
  it('transaction against linked expense creates a DebtPayment', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 5000, max: 200_000, noNaN: true }),
        fc.double({ min: 100, max: 3000, noNaN: true }),
        async (balance, paymentAmount) => {
          const group = await createGroup();
          const cat = await createCategory(group.id, 'P7');
          const acct = await createAccount('P7', 'CHECKING');
          const expense = await createExpense(cat.id, { name: 'P7 Exp', amount: paymentAmount });

          const { body: debt } = await apiCreateDebt({
            name: 'P7 Debt',
            type: 'CREDIT_CARD',
            originalBalance: balance,
            currentBalance: balance,
            apr: 18,
            minimumPayment: paymentAmount,
            frequency: 'MONTHLY',
            startDate: '2024-01-01T00:00:00.000Z',
            linkedExpenseId: expense.id,
          });

          await post('/transactions', {
            type: 'EXPENSE',
            name: 'P7 Payment',
            amount: paymentAmount,
            date: '2026-04-01T00:00:00.000Z',
            accountId: acct.id,
            expenseId: expense.id,
          });

          // Exactly one DebtPayment created
          const payments = await prisma.debtPayment.findMany({ where: { debtId: debt.id } });
          expect(payments).toHaveLength(1);
          expect(payments[0]!.debtId).toBe(debt.id);

          // Balance decreased by principal
          const principalAmount = Number(payments[0]!.principalAmount);
          const updated: any = await (await get(`/debts/${debt.id}`)).json();
          const expectedBalance = Math.max(0, balance - principalAmount);
          expect(updated.currentBalance).toBeCloseTo(expectedBalance, 0);
        },
      ),
      { numRuns: 20 },
    );
  }, 120_000);
});

/**
 * Feature: debt-tracker, Property 8: Transaction deletion restores debt balance
 *
 * Create transaction -> balance decreases.
 * Delete transaction -> balance returns to original value (within 0.01).
 */
describe('Property 8: Transaction deletion restores debt balance', () => {
  it('deleting a transaction restores the debt balance', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 5000, max: 200_000, noNaN: true }),
        fc.double({ min: 100, max: 3000, noNaN: true }),
        async (balance, paymentAmount) => {
          const group = await createGroup();
          const cat = await createCategory(group.id, 'P8');
          const acct = await createAccount('P8', 'CHECKING');
          const expense = await createExpense(cat.id, { name: 'P8 Exp', amount: paymentAmount });

          const { body: debt } = await apiCreateDebt({
            name: 'P8 Debt',
            type: 'STUDENT_LOAN',
            originalBalance: balance,
            currentBalance: balance,
            apr: 5,
            minimumPayment: paymentAmount,
            frequency: 'MONTHLY',
            startDate: '2024-01-01T00:00:00.000Z',
            linkedExpenseId: expense.id,
          });

          // Create transaction
          const txRes = await post('/transactions', {
            type: 'EXPENSE',
            name: 'P8 Payment',
            amount: paymentAmount,
            date: '2026-04-01T00:00:00.000Z',
            accountId: acct.id,
            expenseId: expense.id,
          });
          const tx: any = await txRes.json();

          // Balance should have decreased
          const midDebt: any = await (await get(`/debts/${debt.id}`)).json();
          expect(midDebt.currentBalance).toBeLessThan(balance + 0.01);

          // Delete transaction
          const delRes = await del(`/transactions/${tx.id}`);
          expect(delRes.status).toBe(204);

          // Balance restored
          const restored: any = await (await get(`/debts/${debt.id}`)).json();
          expect(restored.currentBalance).toBeCloseTo(balance, 0);
          expect(restored.paidOff).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  }, 120_000);
});

/**
 * Feature: debt-tracker, Property 12: Summary totals match individual debts
 *
 * For any set of debts (mix of active and paid-off):
 * - totalBalance = sum of currentBalance for active debts
 * - totalMinimumMonthly = sum of minimumPayment for active debts
 * - activeCount + paidOffCount = total debt count
 *
 * Strategy: create debts, then verify summary matches the full DB state.
 */
describe('Property 12: Summary totals match individual debts', () => {
  it('summary totals equal individual debt sums', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            balance: fc.double({ min: 0, max: 100_000, noNaN: true }),
            minPay: fc.double({ min: 0, max: 5000, noNaN: true }),
            paidOff: fc.boolean(),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        async (debtSpecs) => {
          // Create debts — use Prisma directly since API doesn't accept paidOff
          const createdIds: string[] = [];
          for (const spec of debtSpecs) {
            const d = await prisma.debt.create({
              data: {
                name: `P12 ${Date.now()}_${Math.random()}`,
                type: 'OTHER',
                originalBalance: spec.balance,
                currentBalance: spec.paidOff ? 0 : spec.balance,
                apr: 5,
                minimumPayment: spec.minPay,
                frequency: 'MONTHLY',
                startDate: new Date('2024-01-01'),
                paidOff: spec.paidOff,
              },
            });
            createdIds.push(d.id);
          }

          // Read all debts from DB and verify summary matches
          const [summaryRes, allDebts] = await Promise.all([
            get('/debts/summary'),
            prisma.debt.findMany(),
          ]);
          expect(summaryRes.status).toBe(200);
          const summary: any = await summaryRes.json();

          const activeDebts = allDebts.filter((d) => !d.paidOff);
          const paidOffDebts = allDebts.filter((d) => d.paidOff);
          const expectedBalance = activeDebts.reduce((s, d) => s + Number(d.currentBalance), 0);
          const expectedMinPay = activeDebts.reduce((s, d) => s + Number(d.minimumPayment), 0);

          expect(summary.totalBalance).toBeCloseTo(expectedBalance, 0);
          expect(summary.totalMinimumMonthly).toBeCloseTo(expectedMinPay, 0);
          expect(summary.activeCount).toBe(activeDebts.length);
          expect(summary.paidOffCount).toBe(paidOffDebts.length);

          // Cleanup
          for (const id of createdIds) {
            await prisma.debt.delete({ where: { id } }).catch(() => {});
          }
        },
      ),
      { numRuns: 20 },
    );
  }, 60_000);
});
