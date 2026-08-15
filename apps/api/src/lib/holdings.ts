/**
 * Investment holding utilities.
 * Adjusts InvestmentHolding records when trade transactions are created or deleted.
 */
import { prisma } from '@budget-tracker/db';
import type { DbClient } from './lifecycle/db-client.js';

interface TradeMetadata {
  direction: 'BUY' | 'SELL';
  assetType: 'Stock' | 'Bitcoin';
  ticker?: string;
  unitPrice: number;
  quantity: number;
  bitcoinUnit?: 'Bitcoin' | 'Sats';
  custodianId?: string;
  walletId?: string;
}

const detailNum = (v: number | { toNumber(): number }): number =>
  typeof v === 'number' ? v : v.toNumber();

/** Adapt a persisted TradeDetail row to the trade-holding input shape. */
export function tradeDetailToMetadata(d: {
  direction: string;
  assetType: string;
  ticker: string | null;
  quantity: number | { toNumber(): number };
  unitPrice: number | { toNumber(): number };
  bitcoinUnit: string | null;
  custodianId: string | null;
  walletId: string | null;
}): TradeMetadata {
  return {
    direction: d.direction as 'BUY' | 'SELL',
    assetType: d.assetType as 'Stock' | 'Bitcoin',
    ticker: d.ticker ?? undefined,
    unitPrice: detailNum(d.unitPrice),
    quantity: detailNum(d.quantity),
    bitcoinUnit: (d.bitcoinUnit ?? undefined) as 'Bitcoin' | 'Sats' | undefined,
    custodianId: d.custodianId ?? undefined,
    walletId: d.walletId ?? undefined,
  };
}

/**
 * Apply a trade's effect on investment holdings.
 *
 * @param tradeMetadata - The parsed trade metadata from the transaction
 * @param usdAmount - The USD amount of the trade
 * @param multiplier - 1 to apply (create), -1 to reverse (delete)
 */
export async function applyTradeToHolding(
  tradeMetadata: TradeMetadata,
  usdAmount: number,
  multiplier: 1 | -1 = 1,
  db: DbClient = prisma,
): Promise<{ costBasisAllocated?: number }> {
  const { direction, assetType, quantity: rawQuantity } = tradeMetadata;

  // Convert sats to BTC if needed
  const quantity =
    assetType === 'Bitcoin' && tradeMetadata.bitcoinUnit === 'Sats'
      ? rawQuantity / 100_000_000
      : rawQuantity;

  // Determine holding type and ticker
  const holdingType = assetType === 'Stock' ? 'STOCK' : 'BITCOIN';
  const ticker = assetType === 'Stock' ? tradeMetadata.ticker! : null;

  // Build match criteria using FK instead of accountName
  const matchWhere = {
    type: holdingType as 'STOCK' | 'BITCOIN',
    ...(assetType === 'Stock'
      ? { custodianId: tradeMetadata.custodianId! }
      : { walletId: tradeMetadata.walletId! }),
    ...(ticker ? { ticker } : { ticker: null }),
  };

  // Find existing holding
  const existing = await db.investmentHolding.findFirst({ where: matchWhere });

  // Determine effective direction considering multiplier
  // multiplier=-1 reverses: a BUY reversal acts like SELL, a SELL reversal acts like BUY
  const isBuy =
    (direction === 'BUY' && multiplier === 1) || (direction === 'SELL' && multiplier === -1);

  if (isBuy) {
    // Increment quantity and cost basis
    if (existing) {
      await db.investmentHolding.update({
        where: { id: existing.id },
        data: {
          quantity: { increment: quantity },
          costBasis: { increment: usdAmount },
        },
      });
    } else {
      // Look up custodian/wallet name for the holding display name
      let entityName: string;
      if (assetType === 'Stock') {
        const custodian = await db.custodian.findUniqueOrThrow({
          where: { id: tradeMetadata.custodianId! },
        });
        entityName = custodian.name;
      } else {
        const wallet = await db.wallet.findUniqueOrThrow({
          where: { id: tradeMetadata.walletId! },
        });
        entityName = wallet.name;
      }

      await db.investmentHolding.create({
        data: {
          name: entityName,
          ticker,
          type: holdingType as 'STOCK' | 'BITCOIN',
          quantity,
          costBasis: usdAmount,
          ...(assetType === 'Stock'
            ? { custodianId: tradeMetadata.custodianId! }
            : { walletId: tradeMetadata.walletId! }),
        },
      });
    }
    return {};
  } else {
    // Decrement quantity and proportional cost basis
    if (existing) {
      const currentQty = Number(existing.quantity);
      const currentCostBasis = Number(existing.costBasis ?? 0);

      // Proportional cost basis: (quantity sold / current quantity) * current cost basis
      const proportion = currentQty > 0 ? quantity / currentQty : 0;
      const costBasisReduction = currentCostBasis * proportion;

      await db.investmentHolding.update({
        where: { id: existing.id },
        data: {
          quantity: { decrement: quantity },
          costBasis: { decrement: costBasisReduction },
        },
      });

      return { costBasisAllocated: costBasisReduction };
    }
    // If no existing holding for a sell, nothing to decrement (shouldn't happen with proper validation)
    return {};
  }
}

