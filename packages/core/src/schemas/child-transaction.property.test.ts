import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeLineTotal, CreateChildTransactionSchema } from './child-transaction.js';

// ─── Helpers ───

/** Round to 2 decimal places, matching the implementation's rounding */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ─── Generators ───

/** Positive monetary amount (0.01 to 999_999) */
const positiveAmount = fc.double({ min: 0.01, max: 999_999, noNaN: true, noDefaultInfinity: true });

/** Non-negative tax amount */
const nonNegativeTax = fc.double({ min: 0, max: 999_999, noNaN: true, noDefaultInfinity: true });

/** Tax rate between 0 and 100 */
const taxRate = fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true });

// ─── Property 1: Tax computation correctness ───

describe('Feature: transaction-splitting, Property 1: Tax computation correctness', () => {
  /**
   * **Validates: Requirements 1.2, 1.3, 5.1, 5.2, 5.4**
   *
   * For any positive pre-tax amount and any valid tax input (taxAmount only,
   * taxRate only, or neither), computeLineTotal should return a lineTotal equal
   * to preTaxAmount + computedTaxAmount, where computedTaxAmount is:
   * - the provided taxAmount if given
   * - preTaxAmount * taxRate / 100 (rounded to 2 decimals) if taxRate is given
   * - 0 if neither is given
   */

  it('with taxAmount only: lineTotal = preTaxAmount + taxAmount (rounded)', () => {
    fc.assert(
      fc.property(positiveAmount, nonNegativeTax, (preTaxAmount, taxAmount) => {
        const result = computeLineTotal({ preTaxAmount, taxAmount });

        expect(result.preTaxAmount).toBe(round2(preTaxAmount));
        expect(result.taxAmount).toBe(round2(taxAmount));
        expect(result.lineTotal).toBe(round2(preTaxAmount + taxAmount));
      }),
      { numRuns: 20 },
    );
  });

  it('with taxRate only: lineTotal = preTaxAmount + (preTaxAmount * taxRate / 100) (rounded)', () => {
    fc.assert(
      fc.property(positiveAmount, taxRate, (preTaxAmount, rate) => {
        const result = computeLineTotal({ preTaxAmount, taxRate: rate });

        const expectedTax = round2((preTaxAmount * rate) / 100);
        expect(result.preTaxAmount).toBe(round2(preTaxAmount));
        expect(result.taxAmount).toBe(expectedTax);
        expect(result.lineTotal).toBe(round2(preTaxAmount + expectedTax));
      }),
      { numRuns: 20 },
    );
  });

  it('with neither taxAmount nor taxRate: lineTotal = preTaxAmount, taxAmount = 0', () => {
    fc.assert(
      fc.property(positiveAmount, (preTaxAmount) => {
        const result = computeLineTotal({ preTaxAmount });

        expect(result.preTaxAmount).toBe(round2(preTaxAmount));
        expect(result.taxAmount).toBe(0);
        expect(result.lineTotal).toBe(round2(preTaxAmount));
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2: Mutual exclusion of tax inputs ───

describe('Feature: transaction-splitting, Property 2: Mutual exclusion of tax inputs', () => {
  /**
   * **Validates: Requirements 1.4**
   *
   * For any input where both taxAmount and taxRate are provided (both > 0),
   * the CreateChildTransactionSchema should reject validation, and the
   * computeLineTotal function should throw an error.
   */

  /** Strictly positive tax amount (> 0) */
  const positiveTax = fc.double({ min: 0.01, max: 999_999, noNaN: true, noDefaultInfinity: true });

  /** Strictly positive tax rate (> 0, ≤ 100) */
  const positiveTaxRate = fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true });

  it('computeLineTotal throws when both taxAmount and taxRate are provided', () => {
    fc.assert(
      fc.property(positiveAmount, positiveTax, positiveTaxRate, (preTaxAmount, taxAmount, rate) => {
        expect(() => computeLineTotal({ preTaxAmount, taxAmount, taxRate: rate })).toThrow(
          'Provide either taxAmount or taxRate, not both',
        );
      }),
      { numRuns: 20 },
    );
  });

  it('CreateChildTransactionSchema.safeParse fails when both taxAmount and taxRate are provided', () => {
    fc.assert(
      fc.property(
        positiveAmount,
        positiveTax,
        positiveTaxRate,
        fc.string({ minLength: 1, maxLength: 20 }),
        (preTaxAmount, taxAmount, rate, budgetId) => {
          const result = CreateChildTransactionSchema.safeParse({
            budgetId,
            preTaxAmount,
            taxAmount,
            taxRate: rate,
          });

          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 9: Invalid input rejection ───

describe('Feature: transaction-splitting, Property 9: Invalid input rejection', () => {
  /**
   * **Validates: Requirements 6.5**
   *
   * For any child transaction request with invalid data (missing budgetId,
   * negative preTaxAmount, negative taxAmount, taxRate > 100, or both taxAmount
   * and taxRate provided), the schema should reject validation.
   */

  it('rejects missing budgetId (empty string)', () => {
    fc.assert(
      fc.property(positiveAmount, (preTaxAmount) => {
        const result = CreateChildTransactionSchema.safeParse({
          budgetId: '',
          preTaxAmount,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects negative preTaxAmount', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -999_999, max: -0.01, noNaN: true, noDefaultInfinity: true }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (preTaxAmount, budgetId) => {
          const result = CreateChildTransactionSchema.safeParse({
            budgetId,
            preTaxAmount,
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects negative taxAmount', () => {
    fc.assert(
      fc.property(
        positiveAmount,
        fc.double({ min: -999_999, max: -0.01, noNaN: true, noDefaultInfinity: true }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (preTaxAmount, taxAmount, budgetId) => {
          const result = CreateChildTransactionSchema.safeParse({
            budgetId,
            preTaxAmount,
            taxAmount,
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects taxRate > 100', () => {
    fc.assert(
      fc.property(
        positiveAmount,
        fc.double({ min: 100.01, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (preTaxAmount, rate, budgetId) => {
          const result = CreateChildTransactionSchema.safeParse({
            budgetId,
            preTaxAmount,
            taxRate: rate,
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects both taxAmount and taxRate provided', () => {
    fc.assert(
      fc.property(
        positiveAmount,
        fc.double({ min: 0.01, max: 999_999, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (preTaxAmount, taxAmount, rate, budgetId) => {
          const result = CreateChildTransactionSchema.safeParse({
            budgetId,
            preTaxAmount,
            taxAmount,
            taxRate: rate,
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });
});
