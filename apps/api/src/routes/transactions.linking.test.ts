import { describe, it, expect } from 'vitest';
import {
  post,
  del,
  createAccount,
  createBudgetGroup,
  createBudget,
  createExpense,
  createIncome,
  createTransaction,
} from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';

describe('Transaction Linking API', () => {
  /** Seed the full data chain: account → budget group → budget → expense/income → transaction */
  async function setup() {
    const account = await createAccount();
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const expense = await createExpense(budget.id);
    const income = await createIncome(budget.id);
    const transaction = await createTransaction(account.id);
    return { account, group, budget, expense, income, transaction };
  }

  // ─── POST /:id/link ───

  describe('POST /transactions/:id/link', () => {
    it('links a transaction to an expense — sets expenseId, budgetId, returns 200', async () => {
      const { budget, expense, transaction } = await setup();

      const res = await post(`/transactions/${transaction.id}/link`, {
        expenseId: expense.id,
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.expenseId).toBe(expense.id);
      expect(body.budgetId).toBe(budget.id);

      // Verify DB state
      const dbTx = await prisma.transaction.findUnique({ where: { id: transaction.id } });
      expect(dbTx!.expenseId).toBe(expense.id);
      expect(dbTx!.budgetId).toBe(budget.id);
    });

    it('links a transaction to an income — sets incomeId, budgetId, returns 200', async () => {
      const { budget, income, transaction } = await setup();

      const res = await post(`/transactions/${transaction.id}/link`, {
        incomeId: income.id,
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.incomeId).toBe(income.id);
      expect(body.budgetId).toBe(budget.id);

      // Verify DB state
      const dbTx = await prisma.transaction.findUnique({ where: { id: transaction.id } });
      expect(dbTx!.incomeId).toBe(income.id);
      expect(dbTx!.budgetId).toBe(budget.id);
    });

    it('returns 409 when another transaction is already linked to the same expense on the same date', async () => {
      const { account, expense, transaction } = await setup();

      // Link the first transaction
      await post(`/transactions/${transaction.id}/link`, { expenseId: expense.id });

      // Create a second transaction on the same date
      const tx2 = await createTransaction(account.id, { date: transaction.date });

      // Attempt to link the second transaction to the same expense
      const res = await post(`/transactions/${tx2.id}/link`, { expenseId: expense.id });
      expect(res.status).toBe(409);
      const body: any = await res.json();
      expect(body.error).toContain('already linked');
    });

    it('returns 404 for a non-existent transaction ID', async () => {
      const { expense } = await setup();

      const res = await post('/transactions/nonexistent-id/link', {
        expenseId: expense.id,
      });
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('Transaction not found');
    });

    it('returns 404 when expenseId does not exist', async () => {
      const { transaction } = await setup();

      const res = await post(`/transactions/${transaction.id}/link`, {
        expenseId: 'nonexistent-expense-id',
      });
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toBe('Expense not found');
    });
  });

  // ─── DELETE /:id/link ───

  describe('DELETE /transactions/:id/link', () => {
    it('unlinks an expense-linked transaction — sets expenseId/incomeId to null, returns 200', async () => {
      const { expense, transaction } = await setup();

      // First link the transaction
      await post(`/transactions/${transaction.id}/link`, { expenseId: expense.id });

      // Verify it's linked
      const linked = await prisma.transaction.findUnique({ where: { id: transaction.id } });
      expect(linked!.expenseId).toBe(expense.id);

      // Unlink
      const res = await del(`/transactions/${transaction.id}/link`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.expenseId).toBeNull();
      expect(body.incomeId).toBeNull();

      // Verify DB state
      const dbTx = await prisma.transaction.findUnique({ where: { id: transaction.id } });
      expect(dbTx!.expenseId).toBeNull();
      expect(dbTx!.incomeId).toBeNull();
    });

    it('returns 400 when transaction is not linked to any recurring source', async () => {
      const { transaction } = await setup();

      const res = await del(`/transactions/${transaction.id}/link`);
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toBe('Transaction is not linked to any recurring source');
    });

    it('returns 404 for a non-existent transaction ID', async () => {
      await setup();

      const res = await del('/transactions/nonexistent-id/link');
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('Transaction not found');
    });
  });
});
