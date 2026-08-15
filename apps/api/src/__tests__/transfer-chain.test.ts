/**
 * Regression tests for the transfer DESTINATION balance-chain (2026-07-27).
 *
 * A transfer has two chains: the source account it leaves and the destination it
 * arrives at. The source chain was maintained correctly (getPreviousBalanceAfter
 * + recalculateChainForward), but the destination's `toBalanceBefore/After` were
 * computed from the destination's CURRENT running total — a shortcut that only
 * holds when the transfer is the last row on the destination. For a mid-chain
 * transfer — later rows on the destination, or (the reported bug) a credit-card
 * payment whose DATE was moved earlier — that read the wrong balance and
 * re-seeded the destination chain from that point.
 *
 * The fix derives the destination chain from the transfer's own position and
 * propagates the destination chain forward on create / update / delete.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { ledgerCreate, ledgerUpdate, ledgerDelete } from '../lib/lifecycle/index.js';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

async function acct(type: string, opening: number) {
  return prisma.account.create({
    data: {
      name: `xfer-${type}-${Date.now()}-${Math.random()}`,
      type,
      balance: opening,
      openingBalance: opening,
    },
  });
}

function utc(day: number): Date {
  return new Date(Date.UTC(2026, 6, day));
}

const num = (v: { toNumber(): number } | null) => (v == null ? null : v.toNumber());

describe('transfer destination chain', () => {
  it('chains an inbound transfer from its position; later destination rows follow', async () => {
    const src = await acct('Checking', 1000);
    const dst = await acct('Credit Card', 0);

    const c1 = await ledgerCreate({
      type: 'EXPENSE',
      name: 'c1',
      amount: 100,
      date: utc(10),
      accountId: dst.id,
      imported: false,
    }); // dst -100
    const pay = await ledgerCreate({
      type: 'TRANSFER',
      name: 'payment',
      amount: 50,
      date: utc(11),
      accountId: src.id,
      toAccountId: dst.id,
      imported: false,
    }); // +50 -> -50
    const c2 = await ledgerCreate({
      type: 'EXPENSE',
      name: 'c2',
      amount: 20,
      date: utc(12),
      accountId: dst.id,
      imported: false,
    }); // -70

    const rp = await prisma.transaction.findUniqueOrThrow({ where: { id: pay.id } });
    const r2 = await prisma.transaction.findUniqueOrThrow({ where: { id: c2.id } });
    void c1;

    expect(num(rp.toBalanceBefore)).toBe(-100);
    expect(num(rp.toBalanceAfter)).toBe(-50);
    expect(num(r2.balanceBefore)).toBe(-50);
    expect(num(r2.balanceAfter)).toBe(-70);
  });

  it('moving a transfer date earlier keeps the destination chain consistent (the card-payment-date bug)', async () => {
    const src = await acct('Checking', 1000);
    const dst = await acct('Credit Card', 0);

    // src has prior activity, so the transfer takes the MAIN path (not the
    // first-row null-branch) — this is the user's exact scenario, and the path
    // where the old "use the destination's running total" shortcut lived.
    await ledgerCreate({
      type: 'INCOME',
      name: 'deposit',
      amount: 500,
      date: utc(1),
      accountId: src.id,
      imported: false,
    });

    const c1 = await ledgerCreate({
      type: 'EXPENSE',
      name: 'c1',
      amount: 100,
      date: utc(10),
      accountId: dst.id,
      imported: false,
    });
    const c2 = await ledgerCreate({
      type: 'EXPENSE',
      name: 'c2',
      amount: 20,
      date: utc(12),
      accountId: dst.id,
      imported: false,
    });
    // Payment created at the END of the chain (day 15).
    const pay = await ledgerCreate({
      type: 'TRANSFER',
      name: 'payment',
      amount: 50,
      date: utc(15),
      accountId: src.id,
      toAccountId: dst.id,
      imported: false,
    });

    // Move it to day 11 — between the two charges. This is the edit that broke.
    await ledgerUpdate(pay.id, { date: utc(11) });

    const r1 = await prisma.transaction.findUniqueOrThrow({ where: { id: c1.id } });
    const rp = await prisma.transaction.findUniqueOrThrow({ where: { id: pay.id } });
    const r2 = await prisma.transaction.findUniqueOrThrow({ where: { id: c2.id } });

    // dst chain: 0 -> -100 (c1, d10) -> -50 (payment, d11) -> -70 (c2, d12)
    expect(num(r1.balanceAfter)).toBe(-100);
    expect(num(rp.toBalanceBefore)).toBe(-100);
    expect(num(rp.toBalanceAfter)).toBe(-50);
    expect(num(r2.balanceBefore)).toBe(-50);
    expect(num(r2.balanceAfter)).toBe(-70);
  });

  it('deleting a transfer repropagates the destination chain', async () => {
    const src = await acct('Checking', 1000);
    const dst = await acct('Credit Card', 0);

    await ledgerCreate({
      type: 'EXPENSE',
      name: 'c1',
      amount: 100,
      date: utc(10),
      accountId: dst.id,
      imported: false,
    });
    const pay = await ledgerCreate({
      type: 'TRANSFER',
      name: 'payment',
      amount: 50,
      date: utc(11),
      accountId: src.id,
      toAccountId: dst.id,
      imported: false,
    });
    const c2 = await ledgerCreate({
      type: 'EXPENSE',
      name: 'c2',
      amount: 20,
      date: utc(12),
      accountId: dst.id,
      imported: false,
    });

    await ledgerDelete(pay.id);

    // Payment gone: dst chain is 0 -> -100 (c1) -> -120 (c2).
    const r2 = await prisma.transaction.findUniqueOrThrow({ where: { id: c2.id } });
    expect(num(r2.balanceBefore)).toBe(-100);
    expect(num(r2.balanceAfter)).toBe(-120);
  });
});
