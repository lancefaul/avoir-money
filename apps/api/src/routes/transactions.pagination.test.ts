/**
 * Unit tests for cursor-based pagination on the transactions API.
 * Task 2.7: Deterministic edge-case tests.
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import {
  get,
  post,
  createGroup,
  createCategory,
  createExpense,
  createIncome,
  createAccount,
} from '../test/helpers.js';

interface PaginatedResponse {
  transactions: Array<{
    id: string;
    type: string;
    name: string;
    amount: number;
    date: string;
    payPeriodId: string | null;
    expenseId: string | null;
    incomeId: string | null;
    accountId: string;
    toAccountId: string | null;
    budgetId: string | null;
    note: string | null;
    createdAt: string;
  }>;
  totalCount: number;
  nextCursor: string | null;
  hasMore: boolean;
  anticipations?: unknown[];
}

describe('Transactions Pagination — Unit Tests', () => {
  // ─── Empty database ───

  it('empty database returns empty response with correct shape', async () => {
    const res = await get('/transactions?skipGenerate=true');
    expect(res.status).toBe(200);
    const body = (await res.json()) as PaginatedResponse;
    expect(body.transactions).toEqual([]);
    expect(body.totalCount).toBe(0);
    expect(body.nextCursor).toBeNull();
    expect(body.hasMore).toBe(false);
  });

  // ─── Single page (fewer than limit) ───

  it('single page of results returns hasMore false and nextCursor null', async () => {
    const acct = await createAccount();
    // Seed 3 transactions, request with limit=10
    for (let i = 0; i < 3; i++) {
      await post('/transactions', {
        type: 'EXPENSE',
        name: `Item_${i}`,
        amount: 100,
        date: '2026-03-15',
        accountId: acct.id,
      });
    }

    const res = await get(`/transactions?limit=10&skipGenerate=true&accountId=${acct.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PaginatedResponse;
    expect(body.transactions.length).toBe(3);
    expect(body.totalCount).toBe(3);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  // ─── Anticipations on first page only ───

  it('anticipations are included on first page (no cursor)', async () => {
    const acct = await createAccount();
    const group = await createGroup();
    const cat = await createCategory(group.id);
    const expense = await createExpense(cat.id, { frequency: 'MONTHLY' });

    await post('/transactions', {
      type: 'EXPENSE',
      name: 'Test',
      amount: 100,
      date: '2026-03-15',
      accountId: acct.id,
      expenseId: expense.id,
    });

    // First page — no cursor
    const res = await get(`/transactions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PaginatedResponse;
    // anticipations key should exist (may be empty array but must be present)
    expect('anticipations' in body).toBe(true);
    expect(Array.isArray(body.anticipations)).toBe(true);
  });

  it('anticipations are NOT included on subsequent pages (cursor provided)', async () => {
    const acct = await createAccount();
    // Seed enough transactions to produce a second page
    for (let i = 0; i < 5; i++) {
      const date = new Date(Date.UTC(2026, 2, 15 - i));
      await post('/transactions', {
        type: 'EXPENSE',
        name: `Page_${i}`,
        amount: 100,
        date: date.toISOString().slice(0, 10),
        accountId: acct.id,
      });
    }

    // First page with limit=2
    const firstRes = await get(`/transactions?limit=2&skipGenerate=true&accountId=${acct.id}`);
    expect(firstRes.status).toBe(200);
    const firstBody = (await firstRes.json()) as PaginatedResponse;
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.nextCursor).not.toBeNull();

    // Second page using cursor
    const secondRes = await get(
      `/transactions?limit=2&skipGenerate=true&cursor=${firstBody.nextCursor}&accountId=${acct.id}`,
    );
    expect(secondRes.status).toBe(200);
    const secondBody = (await secondRes.json()) as PaginatedResponse;
    // anticipations should NOT be present when cursor is provided
    expect(secondBody.anticipations).toBeUndefined();
  });

  // ─── Filter by accountId ───

  it('filter by accountId returns only transactions for that account with correct totalCount', async () => {
    const acct1 = await createAccount('Account1');
    const acct2 = await createAccount('Account2');

    // Seed 3 transactions in acct1, 2 in acct2
    for (let i = 0; i < 3; i++) {
      await post('/transactions', {
        type: 'EXPENSE',
        name: `Acct1_${i}`,
        amount: 100,
        date: '2026-03-15',
        accountId: acct1.id,
      });
    }
    for (let i = 0; i < 2; i++) {
      await post('/transactions', {
        type: 'EXPENSE',
        name: `Acct2_${i}`,
        amount: 200,
        date: '2026-03-15',
        accountId: acct2.id,
      });
    }

    const res = await get(`/transactions?accountId=${acct1.id}&skipGenerate=true`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PaginatedResponse;
    expect(body.totalCount).toBe(3);
    expect(body.transactions.length).toBe(3);
    for (const tx of body.transactions) {
      expect(tx.accountId).toBe(acct1.id);
    }
  });

  // ─── Filter by type ───

  it('filter by type returns only transactions of that type', async () => {
    const acct = await createAccount();
    const acct2 = await createAccount('Secondary');
    const group = await createGroup();
    const cat = await createCategory(group.id);
    const income = await createIncome(cat.id);

    // Create one EXPENSE, one INCOME, one TRANSFER
    await post('/transactions', {
      type: 'EXPENSE',
      name: 'Expense1',
      amount: 100,
      date: '2026-03-15',
      accountId: acct.id,
    });
    await post('/transactions', {
      type: 'INCOME',
      name: 'Income1',
      amount: 5000,
      date: '2026-03-15',
      incomeId: income.id,
      accountId: acct.id,
    });
    await post('/transactions', {
      type: 'TRANSFER',
      name: 'Transfer1',
      amount: 500,
      date: '2026-03-15',
      accountId: acct.id,
      toAccountId: acct2.id,
    });

    // Filter for EXPENSE only
    const res = await get('/transactions?type=EXPENSE&skipGenerate=true');
    expect(res.status).toBe(200);
    const body = (await res.json()) as PaginatedResponse;
    expect(body.totalCount).toBe(1);
    expect(body.transactions.length).toBe(1);
    expect(body.transactions[0]!.type).toBe('EXPENSE');

    // Filter for INCOME only
    const incomeRes = await get('/transactions?type=INCOME&skipGenerate=true');
    expect(incomeRes.status).toBe(200);
    const incomeBody = (await incomeRes.json()) as PaginatedResponse;
    expect(incomeBody.totalCount).toBe(1);
    expect(incomeBody.transactions[0]!.type).toBe('INCOME');

    // Filter for TRANSFER only
    const transferRes = await get('/transactions?type=TRANSFER&skipGenerate=true');
    expect(transferRes.status).toBe(200);
    const transferBody = (await transferRes.json()) as PaginatedResponse;
    expect(transferBody.totalCount).toBe(1);
    expect(transferBody.transactions[0]!.type).toBe('TRANSFER');
  });
});
