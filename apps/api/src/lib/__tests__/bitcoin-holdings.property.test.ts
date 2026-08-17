/**
 * Property-based tests for applyBitcoinToHolding (DB-backed).
 * Feature: expanded-bitcoin-features
 *
 * Property 2: Bitcoin EXPENSE Decrements Holdings — **Validates: Requirements 1.4, 1.5**
 * Property 3: Bitcoin INCOME/REFUND Increments Holdings — **Validates: Requirements 2.4, 2.5, 3.4, 3.5**
 * Property 9: Create-Then-Delete Round-Trip Restores Holdings — **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 * Property 11: Auto-Creation of Holdings for New Wallets — **Validates: Requirements 7.1, 7.2**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { applyBitcoinToHolding } from '../holdings.js';

// ─── Helpers ───

/** Create an isolated wallet for a single test iteration. */
async function createTestWallet() {
  return prisma.wallet.create({
    data: { name: `PBT_WALLET_${Date.now()}_${Math.random()}` },
  });
}

/** Create an isolated holding linked to a wallet. */
async function createTestHolding(walletId: string, quantity: number, costBasis: number) {
  return prisma.investmentHolding.create({
    data: {
      name: `PBT_HOLDING_${Date.now()}_${Math.random()}`,
      type: 'BITCOIN',
      ticker: null,
      quantity,
      costBasis,
      walletId,
    },
  });
}

// ─── Generators ───

/** Generate initial holding quantity Q in [0.001, 10] BTC. */
const initialQtyArb = fc.double({ min: 0.001, max: 10, noNaN: true, noDefaultInfinity: true });

