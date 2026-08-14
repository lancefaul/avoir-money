import { describe, it, expect } from 'vitest';
import { post, put } from '../../../test/helpers.js';
import { createAccount, createBudgetGroup, createBudget } from '../../../test/helpers.js';
import { prisma } from '@budget-tracker/db';

/**
 * Integration tests for the system-budget lifecycle hook.
 *
 * Strategy: create transactions through the API routes so the lifecycle hooks
 * fire naturally, then verify the system budget assignment behavior.
 */
describe('System Budget Lifecycle Hook', () => {
  async function seedSystemBudgets() {
    // Create a budget group for system budgets
    const group = await createBudgetGroup();

    // Create system budgets for INCOME, TRADE, and TRANSFER types
    const incomeBudget = await prisma.budget.create({
      data: {
        name: 'Income',
        isSystem: true,
        groupId: group.id,
      },
    });

    const tradeBudget = await prisma.budget.create({
      data: {
        name: 'Trade',
        isSystem: true,
        groupId: group.id,
      },
    });

    const transferBudget = await prisma.budget.create({
      data: {
        name: 'Transfer',
        isSystem: true,
        groupId: group.id,
      },
    });

    return { incomeBudget, tradeBudget, transferBudget };
  }

  // ─── created event ───

  describe('created event', () => {
    it('assigns "Income" system budget when creating an INCOME transaction', async () => {
      const { incomeBudget } = await seedSystemBudgets();
      const account = await createAccount();

      const res = await post('/transactions', {
        type: 'INCOME',
        name: 'Salary',
        amount: 5000,
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        accountId: account.id,
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();

      // Verify the system budget was assigned (API returns as budgetId)
      expect(body.budgetId).toBe(incomeBudget.id);
    });

    it('assigns "Trade" system budget when creating a TRADE transaction', async () => {
      const { tradeBudget } = await seedSystemBudgets();

      // Create a proper test with valid data
      const custodian = await prisma.custodian.create({
        data: { name: 'Test Custodian' },
      });
      const account = await createAccount();

      const res = await post('/transactions', {
        type: 'TRADE',
        name: 'Buy AAPL',
        amount: 1000,
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        accountId: account.id,
        tradeMetadata: {
          direction: 'BUY',
          assetType: 'Stock',
          ticker: 'AAPL',
          unitPrice: 100,
          quantity: 10,
          custodianId: custodian.id,
        },
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();

      // Verify the system budget was assigned (API returns as budgetId)
      expect(body.budgetId).toBe(tradeBudget.id);
    });

    it('assigns "Transfer" system budget when creating a TRANSFER transaction', async () => {
      const { transferBudget } = await seedSystemBudgets();
      const fromAccount = await createAccount();
      const toAccount = await createAccount();

      const res = await post('/transactions', {
        type: 'TRANSFER',
        name: 'Move funds',
        amount: 500,
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        accountId: fromAccount.id,
        toAccountId: toAccount.id,
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();

      // Verify the system budget was assigned (API returns as budgetId)
      expect(body.budgetId).toBe(transferBudget.id);
    });

    it('does not assign a system budget for EXPENSE transactions', async () => {
      await seedSystemBudgets();
      const account = await createAccount();
      const group = await createBudgetGroup();
      const budget = await createBudget(group.id);

      const res = await post('/transactions', {
        type: 'EXPENSE',
        name: 'Groceries',
        amount: 100,
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        accountId: account.id,
        budgetId: budget.id,
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();

      // Verify the budget remains as provided (not overridden by system budget, API returns as budgetId)
      expect(body.budgetId).toBe(budget.id);
    });
  });

  // ─── updated event ───

  describe('updated event', () => {
    it('assigns "Income" system budget when transaction type changes to INCOME', async () => {
      const { incomeBudget } = await seedSystemBudgets();
      const account = await createAccount();
      const group = await createBudgetGroup();
      const budget = await createBudget(group.id);

      // Create an EXPENSE transaction
      const createRes = await post('/transactions', {
        type: 'EXPENSE',
        name: 'Payment',
        amount: 500,
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        accountId: account.id,
        budgetId: budget.id,
      });

      expect(createRes.status).toBe(201);
      const created: any = await createRes.json();
      expect(created.budgetId).toBe(budget.id);

      // Update the transaction type to INCOME
      const updateRes = await put(`/transactions/${created.id}`, {
        type: 'INCOME',
      });

      expect(updateRes.status).toBe(200);
      const updated: any = await updateRes.json();

      // Verify the system budget was assigned (API returns as budgetId)
      expect(updated.budgetId).toBe(incomeBudget.id);
    });

    it('does not reassign budget when transaction type does not change', async () => {
      const { incomeBudget } = await seedSystemBudgets();
      const account = await createAccount();

      // Create an INCOME transaction
      const createRes = await post('/transactions', {
        type: 'INCOME',
        name: 'Salary',
        amount: 5000,
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        accountId: account.id,
      });

      expect(createRes.status).toBe(201);
      const created: any = await createRes.json();
      expect(created.budgetId).toBe(incomeBudget.id);

      // Update the transaction amount (type remains INCOME)
      const updateRes = await put(`/transactions/${created.id}`, {
        amount: 6000,
      });

      expect(updateRes.status).toBe(200);
      const updated: any = await updateRes.json();

      // Verify the budget remains the same (hook condition returns false, API returns as budgetId)
      expect(updated.budgetId).toBe(incomeBudget.id);

      // Verify the hook didn't run by checking that only the amount changed
      const dbRecord = await prisma.transaction.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(Number(dbRecord.amount)).toBe(6000);
      expect(dbRecord.budgetId).toBe(incomeBudget.id);
    });

    it('assigns system budget when changing from EXPENSE to TRADE', async () => {
      const { tradeBudget } = await seedSystemBudgets();
      const account = await createAccount();
      const group = await createBudgetGroup();
      const budget = await createBudget(group.id);
      const custodian = await prisma.custodian.create({
        data: { name: 'Test Custodian' },
      });

      // Create an EXPENSE transaction
      const createRes = await post('/transactions', {
        type: 'EXPENSE',
        name: 'Payment',
        amount: 1000,
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        accountId: account.id,
        budgetId: budget.id,
      });

      expect(createRes.status).toBe(201);
      const created: any = await createRes.json();
      expect(created.budgetId).toBe(budget.id);

      // Update the transaction type to TRADE
      const updateRes = await put(`/transactions/${created.id}`, {
        type: 'TRADE',
        tradeMetadata: {
          direction: 'BUY',
          assetType: 'Stock',
          ticker: 'AAPL',
          unitPrice: 100,
          quantity: 10,
          custodianId: custodian.id,
        },
      });

      expect(updateRes.status).toBe(200);
      const updated: any = await updateRes.json();

      // Verify the system budget was assigned (API returns as budgetId)
      expect(updated.budgetId).toBe(tradeBudget.id);
    });
  });
});
