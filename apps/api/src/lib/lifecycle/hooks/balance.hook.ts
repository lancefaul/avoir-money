import { prisma } from '@budget-tracker/db';
import type { HookDefinition, TransactionRecord } from '../types.js';
import type { DbClient } from '../db-client.js';
import { applyTransactionToBalances } from '../../balance.js';

/** Round to 2 decimal places to prevent floating point drift in balance chain */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the balance delta that a transaction applies to its PRIMARY account.
 * Positive means the account balance increases; negative means it decreases.
 */
function computeSourceDelta(tx: TransactionRecord): number {
  const rawAmount = tx.netAmount != null ? tx.netAmount : tx.amount;
  const raw = typeof rawAmount === 'number' ? rawAmount : rawAmount.toNumber();
  // Round to 2 decimals to prevent floating point drift from unrounded DB values
  const amount = Math.round(raw * 100) / 100;

  if (tx.type === 'INCOME' || tx.type === 'REFUND') {
    return amount;
  } else if (tx.type === 'EXPENSE') {
    return -amount;
  } else if (tx.type === 'TRANSFER') {
    return -amount;
  } else if (tx.type === 'TRADE') {
    const direction = tx.tradeDetail?.direction;
    if (direction === 'BUY') return -amount;
    if (direction === 'SELL') return amount;
  }
  return 0;
}

/**
 * Compute the delta for a raw DB transaction record (Decimal fields).
 */
function computeDeltaFromRecord(tx: {
  type: string;
  netAmount: { toNumber(): number };
  tradeDetail: { direction: string } | null;
}): number {
  const amount = tx.netAmount.toNumber();

  if (tx.type === 'INCOME' || tx.type === 'REFUND') {
    return amount;
  } else if (tx.type === 'EXPENSE') {
    return -amount;
  } else if (tx.type === 'TRANSFER') {
    return -amount;
  } else if (tx.type === 'TRADE') {
    const direction = tx.tradeDetail?.direction;
    if (direction === 'BUY') return -amount;
    if (direction === 'SELL') return amount;
  }
  return 0;
}

/**
 * Find the balanceAfter of the transaction immediately BEFORE the given one
 * on the same account (by date, createdAt order). Returns null if no prior
 * transaction exists or if the prior transaction has no balanceAfter set.
 */
