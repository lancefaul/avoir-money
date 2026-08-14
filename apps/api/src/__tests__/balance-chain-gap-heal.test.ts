/**
 * Regression tests for the balance-chain gap heal (2026-07-17).
 *
 * Background: a create that ran during the TradeDetail deploy window (2026-07-15)
 * landed with NULL balanceBefore/balanceAfter. Because getPreviousBalanceAfter
 * treats a NULL predecessor as "don't write" (the ADR-014 null boundary), every
 * subsequent create on that account also stayed NULL — one poisoned row silently
 * broke the chain forever. NULLs are only supposed to exist as a pre-chain
 * PREFIX (cleared history); a NULL between two chained rows is corruption.
 *
 * The fix: when a create/update finds a NULL predecessor, it looks back for the
 * most recent chained row (the anchor) and recomputes forward from it, writing
 * through the NULL gap.
 *
 * Update (2026-07-27): a NULL predecessor with NO anchor no longer stays
 * unchained. That case is a chain that was never seeded — a brand-new account's
 * first-ever transaction (the X Money bug: one INCOME row with blank
 * balanceBefore/balanceAfter), or an all-NULL account. Now the hook seeds from
 * `openingBalance` and builds forward, the same rule `rebuildBalanceChain` uses.
 * The old "pre-chain prefix stays NULL" behaviour predated `openingBalance`;
 * with an explicit opening there is no unknowable prefix left to leave blank.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { ledgerCreate, ledgerUpdate } from '../lib/lifecycle/index.js';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

async function freshAccount(balance: number) {
  return prisma.account.create({
    data: { name: `gap-heal-${Date.now()}-${Math.random()}`, type: 'Credit Card', balance },
  });
}

function utc(day: number): Date {
  return new Date(Date.UTC(2026, 6, day));
}

describe('balance chain gap heal', () => {
  it('chains a create off a healthy predecessor (baseline)', async () => {
    const acct = await freshAccount(-100);
    const tx1 = await ledgerCreate({
      type: 'EXPENSE',
      name: 'seed',
      amount: 10,
      date: utc(10),
      accountId: acct.id,
      imported: false,
    });
    await prisma.transaction.update({
      where: { id: tx1.id },
      data: { balanceBefore: -100, balanceAfter: -110 },
    });

    const tx2 = await ledgerCreate({
      type: 'EXPENSE',
      name: 'next',
      amount: 5,
      date: utc(11),
      accountId: acct.id,
      imported: false,
    });
    const r2 = await prisma.transaction.findUniqueOrThrow({ where: { id: tx2.id } });
    expect(Number(r2.balanceBefore)).toBe(-110);
    expect(Number(r2.balanceAfter)).toBe(-115);
  });

  it('heals a mid-chain NULL gap on the next create (repairs the gap rows too)', async () => {
    const acct = await freshAccount(-100);
    // Anchor: chained row
    const anchor = await ledgerCreate({
      type: 'EXPENSE',
      name: 'anchor',
      amount: 10,
      date: utc(10),
      accountId: acct.id,
      imported: false,
    });
    await prisma.transaction.update({
      where: { id: anchor.id },
      data: { balanceBefore: -100, balanceAfter: -110 },
    });

    // Two poisoned rows (simulating creates during the broken deploy window)
    const gap1 = await ledgerCreate({
      type: 'EXPENSE',
      name: 'gap-1',
      amount: 5,
      date: utc(11),
      accountId: acct.id,
      imported: false,
    });
    const gap2 = await ledgerCreate({
      type: 'REFUND',
      name: 'gap-2',
      amount: 3,
      date: utc(12),
      accountId: acct.id,
      imported: false,
    });
    await prisma.transaction.updateMany({
      where: { id: { in: [gap1.id, gap2.id] } },
      data: { balanceBefore: null, balanceAfter: null },
    });

    // New create — previously stayed NULL forever; now heals the whole tail.
    const tx = await ledgerCreate({
      type: 'EXPENSE',
      name: 'healer',
      amount: 2,
      date: utc(13),
      accountId: acct.id,
      imported: false,
    });

    const g1 = await prisma.transaction.findUniqueOrThrow({ where: { id: gap1.id } });
    const g2 = await prisma.transaction.findUniqueOrThrow({ where: { id: gap2.id } });
    const t = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    // anchor -110 → gap1 (-5) → -115 → gap2 (+3, refund) → -112 → healer (-2) → -114
    expect(Number(g1.balanceBefore)).toBe(-110);
    expect(Number(g1.balanceAfter)).toBe(-115);
    expect(Number(g2.balanceBefore)).toBe(-115);
    expect(Number(g2.balanceAfter)).toBe(-112);
    expect(Number(t.balanceBefore)).toBe(-112);
    expect(Number(t.balanceAfter)).toBe(-114);
  });

  it('heals on update of a row whose predecessor is a mid-chain NULL', async () => {
    const acct = await freshAccount(-100);
    const anchor = await ledgerCreate({
      type: 'EXPENSE',
      name: 'anchor',
      amount: 10,
      date: utc(10),
      accountId: acct.id,
      imported: false,
    });
    await prisma.transaction.update({
      where: { id: anchor.id },
      data: { balanceBefore: -100, balanceAfter: -110 },
    });
    const gap = await ledgerCreate({
      type: 'EXPENSE',
      name: 'gap',
      amount: 5,
      date: utc(11),
      accountId: acct.id,
      imported: false,
    });
    const tail = await ledgerCreate({
      type: 'EXPENSE',
      name: 'tail',
      amount: 4,
      date: utc(12),
      accountId: acct.id,
      imported: false,
    });
    await prisma.transaction.updateMany({
      where: { id: { in: [gap.id, tail.id] } },
      data: { balanceBefore: null, balanceAfter: null },
    });

    // Updating the tail row triggers the heal from the anchor
    await ledgerUpdate(tail.id, { amount: 6 });

    const g = await prisma.transaction.findUniqueOrThrow({ where: { id: gap.id } });
    const t = await prisma.transaction.findUniqueOrThrow({ where: { id: tail.id } });
    // anchor -110 → gap (-5) → -115 → tail (-6) → -121
    expect(Number(g.balanceBefore)).toBe(-110);
    expect(Number(g.balanceAfter)).toBe(-115);
    expect(Number(t.balanceBefore)).toBe(-115);
    expect(Number(t.balanceAfter)).toBe(-121);
  });

  it('seeds the first-ever transaction from openingBalance (the X Money bug)', async () => {
    // A brand-new account, exactly like X Money: openingBalance 0, one INCOME.
    // This used to leave balanceBefore/balanceAfter blank forever.
    const acct = await prisma.account.create({
      data: {
        name: `first-seed-${Date.now()}-${Math.random()}`,
        type: 'Checking',
        balance: 0,
        openingBalance: 0,
      },
    });
    const tx = await ledgerCreate({
      type: 'INCOME',
      name: 'X Money',
      amount: 15,
      date: utc(27),
      accountId: acct.id,
      imported: false,
    });
    const r = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(Number(r.balanceBefore)).toBe(0);
    expect(Number(r.balanceAfter)).toBe(15);
  });

  it('seeds the first-ever transaction from a NONZERO openingBalance (not zero)', async () => {
    const acct = await prisma.account.create({
      data: {
        name: `first-seed-nonzero-${Date.now()}-${Math.random()}`,
        type: 'Checking',
        balance: 500,
        openingBalance: 500,
      },
    });
    const tx1 = await ledgerCreate({
      type: 'EXPENSE',
      name: 'first',
      amount: 200,
      date: utc(10),
      accountId: acct.id,
      imported: false,
    });
    const tx2 = await ledgerCreate({
      type: 'EXPENSE',
      name: 'second',
      amount: 50,
      date: utc(11),
      accountId: acct.id,
      imported: false,
    });
    const r1 = await prisma.transaction.findUniqueOrThrow({ where: { id: tx1.id } });
    const r2 = await prisma.transaction.findUniqueOrThrow({ where: { id: tx2.id } });
    // opening 500 → -200 → 300 → -50 → 250. Chained from the opening, not from 0.
    expect(Number(r1.balanceBefore)).toBe(500);
    expect(Number(r1.balanceAfter)).toBe(300);
    expect(Number(r2.balanceBefore)).toBe(300);
    expect(Number(r2.balanceAfter)).toBe(250);
  });

  it('heals an all-NULL account from openingBalance on the next write', async () => {
    // Simulate an account whose whole chain is NULL (created before the fix):
    // every row unchained, no anchor anywhere.
    const acct = await prisma.account.create({
      data: {
        name: `all-null-${Date.now()}-${Math.random()}`,
        type: 'Checking',
        balance: 0,
        openingBalance: 100,
      },
    });
    const a = await ledgerCreate({
      type: 'EXPENSE',
      name: 'a',
      amount: 10,
      date: utc(10),
      accountId: acct.id,
      imported: false,
    });
    const b = await ledgerCreate({
      type: 'EXPENSE',
      name: 'b',
      amount: 20,
      date: utc(11),
      accountId: acct.id,
      imported: false,
    });
    // Blank the whole chain to reproduce the never-seeded state.
    await prisma.transaction.updateMany({
      where: { id: { in: [a.id, b.id] } },
      data: { balanceBefore: null, balanceAfter: null },
    });

    // Next write seeds from openingBalance and fills the whole tail.
    const c = await ledgerCreate({
      type: 'EXPENSE',
      name: 'c',
      amount: 5,
      date: utc(12),
      accountId: acct.id,
      imported: false,
    });

    const ra = await prisma.transaction.findUniqueOrThrow({ where: { id: a.id } });
    const rb = await prisma.transaction.findUniqueOrThrow({ where: { id: b.id } });
    const rc = await prisma.transaction.findUniqueOrThrow({ where: { id: c.id } });
    // opening 100 → -10 → 90 → -20 → 70 → -5 → 65
    expect(Number(ra.balanceBefore)).toBe(100);
    expect(Number(ra.balanceAfter)).toBe(90);
    expect(Number(rb.balanceBefore)).toBe(90);
    expect(Number(rb.balanceAfter)).toBe(70);
    expect(Number(rc.balanceBefore)).toBe(70);
    expect(Number(rc.balanceAfter)).toBe(65);
  });
});
