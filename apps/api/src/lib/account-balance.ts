/**
 * Account balance recomputation utilities.
 *
 * Pure balance-chain math extracted from the accounts route for testability and to
 * keep the route file thin. These write only `balanceBefore`/`balanceAfter` and
 * `toBalanceBefore`/`toBalanceAfter` metadata directly on transactions — the same
 * rationale that exempts `balance.hook.ts` and `rebuild-balance-chain-backward.ts`
 * from the ledger gate. This file is on the ledger-gate approved list.
 */

import { prisma } from '@budget-tracker/db';

export interface RecalculateBalanceResult {
  oldBalance: number;
  newBalance: number;
  difference: number;
}

/**
 * Recompute an account's balance from scratch by summing every transaction that
 * touches it (source transactions + inbound transfers) on top of the account's
 * `openingBalance`, then write the total. Returns `null` when the account does
 * not exist.
 *
 * The opening seed is not optional bookkeeping. This function used to start from
 * zero, which silently discarded the Starting Balance captured at account
 * creation — on a card carrying a real pre-tracking balance, calling it moved
 * the balance by thousands. Any change here must preserve the invariant the
 * ledger-integrity check asserts: openingBalance + SUM(transactions) == balance.
 */
export async function recalculateAccountBalance(
  id: string,
): Promise<RecalculateBalanceResult | null> {
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) return null;

  const oldBalance = Number(account.balance);

  // Get all parent transactions (no parentId) where this account is the source
  const transactions = await prisma.transaction.findMany({
    where: { accountId: id, parentId: null },
    select: { type: true, netAmount: true, tradeDetail: { select: { direction: true } } },
  });

  // Get all transfers where this account is the destination
  const inboundTransfers = await prisma.transaction.findMany({
    where: { toAccountId: id, parentId: null, type: 'TRANSFER' },
    select: { type: true, netAmount: true },
  });

  let computedBalance = Number(account.openingBalance);

  for (const tx of transactions) {
    const netAmount = Number(tx.netAmount);
    if (tx.type === 'INCOME' || tx.type === 'REFUND') {
      computedBalance += netAmount;
    } else if (tx.type === 'EXPENSE') {
      computedBalance -= netAmount;
    } else if (tx.type === 'TRANSFER') {
      computedBalance -= netAmount; // money leaves source account
    } else if (tx.type === 'TRADE') {
      const direction = tx.tradeDetail?.direction;
      if (direction === 'BUY') {
        computedBalance -= netAmount;
      } else if (direction === 'SELL') {
        computedBalance += netAmount;
      }
    }
  }

  // Inbound transfers add to this account's balance
  for (const tx of inboundTransfers) {
    computedBalance += Number(tx.netAmount);
  }

  computedBalance = Math.round(computedBalance * 100) / 100;

  await prisma.account.update({
    where: { id },
    data: { balance: computedBalance },
  });

  return {
    oldBalance,
    newBalance: computedBalance,
    difference: computedBalance - oldBalance,
  };
}

export interface RebuildChainResult {
  updatedTransactions: number;
  finalBalance: number;
}

/**
 * Rebuild the full `balanceBefore`/`balanceAfter` chain for an account (and the
 * `toBalanceBefore`/`toBalanceAfter` values on inbound transfers), then write the
 * final running balance to the account. Returns `null` when the account does not exist.
 *
 * ONE walk over ONE running balance. This used to be two: a source-only walk
 * (`where: { accountId }`) that wrote every ordinary row's chain, and a second
 * merged walk that wrote the inbound transfers' destination columns and the
 * account total. The first never queried `toAccountId`, so its running balance
 * never received a single transfer INTO the account — while the second, which
 * did, produced a correct `Account.balance`.
 *
 * The result was an account whose total was right and whose every row was wrong
 * by the sum of its inbound transfers. On the Prime Visa card that was nine
 * card payments and tens of thousands, and it appeared the moment `openingBalance` was
 * edited, because that is what triggers this rebuild — overwriting a chain the
 * balance hook had been maintaining correctly since ADR-018 fixed exactly this
 * omission in the incremental path. The rule was fixed there and left unfixed
 * here, three files away, in a second implementation of the same walk.
 *
 * Two walks that must agree but are computed apart WILL drift. One walk cannot.
 */
export async function rebuildBalanceChain(id: string): Promise<RebuildChainResult | null> {
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) return null;

  // Rows where this account is the source: it spends, earns, or sends.
  const sourceTransactions = await prisma.transaction.findMany({
    where: { accountId: id, parentId: null },
    select: {
      id: true,
      type: true,
      netAmount: true,
      tradeDetail: { select: { direction: true } },
      date: true,
      createdAt: true,
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });

  // Rows where it is the destination: money arriving. Omitting these from the
  // running balance is the defect described above — they are as real a movement
  // as any expense, and a credit-card payment is nothing else.
  const inboundTransfers = await prisma.transaction.findMany({
    where: { toAccountId: id, parentId: null, type: 'TRANSFER' },
    select: { id: true, type: true, netAmount: true, date: true, createdAt: true },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });

  const allAffecting = [
    ...sourceTransactions.map((tx) => ({
      id: tx.id,
      date: tx.date,
      createdAt: tx.createdAt,
      isInbound: false,
      amount: tx.netAmount.toNumber(),
      type: tx.type,
      direction: tx.tradeDetail?.direction ?? null,
    })),
    ...inboundTransfers.map((tx) => ({
      id: tx.id,
      date: tx.date,
      createdAt: tx.createdAt,
      isInbound: true,
      amount: tx.netAmount.toNumber(),
      type: tx.type,
      direction: null as string | null,
    })),
  ].sort((a, b) => {
    const dateDiff = a.date.getTime() - b.date.getTime();
    if (dateDiff !== 0) return dateDiff;
    const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (createdDiff !== 0) return createdDiff;
    // Same date AND same createdAt: order by id so the walk is deterministic
    // rather than dependent on which query returned first.
    return a.id.localeCompare(b.id);
  });

  // Seeded from the pre-tracking balance so the earliest row's balanceBefore is
  // the opening rather than an implicit zero — starting at zero would erase it,
  // exactly as the recalculate path once did.
  let running = Number(account.openingBalance);
  let updatedCount = 0;

  for (const tx of allAffecting) {
    let delta = 0;
    if (tx.isInbound) {
      delta = tx.amount; // arriving here, whatever it cost the sender
    } else if (tx.type === 'INCOME' || tx.type === 'REFUND') {
      delta = tx.amount;
    } else if (tx.type === 'EXPENSE') {
      delta = -tx.amount;
    } else if (tx.type === 'TRANSFER') {
      delta = -tx.amount; // outbound
    } else if (tx.type === 'TRADE') {
      if (tx.direction === 'BUY') delta = -tx.amount;
      else if (tx.direction === 'SELL') delta = tx.amount;
    }

    const before = running;
    const after = Math.round((running + delta) * 100) / 100;

    // The same row can sit on two accounts' chains — a transfer is an outbound
    // row for one and an inbound row for the other — so which pair of columns
    // it owns depends on whose chain is being rebuilt. Writing `balanceBefore`
    // on an inbound row would stamp this account's figures over the sender's.
    await prisma.transaction.update({
      where: { id: tx.id },
      data: tx.isInbound
        ? { toBalanceBefore: before, toBalanceAfter: after }
        : { balanceBefore: before, balanceAfter: after },
    });

    running = after;
    updatedCount++;
  }

  await prisma.account.update({ where: { id }, data: { balance: running } });

  return { updatedTransactions: updatedCount, finalBalance: running };
}
