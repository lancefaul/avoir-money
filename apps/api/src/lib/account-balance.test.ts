/**
 * Integration tests for the account balance recomputation helpers extracted from
 * routes/accounts.ts. DB-backed (test DB, port 5433). Seeds an account with
 * deliberately wrong balance/chain values, runs the helper, and verifies the
 * corrected result — the same fixture style as rebuild-balance-chain-backward.test.ts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { makeDate } from './dates.js';
import { createTransaction } from '../test/helpers.js';
import { recalculateAccountBalance, rebuildBalanceChain } from './account-balance.js';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

async function freshAccount(balance: number) {
  return prisma.account.create({
    data: {
      name: `PBT account-balance ${Date.now()}_${Math.random()}`,
      type: 'CHECKING',
      balance,
    },
  });
}

describe('recalculateAccountBalance', () => {
  it('returns null for a missing account', async () => {
    expect(await recalculateAccountBalance('does-not-exist')).toBeNull();
  });

  it('recomputes the balance from source transactions and inbound transfers', async () => {
    const account = await freshAccount(0); // deliberately wrong starting balance
    const other = await freshAccount(0);

    await createTransaction(account.id, {
      type: 'INCOME',
      amount: 500,
      netAmount: 500,
      date: makeDate(2026, 0, 1),
    });
    await createTransaction(account.id, {
      type: 'EXPENSE',
      amount: 200,
      netAmount: 200,
      date: makeDate(2026, 0, 2),
    });
    // Inbound transfer FROM `other` TO `account` adds to account's balance.
    await createTransaction(other.id, {
      type: 'TRANSFER',
      amount: 75,
      netAmount: 75,
      date: makeDate(2026, 0, 3),
      toAccountId: account.id,
    });

    const result = await recalculateAccountBalance(account.id);
    expect(result).not.toBeNull();
    expect(result!.oldBalance).toBe(0);
    expect(result!.newBalance).toBe(375); // 500 - 200 + 75
    expect(result!.difference).toBe(375);

    const reread = await prisma.account.findUnique({ where: { id: account.id } });
    expect(Number(reread!.balance)).toBe(375);
  });
});

describe('rebuildBalanceChain', () => {
  it('returns null for a missing account', async () => {
    expect(await rebuildBalanceChain('does-not-exist')).toBeNull();
  });

  it('rebuilds an internally consistent balanceBefore/balanceAfter chain', async () => {
    const account = await freshAccount(0);

    const tx1 = await createTransaction(account.id, {
      type: 'INCOME',
      amount: 1000,
      netAmount: 1000,
      date: makeDate(2026, 0, 1),
      balanceBefore: -9999,
      balanceAfter: -9999,
    });
    const tx2 = await createTransaction(account.id, {
      type: 'EXPENSE',
      amount: 400,
      netAmount: 400,
      date: makeDate(2026, 0, 2),
      balanceBefore: -9999,
      balanceAfter: -9999,
    });

    const result = await rebuildBalanceChain(account.id);
    expect(result).not.toBeNull();
    expect(result!.finalBalance).toBe(600);
    expect(result!.updatedTransactions).toBe(2);

    const r1 = await prisma.transaction.findUnique({ where: { id: tx1.id } });
    const r2 = await prisma.transaction.findUnique({ where: { id: tx2.id } });
    expect(Number(r1!.balanceBefore)).toBe(0);
    expect(Number(r1!.balanceAfter)).toBe(1000);
    expect(Number(r2!.balanceBefore)).toBe(1000);
    expect(Number(r2!.balanceAfter)).toBe(600);

    const reread = await prisma.account.findUnique({ where: { id: account.id } });
    expect(Number(reread!.balance)).toBe(600);
  });
});
