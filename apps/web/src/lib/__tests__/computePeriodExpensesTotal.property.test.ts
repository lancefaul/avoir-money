import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computePeriodExpensesTotal } from '../utils.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Generators
// ═══════════════════════════════════════════════════════════════════════════════

/** Arbitrary expense item with a numeric amount and nullable actualAmount */
const arbExpenseItem: fc.Arbitrary<{ amount: number; actualAmount: number | null }> = fc.record({
  amount: fc.double({ min: -100_000, max: 100_000, noNaN: true, noDefaultInfinity: true }),
  actualAmount: fc.oneof(
    fc.constant(null),
    fc.double({ min: -100_000, max: 100_000, noNaN: true, noDefaultInfinity: true }),
  ),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 1: Period expenses total equals sum of effective amounts
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * **Validates: Requirements 1.1, 1.5**
 *
 * For any array of expense items (including empty arrays),
 * `computePeriodExpensesTotal(items)` shall equal the sum of
 * `item.actualAmount` when it is not null, or `item.amount` otherwise,
 * for every item in the array.
 */
describe('Feature: period-expenses-total, Property 1: Period expenses total equals sum of effective amounts', () => {
  it('returns the sum of effective amounts for any array of expense items', () => {
    fc.assert(
      fc.property(fc.array(arbExpenseItem, { minLength: 0, maxLength: 100 }), (items) => {
        const result = computePeriodExpensesTotal(items);

        // Manually compute the expected sum
        let expected = 0;
        for (const item of items) {
          expected += item.actualAmount !== null ? item.actualAmount : item.amount;
        }

        expect(result).toBeCloseTo(expected, 5);
      }),
      { numRuns: 20 },
    );
  });
});
