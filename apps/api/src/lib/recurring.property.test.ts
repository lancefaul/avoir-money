/**
 * Property-Based Tests for computeUtilityTotalBill
 *
 * Feature: backend-coverage-push, Property 2: Utility total bill monotonicity
 * Validates: Requirements 13.4
 *
 * For any valid utility reading with non-negative cost, non-negative convenience
 * fee (dollar or percent), and non-negative other fees, computeUtilityTotalBill
 * returns a value >= the base cost. Adding fees never decreases the total.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeUtilityTotalBill } from './recurring.js';

// ─── Generators ───

/** Non-negative cost */
const costArb = fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true });

/** Non-negative convenience fee amount */
const convenienceFeeArb = fc.double({ min: 0, max: 10_000, noNaN: true, noDefaultInfinity: true });

/** Convenience fee type: dollar or percent */
const convenienceFeeTypeArb = fc.constantFrom('dollar' as const, 'percent' as const);

/** Non-negative other fees */
const otherFeesArb = fc.double({ min: 0, max: 10_000, noNaN: true, noDefaultInfinity: true });

/**
 * Generator for a complete utility reading with non-negative values.
 * Produces readings with both dollar and percent convenience fee types,
 * as well as null convenience fees and null other fees.
 */
const readingArb = fc
  .tuple(
    costArb,
    fc.option(convenienceFeeArb, { nil: null }),
    fc.option(convenienceFeeTypeArb, { nil: null }),
    fc.option(otherFeesArb, { nil: null }),
  )
  .map(([cost, convenienceFee, convenienceFeeType, otherFees]) => ({
    cost,
    convenienceFee,
    convenienceFeeType,
    otherFees,
  }));

/**
 * Generator for a reading that always has a non-null convenience fee
 * with a valid fee type, to exercise both dollar and percent paths.
 */
const readingWithFeeArb = fc
  .tuple(costArb, convenienceFeeArb, convenienceFeeTypeArb, otherFeesArb)
  .map(([cost, convenienceFee, convenienceFeeType, otherFees]) => ({
    cost,
    convenienceFee,
    convenienceFeeType,
    otherFees,
  }));

// ─── Property 2: Utility total bill monotonicity ───

describe('Feature: backend-coverage-push, Property 2: Utility total bill monotonicity', () => {
  /**
   * **Validates: Requirements 13.4**
   *
   * For any valid utility reading with non-negative cost, non-negative
   * convenience fee (dollar or percent), and non-negative other fees,
   * computeUtilityTotalBill(reading) >= reading.cost.
   * Adding fees never decreases the total.
   */
  it('total bill is always >= base cost when all fees are non-negative', () => {
    fc.assert(
      fc.property(readingArb, (reading) => {
        const total = computeUtilityTotalBill(reading);
        expect(total).toBeGreaterThanOrEqual(reading.cost);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 13.4**
   *
   * When convenience fee and other fees are both present and non-negative,
   * the total bill equals cost + convenienceAmount + otherFees exactly.
   */
  it('total bill equals cost + computed convenience amount + other fees', () => {
    fc.assert(
      fc.property(readingWithFeeArb, (reading) => {
        const total = computeUtilityTotalBill(reading);
        const convenienceAmount =
          reading.convenienceFeeType === 'percent'
            ? (reading.cost * reading.convenienceFee) / 100
            : reading.convenienceFee;
        const expected = reading.cost + convenienceAmount + reading.otherFees;
        expect(total).toBeCloseTo(expected, 8);
      }),
      { numRuns: 100 },
    );
  });
});
