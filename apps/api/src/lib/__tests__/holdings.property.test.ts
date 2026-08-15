/**
 * Property-based tests for holdings utility.
 * Feature: holdings-overhaul
 *
 * Property 4: Trade-to-holding FK propagation — **Validates: Requirements 5.1, 5.2**
 * Property 5: Trade reversal round-trip — **Validates: Requirements 5.3**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { applyTradeToHolding } from '../holdings.js';

// ─── Generators ───

const TICKERS = ['AAPL', 'GOOG', 'MSFT', 'TSLA', 'NVDA', 'META', 'AMZN', 'NFLX'];

function stockTradeArb() {
  return fc.record({
    direction: fc.constant('BUY' as const),
    assetType: fc.constant('Stock' as const),
    ticker: fc.constantFrom(...TICKERS),
    unitPrice: fc.integer({ min: 1, max: 10000 }),
    quantity: fc.integer({ min: 1, max: 1000 }),
  });
}

function bitcoinTradeArb() {
  return fc.record({
    direction: fc.constant('BUY' as const),
    assetType: fc.constant('Bitcoin' as const),
    unitPrice: fc.integer({ min: 1, max: 100000 }),
    quantity: fc.integer({ min: 1, max: 1000000 }),
    bitcoinUnit: fc.constant('Sats' as const),
  });
}

describe('Feature: holdings-overhaul, Property 4: Trade-to-holding FK propagation', () => {
  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * For any trade transaction with a custodianId or walletId in its metadata,
   * after applying the trade, the resulting holding has the same custodianId
   * or walletId as the trade metadata, and the holding name is derived from
   * the Custodian or Wallet name.
   */
  it('stock trade propagates custodianId and derives name from custodian', async () => {
    await fc.assert(
      fc.asyncProperty(stockTradeArb(), async (trade) => {
        const custodian = await prisma.custodian.create({
          data: { name: `Cust_${Date.now()}_${Math.random()}` },
        });

        const meta = { ...trade, custodianId: custodian.id };
        const usdAmount = trade.unitPrice * trade.quantity;

        await applyTradeToHolding(meta, usdAmount, 1);

        const holding = await prisma.investmentHolding.findFirst({
          where: {
            type: 'STOCK',
            ticker: trade.ticker,
            custodianId: custodian.id,
          },
        });

        expect(holding).toBeDefined();
        expect(holding!.custodianId).toBe(custodian.id);
        expect(holding!.walletId).toBeNull();
        expect(holding!.name).toBe(custodian.name);
      }),
      { numRuns: 20 },
    );
  });

  it('bitcoin trade propagates walletId and derives name from wallet', async () => {
    await fc.assert(
      fc.asyncProperty(bitcoinTradeArb(), async (trade) => {
        const wallet = await prisma.wallet.create({
          data: { name: `Wallet_${Date.now()}_${Math.random()}` },
        });

        const meta = { ...trade, walletId: wallet.id };
        const usdAmount = trade.unitPrice * trade.quantity;

        await applyTradeToHolding(meta, usdAmount, 1);

        const holding = await prisma.investmentHolding.findFirst({
          where: {
            type: 'BITCOIN',
            ticker: null,
            walletId: wallet.id,
          },
        });

        expect(holding).toBeDefined();
        expect(holding!.walletId).toBe(wallet.id);
        expect(holding!.custodianId).toBeNull();
        expect(holding!.name).toBe(wallet.name);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 5: Trade reversal round-trip ───

describe('Feature: holdings-overhaul, Property 5: Trade reversal round-trip', () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * For any trade transaction, applying the trade (multiplier=1) and then
   * reversing it (multiplier=-1) returns the holding's quantity and cost
   * basis to their original values (within floating-point tolerance).
   */
  it('stock BUY then reversal restores quantity and costBasis', async () => {
    await fc.assert(
      fc.asyncProperty(stockTradeArb(), async (trade) => {
        const custodian = await prisma.custodian.create({
          data: { name: `Cust_${Date.now()}_${Math.random()}` },
        });

        const meta = { ...trade, custodianId: custodian.id };
        const usdAmount = trade.unitPrice * trade.quantity;

        // Apply the trade (creates a new holding)
        await applyTradeToHolding(meta, usdAmount, 1);

        const holdingAfterBuy = await prisma.investmentHolding.findFirst({
          where: { type: 'STOCK', ticker: trade.ticker, custodianId: custodian.id },
        });
        expect(holdingAfterBuy).toBeDefined();

        const qtyAfterBuy = Number(holdingAfterBuy!.quantity);
        const costAfterBuy = Number(holdingAfterBuy!.costBasis ?? 0);

        // Reverse the trade
        await applyTradeToHolding(meta, usdAmount, -1);

        const holdingAfterReversal = await prisma.investmentHolding.findFirst({
          where: { type: 'STOCK', ticker: trade.ticker, custodianId: custodian.id },
        });
        expect(holdingAfterReversal).toBeDefined();

        const qtyAfterReversal = Number(holdingAfterReversal!.quantity);
        const costAfterReversal = Number(holdingAfterReversal!.costBasis ?? 0);

        // Quantity and costBasis should return to 0 (the original state before the trade)
        expect(qtyAfterReversal).toBeCloseTo(qtyAfterBuy - trade.quantity, 5);
        expect(costAfterReversal).toBeCloseTo(costAfterBuy - usdAmount, 5);
      }),
      { numRuns: 20 },
    );
  });

  it('bitcoin BUY then reversal restores quantity and costBasis', async () => {
    await fc.assert(
      fc.asyncProperty(bitcoinTradeArb(), async (trade) => {
        const wallet = await prisma.wallet.create({
          data: { name: `Wallet_${Date.now()}_${Math.random()}` },
        });

        const meta = { ...trade, walletId: wallet.id };
        // Convert sats to BTC for USD computation, matching applyTradeToHolding internals
        const btcQuantity =
          trade.bitcoinUnit === 'Sats' ? trade.quantity / 100_000_000 : trade.quantity;
        const usdAmount = trade.unitPrice * btcQuantity;

        // Apply the trade (creates a new holding)
        await applyTradeToHolding(meta, usdAmount, 1);

        const holdingAfterBuy = await prisma.investmentHolding.findFirst({
          where: { type: 'BITCOIN', ticker: null, walletId: wallet.id },
        });
        expect(holdingAfterBuy).toBeDefined();

        const qtyAfterBuy = Number(holdingAfterBuy!.quantity);
        const costAfterBuy = Number(holdingAfterBuy!.costBasis ?? 0);

        // Reverse the trade
        await applyTradeToHolding(meta, usdAmount, -1);

        const holdingAfterReversal = await prisma.investmentHolding.findFirst({
          where: { type: 'BITCOIN', ticker: null, walletId: wallet.id },
        });
        expect(holdingAfterReversal).toBeDefined();

        const qtyAfterReversal = Number(holdingAfterReversal!.quantity);
        const costAfterReversal = Number(holdingAfterReversal!.costBasis ?? 0);

        // Quantity and costBasis should return to 0 (the original state before the trade)
        // Use btcQuantity (converted) for comparison, not raw trade.quantity (sats)
        expect(qtyAfterReversal).toBeCloseTo(qtyAfterBuy - btcQuantity, 5);
        expect(costAfterReversal).toBeCloseTo(costAfterBuy - usdAmount, 5);
      }),
      { numRuns: 20 },
    );
  });
});
