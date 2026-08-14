/**
 * Backward Balance Chain Rebuild
 *
 * Rebuilds balanceBefore/balanceAfter (and toBalanceBefore/toBalanceAfter for
 * inbound transfers) for a single account, anchored to the account's CURRENT
 * balance rather than assuming history starts at 0.
 *
 * Use this when an account's stored `balance` is trusted (e.g. verified
 * against a real statement) but the balanceBefore/balanceAfter ledger chain
 * has drifted or was never rebuilt after a data change. Walking backward
 * from the known-correct current balance means the earliest transaction's
 * balanceBefore lands on whatever balance the account carried before this
 * app started tracking it, instead of forcing it to 0.
 *
 * That pre-history figure is the account's `openingBalance`, and this script
 * persists it. Historically it did not — the number existed only implicitly, as
 * the earliest row's balanceBefore. That is how a wrong balance disguised itself
 * as "this account had history before tracking": the script faithfully absorbed
 * the discrepancy into an invisible figure nobody could compare against anything.
 * A reversed a four-figure card payment hid there for four months. Writing the
 * opening makes the absorption explicit and keeps the ledger invariant
 * (openingBalance + SUM(transactions) == balance) true after a rebuild.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/rebuild-balance-chain-backward.ts <accountId> [--apply] [--force-opening]
 *
 * Without --apply, runs in dry-run mode (read-only) and prints the first/last
 * few computed rows plus the implied pre-history balance.
 *
 * If the account already carries a non-zero openingBalance that disagrees with
 * the implied figure, --apply refuses without --force-opening. That disagreement
 * is genuinely ambiguous — either the stored balance is wrong, or a transaction
 * is — and silently picking one is what caused the bug above.
 */
import { prisma } from '@budget-tracker/db';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface ChainEntry {
  id: string;
  date: Date;
  createdAt: Date;
  isInbound: boolean;
  delta: number;
}

