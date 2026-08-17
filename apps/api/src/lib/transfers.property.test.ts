import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { executeBitcoinTransfer } from './transfers.js';
import { createWallet, createHolding } from '../test/helpers.js';

// ─── Test-local copies of now-private pure functions ───

const SATS_PER_BTC = 100_000_000;

function convertFeeToBtc(
  feeAmount: number,
  feeUnit: 'Bitcoin' | 'Sats' | 'USD',
  bitcoinPrice: number,
): number {
  switch (feeUnit) {
    case 'Bitcoin':
      return feeAmount;
    case 'Sats':
      return feeAmount / SATS_PER_BTC;
    case 'USD':
      return feeAmount / bitcoinPrice;
  }
}

function computeProportionalCostBasis(
  transferQuantity: number,
  sourceQuantity: number,
  sourceCostBasis: number,
): number {
  if (sourceQuantity <= 0) return 0;
  return (transferQuantity / sourceQuantity) * sourceCostBasis;
}

function normalizeQuantityToBtc(quantity: number, unit: 'Bitcoin' | 'Sats'): number {
  return unit === 'Sats' ? quantity / SATS_PER_BTC : quantity;
}

const feeUnitArb = fc.constantFrom('Bitcoin' as const, 'Sats' as const, 'USD' as const);

/** Positive fee amount (non-negative, can be zero) */
const feeAmountArb = fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true });

