/**
 * Property-Based Tests for Healthcare Balance Computation
 *
 * Property 7: Balance capping — generate random raw totals and limits,
 * verify capped = min(raw, limit) and raw value is preserved.
 * Handles nullable limits (dental/vision without limits).
 *
 * All tests are pure (no DB needed) — they exercise computeCappedBalance directly.
 *
 * **Validates: Requirements 3.3, 3.4, 3.6, 3.8**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeCappedBalance } from '../healthcare.js';

// ─── Generators ───

/** Non-negative finite doubles for monetary values */
const moneyArb = fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true });

// ─── Property 7: Balance capping ───

describe('Feature: healthcare-page-revamp, Property 7: Balance capping', () => {
  it('deductibleSpent === Math.min(deductibleRaw, deductibleLimit) when limit is set', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, (deductibleRaw, deductibleLimit) => {
        const result = computeCappedBalance({ deductibleRaw, oopmRaw: 0 }, deductibleLimit, 0);
        expect(result.deductibleSpent).toBe(Math.min(deductibleRaw, deductibleLimit));
      }),
      { numRuns: 20 },
    );
  });

  it('oopmSpent === Math.min(oopmRaw, oopmLimit) when limit is set', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, (oopmRaw, oopmLimit) => {
        const result = computeCappedBalance({ deductibleRaw: 0, oopmRaw }, 0, oopmLimit);
        expect(result.oopmSpent).toBe(Math.min(oopmRaw, oopmLimit));
      }),
      { numRuns: 20 },
    );
  });

  it('deductibleSpent is null when deductibleLimit is null', () => {
    fc.assert(
      fc.property(moneyArb, (deductibleRaw) => {
        const result = computeCappedBalance({ deductibleRaw, oopmRaw: 0 }, null, 0);
        expect(result.deductibleSpent).toBeNull();
      }),
      { numRuns: 20 },
    );
  });

  it('oopmSpent is null when oopmLimit is null', () => {
    fc.assert(
      fc.property(moneyArb, (oopmRaw) => {
        const result = computeCappedBalance({ deductibleRaw: 0, oopmRaw }, 0, null);
        expect(result.oopmSpent).toBeNull();
      }),
      { numRuns: 20 },
    );
  });

  it('deductibleRaw is preserved (=== raw.deductibleRaw)', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, moneyArb, (deductibleRaw, deductibleLimit, oopmLimit) => {
        const result = computeCappedBalance(
          { deductibleRaw, oopmRaw: 0 },
          deductibleLimit,
          oopmLimit,
        );
        expect(result.deductibleRaw).toBe(deductibleRaw);
      }),
      { numRuns: 20 },
    );
  });

  it('oopmRaw is preserved (=== raw.oopmRaw)', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, moneyArb, (oopmRaw, deductibleLimit, oopmLimit) => {
        const result = computeCappedBalance(
          { deductibleRaw: 0, oopmRaw },
          deductibleLimit,
          oopmLimit,
        );
        expect(result.oopmRaw).toBe(oopmRaw);
      }),
      { numRuns: 20 },
    );
  });

  it('deductibleSpent <= deductibleLimit always (when limit is set)', () => {
    fc.assert(
      fc.property(
        moneyArb,
        moneyArb,
        moneyArb,
        moneyArb,
        (deductibleRaw, oopmRaw, deductibleLimit, oopmLimit) => {
          const result = computeCappedBalance(
            { deductibleRaw, oopmRaw },
            deductibleLimit,
            oopmLimit,
          );
          expect(result.deductibleSpent).toBeLessThanOrEqual(deductibleLimit);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('oopmSpent <= oopmLimit always (when limit is set)', () => {
    fc.assert(
      fc.property(
        moneyArb,
        moneyArb,
        moneyArb,
        moneyArb,
        (deductibleRaw, oopmRaw, deductibleLimit, oopmLimit) => {
          const result = computeCappedBalance(
            { deductibleRaw, oopmRaw },
            deductibleLimit,
            oopmLimit,
          );
          expect(result.oopmSpent).toBeLessThanOrEqual(oopmLimit);
        },
      ),
      { numRuns: 20 },
    );
  });
});
