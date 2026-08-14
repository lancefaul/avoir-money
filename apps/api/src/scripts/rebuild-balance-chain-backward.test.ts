/**
 * Integration Tests for Backward Balance Chain Rebuild
 *
 * DB-backed: creates a fixture account with a trusted current balance and a
 * set of transactions (deliberately seeded with stale/wrong balanceBefore/
 * balanceAfter values), runs rebuildBalanceChainBackward, then verifies the
 * chain is internally consistent and anchored to the account's current balance.
 *
 * Follows the same pattern as backfill-schedule.property.test.ts: the core
 * function is exported for direct testing, and tests run against the test DB
 * (port 5433, configured in vitest.config.ts).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { makeDate } from '../lib/dates.js';
import { createTransaction } from '../test/helpers.js';
import { rebuildBalanceChainBackward } from './rebuild-balance-chain-backward.js';

// Ensure Prisma engine is connected before running these DB-backed tests.
beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function freshAccount(balance: number) {
  return prisma.account.create({
    data: {
      name: `PBT rebuild-backward acct ${Date.now()}_${Math.random()}`,
      type: 'CHECKING',
      balance,
    },
  });
}

describe('rebuildBalanceChainBackward', () => {
  it('anchors the chain to the account current balance and is internally consistent', async () => {
    const account = await freshAccount(1000);

    // Seed with deliberately wrong balanceBefore/balanceAfter values.
    const tx1 = await createTransaction(account.id, {
      type: 'EXPENSE',
      amount: 100,
      netAmount: 100,
      date: makeDate(2026, 0, 1),
      balanceBefore: -9999,
      balanceAfter: -9999,
    });
    const tx2 = await createTransaction(account.id, {
      type: 'INCOME',
      amount: 300,
      netAmount: 300,
      date: makeDate(2026, 0, 2),
      balanceBefore: -9999,
      balanceAfter: -9999,
    });
    const tx3 = await createTransaction(account.id, {
      type: 'TRADE',
      amount: 50,
      netAmount: 50,
      date: makeDate(2026, 0, 3),
      tradeDetail: {
        create: { direction: 'BUY', assetType: 'Stock', quantity: 1, unitPrice: 50 },
      },
      balanceBefore: -9999,
      balanceAfter: -9999,
    });

    const result = await rebuildBalanceChainBackward(account.id, { apply: true });

    expect(result.entries).toBe(3);
    expect(result.currentBalance).toBe(1000);
    // tx3 (last): after=1000, delta=-50 -> before=1050
    // tx2: after=1050, delta=+300 -> before=750
    // tx1: after=750, delta=-100 -> before=850
    expect(result.impliedStartingBalance).toBe(850);

    const [r1, r2, r3] = await Promise.all([
      prisma.transaction.findUniqueOrThrow({ where: { id: tx1.id } }),
      prisma.transaction.findUniqueOrThrow({ where: { id: tx2.id } }),
      prisma.transaction.findUniqueOrThrow({ where: { id: tx3.id } }),
    ]);

    expect(r1.balanceBefore?.toNumber()).toBe(850);
    expect(r1.balanceAfter?.toNumber()).toBe(750);
    expect(r2.balanceBefore?.toNumber()).toBe(750);
    expect(r2.balanceAfter?.toNumber()).toBe(1050);
    expect(r3.balanceBefore?.toNumber()).toBe(1050);
    expect(r3.balanceAfter?.toNumber()).toBe(1000);

    // Continuity: each entry's balanceBefore equals the prior entry's balanceAfter.
    expect(r1.balanceAfter?.toNumber()).toBe(r2.balanceBefore?.toNumber());
    expect(r2.balanceAfter?.toNumber()).toBe(r3.balanceBefore?.toNumber());

    // Each entry internally consistent: balanceAfter === balanceBefore + delta.
    expect(round2((r1.balanceBefore?.toNumber() ?? 0) + -100)).toBe(r1.balanceAfter?.toNumber());
    expect(round2((r2.balanceBefore?.toNumber() ?? 0) + 300)).toBe(r2.balanceAfter?.toNumber());
    expect(round2((r3.balanceBefore?.toNumber() ?? 0) + -50)).toBe(r3.balanceAfter?.toNumber());

    // Last (most recent) transaction's balanceAfter equals current account balance exactly.
    const refreshedAccount = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(r3.balanceAfter?.toNumber()).toBe(refreshedAccount.balance.toNumber());
  });

  it('dry run makes no writes but reports what would be written', async () => {
    const account = await freshAccount(2000);

    const tx1 = await createTransaction(account.id, {
      type: 'EXPENSE',
      amount: 400,
      netAmount: 400,
      date: makeDate(2026, 1, 1),
      balanceBefore: -1,
      balanceAfter: -1,
    });
    const tx2 = await createTransaction(account.id, {
      type: 'INCOME',
      amount: 600,
      netAmount: 600,
      date: makeDate(2026, 1, 2),
      balanceBefore: -1,
      balanceAfter: -1,
    });

    const dryRun = await rebuildBalanceChainBackward(account.id, { apply: false });

    // Nothing written — seeded sentinel values remain untouched.
    const [r1, r2] = await Promise.all([
      prisma.transaction.findUniqueOrThrow({ where: { id: tx1.id } }),
      prisma.transaction.findUniqueOrThrow({ where: { id: tx2.id } }),
    ]);
    expect(r1.balanceBefore?.toNumber()).toBe(-1);
    expect(r1.balanceAfter?.toNumber()).toBe(-1);
    expect(r2.balanceBefore?.toNumber()).toBe(-1);
    expect(r2.balanceAfter?.toNumber()).toBe(-1);

    // Summary matches what apply:true would have produced.
    // tx2 (last): after=2000, delta=+600 -> before=1400
    // tx1: after=1400, delta=-400 -> before=1800
    expect(dryRun.entries).toBe(2);
    expect(dryRun.currentBalance).toBe(2000);
    expect(dryRun.impliedStartingBalance).toBe(1800);

    const applyRun = await rebuildBalanceChainBackward(account.id, { apply: true });

    // Every computed figure matches; only `openingBalanceUpdated` differs, and it
    // must — it reports what the run actually wrote, and a dry run writes nothing.
    const { openingBalanceUpdated: dryWrote, ...dryFigures } = dryRun;
    const { openingBalanceUpdated: applyWrote, ...applyFigures } = applyRun;
    expect(applyFigures).toEqual(dryFigures);
    expect(dryWrote).toBe(false);
    expect(applyWrote).toBe(true);
  });

  it('handles inbound transfers via toBalanceBefore/toBalanceAfter, chained with source transactions', async () => {
    const source = await freshAccount(0);
    const target = await freshAccount(500);

    // Inbound transfer INTO target FROM source (earlier date).
    const transferTx = await createTransaction(source.id, {
      type: 'TRANSFER',
      amount: 200,
      netAmount: 200,
      date: makeDate(2026, 2, 1),
      toAccountId: target.id,
      balanceBefore: -1,
      balanceAfter: -1,
      toBalanceBefore: -1,
      toBalanceAfter: -1,
    });

    // A source transaction against target itself (later date).
    const expenseTx = await createTransaction(target.id, {
      type: 'EXPENSE',
      amount: 50,
      netAmount: 50,
      date: makeDate(2026, 2, 2),
      balanceBefore: -1,
      balanceAfter: -1,
    });

    const result = await rebuildBalanceChainBackward(target.id, { apply: true });
    expect(result.entries).toBe(2);

    const [transfer, expense] = await Promise.all([
      prisma.transaction.findUniqueOrThrow({ where: { id: transferTx.id } }),
      prisma.transaction.findUniqueOrThrow({ where: { id: expenseTx.id } }),
    ]);

    // expenseTx (last): after=500, delta=-50 -> before=550
    expect(expense.balanceBefore?.toNumber()).toBe(550);
    expect(expense.balanceAfter?.toNumber()).toBe(500);

    // transferTx (inbound, earlier): after=550 (carried), delta=+200 -> before=350
    // Written to toBalanceBefore/toBalanceAfter, NOT balanceBefore/balanceAfter,
    // since target is the destination, not the source, of this row.
    expect(transfer.toBalanceBefore?.toNumber()).toBe(350);
    expect(transfer.toBalanceAfter?.toNumber()).toBe(550);
    expect(transfer.balanceBefore?.toNumber()).toBe(-1);
    expect(transfer.balanceAfter?.toNumber()).toBe(-1);

    // Continuity across the two entries.
    expect(transfer.toBalanceAfter?.toNumber()).toBe(expense.balanceBefore?.toNumber());
  });

  it('never modifies account.balance itself', async () => {
    const account = await freshAccount(777.77);
    await createTransaction(account.id, {
      type: 'EXPENSE',
      amount: 25,
      netAmount: 25,
      date: makeDate(2026, 3, 1),
      balanceBefore: 0,
      balanceAfter: 0,
    });

    const before = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    await rebuildBalanceChainBackward(account.id, { apply: true });
    const after = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });

    expect(after.balance.toNumber()).toBe(before.balance.toNumber());
    expect(after.balance.toNumber()).toBe(777.77);
  });

  it('excludes child (split) transactions from the chain', async () => {
    const account = await freshAccount(300);

    const parent = await createTransaction(account.id, {
      type: 'EXPENSE',
      amount: 100,
      netAmount: 100,
      date: makeDate(2026, 4, 1),
      balanceBefore: -1,
      balanceAfter: -1,
    });
    // Child transaction — must be excluded from the chain entirely.
    const child = await createTransaction(account.id, {
      type: 'EXPENSE',
      amount: 40,
      netAmount: 40,
      date: makeDate(2026, 4, 1),
      parentId: parent.id,
      balanceBefore: -12345,
      balanceAfter: -12345,
    });

    const result = await rebuildBalanceChainBackward(account.id, { apply: true });
    expect(result.entries).toBe(1); // only the parent counted

    const [parentRow, childRow] = await Promise.all([
      prisma.transaction.findUniqueOrThrow({ where: { id: parent.id } }),
      prisma.transaction.findUniqueOrThrow({ where: { id: child.id } }),
    ]);

    // Parent gets rebuilt (only entry): after=300, delta=-100 -> before=400
    expect(parentRow.balanceBefore?.toNumber()).toBe(400);
    expect(parentRow.balanceAfter?.toNumber()).toBe(300);

    // Child untouched — sentinel values survive.
    expect(childRow.balanceBefore?.toNumber()).toBe(-12345);
    expect(childRow.balanceAfter?.toNumber()).toBe(-12345);
  });
});

/**
 * openingBalance persistence (2026-07-18).
 *
 * The backward walk lands, by construction, on the balance the account carried
 * before its earliest tracked transaction. The script used to only *print* that
 * number — it survived solely as the earliest row's balanceBefore, comparable
 * against nothing. That is how a wrong balance disguised itself as "this account
 * had history before tracking", and how a reversed a four-figure card payment stayed
 * hidden for four months. It is now persisted to `openingBalance`.
 */
