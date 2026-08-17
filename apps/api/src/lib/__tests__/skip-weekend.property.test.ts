import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { applyWeekendShift } from '../recurring.js';

// ─── Generators ───

/** Generate a random UTC-midnight date that falls on Saturday (6) or Sunday (0) */
function weekendDateArb(): fc.Arbitrary<Date> {
  return fc
    .date({ min: new Date(2000, 0, 1), max: new Date(2099, 11, 31) })
    .map((d) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())))
    .filter((d) => d.getUTCDay() === 0 || d.getUTCDay() === 6);
}

/** Generate a random UTC-midnight date that falls on Monday–Friday (1–5) */
function weekdayDateArb(): fc.Arbitrary<Date> {
  return fc
    .date({ min: new Date(2000, 0, 1), max: new Date(2099, 11, 31) })
    .map((d) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())))
    .filter((d) => {
      const day = d.getUTCDay();
      return day >= 1 && day <= 5;
    });
}

/** Generate any random UTC-midnight date */
function anyDateArb(): fc.Arbitrary<Date> {
  return fc
    .date({ min: new Date(2000, 0, 1), max: new Date(2099, 11, 31) })
    .map((d) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}

describe('Feature: recurring-schedule-option, Property 1: Weekend dates shift to Monday when skipWeekend is true', () => {
  /**
   * **Validates: Requirements 2.1, 3.1, 7.1**
   *
   * For any date falling on a Saturday or Sunday, applyWeekendShift(date, true)
   * should return the following Monday (UTC day 1), at most 2 days after the original.
   */
  it('should shift Saturday/Sunday to the following Monday', () => {
    fc.assert(
      fc.property(weekendDateArb(), (date) => {
        const result = applyWeekendShift(date, true);

        // Result must be a Monday (UTC day 1)
        expect(result.getUTCDay()).toBe(1);

        // Result must be at most 2 days after the original
        const diffMs = result.getTime() - date.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        expect(diffDays).toBeGreaterThanOrEqual(1);
        expect(diffDays).toBeLessThanOrEqual(2);
      }),
      { numRuns: 20 },
    );
  });
});

describe('Feature: recurring-schedule-option, Property 2: Original date preserved when skipWeekend is false', () => {
  /**
   * **Validates: Requirements 2.2, 3.2, 7.2**
   *
   * For any date (weekend or weekday), applyWeekendShift(date, false)
   * should return the original date unchanged.
   */
  it('should return the original date unchanged when skipWeekend is false', () => {
    fc.assert(
      fc.property(anyDateArb(), (date) => {
        const result = applyWeekendShift(date, false);

        expect(result.getTime()).toBe(date.getTime());
      }),
      { numRuns: 20 },
    );
  });
});

describe('Feature: recurring-schedule-option, Property 3: Weekday dates unchanged regardless of skipWeekend', () => {
  /**
   * **Validates: Requirements 7.3**
   *
   * For any date falling on Monday through Friday, applyWeekendShift(date, skipWeekend)
   * should return the original date regardless of the skipWeekend value.
   */
  it('should return the original weekday date regardless of skipWeekend', () => {
    fc.assert(
      fc.property(weekdayDateArb(), fc.boolean(), (date, skipWeekend) => {
        const result = applyWeekendShift(date, skipWeekend);

        expect(result.getTime()).toBe(date.getTime());
      }),
      { numRuns: 20 },
    );
  });
});
