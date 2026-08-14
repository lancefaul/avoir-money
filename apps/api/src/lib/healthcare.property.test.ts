/**
 * Property-Based Tests for computeOopmSpread
 *
 * Tests correctness properties from the OOPM Budget Integration design document.
 * All tests are pure (no DB needed) — they exercise the pure function directly.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeOopmSpread } from './healthcare.js';

// ─── Property 1: Spread formula correctness ───
// **Validates: Requirements 1.1, 1.2**

describe('Feature: oopm-budget-integration, Property 1: Spread formula correctness', () => {
  it('for non-null oopmLimit, override false, spent < limit, result equals the spread formula', () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.01), max: Math.fround(50000), noNaN: true }),
        fc.integer({ min: 1, max: 12 }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        (oopmLimit, currentMonth, spentFraction) => {
          // Derive oopmSpent as a fraction of oopmLimit to guarantee spent < limit
          const oopmSpent = oopmLimit * spentFraction * 0.9999;
          fc.pre(oopmSpent < oopmLimit);

          const result = computeOopmSpread(oopmLimit, oopmSpent, false, currentMonth);
          const expected =
            Math.round(((oopmLimit - oopmSpent) / (12 - currentMonth + 1)) * 100) / 100;

          expect(result).toBe(expected);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2: Non-negativity ───
// **Validates: Requirements 5.6, 1.3, 1.4, 3.3, 5.2, 5.3, 5.4**

describe('Feature: oopm-budget-integration, Property 2: Non-negativity', () => {
  it('for all valid inputs, computeOopmSpread returns a value >= 0', () => {
    fc.assert(
      fc.property(
        fc.option(fc.float({ min: 0, max: 50000, noNaN: true })),
        fc.float({ min: 0, max: 100000, noNaN: true }),
        fc.boolean(),
        fc.integer({ min: 1, max: 12 }),
        (oopmLimit, oopmSpent, oopmOverride, currentMonth) => {
          const result = computeOopmSpread(
            oopmLimit ?? null,
            oopmSpent,
            oopmOverride,
            currentMonth,
          );
          expect(result).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 3: Two-decimal rounding ───
// **Validates: Requirements 1.5**

describe('Feature: oopm-budget-integration, Property 3: Two-decimal rounding', () => {
  it('for all valid inputs, result * 100 is an integer within floating-point tolerance', () => {
    fc.assert(
      fc.property(
        fc.option(fc.float({ min: 0, max: 50000, noNaN: true })),
        fc.float({ min: 0, max: 100000, noNaN: true }),
        fc.boolean(),
        fc.integer({ min: 1, max: 12 }),
        (oopmLimit, oopmSpent, oopmOverride, currentMonth) => {
          const result = computeOopmSpread(
            oopmLimit ?? null,
            oopmSpent,
            oopmOverride,
            currentMonth,
          );
          const scaled = result * 100;
          const rounded = Math.round(scaled);
          expect(Math.abs(scaled - rounded)).toBeLessThan(1e-9);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 4: Monotonically non-increasing with respect to spending ───
// **Validates: Requirements 5.7**

describe('Feature: oopm-budget-integration, Property 4: Monotonically non-increasing with spending', () => {
  it('for spent2 > spent1 with all other params constant, spread(spent2) <= spread(spent1)', () => {
    fc.assert(
      fc.property(
        fc.option(fc.float({ min: 0, max: 50000, noNaN: true })),
        fc.float({ min: 0, max: 100000, noNaN: true }),
        fc.float({ min: 0, max: 100000, noNaN: true }),
        fc.boolean(),
        fc.integer({ min: 1, max: 12 }),
        (oopmLimit, spent1, spent2, oopmOverride, currentMonth) => {
          fc.pre(spent2 > spent1);

          const result1 = computeOopmSpread(oopmLimit ?? null, spent1, oopmOverride, currentMonth);
          const result2 = computeOopmSpread(oopmLimit ?? null, spent2, oopmOverride, currentMonth);

          expect(result2).toBeLessThanOrEqual(result1);
        },
      ),
      { numRuns: 20 },
    );
  });
});
