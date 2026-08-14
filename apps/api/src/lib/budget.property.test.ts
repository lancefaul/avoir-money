/**
 * Property-Based Tests for Budget Functions
 *
 * Tests Properties 1, 2, 3, and 7 from the category-budgets design document.
 * All tests are pure (no DB needed) — they exercise the budget utility functions directly.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computeMonthlyEquivalent,
  resolveEffectiveVersion,
  computeBudgetStatus,
  isSeasonalActiveInMonth,
} from './budget.js';

// ─── Shared Generators ───

const positiveAmount = fc.double({ min: 0.01, max: 1e9, noNaN: true, noDefaultInfinity: true });
const nonNegativeAmount = fc.double({ min: 0, max: 1e9, noNaN: true, noDefaultInfinity: true });
const monthArb = fc.integer({ min: 1, max: 12 });

// ─── Property 1: Frequency conversion correctness ───

describe('Feature: category-budgets, Property 1: Frequency conversion correctness', () => {
  it('WEEKLY: result === amount * (52 / 12)', () => {
    fc.assert(
      fc.property(positiveAmount, (amount) => {
        const result = computeMonthlyEquivalent(amount, 'WEEKLY');
        expect(result).toBeCloseTo(amount * (52 / 12), 10);
      }),
      { numRuns: 20 },
    );
  });

  it('BIWEEKLY: result === amount * (26 / 12)', () => {
    fc.assert(
      fc.property(positiveAmount, (amount) => {
        const result = computeMonthlyEquivalent(amount, 'BIWEEKLY');
        expect(result).toBeCloseTo(amount * (26 / 12), 10);
      }),
      { numRuns: 20 },
    );
  });

  it('MONTHLY: result === amount', () => {
    fc.assert(
      fc.property(positiveAmount, (amount) => {
        const result = computeMonthlyEquivalent(amount, 'MONTHLY');
        expect(result).toBeCloseTo(amount, 10);
      }),
      { numRuns: 20 },
    );
  });

  it('YEARLY (non-seasonal): result === amount / 12', () => {
    fc.assert(
      fc.property(positiveAmount, (amount) => {
        const result = computeMonthlyEquivalent(amount, 'YEARLY');
        expect(result).toBeCloseTo(amount / 12, 10);
      }),
      { numRuns: 20 },
    );
  });

  it('YEARLY (seasonal): result === amount / activeMonths.length', () => {
    fc.assert(
      fc.property(
        positiveAmount,
        fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { minLength: 1 }),
        (amount, activeMonths) => {
          const result = computeMonthlyEquivalent(amount, 'YEARLY', activeMonths);
          expect(result).toBeCloseTo(amount / activeMonths.length, 10);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2: Budget version resolution selects the correct effective version ───

describe('Feature: category-budgets, Property 2: Budget version resolution', () => {
  it('resolves the version with the latest effectiveDate on or before the target month', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { minLength: 1 }),
        monthArb,
        (months, targetMonth) => {
          const versions = months.map((m) => ({
            effectiveDate: new Date(Date.UTC(2025, m - 1, 1)),
          }));

          const result = resolveEffectiveVersion(versions, targetMonth, 2025);

          const targetUtc = Date.UTC(2025, targetMonth - 1, 1);
          const eligible = versions.filter((v) => v.effectiveDate.getTime() <= targetUtc);

          if (eligible.length === 0) {
            expect(result).toBeNull();
          } else {
            expect(result).not.toBeNull();
            // The resolved version must have the latest effectiveDate among eligible ones
            const maxTime = Math.max(...eligible.map((v) => v.effectiveDate.getTime()));
            expect(result!.effectiveDate.getTime()).toBe(maxTime);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('returns null when target month is before all version effectiveDates', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 2, max: 12 }), { minLength: 1 }), (months) => {
        // All versions start at month 2 or later; target is month 1
        const versions = months.map((m) => ({
          effectiveDate: new Date(Date.UTC(2025, m - 1, 1)),
        }));

        const result = resolveEffectiveVersion(versions, 1, 2025);
        expect(result).toBeNull();
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 3: Budget status thresholds are mutually exclusive and exhaustive ───

describe('Feature: category-budgets, Property 3: Budget status thresholds', () => {
  it('returns exactly one of under/near/over for any non-negative actual and positive monthlyEquivalent', () => {
    fc.assert(
      fc.property(nonNegativeAmount, positiveAmount, (actual, monthlyEquivalent) => {
        const status = computeBudgetStatus(actual, monthlyEquivalent);
        const validStatuses = ['under', 'near', 'over'] as const;
        expect(validStatuses).toContain(status);
      }),
      { numRuns: 20 },
    );
  });

  it('status matches threshold rules: under < 80%, near 80-100%, over > 100%', () => {
    fc.assert(
      fc.property(nonNegativeAmount, positiveAmount, (actual, monthlyEquivalent) => {
        const status = computeBudgetStatus(actual, monthlyEquivalent);

        if (actual < 0.8 * monthlyEquivalent) {
          expect(status).toBe('under');
        } else if (actual > monthlyEquivalent) {
          expect(status).toBe('over');
        } else {
          expect(status).toBe('near');
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 7: Seasonal budget filtering by month ───

describe('Feature: category-budgets, Property 7: Seasonal budget filtering', () => {
  it('returns true only when month is in activeMonths or activeMonths is empty', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 12 })), monthArb, (activeMonths, month) => {
        const result = isSeasonalActiveInMonth(activeMonths, month);
        if (activeMonths.length === 0) {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(activeMonths.includes(month));
        }
      }),
      { numRuns: 20 },
    );
  });

  it('empty activeMonths always returns true', () => {
    fc.assert(
      fc.property(monthArb, (month) => {
        expect(isSeasonalActiveInMonth([], month)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});
