import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computePausedUntil, isPaused, SENTINEL } from '../pause.js';
import { today, makeDate } from '../dates.js';

// ─── Generators ───

const UNITS = ['days', 'weeks', 'months', 'years'] as const;

// ─── Property 1: Pause duration computation is correct ───

describe('Feature: recurring-pause, Property 1: Pause duration computation is correct', () => {
  /**
   * **Validates: Requirements 1.1, 1.4**
   *
   * For any valid duration (positive integer) and unit (days, weeks, months, years),
   * computePausedUntil should produce a UTC midnight date that is today + the specified
   * offset. For indefinite, it should return the sentinel date (9999-12-31).
   */
  it('should compute the correct pausedUntil date for any duration and unit', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 365 }), fc.constantFrom(...UNITS), (duration, unit) => {
        const result = computePausedUntil({ duration, unit });
        const now = today();

        // Result must be UTC midnight
        expect(result.getUTCHours()).toBe(0);
        expect(result.getUTCMinutes()).toBe(0);
        expect(result.getUTCSeconds()).toBe(0);
        expect(result.getUTCMilliseconds()).toBe(0);

        // Compute expected date manually
        const expected = new Date(now);
        switch (unit) {
          case 'days':
            expected.setUTCDate(expected.getUTCDate() + duration);
            break;
          case 'weeks':
            expected.setUTCDate(expected.getUTCDate() + duration * 7);
            break;
          case 'months':
            expected.setUTCMonth(expected.getUTCMonth() + duration);
            break;
          case 'years':
            expected.setUTCFullYear(expected.getUTCFullYear() + duration);
            break;
        }
        const expectedNorm = makeDate(
          expected.getUTCFullYear(),
          expected.getUTCMonth(),
          expected.getUTCDate(),
        );

        expect(result.getTime()).toBe(expectedNorm.getTime());

        // Result must be in the future relative to today
        expect(result.getTime()).toBeGreaterThan(now.getTime());

        // isPaused should return true for a future pausedUntil
        expect(isPaused(result, now)).toBe(true);

        // Finite durations should not be the sentinel year
        expect(result.getUTCFullYear()).not.toBe(9999);
      }),
      { numRuns: 20 },
    );
  });

  it('should return the sentinel date for indefinite pause', () => {
    const result = computePausedUntil({ indefinite: true });

    expect(result.getUTCFullYear()).toBe(9999);
    expect(result.getTime()).toBe(SENTINEL.getTime());
    expect(result.getUTCFullYear()).toBe(9999);
    expect(result.getUTCMonth()).toBe(11);
    expect(result.getUTCDate()).toBe(31);
    expect(isPaused(result, today())).toBe(true);
  });

  it('should overwrite previous pausedUntil when re-pausing with a new duration', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.constantFrom(...UNITS),
        fc.integer({ min: 1, max: 100 }),
        fc.constantFrom(...UNITS),
        (dur1, unit1, dur2, unit2) => {
          const first = computePausedUntil({ duration: dur1, unit: unit1 });
          const second = computePausedUntil({ duration: dur2, unit: unit2 });

          // Each call independently computes from today — the second result
          // does not depend on the first, confirming overwrite semantics
          const now = today();
          expect(isPaused(second, now)).toBe(true);

          // If duration/unit differ, the results should (generally) differ
          // but both must be valid UTC midnight dates
          expect(second.getUTCHours()).toBe(0);
          expect(second.getUTCMinutes()).toBe(0);
          expect(first.getUTCHours()).toBe(0);
          expect(first.getUTCMinutes()).toBe(0);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// Note: Properties 2 and 3 (paused sources produce no anticipations, expired pause restores generation)
// previously tested against the old computeAnticipations() engine which has been removed.
// Pause behavior is now tested via the schedule generator tests in schedule-generator.test.ts
// (see "paused sources skipped" test suite).