export async function rebuildBalanceChainBackward(
  accountId: string,
  opts: { apply: boolean; forceOpening?: boolean },
): Promise<{
  entries: number;
  currentBalance: number;
  impliedStartingBalance: number;
  previousOpeningBalance: number;
  openingBalanceUpdated: boolean;
}> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  const currentBalance = account.balance.toNumber();
  const previousOpeningBalance = account.openingBalance.toNumber();

  const sourceTransactions = await prisma.transaction.findMany({
    where: { accountId, parentId: null },
    select: {
      id: true,
      type: true,
      netAmount: true,
      tradeDetail: { select: { direction: true } },
      date: true,
      createdAt: true,
    },
  });

  const inboundTransfers = await prisma.transaction.findMany({
    where: { toAccountId: accountId, type: 'TRANSFER', parentId: null },
    select: { id: true, netAmount: true, date: true, createdAt: true },
  });

  const entries: ChainEntry[] = [
    ...sourceTransactions.map((tx) => {
      const amount = tx.netAmount.toNumber();
      let delta = 0;
      if (tx.type === 'INCOME' || tx.type === 'REFUND') delta = amount;
      else if (tx.type === 'EXPENSE') delta = -amount;
      else if (tx.type === 'TRANSFER') delta = -amount;
      else if (tx.type === 'TRADE') {
        const direction = tx.tradeDetail?.direction;
        if (direction === 'BUY') delta = -amount;
        else if (direction === 'SELL') delta = amount;
      }
      return { id: tx.id, date: tx.date, createdAt: tx.createdAt, isInbound: false, delta };
    }),
    ...inboundTransfers.map((tx) => ({
      id: tx.id,
      date: tx.date,
      createdAt: tx.createdAt,
      isInbound: true,
      delta: tx.netAmount.toNumber(),
    })),
  ].sort((a, b) => {
    const dateDiff = a.date.getTime() - b.date.getTime();
    if (dateDiff !== 0) return dateDiff;
    const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (createdDiff !== 0) return createdDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Walk backward from the known-correct current balance.
  let runningBalanceAfter = currentBalance;
  const writes: { id: string; isInbound: boolean; before: number; after: number }[] = [];

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    const balanceAfter = round2(runningBalanceAfter);
    const balanceBefore = round2(balanceAfter - entry.delta);
    writes.push({
      id: entry.id,
      isInbound: entry.isInbound,
      before: balanceBefore,
      after: balanceAfter,
    });
    runningBalanceAfter = balanceBefore;
  }
  writes.reverse(); // back to chronological order for display/logging

  const impliedStartingBalance = round2(runningBalanceAfter);
  const openingDrift = round2(impliedStartingBalance - previousOpeningBalance);
  const openingChanges = Math.abs(openingDrift) > 0.005;

  console.log(`Account ${accountId}: current balance = ${currentBalance}`);
  console.log(`${entries.length} ledger-affecting transaction(s) found.`);
  console.log(`Stored openingBalance: ${previousOpeningBalance}`);
  console.log(
    `Implied pre-history balance (before earliest transaction): ${impliedStartingBalance}`,
  );
  if (openingChanges) {
    console.log(`  → openingBalance would move by ${openingDrift}`);
  } else {
    console.log('  → openingBalance already agrees; no change needed.');
  }
  console.log('\nFirst 3 entries (chronological):');
  for (const w of writes.slice(0, 3)) console.log(' ', w);
  console.log('\nLast 3 entries (chronological):');
  for (const w of writes.slice(-3)) console.log(' ', w);

  // Refuse an ambiguous overwrite BEFORE touching anything, so a rejected run
  // leaves no partial state behind.
  const needsForce = openingChanges && Math.abs(previousOpeningBalance) > 0.005;
  if (opts.apply && needsForce && !opts.forceOpening) {
    throw new Error(
      `Refusing to overwrite a non-zero openingBalance.\n` +
        `  stored:  ${previousOpeningBalance}\n` +
        `  implied: ${impliedStartingBalance}\n` +
        `  drift:   ${openingDrift}\n\n` +
        `These disagree, which means either the stored balance is wrong or a transaction is.\n` +
        `Reconcile against the real statement first. Re-run with --force-opening only once\n` +
        `you are certain the stored balance (${currentBalance}) is the trusted figure.`,
    );
  }

  if (opts.apply) {
    // Opening first, deliberately. The invariant (openingBalance + SUM(tx) ==
    // balance) does not involve the chain at all, so writing the opening ahead
    // of the row updates means a crash mid-rebuild leaves the invariant intact
    // and only the chain stale — and the chain rebuild is idempotent, so it can
    // simply be re-run. The reverse order would leave the invariant broken.
    if (openingChanges) {
      await prisma.account.update({
        where: { id: accountId },
        data: { openingBalance: impliedStartingBalance },
      });
      console.log(
        `\nopeningBalance: ${previousOpeningBalance} → ${impliedStartingBalance}` +
          (opts.forceOpening ? '  (forced)' : ''),
      );
    }

    for (const w of writes) {
      if (w.isInbound) {
        await prisma.transaction.update({
          where: { id: w.id },
          data: { toBalanceBefore: w.before, toBalanceAfter: w.after },
        });
      } else {
        await prisma.transaction.update({
          where: { id: w.id },
          data: { balanceBefore: w.before, balanceAfter: w.after },
        });
      }
    }
    console.log(
      `\nApplied ${writes.length} update(s). Account balance left untouched at ${currentBalance}.`,
    );
  } else {
    console.log('\nDRY RUN — pass --apply to write these values.');
    if (needsForce) {
      console.log('NOTE: --apply will refuse this run without --force-opening (see drift above).');
    }
  }

  return {
    entries: entries.length,
    currentBalance,
    impliedStartingBalance,
    previousOpeningBalance,
    openingBalanceUpdated: opts.apply && openingChanges,
  };
}

async function run() {
  const accountId = process.argv[2];
  if (!accountId || accountId.startsWith('--')) {
    console.error(
      'Usage: npx tsx apps/api/src/scripts/rebuild-balance-chain-backward.ts <accountId> [--apply] [--force-opening]',
    );
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  const forceOpening = process.argv.includes('--force-opening');
  await rebuildBalanceChainBackward(accountId, { apply, forceOpening });
  await prisma.$disconnect();
}

// Only auto-run when executed directly (tsx/node), not when imported —
// run() calls process.exit(1) on missing args, which would otherwise crash
// any test or future consumer that merely imports rebuildBalanceChainBackward.
if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
