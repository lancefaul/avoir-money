/**
 * Property-based test for insufficient holdings rejection (DB-backed, route-level).
 * Feature: expanded-bitcoin-features, Property 5: Insufficient Holdings Rejection
 *
 * **Validates: Requirements 1.8**
 *
 * For any Bitcoin EXPENSE transaction specifying a quantity q (in BTC) against
 * a wallet whose InvestmentHolding has current quantity Q where q > Q, the
 * Transaction_System SHALL reject the transaction with a 400 error.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { post } from '../../test/helpers.js';

// ─── Helpers ───

async function createTestWallet() {
  return prisma.wallet.create({
    data: { name: `PBT_WALLET_${Date.now()}_${Math.random()}` },
  });
}

async function createTestHolding(walletId: string, quantity: number) {
  return prisma.investmentHolding.create({
    data: {
      name: `PBT_HOLDING_${Date.now()}_${Math.random()}`,
      type: 'BITCOIN',
      ticker: null,
      quantity,
      costBasis: quantity * 50000, // arbitrary cost basis
      walletId,
    },
  });
}

async function createTestCategory() {
  const group = await prisma.budgetGroup.create({
    data: { name: `PBT_GRP_${Date.now()}_${Math.random()}`, color: '#ff0000' },
  });
  return prisma.budget.create({
    data: { name: `PBT_CAT_${Date.now()}_${Math.random()}`, groupId: group.id, isCustom: false },
  });
}

// ─── Generators ───

/** Holding quantity Q in [0.001, 5] BTC. */
const holdingQtyArb = fc.double({ min: 0.001, max: 5, noNaN: true, noDefaultInfinity: true });

/** Excess fraction above Q in (0, 5] BTC — added to Q to get spend quantity. */
const excessArb = fc.double({ min: 0.0001, max: 5, noNaN: true, noDefaultInfinity: true });

/** Unit price in [1, 200000] USD. */
const unitPriceArb = fc.double({ min: 1, max: 200000, noNaN: true, noDefaultInfinity: true });

// ─── Property 5: Insufficient Holdings Rejection ───

describe('Feature: expanded-bitcoin-features, Property 5: Insufficient Holdings Rejection', () => {
  /**
   * **Validates: Requirements 1.8**
   *
   * For any Bitcoin EXPENSE with quantity q > Q (the wallet's holding quantity),
   * the route SHALL reject with a 400 error containing "Insufficient holdings".
   */
  it('EXPENSE with quantity > holding quantity returns 400', async () => {
    await fc.assert(
      fc.asyncProperty(holdingQtyArb, excessArb, unitPriceArb, async (Q, excess, unitPrice) => {
        const wallet = await createTestWallet();
        await createTestHolding(wallet.id, Q);
        const category = await createTestCategory();

        // Spend quantity is strictly greater than holding quantity
        const spendQty = Q + excess;

        const res = await post('/transactions', {
          type: 'EXPENSE',
          name: 'BTC Spend',
          amount: 0, // will be overridden by route
          date: '2026-04-01',
          budgetId: category.id,
          bitcoinMetadata: {
            walletId: wallet.id,
            quantity: spendQty,
            bitcoinUnit: 'Bitcoin',
            unitPrice,
          },
        });

        expect(res.status).toBe(400);
        const body: any = await res.json();
        expect(body.error).toContain('Insufficient holdings');
      }),
      { numRuns: 20 },
    );
  });
});
