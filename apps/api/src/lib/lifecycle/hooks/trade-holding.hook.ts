import type { HookDefinition } from '../types.js';
import { applyTradeToHolding, tradeDetailToMetadata } from '../../holdings.js';
import { prisma } from '@budget-tracker/db';

export const tradeHoldingHook: HookDefinition = {
  name: 'trade-holding',
  events: ['created', 'updated', 'deleted'],
  priority: 20,
  condition: (ctx) => ctx.tx.type === 'TRADE' && !!ctx.tx.tradeDetail,
  async execute(ctx) {
    // Use the caller's transaction client when present so the holding writes and
    // the costBasisAllocated write join the enclosing $transaction.
    const db = ctx.db ?? prisma;
    const amount = typeof ctx.tx.amount === 'number' ? ctx.tx.amount : ctx.tx.amount.toNumber();

    if (ctx.event === 'updated' && ctx.oldTx) {
      // Reverse old trade (only if old tx was also a TRADE with a detail row)
      if (ctx.oldTx.tradeDetail) {
        const oldMeta = tradeDetailToMetadata(ctx.oldTx.tradeDetail);
        const oldAmount =
          typeof ctx.oldTx.amount === 'number' ? ctx.oldTx.amount : ctx.oldTx.amount.toNumber();
        await applyTradeToHolding(oldMeta, oldAmount, -1, db);
      }
      // Apply new trade
      const newMeta = tradeDetailToMetadata(ctx.tx.tradeDetail!);
      const result = await applyTradeToHolding(newMeta, amount, 1, db);
      // Write costBasisAllocated for SELL trades
      if (result.costBasisAllocated !== undefined) {
        await db.transaction.update({
          where: { id: ctx.tx.id },
          data: { costBasisAllocated: result.costBasisAllocated },
        });
      }
    } else if (ctx.event === 'created') {
      const meta = tradeDetailToMetadata(ctx.tx.tradeDetail!);
      const result = await applyTradeToHolding(meta, amount, 1, db);
      // Write costBasisAllocated for SELL trades
      if (result.costBasisAllocated !== undefined) {
        await db.transaction.update({
          where: { id: ctx.tx.id },
          data: { costBasisAllocated: result.costBasisAllocated },
        });
      }
    } else if (ctx.event === 'deleted') {
      const meta = tradeDetailToMetadata(ctx.tx.tradeDetail!);
      await applyTradeToHolding(meta, amount, -1, db);
    }
  },
};