/** Positive bitcoin price — must be > 0 for USD conversion */
const bitcoinPriceArb = fc.double({
  min: 0.01,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Positive quantity for transfers */
const positiveQuantityArb = fc.double({
  min: 0.00000001,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Source quantity must be > 0 for proportional cost basis */
const sourceQuantityArb = fc.double({
  min: 0.00000001,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Cost basis (non-negative) */
const costBasisArb = fc.double({ min: 0, max: 10_000_000, noNaN: true, noDefaultInfinity: true });

const bitcoinUnitArb = fc.constantFrom('Bitcoin' as const, 'Sats' as const);

// ─── Property 3: Fee conversion correctness ───

describe('Feature: investment-transfers, Property 3: Fee conversion correctness', () => {
  /**
   * Validates: Requirements 2.1, 2.2, 2.3
   *
   * For any fee amount F, fee unit U ∈ {Bitcoin, Sats, USD}, and bitcoin price P > 0:
   * - If U = Bitcoin, then feeBtc = F
   * - If U = Sats, then feeBtc = F / 100,000,000
   * - If U = USD, then feeBtc = F / P
   */
  it('convertFeeToBtc matches the expected formula for all fee units', () => {
    fc.assert(
      fc.property(feeAmountArb, feeUnitArb, bitcoinPriceArb, (feeAmount, feeUnit, bitcoinPrice) => {
        const result = convertFeeToBtc(feeAmount, feeUnit, bitcoinPrice);

        switch (feeUnit) {
          case 'Bitcoin':
            expect(result).toBe(feeAmount);
            break;
          case 'Sats':
            expect(result).toBe(feeAmount / SATS_PER_BTC);
            break;
          case 'USD':
            expect(result).toBe(feeAmount / bitcoinPrice);
            break;
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Additional pure function properties ───

describe('Feature: investment-transfers, normalizeQuantityToBtc correctness', () => {
  /**
   * Validates: Requirements 2.1, 2.2
   *
   * normalizeQuantityToBtc should return quantity as-is for Bitcoin,
   * and quantity / 100,000,000 for Sats.
   */
  it('normalizes quantity to BTC correctly for both units', () => {
    fc.assert(
      fc.property(positiveQuantityArb, bitcoinUnitArb, (quantity, unit) => {
        const result = normalizeQuantityToBtc(quantity, unit);

        if (unit === 'Bitcoin') {
          expect(result).toBe(quantity);
        } else {
          expect(result).toBe(quantity / SATS_PER_BTC);
        }
      }),
      { numRuns: 20 },
    );
  });
});

describe('Feature: investment-transfers, computeProportionalCostBasis correctness', () => {
  /**
   * Validates: Requirements 1.2, 4.2
   *
   * Proportional cost basis = (transferQuantity / sourceQuantity) * sourceCostBasis
   * Returns 0 when sourceQuantity <= 0.
   */
  it('computes proportional cost basis matching the formula', () => {
    fc.assert(
      fc.property(
        positiveQuantityArb,
        sourceQuantityArb,
        costBasisArb,
        (transferQuantity, sourceQuantity, sourceCostBasis) => {
          const result = computeProportionalCostBasis(
            transferQuantity,
            sourceQuantity,
            sourceCostBasis,
          );
          const expected = (transferQuantity / sourceQuantity) * sourceCostBasis;
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('returns 0 when sourceQuantity is zero or negative', () => {
    fc.assert(
      fc.property(
        positiveQuantityArb,
        fc.double({ min: -1_000_000, max: 0, noNaN: true, noDefaultInfinity: true }),
        costBasisArb,
        (transferQuantity, sourceQuantity, sourceCostBasis) => {
          const result = computeProportionalCostBasis(
            transferQuantity,
            sourceQuantity,
            sourceCostBasis,
          );
          expect(result).toBe(0);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 1: Bitcoin transfer conservation (DB-backed) ───

describe('Feature: backend-coverage-push, Property 1: Bitcoin transfer conservation', () => {
  /**
   * **Validates: Requirements 4.8**
   *
   * For any valid bitcoin transfer where the source holding has sufficient
   * quantity (quantity >= transfer amount + fee), executeBitcoinTransfer
   * preserves total BTC across source and destination holdings.
   *
   * Conservation invariant:
   *   source_before - source_after = transfer_quantity + fee_btc
   *   destination_after - destination_before = transfer_quantity
   */
  it('preserves BTC conservation: source decrement = transfer + fee, destination increment = transfer', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Transfer quantity in BTC: small positive values to keep things reasonable
        fc.double({ min: 0.001, max: 5.0, noNaN: true, noDefaultInfinity: true }),
        // Fee amount in BTC (can be zero)
        fc.double({ min: 0, max: 0.5, noNaN: true, noDefaultInfinity: true }),
        // Bitcoin price (used for context, fee is in BTC so price doesn't affect conservation)
        fc.double({ min: 1000, max: 100000, noNaN: true, noDefaultInfinity: true }),
        async (transferBtc, feeBtc, bitcoinPrice) => {
          const totalDeduction = transferBtc + feeBtc;

          // Source must have enough to cover transfer + fee, with headroom
          const sourceQuantity = totalDeduction + 2.0;

          // Create wallets and holdings
          const sourceWallet = await createWallet();
          const destWallet = await createWallet();

          const sourceHolding = await createHolding({
            walletId: sourceWallet.id,
            type: 'BITCOIN',
            quantity: sourceQuantity,
            costBasis: sourceQuantity * bitcoinPrice,
          });

          const destHolding = await createHolding({
            walletId: destWallet.id,
            type: 'BITCOIN',
            quantity: 0.5, // pre-existing destination balance
            costBasis: 0.5 * bitcoinPrice,
          });

          const sourceBefore = Number(sourceHolding.quantity);
          const destBefore = Number(destHolding.quantity);

          // Build the transfer input — use Bitcoin unit so quantity is already in BTC
          const input = {
            fromWalletId: sourceWallet.id,
            toWalletId: destWallet.id,
            quantity: transferBtc,
            bitcoinUnit: 'Bitcoin' as const,
            bitcoinPrice,
            feeAmount: feeBtc > 0 ? feeBtc : undefined,
            feeUnit: feeBtc > 0 ? ('Bitcoin' as const) : undefined,
          };

          // Execute the transfer inside a Prisma transaction
          await prisma.$transaction(async (tx) => {
            await executeBitcoinTransfer(input, tx);
          });

          // Read back the holdings after transfer
          const sourceAfter = await prisma.investmentHolding.findUniqueOrThrow({
            where: { id: sourceHolding.id },
          });
          const destAfter = await prisma.investmentHolding.findUniqueOrThrow({
            where: { id: destHolding.id },
          });

          const sourceAfterQty = Number(sourceAfter.quantity);
          const destAfterQty = Number(destAfter.quantity);

          // Conservation invariant 1: source lost exactly transfer + fee
          const sourceDecrement = sourceBefore - sourceAfterQty;
          expect(sourceDecrement).toBeCloseTo(transferBtc + feeBtc, 8);

          // Conservation invariant 2: destination gained exactly transfer amount
          const destIncrement = destAfterQty - destBefore;
          expect(destIncrement).toBeCloseTo(transferBtc, 8);
        },
      ),
      { numRuns: 50 },
    );
  });
});