describe('rebuildBalanceChainBackward — openingBalance persistence', () => {
  it('writes the implied pre-history figure into openingBalance', async () => {
    const account = await freshAccount(-500);
    await createTransaction(account.id, {
      type: 'EXPENSE',
      amount: 120,
      netAmount: 120,
      date: makeDate(2026, 6, 4),
    });

    const result = await rebuildBalanceChainBackward(account.id, { apply: true });

    // Balance is trusted at -500 and the only transaction is a 120 expense, so
    // the account must have carried -380 before tracking began.
    expect(result.impliedStartingBalance).toBe(-380);
    expect(result.previousOpeningBalance).toBe(0);
    expect(result.openingBalanceUpdated).toBe(true);

    const row = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.openingBalance.toNumber()).toBe(-380);
    expect(row.balance.toNumber()).toBe(-500); // balance itself still untouched
  });

  it('leaves the ledger invariant true after a rebuild', async () => {
    const account = await freshAccount(-1000);
    for (const [day, amount] of [
      [5, 40.25],
      [6, 13.7],
      [7, 210.05],
    ] as const) {
      await createTransaction(account.id, {
        type: 'EXPENSE',
        amount,
        netAmount: amount,
        date: makeDate(2026, 6, day),
      });
    }

    await rebuildBalanceChainBackward(account.id, { apply: true });

    // Ground truth computed independently of the production sign helpers.
    const row = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    const sums = await prisma.$queryRaw<{ total: string | null }[]>`
      SELECT SUM(
        CASE
          WHEN t.type IN ('INCOME', 'REFUND') THEN t."netAmount"
          WHEN t.type = 'EXPENSE' THEN -t."netAmount"
          WHEN t.type = 'TRANSFER' AND t."toAccountId" = ${account.id} THEN t."netAmount"
          WHEN t.type = 'TRANSFER' THEN -t."netAmount"
          ELSE 0
        END
      )::text AS total
      FROM "Transaction" t
      WHERE t."parentId" IS NULL
        AND (t."accountId" = ${account.id} OR (t."toAccountId" = ${account.id} AND t.type = 'TRANSFER'))
    `;
    const sum = Number(sums[0]?.total ?? 0);
    expect(row.balance.toNumber()).toBe(round2(row.openingBalance.toNumber() + sum));
  });

  it('on an account with no transactions, the opening must equal the balance', async () => {
    // Empty boundary: the backward walk never runs, so the implied figure falls
    // through as the current balance. With nothing to sum, the invariant
    // (opening + 0 == balance) forces the opening to be the balance itself.
    const account = await freshAccount(425.5);

    const result = await rebuildBalanceChainBackward(account.id, { apply: true });

    expect(result.entries).toBe(0);
    expect(result.impliedStartingBalance).toBe(425.5);
    expect(result.openingBalanceUpdated).toBe(true);

    const row = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.openingBalance.toNumber()).toBe(425.5);
    expect(row.balance.toNumber()).toBe(425.5);
  });

  it('is a no-op on openingBalance when it already agrees', async () => {
    const account = await prisma.account.create({
      data: {
        name: `PBT bwd agree ${Date.now()}_${Math.random()}`,
        type: 'CHECKING',
        balance: 150,
        openingBalance: 200,
      },
    });
    await createTransaction(account.id, {
      type: 'EXPENSE',
      amount: 50,
      netAmount: 50,
      date: makeDate(2026, 6, 8),
    });

    const result = await rebuildBalanceChainBackward(account.id, { apply: true });

    expect(result.impliedStartingBalance).toBe(200);
    expect(result.openingBalanceUpdated).toBe(false);

    const row = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.openingBalance.toNumber()).toBe(200);
  });
});

