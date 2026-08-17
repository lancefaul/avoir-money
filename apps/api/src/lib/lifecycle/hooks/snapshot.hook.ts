import { prisma } from '@budget-tracker/db';
import type { HookDefinition } from '../types.js';
import { regenerateHoldingSnapshot } from '../../snapshot-generator.js';

/**
 * Snapshot lifecycle hook — regenerates today's investment snapshot
 * when a BTC-related transaction is created, updated, or deleted.
 *
 * Priority 50: runs after all other hooks to capture the final holding state.
 *
 * The snapshot regeneration is awaited (best-effort on errors) so the mutation
 * completes deterministically. A previous fire-and-forget version let the regen
 * write to the DB in the background AFTER the request returned, which — in the
 * test suite — bled snapshot rows into the next test's setup under load and
 * caused intermittent failures.
 */
export const snapshotHook: HookDefinition = {
  name: 'snapshot',
  events: ['created', 'updated', 'deleted'],
  priority: 50,
  condition: (ctx) => {
    // Fire for BTC trades
    if (ctx.tx.tradeDetail?.assetType === 'Bitcoin') return true;
    // Fire for bitcoin income/expense
    if (ctx.tx.bitcoinPaymentDetail) return true;
    return false;
  },
  async execute(ctx) {
    const db = ctx.db ?? prisma;
    // Determine affected holding(s) via wallet lookup
    const holdingIds = new Set<string>();

    const addWalletHolding = async (walletId: string | null | undefined) => {
      if (!walletId) return;
      const holding = await db.investmentHolding.findFirst({
        where: { type: 'BITCOIN', walletId },
        select: { id: true },
      });
      if (holding) holdingIds.add(holding.id);
    };

    if (ctx.tx.tradeDetail?.assetType === 'Bitcoin') {
      await addWalletHolding(ctx.tx.tradeDetail.walletId);
    }
    await addWalletHolding(ctx.tx.bitcoinPaymentDetail?.walletId);

    // Also handle old tx wallet if this is an update (regen old holding too)
    if (ctx.event === 'updated' && ctx.oldTx) {
      if (ctx.oldTx.tradeDetail?.assetType === 'Bitcoin') {
        await addWalletHolding(ctx.oldTx.tradeDetail.walletId);
      }
      await addWalletHolding(ctx.oldTx.bitcoinPaymentDetail?.walletId);
    }

    // Regenerate today's snapshot for each affected holding. Awaited so the
    // mutation fully completes before returning (no background DB writes that
    // could bleed across test boundaries). Best-effort: a regen failure must
    // not fail the mutation.
    for (const holdingId of holdingIds) {
      try {
        await regenerateHoldingSnapshot(holdingId);
      } catch {
        // Swallow — snapshot regen is best-effort and should not crash the request.
      }
    }
  },
};
