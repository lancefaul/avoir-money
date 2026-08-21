import { prisma } from '@budget-tracker/db';
import type { HookDefinition } from '../types.js';
import type { DbClient } from '../db-client.js';
import { applyBitcoinToHolding, bitcoinDetailToMetadata } from '../../holdings.js';

/** Read the current BTC quantity (in BTC) for a wallet's holding. Returns 0 if no holding exists. */
async function getWalletBtcBalance(db: DbClient, walletId: string): Promise<number> {
  const holding = await db.investmentHolding.findFirst({
    where: { type: 'BITCOIN', walletId, ticker: null },
    select: { quantity: true },
  });
  return holding ? Number(holding.quantity) : 0;
}

/** Write balanceBefore/balanceAfter (in BTC) to the transaction. */
async function writeWalletLedger(
  db: DbClient,
  txId: string,
  balanceBefore: number,
  balanceAfter: number,
): Promise<void> {
  await db.transaction.update({
    where: { id: txId },
    data: { balanceBefore, balanceAfter },
  });
}

export const bitcoinHoldingHook: HookDefinition = {
  name: 'bitcoin-holding',
  events: ['created', 'updated', 'deleted'],
  priority: 20,
  condition: (ctx) => !!ctx.tx.bitcoinPaymentDetail,
  async execute(ctx) {
    // Use the caller's transaction client when present so the holding writes and
    // the wallet-ledger write join the enclosing $transaction.
    const db = ctx.db ?? prisma;
    const amount = typeof ctx.tx.amount === 'number' ? ctx.tx.amount : ctx.tx.amount.toNumber();

    if (ctx.event === 'updated' && ctx.oldTx) {
      // Reverse old bitcoin holding
      if (ctx.oldTx.bitcoinPaymentDetail) {
        const oldMeta = bitcoinDetailToMetadata(ctx.oldTx.bitcoinPaymentDetail);
        const oldAmount =
          typeof ctx.oldTx.amount === 'number' ? ctx.oldTx.amount : ctx.oldTx.amount.toNumber();
        await applyBitcoinToHolding(
          oldMeta,
          ctx.oldTx.type as 'EXPENSE' | 'INCOME' | 'REFUND',
          oldAmount,
          -1,
          db,
        );
      }
      // Apply new bitcoin holding with ledger tracking
      const newMeta = bitcoinDetailToMetadata(ctx.tx.bitcoinPaymentDetail!);
      const balanceBefore = await getWalletBtcBalance(db, newMeta.walletId);
      await applyBitcoinToHolding(
        newMeta,
        ctx.tx.type as 'EXPENSE' | 'INCOME' | 'REFUND',
        amount,
        1,
        db,
      );
      const balanceAfter = await getWalletBtcBalance(db, newMeta.walletId);
      await writeWalletLedger(db, ctx.tx.id, balanceBefore, balanceAfter);
    } else if (ctx.event === 'created') {
      const meta = bitcoinDetailToMetadata(ctx.tx.bitcoinPaymentDetail!);
      const balanceBefore = await getWalletBtcBalance(db, meta.walletId);
      await applyBitcoinToHolding(
        meta,
        ctx.tx.type as 'EXPENSE' | 'INCOME' | 'REFUND',
        amount,
        1,
        db,
      );
      const balanceAfter = await getWalletBtcBalance(db, meta.walletId);
      await writeWalletLedger(db, ctx.tx.id, balanceBefore, balanceAfter);
    } else if (ctx.event === 'deleted') {
      const meta = bitcoinDetailToMetadata(ctx.tx.bitcoinPaymentDetail!);
      await applyBitcoinToHolding(
        meta,
        ctx.tx.type as 'EXPENSE' | 'INCOME' | 'REFUND',
        amount,
        -1,
        db,
      );
      // No ledger write on delete — record is already being removed
    }
  },
};
