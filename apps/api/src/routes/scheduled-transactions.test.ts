/**
 * Unit tests for Scheduled Transactions API routes.
 *
 * Feature: transaction-schedule
 * Requirements: 4.4, 7.3, 9.5
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import {
  get,
  post,
  createGroup,
  createCategory,
  createAccount,
  createExpense,
  createIncome,
} from '../test/helpers.js';

describe('Scheduled Transactions API', () => {
  async function setup() {
    const group = await createGroup();
    const cat = await createCategory(group.id);
    const acct = await createAccount();
    return { group, cat, acct };
  }

  /** Helper: create a PENDING ScheduledTransaction for an expense */
  async function createScheduledExpense(expenseId: string, dueDate: Date, expectedAmount: number) {
    return prisma.scheduledTransaction.create({
      data: {
        sourceType: 'EXPENSE',
        sourceId: expenseId,
        dueDate,
        expectedAmount,
        status: 'PENDING',
        expenseId,
        incomeId: null,
      },
    });
  }

  /** Helper: create a PENDING ScheduledTransaction for an income */
  async function createScheduledIncome(incomeId: string, dueDate: Date, expectedAmount: number) {
    return prisma.scheduledTransaction.create({
      data: {
        sourceType: 'INCOME',
        sourceId: incomeId,
        dueDate,
        expectedAmount,
        status: 'PENDING',
        expenseId: null,
        incomeId,
      },
    });
  }

  describe('POST /:id/pay — mark as paid', () => {
    it('creates a transaction with custom amount and date', async () => {
      const { cat, acct } = await setup();
      const expense = await createExpense(cat.id, {
        amount: 100,
        dueDay: 15,
        frequency: 'MONTHLY',
        accountId: acct.id,
      });
      const sched = await createScheduledExpense(expense.id, new Date('2026-04-15T00:00:00Z'), 100);

      const res = await post(`/scheduled-transactions/${sched.id}/pay`, {
        amount: 120,
        date: '2026-04-14',
      });
      expect(res.status).toBe(201);

      const body: any = await res.json();
      expect(body.type).toBe('EXPENSE');
      expect(body.amount).toBe(120);
      expect(body.expenseId).toBe(expense.id);
      expect(body.accountId).toBe(acct.id);

      // Verify the scheduled transaction was updated
      const updated = await prisma.scheduledTransaction.findUnique({ where: { id: sched.id } });
      expect(updated!.status).toBe('PAID');
      expect(Number(updated!.actualAmount)).toBe(120);
      expect(updated!.transactionId).toBe(body.id);
    });

    it('marks income as paid with defaults', async () => {
      const { cat, acct } = await setup();
      const income = await createIncome(cat.id, {
        amount: 5000,
        frequency: 'MONTHLY',
        accountId: acct.id,
      });
      const sched = await createScheduledIncome(income.id, new Date('2026-04-01T00:00:00Z'), 5000);

      const res = await post(`/scheduled-transactions/${sched.id}/pay`, {});
      expect(res.status).toBe(201);

      const body: any = await res.json();
      expect(body.type).toBe('INCOME');
      expect(body.amount).toBe(5000);
      expect(body.incomeId).toBe(income.id);
    });

    it('sets PARTIAL status when amount < expectedAmount', async () => {
      const { cat, acct } = await setup();
      const expense = await createExpense(cat.id, {
        amount: 200,
        dueDay: 15,
        frequency: 'MONTHLY',
        accountId: acct.id,
      });
      const sched = await createScheduledExpense(expense.id, new Date('2026-04-15T00:00:00Z'), 200);

      const res = await post(`/scheduled-transactions/${sched.id}/pay`, { amount: 50 });
      expect(res.status).toBe(201);

      const updated = await prisma.scheduledTransaction.findUnique({ where: { id: sched.id } });
      expect(updated!.status).toBe('PARTIAL');
      expect(Number(updated!.actualAmount)).toBe(50);
    });

    it('returns 409 when already PAID', async () => {
      const { cat, acct } = await setup();
      const expense = await createExpense(cat.id, {
        amount: 100,
        dueDay: 15,
        frequency: 'MONTHLY',
        accountId: acct.id,
      });
      const sched = await createScheduledExpense(expense.id, new Date('2026-04-15T00:00:00Z'), 100);

      // Pay it first
      await post(`/scheduled-transactions/${sched.id}/pay`, {});

      // Try to pay again
      const res = await post(`/scheduled-transactions/${sched.id}/pay`, {});
      expect(res.status).toBe(409);
      const body: any = await res.json();
      expect(body.error).toContain('already paid');
    });

    it('returns 404 for invalid id', async () => {
      const res = await post('/scheduled-transactions/nonexistent/pay', {});
      expect(res.status).toBe(404);
    });
  });

  describe('POST /:id/skip', () => {
    it('sets PENDING row to SKIPPED', async () => {
      const { cat, acct } = await setup();
      const expense = await createExpense(cat.id, {
        amount: 100,
        dueDay: 15,
        frequency: 'MONTHLY',
        accountId: acct.id,
      });
      const sched = await createScheduledExpense(expense.id, new Date('2026-04-15T00:00:00Z'), 100);

      const res = await post(`/scheduled-transactions/${sched.id}/skip`, {});
      expect(res.status).toBe(200);

      const body: any = await res.json();
      expect(body.status).toBe('SKIPPED');

      const updated = await prisma.scheduledTransaction.findUnique({ where: { id: sched.id } });
      expect(updated!.status).toBe('SKIPPED');
    });

    it('returns 409 when already PAID', async () => {
      const { cat, acct } = await setup();
      const expense = await createExpense(cat.id, {
        amount: 100,
        dueDay: 15,
        frequency: 'MONTHLY',
        accountId: acct.id,
      });
      const sched = await createScheduledExpense(expense.id, new Date('2026-04-15T00:00:00Z'), 100);

      // Pay it first
      await post(`/scheduled-transactions/${sched.id}/pay`, {});

      const res = await post(`/scheduled-transactions/${sched.id}/skip`, {});
      expect(res.status).toBe(409);
      const body: any = await res.json();
      expect(body.error).toContain('Cannot skip');
    });

    it('returns 404 for invalid id', async () => {
      const res = await post('/scheduled-transactions/nonexistent/skip', {});
      expect(res.status).toBe(404);
    });
  });

  describe('POST /:id/snooze', () => {
    it('sets PENDING row to SNOOZED with snoozedUntil', async () => {
      const { cat, acct } = await setup();
      const expense = await createExpense(cat.id, {
        amount: 100,
        dueDay: 15,
        frequency: 'MONTHLY',
        accountId: acct.id,
      });
      const sched = await createScheduledExpense(expense.id, new Date('2026-04-15T00:00:00Z'), 100);

      const res = await post(`/scheduled-transactions/${sched.id}/snooze`, { days: 3 });
      expect(res.status).toBe(200);

      const body: any = await res.json();
      expect(body.status).toBe('SNOOZED');
      expect(body.snoozedUntil).toBeDefined();

      const updated = await prisma.scheduledTransaction.findUnique({ where: { id: sched.id } });
      expect(updated!.status).toBe('SNOOZED');
      expect(updated!.snoozedUntil).not.toBeNull();
    });

    it('returns 409 when already PAID', async () => {
      const { cat, acct } = await setup();
      const expense = await createExpense(cat.id, {
        amount: 100,
        dueDay: 15,
        frequency: 'MONTHLY',
        accountId: acct.id,
      });
      const sched = await createScheduledExpense(expense.id, new Date('2026-04-15T00:00:00Z'), 100);

      // Pay it first
      await post(`/scheduled-transactions/${sched.id}/pay`, {});

      const res = await post(`/scheduled-transactions/${sched.id}/snooze`, { days: 3 });
      expect(res.status).toBe(409);
    });

    it('returns 404 for invalid id', async () => {
      const res = await post('/scheduled-transactions/nonexistent/snooze', { days: 3 });
      expect(res.status).toBe(404);
    });
  });

  describe('GET / — list scheduled transactions', () => {
    it('returns scheduled transactions for a period', async () => {
      const { cat, acct } = await setup();
      const expense = await createExpense(cat.id, {
        amount: 100,
        dueDay: 15,
        frequency: 'MONTHLY',
        accountId: acct.id,
      });
      await createScheduledExpense(expense.id, new Date('2026-04-15T00:00:00Z'), 100);

      const res = await get('/scheduled-transactions?periodStart=2026-04-01&periodEnd=2026-04-30');
      expect(res.status).toBe(200);

      const body: any = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0].sourceType).toBe('EXPENSE');
      expect(body[0].expectedAmount).toBe(100);
    });
  });
});