async function getPreviousBalanceAfter(
  db: DbClient,
  accountId: string,
  date: Date,
  createdAt: Date,
  txId: string,
): Promise<number | null> {
  // Find the most recent transaction where this account is the source
  const prevSource = await db.transaction.findFirst({
    where: {
      accountId,
      parentId: null,
      id: { not: txId },
      OR: [
        { date: { lt: date } },
        { date, createdAt: { lt: createdAt } },
        { date, createdAt, id: { lt: txId } },
      ],
    },
    select: { date: true, createdAt: true, balanceAfter: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  // Find the most recent inbound transfer where this account is the destination
  const prevInbound = await db.transaction.findFirst({
    where: {
      toAccountId: accountId,
      type: 'TRANSFER',
      parentId: null,
      id: { not: txId },
      OR: [
        { date: { lt: date } },
        { date, createdAt: { lt: createdAt } },
        { date, createdAt, id: { lt: txId } },
      ],
    },
    select: { date: true, createdAt: true, toBalanceAfter: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  // Pick whichever is more recent
  if (!prevSource && !prevInbound) return null;

  if (!prevInbound) return prevSource?.balanceAfter?.toNumber() ?? null;
  if (!prevSource) return prevInbound?.toBalanceAfter?.toNumber() ?? null;

  // Both exist — compare dates to find the most recent
  const sourceTime = prevSource.date.getTime() * 1e6 + prevSource.createdAt.getTime();
  const inboundTime = prevInbound.date.getTime() * 1e6 + prevInbound.createdAt.getTime();

  if (inboundTime > sourceTime) {
    return prevInbound.toBalanceAfter?.toNumber() ?? null;
  }
  return prevSource.balanceAfter?.toNumber() ?? null;
}

/**
 * Write balanceBefore/balanceAfter to a transaction record.
 */
async function writeLedgerFields(
  db: DbClient,
  txId: string,
  balanceBefore: number | null,
  balanceAfter: number | null,
  toBalanceBefore?: number | null,
  toBalanceAfter?: number | null,
): Promise<void> {
  await db.transaction.update({
    where: { id: txId },
    data: {
      balanceBefore,
      balanceAfter,
      ...(toBalanceBefore !== undefined ? { toBalanceBefore } : {}),
      ...(toBalanceAfter !== undefined ? { toBalanceAfter } : {}),
    },
  });
}

/**
 * Find the most recent transaction BEFORE the given position that has a
 * non-null chain value (balanceAfter for source rows, toBalanceAfter for
 * inbound transfers). Used to heal a mid-chain NULL gap: by design NULLs only
 * exist as a pre-chain prefix (cleared history), so a NULL between two chained
 * rows is corruption — e.g. a create that ran while the server was mid-deploy.
 * Returns null when no chained anchor exists (true prefix / empty account).
 */
async function findChainAnchor(
  db: DbClient,
  accountId: string,
  date: Date,
  createdAt: Date,
  txId: string,
): Promise<{ id: string; date: Date; createdAt: Date; balanceAfter: number } | null> {
  const beforePosition = [
    { date: { lt: date } },
    { date, createdAt: { lt: createdAt } },
    { date, createdAt, id: { lt: txId } },
  ];

  const anchorSource = await db.transaction.findFirst({
    where: {
      accountId,
      parentId: null,
      id: { not: txId },
      balanceAfter: { not: null },
      OR: beforePosition,
    },
    select: { id: true, date: true, createdAt: true, balanceAfter: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  const anchorInbound = await db.transaction.findFirst({
    where: {
      toAccountId: accountId,
      type: 'TRANSFER',
      parentId: null,
      id: { not: txId },
      toBalanceAfter: { not: null },
      OR: beforePosition,
    },
    select: { id: true, date: true, createdAt: true, toBalanceAfter: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  if (!anchorSource && !anchorInbound) return null;

  const sourceTime = anchorSource
    ? anchorSource.date.getTime() * 1e6 + anchorSource.createdAt.getTime()
    : -Infinity;
  const inboundTime = anchorInbound
    ? anchorInbound.date.getTime() * 1e6 + anchorInbound.createdAt.getTime()
    : -Infinity;

  if (inboundTime > sourceTime) {
    return {
      id: anchorInbound!.id,
      date: anchorInbound!.date,
      createdAt: anchorInbound!.createdAt,
      balanceAfter: anchorInbound!.toBalanceAfter!.toNumber(),
    };
  }
  return {
    id: anchorSource!.id,
    date: anchorSource!.date,
    createdAt: anchorSource!.createdAt,
    balanceAfter: anchorSource!.balanceAfter!.toNumber(),
  };
}

/**
 * Recalculate the balanceBefore/balanceAfter chain forward from a given point.
 * Includes both source transactions and inbound transfers for the account.
 * Stops when convergence is reached OR when a NULL boundary is hit — unless
 * `fillNulls` is set, in which case NULL rows are written through (gap heal)
 * and only convergence on an already-correct non-null row stops the pass.
 */
async function recalculateChainForward(
  db: DbClient,
  accountId: string,
  afterDate: Date,
  afterCreatedAt: Date,
  afterId: string,
  startingBalanceAfter: number,
  fillNulls = false,
): Promise<void> {
  const dateFilter = [
    { date: { gt: afterDate } },
    { date: afterDate, createdAt: { gt: afterCreatedAt } },
    { date: afterDate, createdAt: afterCreatedAt, id: { gt: afterId } },
  ];

  // Source transactions (this account is accountId)
  const subsequentSource = await db.transaction.findMany({
    where: { accountId, parentId: null, OR: dateFilter },
    select: {
      id: true,
      type: true,
      netAmount: true,
      tradeDetail: { select: { direction: true } },
      balanceBefore: true,
      date: true,
      createdAt: true,
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });

  // Inbound transfers (this account is toAccountId)
  const subsequentInbound = await db.transaction.findMany({
    where: { toAccountId: accountId, type: 'TRANSFER', parentId: null, OR: dateFilter },
    select: {
      id: true,
      type: true,
      netAmount: true,
      toBalanceBefore: true,
      date: true,
      createdAt: true,
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });

  // Merge and sort chronologically
  type ChainEntry = {
    id: string;
    date: Date;
    createdAt: Date;
    isInbound: boolean;
    delta: number;
    existingBefore: number | null;
  };

  const merged: ChainEntry[] = [
    ...subsequentSource.map((tx) => ({
      id: tx.id,
      date: tx.date,
      createdAt: tx.createdAt,
      isInbound: false,
      delta: computeDeltaFromRecord(tx),
      existingBefore: tx.balanceBefore?.toNumber() ?? null,
    })),
    ...subsequentInbound.map((tx) => ({
      id: tx.id,
      date: tx.date,
      createdAt: tx.createdAt,
      isInbound: true,
      delta: tx.netAmount.toNumber(), // inbound adds to account
      existingBefore: tx.toBalanceBefore?.toNumber() ?? null,
    })),
  ].sort((a, b) => {
    const dateDiff = a.date.getTime() - b.date.getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  let runningBalance = startingBalanceAfter;

  for (const entry of merged) {
    // Stop at NULL boundary — don't propagate into cleared history.
    // In gap-heal mode NULL rows are corruption inside the chain: write through.
    if (entry.existingBefore === null && !fillNulls) {
      break;
    }

    // Convergence: existing value already correct, stop
    if (entry.existingBefore !== null && Math.abs(entry.existingBefore - runningBalance) < 0.001) {
      break;
    }

    const newBalanceAfter = round2(runningBalance + entry.delta);

    if (entry.isInbound) {
      await db.transaction.update({
        where: { id: entry.id },
        data: { toBalanceBefore: runningBalance, toBalanceAfter: newBalanceAfter },
      });
    } else {
      await db.transaction.update({
        where: { id: entry.id },
        data: { balanceBefore: runningBalance, balanceAfter: newBalanceAfter },
      });
    }

    runningBalance = newBalanceAfter;
  }
}

/**
 * Seed and build an account's balance chain from its `openingBalance`, filling
 * through unseeded NULL rows. Used when a transaction has a NULL predecessor and
 * there is no chained anchor before it — meaning the chain was never seeded: a
 * brand-new account's first-ever transaction, or an account whose rows are all
 * NULL. Without this, the earliest row's balanceBefore/balanceAfter stay blank
 * forever, because every later row inherits the NULL predecessor.
 *
 * This is the incremental-path counterpart to `rebuildBalanceChain`'s
 * `running = openingBalance` seed — the same rule, restated where the hook lives.
 * It writes only the per-row chain fields; `Account.balance` is maintained
 * separately by `applyTransactionToBalances`, so we do not touch it here.
 */
async function seedChainFromOpening(db: DbClient, accountId: string): Promise<void> {
  const account = await db.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { openingBalance: true },
  });
  const opening = account.openingBalance.toNumber();
  // A position before every real transaction, so the whole chain rebuilds from
  // the opening. fillNulls writes through the unseeded rows.
  await recalculateChainForward(db, accountId, new Date(0), new Date(0), '', opening, true);
}

/**
 * A transfer's DESTINATION chain values (toBalanceBefore/toBalanceAfter), derived
 * from the destination's own chain AT THE TRANSFER'S POSITION — the balanceAfter
 * of the row just before it on that account (source rows or earlier inbound
 * transfers), seeded from openingBalance when the transfer is the destination's
 * first activity.
 *
 * This replaces a shortcut that read the destination's CURRENT running total
 * (`toAccount.balance`) and assumed the transfer was the last row on that
 * account. That only held for an end-of-chain transfer; a mid-chain one — later
 * rows on the destination, or a transfer whose date was moved earlier — got its
 * destination chain computed from the wrong (final) balance, re-seeding the chain
 * from that point. Editing a credit-card payment's date is exactly this case.
 */
async function transferDestinationChain(
  db: DbClient,
  tx: TransactionRecord,
  txDate: Date,
  txCreatedAt: Date,
): Promise<{ toBalanceBefore: number; toBalanceAfter: number }> {
  const rawAmount = tx.netAmount != null ? tx.netAmount : tx.amount;
  const amount = typeof rawAmount === 'number' ? rawAmount : rawAmount.toNumber();
  const toId = tx.toAccountId!;
  const prev = await getPreviousBalanceAfter(db, toId, txDate, txCreatedAt, tx.id);
  let before: number;
  if (prev != null) {
    before = prev;
  } else {
    const acct = await db.account.findUniqueOrThrow({
      where: { id: toId },
      select: { openingBalance: true },
    });
    before = acct.openingBalance.toNumber();
  }
  return { toBalanceBefore: round2(before), toBalanceAfter: round2(before + amount) };
}

/**
 * Compute a transfer's destination chain, write it, and propagate the
 * destination account forward. Used where the destination must be chained
 * independently of the source — the null-branch, where the source hits its
 * seed/heal path and returns early. A transfer that is the first row on its
 * source account would otherwise never get its destination chained.
 */
async function writeTransferDestinationChain(
  db: DbClient,
  tx: TransactionRecord,
  txDate: Date,
  txCreatedAt: Date,
): Promise<void> {
  const { toBalanceBefore, toBalanceAfter } = await transferDestinationChain(
    db,
    tx,
    txDate,
    txCreatedAt,
  );
  await db.transaction.update({
    where: { id: tx.id },
    data: { toBalanceBefore, toBalanceAfter },
  });
  await recalculateChainForward(db, tx.toAccountId!, txDate, txCreatedAt, tx.id, toBalanceAfter);
}

export const balanceHook: HookDefinition = {
  name: 'balance-update',
  events: ['created', 'updated', 'deleted'],
  priority: 10,
  condition: (ctx) => ctx.tx.accountId != null,
  async execute(ctx) {
    const db = ctx.db ?? prisma;
    if (ctx.event === 'created') {
      // Apply the balance change to the account running total
      await applyTransactionToBalances(ctx.tx, 1, db);

      // Get the transaction's date/createdAt for ordering
      const txRecord = await db.transaction.findUniqueOrThrow({
        where: { id: ctx.tx.id },
        select: { date: true, createdAt: true },
      });

      // Compute balanceBefore from the previous transaction's balanceAfter
      const prevBalanceAfter = await getPreviousBalanceAfter(
        db,
        ctx.tx.accountId!,
        txRecord.date,
        txRecord.createdAt,
        ctx.tx.id,
      );
      // Previous tx missing or has NULL balanceAfter. NULLs are only supposed to
      // exist as a pre-chain prefix (cleared history) — if a chained row exists
      // anywhere earlier, the NULL is mid-chain corruption (e.g. a create that
      // ran during a deploy window). Heal it: recompute forward from the last
      // chained anchor, writing through the NULL gap (this also chains this tx).
      if (prevBalanceAfter === null) {
        const anchor = await findChainAnchor(
          db,
          ctx.tx.accountId!,
          txRecord.date,
          txRecord.createdAt,
          ctx.tx.id,
        );
        if (anchor) {
          await recalculateChainForward(
            db,
            ctx.tx.accountId!,
            anchor.date,
            anchor.createdAt,
            anchor.id,
            anchor.balanceAfter,
            true,
          );
        } else {
          // No chained anchor anywhere before this row: the chain was never
          // seeded (first-ever transaction, or an all-NULL account). Seed from
          // openingBalance and build forward — otherwise this row (and every
          // one after it) stays blank forever.
          await seedChainFromOpening(db, ctx.tx.accountId!);
        }
        // The source hit its seed/heal path above, but a transfer's DESTINATION
        // chain is independent of the source's null state — chain it too.
        if (ctx.tx.type === 'TRANSFER' && ctx.tx.toAccountId) {
          await writeTransferDestinationChain(db, ctx.tx, txRecord.date, txRecord.createdAt);
        }
        return;
      }

      const balanceBefore = prevBalanceAfter;
      const delta = computeSourceDelta(ctx.tx);
      const balanceAfter = round2(balanceBefore + delta);

      // For transfers, derive the destination chain from the destination's own
      // position, not its running total (see transferDestinationChain).
      let toBalanceBefore: number | null = null;
      let toBalanceAfter: number | null = null;
      if (ctx.tx.type === 'TRANSFER' && ctx.tx.toAccountId) {
        const dest = await transferDestinationChain(db, ctx.tx, txRecord.date, txRecord.createdAt);
        toBalanceBefore = dest.toBalanceBefore;
        toBalanceAfter = dest.toBalanceAfter;
      }

      await writeLedgerFields(
        db,
        ctx.tx.id,
        balanceBefore,
        balanceAfter,
        toBalanceBefore,
        toBalanceAfter,
      );

      // Propagate forward on the source account
      await recalculateChainForward(
        db,
        ctx.tx.accountId!,
        txRecord.date,
        txRecord.createdAt,
        ctx.tx.id,
        balanceAfter,
      );

      // For a transfer, also propagate the DESTINATION account's chain forward
      // from this transfer, so later rows on the destination reflect the arriving
      // funds at the right position (not only the end of its chain).
      if (ctx.tx.type === 'TRANSFER' && ctx.tx.toAccountId && toBalanceAfter != null) {
        await recalculateChainForward(
          db,
          ctx.tx.toAccountId,
          txRecord.date,
          txRecord.createdAt,
          ctx.tx.id,
          toBalanceAfter,
        );
      }
    } else if (ctx.event === 'updated' && ctx.oldTx) {
      // Reverse old transaction's effect on account balance
      if (ctx.oldTx.accountId) {
        await applyTransactionToBalances(ctx.oldTx, -1, db);
      }
      // Apply new transaction's effect
      await applyTransactionToBalances(ctx.tx, 1, db);

      // Get the transaction's date/createdAt for ordering
      const txRecord = await db.transaction.findUniqueOrThrow({
        where: { id: ctx.tx.id },
        select: { date: true, createdAt: true },
      });

      // Compute balanceBefore from the previous transaction's balanceAfter
      const prevBalanceAfter = await getPreviousBalanceAfter(
        db,
        ctx.tx.accountId!,
        txRecord.date,
        txRecord.createdAt,
        ctx.tx.id,
      );
      if (prevBalanceAfter === null) {
        // Same gap-heal as the created path: a mid-chain NULL predecessor is
        // corruption — recompute forward from the last chained anchor.
        const anchor = await findChainAnchor(
          db,
          ctx.tx.accountId!,
          txRecord.date,
          txRecord.createdAt,
          ctx.tx.id,
        );
        if (anchor) {
          await recalculateChainForward(
            db,
            ctx.tx.accountId!,
            anchor.date,
            anchor.createdAt,
            anchor.id,
            anchor.balanceAfter,
            true,
          );
        } else {
          // No chained anchor: an all-NULL / never-seeded chain. Seed from
          // openingBalance so editing a transaction on such an account heals it.
          await seedChainFromOpening(db, ctx.tx.accountId!);
        }
        // A transfer's DESTINATION chain is independent of the source's null
        // state — chain it too before returning.
        if (ctx.tx.type === 'TRANSFER' && ctx.tx.toAccountId) {
          await writeTransferDestinationChain(db, ctx.tx, txRecord.date, txRecord.createdAt);
        }
        return;
      }

      const balanceBefore = prevBalanceAfter;
      const delta = computeSourceDelta(ctx.tx);
      const balanceAfter = round2(balanceBefore + delta);

      // For transfers, derive the destination chain from the destination's own
      // position, not its running total (see transferDestinationChain).
      let toBalanceBefore: number | null = null;
      let toBalanceAfter: number | null = null;
      if (ctx.tx.type === 'TRANSFER' && ctx.tx.toAccountId) {
        const dest = await transferDestinationChain(db, ctx.tx, txRecord.date, txRecord.createdAt);
        toBalanceBefore = dest.toBalanceBefore;
        toBalanceAfter = dest.toBalanceAfter;
      }

      await writeLedgerFields(
        db,
        ctx.tx.id,
        balanceBefore,
        balanceAfter,
        toBalanceBefore,
        toBalanceAfter,
      );

      // Propagate forward on the source account
      await recalculateChainForward(
        db,
        ctx.tx.accountId!,
        txRecord.date,
        txRecord.createdAt,
        ctx.tx.id,
        balanceAfter,
      );

      // A transfer edit (amount, or a date move) shifts the destination chain
      // too — repropagate it from the transfer's position so the destination's
      // later rows follow the moved payment. This is the case that broke when a
      // credit-card payment's date was changed.
      if (ctx.tx.type === 'TRANSFER' && ctx.tx.toAccountId && toBalanceAfter != null) {
        await recalculateChainForward(
          db,
          ctx.tx.toAccountId,
          txRecord.date,
          txRecord.createdAt,
          ctx.tx.id,
          toBalanceAfter,
        );
      }
    } else if (ctx.event === 'deleted') {
      // Reverse the balance change on the account running total
      await applyTransactionToBalances(ctx.tx, -1, db);

      // Find the tx just before the deleted one's position
      const txDate = ctx.tx.date instanceof Date ? ctx.tx.date : new Date(ctx.tx.date as string);
      const txCreatedAt =
        ctx.tx.createdAt instanceof Date ? ctx.tx.createdAt : new Date(ctx.tx.createdAt as string);
      const prevBeforeDeleted = await db.transaction.findFirst({
        where: {
          accountId: ctx.tx.accountId!,
          parentId: null,
          OR: [
            { date: { lt: txDate } },
            { date: txDate, createdAt: { lt: txCreatedAt } },
            { date: txDate, createdAt: txCreatedAt, id: { lt: ctx.tx.id } },
          ],
        },
        select: { id: true, balanceAfter: true, date: true, createdAt: true },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      });

      if (
        prevBeforeDeleted?.balanceAfter !== null &&
        prevBeforeDeleted?.balanceAfter !== undefined
      ) {
        await recalculateChainForward(
          db,
          ctx.tx.accountId!,
          prevBeforeDeleted.date,
          prevBeforeDeleted.createdAt,
          prevBeforeDeleted.id,
          prevBeforeDeleted.balanceAfter.toNumber(),
        );
      }

      // If the deleted row was a transfer, repropagate the DESTINATION chain too:
      // its inbound funds are gone, so the destination's later rows shift back.
      if (ctx.tx.type === 'TRANSFER' && ctx.tx.toAccountId) {
        let destSeed = await getPreviousBalanceAfter(
          db,
          ctx.tx.toAccountId,
          txDate,
          txCreatedAt,
          ctx.tx.id,
        );
        if (destSeed == null) {
          const acct = await db.account.findUniqueOrThrow({
            where: { id: ctx.tx.toAccountId },
            select: { openingBalance: true },
          });
          destSeed = acct.openingBalance.toNumber();
        }
        await recalculateChainForward(
          db,
          ctx.tx.toAccountId,
          txDate,
          txCreatedAt,
          ctx.tx.id,
          destSeed,
        );
      }
    }
  },
};
