/**
 * A note-only edit must not move money.
 *
 * Marking a row "reviewed during reconciliation" appends to its note, and that
 * goes through `ledgerUpdate` like any other change — as it must, since the
 * ledger gate exists so nothing writes to a transaction behind its back. But
 * the update path reverses the old row's effect on the balance and re-applies
 * the new one, then walks the balance chain forward. With an unchanged amount
 * those cancel exactly; this proves they do, rather than assuming it.
 *
 * If they ever stopped cancelling, every ignored row would silently shift the
 * account balance — and ignoring is the action a user reaches for precisely
 * when they believe nothing needs to change.
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

let n = 0;
async function makeAccount(opening: number) {
  return prisma.account.create({
    data: {
      name: `__note_${Date.now()}_${++n}`,
      type: 'CHECKING',
      balance: opening,
      openingBalance: opening,
    },
  });
}

describe('appending a note through the ledger gate', () => {
  it('leaves the account balance exactly where it was', async () => {
    const account = await makeAccount(1000);
    const tx = await ledgerCreate({
      accountId: account.id,
      date: new Date(Date.UTC(2026, 5, 10)),
      name: 'Corner Coffee',
      amount: 24.5,
      type: 'EXPENSE',
    });

    const before = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    await ledgerUpdate(tx.id, {
      note: 'Reviewed during reconciliation on 2026-07-19: left as-is.',
    });
    const after = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });

    expect(Number(after.balance)).toBe(Number(before.balance));
  });

  it('keeps openingBalance + SUM(transactions) == balance', async () => {
    // The invariant the whole ledger design protects. A note edit must be
    // invisible to it.
    const account = await makeAccount(500);
    const a = await ledgerCreate({
      accountId: account.id,
      date: new Date(Date.UTC(2026, 5, 10)),
      name: 'One',
      amount: 30,
      type: 'EXPENSE',
    });
    await ledgerCreate({
      accountId: account.id,
      date: new Date(Date.UTC(2026, 5, 12)),
      name: 'Two',
      amount: 12.75,
      type: 'EXPENSE',
    });

    await ledgerUpdate(a.id, { note: 'Reviewed during reconciliation on 2026-07-19: left as-is.' });

    const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    const rows = await prisma.transaction.findMany({
      where: { accountId: account.id },
      select: { netAmount: true, type: true },
    });
    const signed = rows.reduce(
      (sum, r) =>
        Math.round(
          (sum + (r.type === 'INCOME' || r.type === 'REFUND' ? 1 : -1) * Number(r.netAmount)) * 100,
        ) / 100,
      0,
    );
    expect(Number(acct.balance)).toBeCloseTo(
      Math.round((Number(acct.openingBalance) + signed) * 100) / 100,
      2,
    );
  });

  it('does not disturb netAmount when only the note changes', async () => {
    // `ledgerUpdate` recomputes netAmount on every call from whatever it finds.
    // With no monetary field in the change it must land on the same figure.
    const account = await makeAccount(0);
    const tx = await ledgerCreate({
      accountId: account.id,
      date: new Date(Date.UTC(2026, 5, 10)),
      name: 'Rewarded Basket',
      amount: 200.0,
      type: 'EXPENSE',
    });

    const before = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    await ledgerUpdate(tx.id, {
      note: 'Reviewed during reconciliation on 2026-07-19: left as-is.',
    });
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });

    expect(Number(after.netAmount)).toBe(Number(before.netAmount));
    expect(after.note).toContain('Reviewed during reconciliation');
  });
});
