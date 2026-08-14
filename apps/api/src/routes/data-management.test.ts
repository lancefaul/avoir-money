/**
 * Integration tests for data-management routes.
 *
 * Tests:
 * - GET /data-management/counts — returns correct counts per category
 * - DELETE /data-management/bulk — deletes selected categories
 */
import { describe, it, expect } from 'vitest';
import {
  get,
  req,
  createAccount,
  createBudgetGroup,
  createBudget,
  createExpense,
  createIncome,
  createDebt,
  createTransaction,
  createPaySchedule,
  createHolding,
} from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';

interface CountsResponse {
  allTransactions: number;
  importedTransactions: number;
  recurringExpenses: number;
  recurringIncome: number;
  accounts: number;
  budgets: number;
  debts: number;
  utilities: number;
  healthcarePolicies: number;
  investments: number;
  scheduledTransactions: number;
  paySchedules: number;
}

interface BulkDeleteResponse {
  deleted: number;
}

describe('GET /data-management/counts', () => {
  it('returns zeros when database is empty', async () => {
    const res = await get('/data-management/counts');
    expect(res.status).toBe(200);

    const data = (await res.json()) as CountsResponse & BulkDeleteResponse;
    expect(data.allTransactions).toBe(0);
    expect(data.importedTransactions).toBe(0);
    expect(data.recurringExpenses).toBe(0);
    expect(data.recurringIncome).toBe(0);
    expect(data.accounts).toBe(0);
    expect(data.budgets).toBe(0);
    expect(data.debts).toBe(0);
    expect(data.utilities).toBe(0);
    expect(data.healthcarePolicies).toBe(0);
    expect(data.investments).toBe(0);
    expect(data.scheduledTransactions).toBe(0);
    expect(data.paySchedules).toBe(0);
  });

  it('returns correct counts after creating records', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const account = await createAccount();
    await createExpense(budget.id);
    await createExpense(budget.id);
    await createIncome(budget.id);
    await createTransaction(account.id);
    await createTransaction(account.id, { imported: true });
    await createDebt();
    await createPaySchedule();

    const res = await get('/data-management/counts');
    expect(res.status).toBe(200);

    const data = (await res.json()) as CountsResponse & BulkDeleteResponse;
    expect(data.allTransactions).toBe(2);
    expect(data.importedTransactions).toBe(1);
    expect(data.recurringExpenses).toBe(2);
    expect(data.recurringIncome).toBe(1);
    expect(data.accounts).toBe(1);
    expect(data.debts).toBe(1);
    expect(data.paySchedules).toBe(1);
  });
});