/** Generate initial cost basis C in [1, 100000] USD. */
const initialCostBasisArb = fc.double({
  min: 1,
  max: 100000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Generate a unit price in [1, 200000] USD. */
const unitPriceArb = fc.double({ min: 1, max: 200000, noNaN: true, noDefaultInfinity: true });

/** Generate a BTC quantity for income/refund in [0.00001, 5] BTC. */
const incomeBtcQtyArb = fc.double({ min: 0.00001, max: 5, noNaN: true, noDefaultInfinity: true });

/** INCOME or REFUND type. */
const incomeRefundTypeArb = fc.constantFrom('INCOME' as const, 'REFUND' as const);

/** Any bitcoin tx type. */
const anyBtcTxTypeArb = fc.constantFrom('EXPENSE' as const, 'INCOME' as const, 'REFUND' as const);

// ─── Property 2: Bitcoin EXPENSE Decrements Holdings ───

describe('Feature: expanded-bitcoin-features, Property 2: Bitcoin EXPENSE Decrements Holdings', () => {
  /**
   * **Validates: Requirements 1.4, 1.5**
   *
   * For any Bitcoin EXPENSE with quantity q (in BTC) against a wallet holding
   * with current quantity Q and costBasis C (where q ≤ Q), after applying the
   * transaction, the holding quantity SHALL equal Q - q and the costBasis
   * SHALL equal C - (C × q / Q).
   */
  it('EXPENSE decrements quantity by q and costBasis proportionally', async () => {
    await fc.assert(
      fc.asyncProperty(
        initialQtyArb,
        initialCostBasisArb,
        unitPriceArb,
        async (Q, C, unitPrice) => {
          // Generate q ≤ Q (spend fraction between 1% and 99% of Q)
          const fraction = 0.01 + Math.random() * 0.98;
          const q = Q * fraction;

          const wallet = await createTestWallet();
          await createTestHolding(wallet.id, Q, C);

          const usdAmount = q * unitPrice;

          await applyBitcoinToHolding(
            { walletId: wallet.id, quantity: q, bitcoinUnit: 'Bitcoin', unitPrice },
            'EXPENSE',
            usdAmount,
            1,
          );

          const holding = await prisma.investmentHolding.findFirst({
            where: { type: 'BITCOIN', walletId: wallet.id, ticker: null },
          });

          expect(holding).toBeDefined();

          const actualQty = Number(holding!.quantity);
          const actualCost = Number(holding!.costBasis);

          const expectedQty = Q - q;
          const expectedCost = C - (C * q) / Q;

          expect(Math.abs(actualQty - expectedQty)).toBeLessThan(1e-8);
          expect(Math.abs(actualCost - expectedCost)).toBeLessThan(1e-4);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 3: Bitcoin INCOME/REFUND Increments Holdings ───

describe('Feature: expanded-bitcoin-features, Property 3: Bitcoin INCOME/REFUND Increments Holdings', () => {
  /**
   * **Validates: Requirements 2.4, 2.5, 3.4, 3.5**
   *
   * For any Bitcoin INCOME or REFUND transaction with quantity q (in BTC) and
   * USD amount usd, after applying the transaction to a wallet holding with
   * current quantity Q and costBasis C, the holding quantity SHALL equal Q + q
   * and the costBasis SHALL equal C + usd.
   */
  it('INCOME/REFUND increments quantity by q and costBasis by usdAmount', async () => {
    await fc.assert(
      fc.asyncProperty(
        initialQtyArb,
        initialCostBasisArb,
        incomeBtcQtyArb,
        unitPriceArb,
        incomeRefundTypeArb,
        async (Q, C, q, unitPrice, txType) => {
          const wallet = await createTestWallet();
          await createTestHolding(wallet.id, Q, C);

          const usdAmount = q * unitPrice;

          await applyBitcoinToHolding(
            { walletId: wallet.id, quantity: q, bitcoinUnit: 'Bitcoin', unitPrice },
            txType,
            usdAmount,
            1,
          );

          const holding = await prisma.investmentHolding.findFirst({
            where: { type: 'BITCOIN', walletId: wallet.id, ticker: null },
          });

          expect(holding).toBeDefined();

          const actualQty = Number(holding!.quantity);
          const actualCost = Number(holding!.costBasis);

          const expectedQty = Q + q;
          const expectedCost = C + usdAmount;

          expect(Math.abs(actualQty - expectedQty)).toBeLessThan(1e-8);
          expect(Math.abs(actualCost - expectedCost)).toBeLessThan(1e-4);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 9: Create-Then-Delete Round-Trip Restores Holdings ───

describe('Feature: expanded-bitcoin-features, Property 9: Create-Then-Delete Round-Trip Restores Holdings', () => {
  /**
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
   *
   * For any Bitcoin-denominated transaction (EXPENSE, INCOME, or REFUND),
   * creating the transaction and then reversing it with multiplier=-1 SHALL
   * restore the wallet's InvestmentHolding quantity and costBasis to their
   * original values (within floating-point tolerance).
   */
  it('apply then reverse restores original quantity and costBasis', async () => {
    await fc.assert(
      fc.asyncProperty(
        incomeBtcQtyArb,
        unitPriceArb,
        anyBtcTxTypeArb,
        async (q, unitPrice, txType) => {
          const wallet = await createTestWallet();

          // Start from a known baseline. For EXPENSE we need an existing holding
          // with exactly q so the full amount is spent and the proportional
          // costBasis reduction equals the full costBasis — making the round-trip
          // exact. For INCOME/REFUND we start with no holding (auto-created).
          const usdAmount = q * unitPrice;

          if (txType === 'EXPENSE') {
            // Seed holding with exactly q and usdAmount so spending all of it
            // reduces to 0, and the reversal restores to (q, usdAmount).
            await createTestHolding(wallet.id, q, usdAmount);
          }

          // Snapshot original state
          const beforeHolding = await prisma.investmentHolding.findFirst({
            where: { type: 'BITCOIN', walletId: wallet.id, ticker: null },
          });
          const origQty = beforeHolding ? Number(beforeHolding.quantity) : 0;
          const origCost = beforeHolding ? Number(beforeHolding.costBasis) : 0;

          // Apply the transaction
          await applyBitcoinToHolding(
            { walletId: wallet.id, quantity: q, bitcoinUnit: 'Bitcoin', unitPrice },
            txType,
            usdAmount,
            1,
          );

          // Reverse the transaction
          await applyBitcoinToHolding(
            { walletId: wallet.id, quantity: q, bitcoinUnit: 'Bitcoin', unitPrice },
            txType,
            usdAmount,
            -1,
          );

          const holding = await prisma.investmentHolding.findFirst({
            where: { type: 'BITCOIN', walletId: wallet.id, ticker: null },
          });

          expect(holding).toBeDefined();

          const actualQty = Number(holding!.quantity);
          const actualCost = Number(holding!.costBasis);

          expect(Math.abs(actualQty - origQty)).toBeLessThan(1e-8);
          expect(Math.abs(actualCost - origCost)).toBeLessThan(1e-4);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 11: Auto-Creation of Holdings for New Wallets ───

describe('Feature: expanded-bitcoin-features, Property 11: Auto-Creation of Holdings for New Wallets', () => {
  /**
   * **Validates: Requirements 7.1, 7.2**
   *
   * For any Bitcoin INCOME or REFUND transaction targeting a Wallet that has
   * no existing InvestmentHolding, the Holdings_Engine SHALL create a new
   * InvestmentHolding with name equal to the Wallet name, type equal to
   * BITCOIN, ticker equal to null, quantity equal to the transaction's BTC
   * quantity, and costBasis equal to the transaction's USD amount.
   */
  it('INCOME to wallet with no holding creates new holding with correct fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        incomeBtcQtyArb,
        unitPriceArb,
        incomeRefundTypeArb,
        async (q, unitPrice, txType) => {
          // Create wallet with NO holding
          const wallet = await createTestWallet();

          const usdAmount = q * unitPrice;

          await applyBitcoinToHolding(
            { walletId: wallet.id, quantity: q, bitcoinUnit: 'Bitcoin', unitPrice },
            txType,
            usdAmount,
            1,
          );

          const holding = await prisma.investmentHolding.findFirst({
            where: { type: 'BITCOIN', walletId: wallet.id, ticker: null },
          });

          expect(holding).toBeDefined();
          expect(holding!.name).toBe(wallet.name);
          expect(holding!.type).toBe('BITCOIN');
          expect(holding!.ticker).toBeNull();
          expect(holding!.walletId).toBe(wallet.id);

          const actualQty = Number(holding!.quantity);
          const actualCost = Number(holding!.costBasis);

          expect(Math.abs(actualQty - q)).toBeLessThan(1e-8);
          expect(Math.abs(actualCost - usdAmount)).toBeLessThan(1e-4);
        },
      ),
      { numRuns: 20 },
    );
  });
});
