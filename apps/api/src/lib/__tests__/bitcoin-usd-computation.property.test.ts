/**
 * Property-based test for USD amount computation (pure, no DB).
 * Feature: expanded-bitcoin-features, Property 1: USD Amount Computation
 *
 * **Validates: Requirements 1.3, 2.3, 3.3, 8.5**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeUsdAmount } from '../holdings.js';

// ─── Generators ───

/** Positive double for Bitcoin quantity */
const btcQuantityArb = fc.double({
  min: 0.00000001,
  max: 100,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Positive integer for Sats quantity */
const satsQuantityArb = fc.integer({ min: 1, max: 2_100_000_000_000_000 });

/** Positive unit price (USD per 1 BTC) */
const unitPriceArb = fc.double({
  min: 0.01,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

// ─── Property 1: USD Amount Computation ───

describe('Feature: expanded-bitcoin-features, Property 1: USD Amount Computation', () => {
  /**
   * **Validates: Requirements 1.3, 2.3, 3.3, 8.5**
   *
   * For any valid bitcoinMetadata with arbitrary positive quantity,
   * bitcoinUnit (Bitcoin or Sats), and positive unitPrice, the computed
   * USD amount SHALL equal quantity × unitPrice when bitcoinUnit is
   * "Bitcoin", or (quantity / 100_000_000) × unitPrice when bitcoinUnit
   * is "Sats".
   */
  it('computes USD = quantity × unitPrice for Bitcoin unit', () => {
    fc.assert(
      fc.property(btcQuantityArb, unitPriceArb, (quantity, unitPrice) => {
        const result = computeUsdAmount(quantity, 'Bitcoin', unitPrice);
        const expected = quantity * unitPrice;
        expect(result).toBeCloseTo(expected, 10);
      }),
      { numRuns: 20 },
    );
  });

  it('computes USD = (quantity / 100_000_000) × unitPrice for Sats unit', () => {
    fc.assert(
      fc.property(satsQuantityArb, unitPriceArb, (quantity, unitPrice) => {
        const result = computeUsdAmount(quantity, 'Sats', unitPrice);
        const expected = (quantity / 100_000_000) * unitPrice;
        expect(result).toBeCloseTo(expected, 10);
      }),
      { numRuns: 20 },
    );
  });
});