describe('rebuildBalanceChainBackward — non-zero opening guard', () => {
  /** Opening claims 900, but the trusted balance and transactions imply 80. */
  async function contradictoryAccount(day: number) {
    const account = await prisma.account.create({
      data: {
        name: `PBT bwd guard ${Date.now()}_${Math.random()}`,
        type: 'CHECKING',
        balance: 0,
        openingBalance: 900,
      },
    });
    const tx = await createTransaction(account.id, {
      type: 'EXPENSE',
      amount: 80,
      netAmount: 80,
      date: makeDate(2026, 6, day),
      balanceBefore: -1,
      balanceAfter: -1,
    });
    return { account, tx };
  }

  it('refuses to overwrite a disagreeing non-zero opening without --force-opening', async () => {
    const { account, tx } = await contradictoryAccount(10);

    await expect(rebuildBalanceChainBackward(account.id, { apply: true })).rejects.toThrow(
      /Refusing to overwrite a non-zero openingBalance/,
    );

    // The refusal happens before any write, so neither the opening nor the
    // chain is left half-updated.
    const row = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.openingBalance.toNumber()).toBe(900);
    const txRow = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(txRow.balanceBefore?.toNumber()).toBe(-1);
    expect(txRow.balanceAfter?.toNumber()).toBe(-1);
  });

  it('overwrites when --force-opening is given', async () => {
    const { account } = await contradictoryAccount(11);

    const result = await rebuildBalanceChainBackward(account.id, {
      apply: true,
      forceOpening: true,
    });

    expect(result.previousOpeningBalance).toBe(900);
    expect(result.impliedStartingBalance).toBe(80);
    expect(result.openingBalanceUpdated).toBe(true);

    const row = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.openingBalance.toNumber()).toBe(80);
  });

  it('does not require the force flag when the stored opening is zero', async () => {
    const account = await freshAccount(0);
    await createTransaction(account.id, {
      type: 'EXPENSE',
      amount: 60,
      netAmount: 60,
      date: makeDate(2026, 6, 12),
    });

    const result = await rebuildBalanceChainBackward(account.id, { apply: true });
    expect(result.impliedStartingBalance).toBe(60);

    const row = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.openingBalance.toNumber()).toBe(60);
  });

  it('never writes in dry-run mode, even when the opening disagrees', async () => {
    const { account } = await contradictoryAccount(13);

    const result = await rebuildBalanceChainBackward(account.id, { apply: false });

    expect(result.impliedStartingBalance).toBe(80);
    expect(result.openingBalanceUpdated).toBe(false);

    const row = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.openingBalance.toNumber()).toBe(900); // untouched
  });
});
