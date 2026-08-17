/**
 * Account balance utilities.
 * Updates account balances when transactions are created, updated, or deleted.
 */
import { prisma } from '@budget-tracker/db';
import type { DbClient } from './lifecycle/db-client.js';

/**
 * Apply a transaction's effect on account balances.
 * Call with positive multiplier (1) to apply, negative (-1) to reverse.
 *
 * `db` is the client the balance writes run against — the surrounding
 * interactive-transaction client when the ledger gate was called inside one,
 * else the global `prisma`. It must run on the same client as the row write it
 * mirrors, or a rollback undoes the row and leaves the balance moved.
 */
export async function applyTransactionToBalances(
  tx: {
    type: string;
    amount: number | { toNumber(): number };
    netAmount?: number | { toNumber(): number };
    accountId: string | null;
    toAccountId: string | null;
    tradeDetail?: { direction: string } | null;
  },
  multiplier: 1 | -1 = 1,
  db: DbClient = prisma,
) {
  // Skip balance updates for transactions without a bank account (e.g. bitcoin payments)
  if (!tx.accountId) return;

  // Use netAmount (amount minus rewards) when available, falling back to amount
  const rawAmount = tx.netAmount != null ? tx.netAmount : tx.amount;
  const amount = typeof rawAmount === 'number' ? rawAmount : rawAmount.toNumber();
  // Round to 2 decimals to prevent floating point drift in account balance
  const delta = Math.round(amount * multiplier * 100) / 100;

  if (tx.type === 'INCOME' || tx.type === 'REFUND') {
    await db.account.update({
      where: { id: tx.accountId },
      data: { balance: { increment: delta } },
    });
  } else if (tx.type === 'EXPENSE') {
    await db.account.update({
      where: { id: tx.accountId },
      data: { balance: { decrement: delta } },
    });
  } else if (tx.type === 'TRANSFER') {
    await db.account.update({
      where: { id: tx.accountId },
      data: { balance: { decrement: delta } },
    });
    if (tx.toAccountId) {
      await db.account.update({
        where: { id: tx.toAccountId },
        data: { balance: { increment: delta } },
      });
    }
  } else if (tx.type === 'TRADE') {
    const direction = tx.tradeDetail?.direction;
    if (direction === 'BUY') {
      // BUY: money leaves the account (like EXPENSE)
      await db.account.update({
        where: { id: tx.accountId },
        data: { balance: { decrement: delta } },
      });
    } else if (direction === 'SELL') {
      // SELL: money enters the account (like INCOME)
      await db.account.update({
        where: { id: tx.accountId },
        data: { balance: { increment: delta } },
      });
    }
  }
}