// ─── Bitcoin Payment Holdings ───

interface BitcoinPaymentMetadata {
  walletId: string;
  quantity: number;
  bitcoinUnit: 'Bitcoin' | 'Sats';
  unitPrice: number;
}

/** Adapt a persisted BitcoinPaymentDetail row to the bitcoin-holding input shape. */
export function bitcoinDetailToMetadata(d: {
  walletId: string;
  quantity: number | { toNumber(): number };
  unitPrice: number | { toNumber(): number };
  bitcoinUnit: string;
}): BitcoinPaymentMetadata {
  return {
    walletId: d.walletId,
    quantity: detailNum(d.quantity),
    bitcoinUnit: d.bitcoinUnit as 'Bitcoin' | 'Sats',
    unitPrice: detailNum(d.unitPrice),
  };
}

/**
 * Compute the USD equivalent for a Bitcoin payment.
 *
 * - Bitcoin: usdAmount = quantity × unitPrice
 * - Sats:    usdAmount = (quantity / 100_000_000) × unitPrice
 */
export function computeUsdAmount(
  quantity: number,
  bitcoinUnit: 'Bitcoin' | 'Sats',
  unitPrice: number,
): number {
  const btcQuantity = bitcoinUnit === 'Sats' ? quantity / 100_000_000 : quantity;
  return btcQuantity * unitPrice;
}

/**
 * Back-calculate the unit price (USD per BTC) given a USD equivalent and quantity.
 *
 * This is the inverse of `computeUsdAmount`:
 *   computeUsdAmount(quantity, unit, backCalculateUnitPrice(usd, quantity, unit)) ≈ usd
 *
 * - If bitcoinUnit is 'Sats', converts quantity to BTC first.
 * - Returns usdEquivalent / btcQuantity.
 */
export function backCalculateUnitPrice(
  usdEquivalent: number,
  quantity: number,
  bitcoinUnit: 'Bitcoin' | 'Sats',
): number {
  const btcQuantity = bitcoinUnit === 'Sats' ? quantity / 100_000_000 : quantity;
  return usdEquivalent / btcQuantity;
}

/**
 * Apply a Bitcoin payment's effect on investment holdings.
 *
 * EXPENSE+multiplier=1 → decrement (spending BTC)
 * EXPENSE+multiplier=-1 → increment (reversing a spend)
 * INCOME/REFUND+multiplier=1 → increment (receiving BTC)
 * INCOME/REFUND+multiplier=-1 → decrement proportionally (reversing a receive)
 *
 * @param meta - The parsed Bitcoin payment metadata from the transaction
 * @param txType - The transaction type (EXPENSE, INCOME, or REFUND)
 * @param usdAmount - The USD equivalent amount of the transaction
 * @param multiplier - 1 to apply (create), -1 to reverse (delete)
 */
export async function applyBitcoinToHolding(
  meta: BitcoinPaymentMetadata,
  txType: 'EXPENSE' | 'INCOME' | 'REFUND',
  usdAmount: number,
  multiplier: 1 | -1 = 1,
  db: DbClient = prisma,
): Promise<void> {
  // Convert sats to BTC if needed
  const btcQuantity = meta.bitcoinUnit === 'Sats' ? meta.quantity / 100_000_000 : meta.quantity;

  // Find existing holding for this wallet
  const existing = await db.investmentHolding.findFirst({
    where: { type: 'BITCOIN', walletId: meta.walletId, ticker: null },
  });

  // Determine effective direction:
  // EXPENSE+1 = decrement, EXPENSE-1 = increment
  // INCOME/REFUND+1 = increment, INCOME/REFUND-1 = decrement
  const isIncrement =
    (txType === 'EXPENSE' && multiplier === -1) ||
    ((txType === 'INCOME' || txType === 'REFUND') && multiplier === 1);

  if (isIncrement) {
    if (existing) {
      await db.investmentHolding.update({
        where: { id: existing.id },
        data: {
          quantity: { increment: btcQuantity },
          costBasis: { increment: usdAmount },
        },
      });
    } else {
      // Auto-create holding — look up wallet name
      const wallet = await db.wallet.findUniqueOrThrow({
        where: { id: meta.walletId },
      });

      await db.investmentHolding.create({
        data: {
          name: wallet.name,
          type: 'BITCOIN',
          ticker: null,
          quantity: btcQuantity,
          costBasis: usdAmount,
          walletId: meta.walletId,
        },
      });
    }
  } else {
    // Decrement quantity and proportional costBasis
    if (existing) {
      const currentQty = Number(existing.quantity);
      const currentCostBasis = Number(existing.costBasis ?? 0);

      const proportion = currentQty > 0 ? btcQuantity / currentQty : 0;
      const costBasisReduction = currentCostBasis * proportion;

      await db.investmentHolding.update({
        where: { id: existing.id },
        data: {
          quantity: { decrement: btcQuantity },
          costBasis: { decrement: costBasisReduction },
        },
      });
    }
    // If no existing holding for a decrement, nothing to do (shouldn't happen with proper validation)
  }
}