describe('DELETE /data-management/bulk', () => {
  it('requires confirm=true query param', async () => {
    const res = await req('DELETE', '/data-management/bulk', { categories: ['accounts'] });
    // Without ?confirm=true, validation should fail
    expect(res.status).toBe(400);
  });

  it('deletes accounts category', async () => {
    await createAccount('DM_ACCT_1');
    await createAccount('DM_ACCT_2');

    const before = await prisma.account.count();
    expect(before).toBe(2);

    const res = await req('DELETE', '/data-management/bulk?confirm=true', {
      categories: ['accounts'],
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as CountsResponse & BulkDeleteResponse;
    expect(data.deleted).toBe(2);

    const after = await prisma.account.count();
    expect(after).toBe(0);
  });

  it('deletes recurring-expenses category', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    await createExpense(budget.id);
    await createExpense(budget.id);
    await createExpense(budget.id);

    const res = await req('DELETE', '/data-management/bulk?confirm=true', {
      categories: ['recurring-expenses'],
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as CountsResponse & BulkDeleteResponse;
    expect(data.deleted).toBe(3);

    const after = await prisma.expense.count();
    expect(after).toBe(0);
  });

  it('deletes recurring-income category', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    await createIncome(budget.id);
    await createIncome(budget.id);

    const res = await req('DELETE', '/data-management/bulk?confirm=true', {
      categories: ['recurring-income'],
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as CountsResponse & BulkDeleteResponse;
    expect(data.deleted).toBe(2);
  });

  it('deletes all-transactions and resets account balances', async () => {
    const account = await createAccount();
    await createTransaction(account.id, { amount: 100, netAmount: 100 });
    await createTransaction(account.id, { amount: 200, netAmount: 200 });

    // Manually set account balance to simulate real state
    await prisma.account.update({
      where: { id: account.id },
      data: { balance: 5000 },
    });

    const res = await req('DELETE', '/data-management/bulk?confirm=true', {
      categories: ['all-transactions'],
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as CountsResponse & BulkDeleteResponse;
    expect(data.deleted).toBe(2);

    // Balance should be reset to 0
    const updatedAccount = await prisma.account.findUnique({ where: { id: account.id } });
    expect(Number(updatedAccount?.balance)).toBe(0);
  });

  it('deletes imported-transactions only', async () => {
    const account = await createAccount();
    await createTransaction(account.id, { imported: false });
    await createTransaction(account.id, { imported: true });
    await createTransaction(account.id, { imported: true });

    const res = await req('DELETE', '/data-management/bulk?confirm=true', {
      categories: ['imported-transactions'],
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as CountsResponse & BulkDeleteResponse;
    expect(data.deleted).toBe(2);

    // Non-imported transaction should remain
    const remaining = await prisma.transaction.count();
    expect(remaining).toBe(1);
  });

  it('deletes debts category', async () => {
    await createDebt();
    await createDebt();

    const res = await req('DELETE', '/data-management/bulk?confirm=true', {
      categories: ['debts'],
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as CountsResponse & BulkDeleteResponse;
    expect(data.deleted).toBe(2);
  });

  it('deletes pay-schedules category (cascades pay periods)', async () => {
    const schedule = await createPaySchedule();
    await prisma.payPeriod.create({
      data: {
        scheduleId: schedule.id,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        endDate: new Date(Date.UTC(2026, 0, 14)),
        payDate: new Date(Date.UTC(2026, 0, 1)),
        year: 2026,
        periodNum: 1,
      },
    });

    const res = await req('DELETE', '/data-management/bulk?confirm=true', {
      categories: ['pay-schedules'],
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as CountsResponse & BulkDeleteResponse;
    expect(data.deleted).toBe(1);

    // Pay periods should also be gone (cascade)
    const periods = await prisma.payPeriod.count();
    expect(periods).toBe(0);
  });

  it('deletes multiple categories in one request', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const account = await createAccount();
    await createExpense(budget.id);
    await createIncome(budget.id);
    await createTransaction(account.id);

    const res = await req('DELETE', '/data-management/bulk?confirm=true', {
      categories: ['recurring-expenses', 'recurring-income', 'all-transactions'],
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as CountsResponse & BulkDeleteResponse;
    expect(data.deleted).toBe(3); // 1 expense + 1 income + 1 transaction

    expect(await prisma.expense.count()).toBe(0);
    expect(await prisma.income.count()).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
  });

  // ─── Cross-table integrity (Audit H1) ──────────────────────────────────────
  // A full transaction wipe must return every transaction-derived value to baseline,
  // not just account balances. These guard the corruption fixed by resetTransactionDerivedState.

  it('all-transactions resets holdings and debt balances to baseline', async () => {
    const account = await createAccount();
    await prisma.account.update({
      where: { id: account.id },
      data: { balance: 5000 },
    });
    await createTransaction(account.id, { amount: 100, netAmount: 100 });
    const tx2 = await createTransaction(account.id, { amount: 200, netAmount: 200 });
    const holding = await createHolding({ quantity: 2.5, costBasis: 60000 });
    const debt = await createDebt({ originalBalance: 200000, currentBalance: 150000 });
    await prisma.debtPayment.create({
      data: {
        debtId: debt.id,
        transactionId: tx2.id,
        principalAmount: 1000,
        interestAmount: 500,
        date: new Date(Date.UTC(2026, 5, 15)),
      },
    });

    const res = await req('DELETE', '/data-management/bulk?confirm=true', {
      categories: ['all-transactions'],
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as BulkDeleteResponse;
    expect(data.deleted).toBe(2);

    const acct = await prisma.account.findUnique({ where: { id: account.id } });
    expect(Number(acct?.balance)).toBe(0);

    const h = await prisma.investmentHolding.findUnique({ where: { id: holding.id } });
    expect(Number(h?.quantity)).toBe(0);
    expect(h?.costBasis).toBeNull();

    const d = await prisma.debt.findUnique({ where: { id: debt.id } });
    expect(Number(d?.currentBalance)).toBe(200000); // back to originalBalance
    expect(await prisma.debtPayment.count()).toBe(0);
  });

  it('all-transactions reverts paid scheduled transactions to pending', async () => {
    const account = await createAccount();
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const expense = await createExpense(budget.id);
    const tx = await createTransaction(account.id);
    const paid = await prisma.scheduledTransaction.create({
      data: {
        sourceType: 'EXPENSE',
        sourceId: expense.id,
        expenseId: expense.id,
        dueDate: new Date(Date.UTC(2026, 5, 1)),
        expectedAmount: 100,
        actualAmount: 100,
        status: 'PAID',
        transactionId: tx.id,
      },
    });
    // A snoozed row is a deliberate user action — it must survive the wipe unchanged.
    const snoozed = await prisma.scheduledTransaction.create({
      data: {
        sourceType: 'EXPENSE',
        sourceId: expense.id,
        expenseId: expense.id,
        dueDate: new Date(Date.UTC(2026, 6, 1)),
        expectedAmount: 100,
        status: 'SNOOZED',
        snoozedUntil: new Date(Date.UTC(2026, 6, 15)),
      },
    });

    const res = await req('DELETE', '/data-management/bulk?confirm=true', {
      categories: ['all-transactions'],
    });
    expect(res.status).toBe(200);

    const paidAfter = await prisma.scheduledTransaction.findUnique({ where: { id: paid.id } });
    expect(paidAfter?.status).toBe('PENDING');
    expect(paidAfter?.transactionId).toBeNull();
    expect(paidAfter?.actualAmount).toBeNull();

    const snoozedAfter = await prisma.scheduledTransaction.findUnique({
      where: { id: snoozed.id },
    });
    expect(snoozedAfter?.status).toBe('SNOOZED');
  });

  it('accounts wipe resets holdings and debt balances derived from cascaded transactions', async () => {
    const account = await createAccount();
    const tx = await createTransaction(account.id);
    const holding = await createHolding({ quantity: 3, costBasis: 90000 });
    const debt = await createDebt({ originalBalance: 100000, currentBalance: 80000 });
    await prisma.debtPayment.create({
      data: {
        debtId: debt.id,
        transactionId: tx.id,
        principalAmount: 100,
        interestAmount: 50,
        date: new Date(Date.UTC(2026, 5, 15)),
      },
    });

    const res = await req('DELETE', '/data-management/bulk?confirm=true', {
      categories: ['accounts'],
    });
    expect(res.status).toBe(200);

    expect(await prisma.account.count()).toBe(0);
    expect(await prisma.transaction.count()).toBe(0); // cascaded with the account

    const h = await prisma.investmentHolding.findUnique({ where: { id: holding.id } });
    expect(Number(h?.quantity)).toBe(0);

    const d = await prisma.debt.findUnique({ where: { id: debt.id } });
    expect(Number(d?.currentBalance)).toBe(100000); // back to originalBalance
    expect(await prisma.debtPayment.count()).toBe(0);
  });

  it('imported-transactions is a partial delete and never blanket-resets survivors', async () => {
    const account = await createAccount();
    await createTransaction(account.id, { imported: false });
    await createTransaction(account.id, { imported: true });
    // A holding is only zeroed by the full-wipe reset — a partial delete must leave it alone.
    const holding = await createHolding({ quantity: 5, costBasis: 100000 });

    const res = await req('DELETE', '/data-management/bulk?confirm=true', {
      categories: ['imported-transactions'],
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as BulkDeleteResponse;
    expect(data.deleted).toBe(1);
    expect(await prisma.transaction.count()).toBe(1); // non-imported survivor remains

    const h = await prisma.investmentHolding.findUnique({ where: { id: holding.id } });
    expect(Number(h?.quantity)).toBe(5); // untouched by the partial path
  });

  it('ignores unknown categories gracefully', async () => {
    const res = await req('DELETE', '/data-management/bulk?confirm=true', {
      categories: ['nonexistent-category'],
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as CountsResponse & BulkDeleteResponse;
    expect(data.deleted).toBe(0);
  });
});
