/**
 * Property-based test for update reversal (DB-backed, route-level).
 * Feature: expanded-bitcoin-features, Property 10: Update Correctly Reverses Old and Applies New Holdings
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
 *
 * For any Bitcoin INCOME transaction that is updated (changing quantity),
 * the resulting holdings state SHALL be equivalent to having deleted the
 * original transaction and created a new one with the updated values.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { post, put } from '../../test/helpers.js';

// ─── Helpers ───

/** No sentinel account needed — bitcoin transactions have null accountId. */

async function createTestWallet() {
  return prisma.wallet.create({
    data: { name: `PBT_WALLET_${Date.now()}_${Math.random()}` },
  });
}

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

async function createTestCategory() {
  const group = await prisma.budgetGroup.create({
    data: { name: `PBT_GRP_${Date.now()}_${Math.random()}`, color: '#ff0000' },
  });
  return prisma.budget.create({
    data: { name: `PBT_CAT_${Date.now()}_${Math.random()}`, groupId: group.id, isCustom: false },
  });
}

// ─── Generators ───

/** Initial holding quantity Q in [0.01, 5] BTC. */
const holdingQtyArb = fc.double({ min: 0.01, max: 5, noNaN: true, noDefaultInfinity: true });

/** Initial cost basis C in [100, 500000] USD. */
const costBasisArb = fc.double({ min: 100, max: 500000, noNaN: true, noDefaultInfinity: true });

/** Transaction quantity q1, q2 in [0.001, 2] BTC. */
const txQtyArb = fc.double({ min: 0.001, max: 2, noNaN: true, noDefaultInfinity: true });

/** Unit price in [1, 200000] USD. */
const unitPriceArb = fc.double({ min: 1, max: 200000, noNaN: true, noDefaultInfinity: true });

// ─── Property 10: Update Correctly Reverses Old and Applies New Holdings ───

describe('Feature: expanded-bitcoin-features, Property 10: Update Correctly Reverses Old and Applies New Holdings', () => {
  /**
   * **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
   *
   * 1. Create a wallet with holding (Q, C)
   * 2. POST an INCOME transaction with quantity q1 → holding becomes (Q+q1, C+usd1)
   * 3. PUT to update the transaction with quantity q2
   * 4. Verify holding matches the expected state: (Q+q2, C+usd2)
   *    i.e. the old effect (q1, usd1) was reversed and the new effect (q2, usd2) was applied
   */
  it('update reverses old INCOME and applies new, holdings match delete-then-create equivalent', async () => {
    await fc.assert(
      fc.asyncProperty(
        holdingQtyArb,
        costBasisArb,
        txQtyArb,
        txQtyArb,
        unitPriceArb,
        async (Q, C, q1, q2, unitPrice) => {
          // Setup: wallet + initial holding
          const wallet = await createTestWallet();
          await createTestHolding(wallet.id, Q, C);
          const category = await createTestCategory();

          const usd1 = q1 * unitPrice;
          const usd2 = q2 * unitPrice;

          // Step 1: Create INCOME transaction with q1
          const createRes = await post('/transactions', {
            type: 'INCOME',
            name: 'BTC Income',
            amount: 0,
            date: '2026-04-01',
            budgetId: category.id,
            bitcoinMetadata: {
              walletId: wallet.id,
              quantity: q1,
              bitcoinUnit: 'Bitcoin',
              unitPrice,
            },
          });

          expect(createRes.status).toBe(201);
          const created: any = await createRes.json();
          const txId = created.id;

          // Step 2: Update the transaction with q2
          const updateRes = await put(`/transactions/${txId}`, {
            type: 'INCOME',
            name: 'BTC Income Updated',
            amount: 0,
            date: '2026-04-01',
            budgetId: category.id,
            bitcoinMetadata: {
              walletId: wallet.id,
              quantity: q2,
              bitcoinUnit: 'Bitcoin',
              unitPrice,
            },
          });

          expect(updateRes.status).toBe(200);

          // Step 3: Read the holding from DB and verify
          const holding = await prisma.investmentHolding.findFirst({
            where: { type: 'BITCOIN', walletId: wallet.id, ticker: null },
          });

          expect(holding).not.toBeNull();

          const actualQty = Number(holding!.quantity);
          const actualCostBasis = Number(holding!.costBasis);

          // Expected quantity: the update reverses q1 then applies q2
          // After POST:    qty = Q + q1,  cost = C + usd1
          // Reverse INCOME (proportional decrement):
          //   proportion = q1 / (Q + q1)
          //   cost after reversal = (C + usd1) - (C + usd1) * q1 / (Q + q1)
          //                       = (C + usd1) * Q / (Q + q1)
          //   qty after reversal  = Q
          // Apply new INCOME q2:
          //   qty  = Q + q2
          //   cost = (C + usd1) * Q / (Q + q1) + usd2
          const expectedQty = Q + q2;
          const costAfterReversal = ((C + usd1) * Q) / (Q + q1);
          const expectedCostBasis = costAfterReversal + usd2;

          expect(Math.abs(actualQty - expectedQty)).toBeLessThan(1e-6);
          expect(Math.abs(actualCostBasis - expectedCostBasis)).toBeLessThan(
            Math.max(Math.abs(expectedCostBasis) * 1e-6, 0.01),
          );
        },
      ),
      { numRuns: 20 },
    );
  });
});
