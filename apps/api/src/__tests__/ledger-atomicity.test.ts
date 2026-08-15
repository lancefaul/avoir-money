/**
 * The ledger gate accepts an interactive-transaction client so a multi-row write
 * — a payment-split purchase group — commits or rolls back as one unit.
 *
 * This is the prerequisite the payment-split feature is built on: without the
 * client reaching the balance hook, a failed group would roll back its rows but
 * leave the balances moved — a half-written group indistinguishable from a real
 * discrepancy, which is the whole thing the ledger discipline exists to prevent.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { ledgerCreate } from '../lib/lifecycle/index.js';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

let n = 0;
async function makeAccount(balance: number): Promise<{ id: string }> {
  return prisma.account.create({
    data: {
      name: `__atom_${Date.now()}_${++n}`,
      type: 'CHECKING',
      balance,
      openingBalance: balance,
    },
    select: { id: true },
  });
}

const utc = (d: number) => new Date(Date.UTC(2026, 0, d));

const balanceOf = async (id: string): Promise<number> =>
  Number((await prisma.account.findUniqueOrThrow({ where: { id } })).balance);

describe('ledger gate — interactive transaction client', () => {
  it('rolls back every row AND every balance movement when a group write throws', async () => {
    const account = await makeAccount(100);
    expect(await balanceOf(account.id)).toBe(100);

    // Two legs created inside one $transaction, then a throw on the third step.
    // The balance hook ran on the transaction client for both legs, so the whole
    // thing must unwind — no rows, balance back at 100.
    await expect(
      prisma.$transaction(async (tx) => {
        await ledgerCreate(
          { type: 'EXPENSE', name: 'leg 1', amount: 10, date: utc(1), accountId: account.id },
          tx,
        );
        await ledgerCreate(
          { type: 'EXPENSE', name: 'leg 2', amount: 20, date: utc(1), accountId: account.id },
          tx,
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await prisma.transaction.count({ where: { accountId: account.id } })).toBe(0);
    expect(await balanceOf(account.id)).toBe(100);
  });

  it('commits every row and balance movement when the group write succeeds (control)', async () => {
    const account = await makeAccount(100);

    await prisma.$transaction(async (tx) => {
      await ledgerCreate(
        { type: 'EXPENSE', name: 'leg 1', amount: 10, date: utc(1), accountId: account.id },
        tx,
      );
      await ledgerCreate(
        { type: 'EXPENSE', name: 'leg 2', amount: 20, date: utc(1), accountId: account.id },
        tx,
      );
    });

    expect(await prisma.transaction.count({ where: { accountId: account.id } })).toBe(2);
    // Both debits applied: 100 − 10 − 20.
    expect(await balanceOf(account.id)).toBe(70);

    // And the invariant holds: openingBalance + SUM(tx) == balance.
    const rows = await prisma.transaction.findMany({
      where: { accountId: account.id },
      select: { netAmount: true },
    });
    const txSum = rows.reduce((s, r) => s - Number(r.netAmount), 0); // both EXPENSE
    expect(100 + txSum).toBe(70);
  });

  it('leaves existing behavior unchanged when called without a client (default prisma)', async () => {
    const account = await makeAccount(50);
    await ledgerCreate({
      type: 'EXPENSE',
      name: 'plain',
      amount: 5,
      date: utc(2),
      accountId: account.id,
    });
    expect(await balanceOf(account.id)).toBe(45);
    expect(await prisma.transaction.count({ where: { accountId: account.id } })).toBe(1);
  });
});
