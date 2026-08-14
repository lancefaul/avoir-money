import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { dayAfter } from '../dates.js';

/**
 * Feature: backend-coverage-push, Property 3: dayAfter advances by exactly one calendar day
 *
 * Validates: Requirements 15.5
 */
describe('Feature: backend-coverage-push, Property 3: dayAfter advances by exactly one calendar day', () => {
  it('dayAfter(d) is exactly 86,400,000ms after the UTC midnight of d', () => {
    fc.assert(
      fc.property(
        // Constrain to a realistic date range — fc.date() includes the JS max date
        // (year 275760) which overflows Date.UTC arithmetic in dayAfter.
        // Also filter NaN dates which fast-check may generate at boundaries.
        fc
          .date({ min: new Date('2000-01-01'), max: new Date('2100-12-31') })
          .filter((d) => !isNaN(d.getTime())),
        (d) => {
          const result = dayAfter(d);
          const utcMidnight = new Date(
            Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
          );
          expect(result.getTime() - utcMidnight.getTime()).toBe(86_400_000);
        },
      ),
      { numRuns: 100 },
    );
  });
});
