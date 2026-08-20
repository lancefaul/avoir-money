import { describe, it, expect } from 'vitest';
import {
  get,
  post,
  put,
  del,
  createAccount,
  createTransaction,
  createBudgetGroup,
  createBudget,
  createExpense,
  createIncome,
} from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';

describe('Accounts API', () => {
  describe('GET /accounts', () => {
    it('returns empty list initially', async () => {
      const res = await get('/accounts');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });
  });

  describe('POST /accounts', () => {
    it('creates an account', async () => {
      const res = await post('/accounts', { name: 'Checking', type: 'CHECKING', balance: 1000 });
      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.name).toBe('Checking');
      expect(body.type).toBe('CHECKING');
      expect(body.balance).toBe(1000);
      expect(body.id).toBeDefined();
    });

    it('defaults balance to 0', async () => {
      const res = await post('/accounts', { name: 'Savings', type: 'SAVINGS' });
      expect(res.status).toBe(201);
      expect(((await res.json()) as any).balance).toBe(0);
    });
  });

  describe('PUT /accounts/:id', () => {
    it('updates an account', async () => {
      const create = await post('/accounts', { name: 'Old', type: 'CHECKING' });
      const { id } = (await create.json()) as any;
      const res = await put(`/accounts/${id}`, { name: 'New Name' });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).name).toBe('New Name');
    });

    it('returns 404 for missing account', async () => {
      const res = await put('/accounts/nonexistent', { name: 'X' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /accounts (after creates)', () => {
    it('lists all accounts', async () => {
      await post('/accounts', { name: 'A', type: 'CHECKING' });
      await post('/accounts', { name: 'B', type: 'SAVINGS' });
      const res = await get('/accounts');
      const body: any = await res.json();
      expect(body).toHaveLength(2);
    });
  });

  // ─── Archive / Unarchive ───

  describe('POST /accounts/:id/archive', () => {
    it('archives an account and returns 200', async () => {
      const account = await createAccount('ArchiveMe');
      const res = await post(`/accounts/${account.id}/archive`, {});
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.archived).toBe(true);
      expect(body.id).toBe(account.id);

      // Verify DB state
      const dbAccount = await prisma.account.findUnique({ where: { id: account.id } });
      expect(dbAccount!.archived).toBe(true);
    });

    it('returns 404 for non-existent account', async () => {
      const res = await post('/accounts/nonexistent/archive', {});
      expect(res.status).toBe(404);
    });
  });

  describe('POST /accounts/:id/unarchive', () => {
    it('unarchives an archived account and returns 200', async () => {
      const account = await createAccount('UnarchiveMe');
      // Archive first
      await post(`/accounts/${account.id}/archive`, {});
      // Unarchive
      const res = await post(`/accounts/${account.id}/unarchive`, {});
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.archived).toBe(false);
      expect(body.id).toBe(account.id);

      // Verify DB state
      const dbAccount = await prisma.account.findUnique({ where: { id: account.id } });
      expect(dbAccount!.archived).toBe(false);
    });

    it('returns 404 for non-existent account', async () => {
      const res = await post('/accounts/nonexistent/unarchive', {});
      expect(res.status).toBe(404);
    });
  });

  // ─── Transaction Count ───

  describe('GET /accounts/:id/transaction-count', () => {
    it('returns count of transactions for an account', async () => {
      const account = await createAccount('CountMe');
      await createTransaction(account.id);
      await createTransaction(account.id);

      const res = await get(`/accounts/${account.id}/transaction-count`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.count).toBe(2);
    });

    it('returns 0 for account with no transactions', async () => {
      const account = await createAccount('Empty');
      const res = await get(`/accounts/${account.id}/transaction-count`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.count).toBe(0);
    });
  });

  // ─── Delete ───

  describe('DELETE /accounts/:id', () => {
    it('deletes account and its transactions, returns 204', async () => {
      const account = await createAccount('DeleteMe');
      await createTransaction(account.id);
      await createTransaction(account.id);

      const res = await del(`/accounts/${account.id}`);
      expect(res.status).toBe(204);

      // Verify account is gone
      const dbAccount = await prisma.account.findUnique({ where: { id: account.id } });
      expect(dbAccount).toBeNull();

      // Verify transactions are gone
      const txCount = await prisma.transaction.count({ where: { accountId: account.id } });
      expect(txCount).toBe(0);
    });

    it('unlinks expenses and incomes from deleted account', async () => {
      const account = await createAccount('UnlinkMe');
      const group = await createBudgetGroup();
      const budget = await createBudget(group.id);
      const expense = await createExpense(budget.id, { accountId: account.id });
      const income = await createIncome(budget.id, { accountId: account.id });

      const res = await del(`/accounts/${account.id}`);
      expect(res.status).toBe(204);

      // Verify expense and income accountId set to null
      const dbExpense = await prisma.expense.findUnique({ where: { id: expense.id } });
      expect(dbExpense!.accountId).toBeNull();
      const dbIncome = await prisma.income.findUnique({ where: { id: income.id } });
      expect(dbIncome!.accountId).toBeNull();
    });

    it('returns 404 for non-existent account', async () => {
      const res = await del('/accounts/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  // ─── GET single account ───

  describe('GET /accounts/:id', () => {
    it('returns a single account by ID', async () => {
      const account = await createAccount('SingleGet', 'SAVINGS');
      const res = await get(`/accounts/${account.id}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.id).toBe(account.id);
      expect(body.name).toBe('SingleGet');
      expect(body.type).toBe('SAVINGS');
    });

    it('returns 404 for non-existent account', async () => {
      const res = await get('/accounts/nonexistent');
      expect(res.status).toBe(404);
    });
  });
});
