/**
 * Property-based tests for holdings.ts.
 *
 * Tests universal invariants across randomly generated inputs.
 */
import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { computeUsdAmount, backCalculateUnitPrice } from './holdings.js';

describe('holdings properties', () => {
  it('Property 1: Bitcoin USD amount round-trip', () => {
    /**
     * **Validates: Requirements 6.7**
     *
     * For any positive quantity (in either Bitcoin or Sats unit) and any positive USD equivalent amount,
     * computing `computeUsdAmount(quantity, unit, backCalculateUnitPrice(usdEquivalent, quantity, unit))`
     * SHALL produce a value approximately equal to the original `usdEquivalent`, within floating-point tolerance.
     */
    fc.assert(
      fc.property(
        fc.double({ min: 0.00000001, max: 100, noNaN: true }), // quantity (BTC or sats)
        fc.constantFrom('Bitcoin' as const, 'Sats' as const), // unit
        fc.double({ min: 0.01, max: 1_000_000, noNaN: true }), // usdEquivalent
        (quantity, unit, usdEquivalent) => {
          // Back-calculate the unit price from the USD equivalent
          const unitPrice = backCalculateUnitPrice(usdEquivalent, quantity, unit);

          // Compute the USD amount using the back-calculated unit price
          const roundTrip = computeUsdAmount(quantity, unit, unitPrice);

          // The round-trip should approximately equal the original USD equivalent
          const tolerance = Math.max(0.01, usdEquivalent * 0.0001); // 0.01% tolerance or $0.01 minimum
          const diff = Math.abs(roundTrip - usdEquivalent);

          return diff <= tolerance;
        },
      ),
      { numRuns: 100 },
    );
  });
});
