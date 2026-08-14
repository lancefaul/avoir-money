/**
 * Property-Based Tests for Budget-Expense Linking
 *
 * Tests correctness properties from the design document for pure functions
 * in budget-linking.ts. No database required.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computeExpenseMonthlyEquivalent,
  resolveCurrentAmount,
  computeDerivedBaseline,
} from './budget-linking.js';

// ─── Generators ───

const positiveAmountArb = fc.double({
  min: 0.01,
  max: 100_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** All recurring frequencies (excludes ONE_TIME) */
const recurringFrequencyArb = fc.constantFrom(
  'WEEKLY' as const,
  'BIWEEKLY' as const,
  'SEMI_MONTHLY' as const,
  'MONTHLY' as const,
  'QUARTERLY' as const,
  'BIANNUAL' as const,
  'ANNUAL' as const,
);

// ─── Conversion factor lookup ───

const CONVERSION_FACTORS: Record<string, number> = {
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  SEMI_MONTHLY: 2,
  MONTHLY: 1,
  QUARTERLY: 1 / 3,
  BIANNUAL: 1 / 6,
  ANNUAL: 1 / 12,
};

// ─── Property 1: Frequency conversion correctness ───
// Feature: budget-expense-linking, Property 1: Frequency conversion correctness

describe('Feature: budget-expense-linking, Property 1: Frequency conversion correctness', () => {
  /**
   * Validates: Requirements 3.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
   *
   * For any positive amount and any recurring Frequency enum value,
   * computeExpenseMonthlyEquivalent(amount, frequency) SHALL return
   * the amount multiplied by the correct conversion factor, rounded
   * to 2 decimal places.
   */
  it('returns amount × correct conversion factor (rounded to 2dp) for all recurring frequencies', () => {
    fc.assert(
      fc.property(positiveAmountArb, recurringFrequencyArb, (amount, frequency) => {
        const result = computeExpenseMonthlyEquivalent(amount, frequency);
        const factor = CONVERSION_FACTORS[frequency];
        const expected = Math.round(amount * factor! * 100) / 100;
        expect(result).toBe(expected);
      }),
      { numRuns: 20 },
    );
  });

  /**
   * Validates: Requirements 3.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
   *
   * ONE_TIME frequency always returns 0 regardless of amount.
   */
  it('ONE_TIME always returns 0', () => {
    fc.assert(
      fc.property(positiveAmountArb, (amount) => {
        expect(computeExpenseMonthlyEquivalent(amount, 'ONE_TIME')).toBe(0);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2: Frequency conversion rounding ───
// Feature: budget-expense-linking, Property 2: Frequency conversion rounding

/** All frequencies including ONE_TIME */
const allFrequencyArb = fc.constantFrom(
  'WEEKLY' as const,
  'BIWEEKLY' as const,
  'SEMI_MONTHLY' as const,
  'MONTHLY' as const,
  'QUARTERLY' as const,
  'BIANNUAL' as const,
  'ANNUAL' as const,
  'ONE_TIME' as const,
);

describe('Feature: budget-expense-linking, Property 2: Frequency conversion rounding', () => {
  /**
   * Validates: Requirements 3.5, 7.8
   *
   * For any positive amount and any Frequency enum value, the result of
   * computeExpenseMonthlyEquivalent SHALL have at most two decimal places
   * (i.e., result * 100 is an integer within floating-point tolerance).
   */
  it('result has at most two decimal places for all frequencies', () => {
    fc.assert(
      fc.property(positiveAmountArb, allFrequencyArb, (amount, frequency) => {
        const result = computeExpenseMonthlyEquivalent(amount, frequency);
        expect(Math.abs(result * 100 - Math.round(result * 100))).toBeLessThan(1e-6);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Generators for Property 3 ───

/** Month number 1–12 */
const monthArb = fc.integer({ min: 1, max: 12 });

/** Positive amount for schedule entries */
const scheduleAmountArb = fc.double({
  min: 0.01,
  max: 100_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Generates a partial amountSchedule: a subset of months 1–12 mapped to amounts.
 * Uses subsetOf to pick a random subset of month keys, then pairs each with an amount.
 */
const partialScheduleArb = fc
  .subarray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], { minLength: 0 })
  .chain((months) =>
    fc.tuple(
      fc.constant(months),
      fc.array(scheduleAmountArb, { minLength: months.length, maxLength: months.length }),
    ),
  )
  .map(([months, amounts]) => {
    const schedule: Record<string, number> = {};
    months.forEach((m, i) => {
      schedule[String(m)] = amounts[i]!;
    });
    return schedule;
  });

// ─── Property 3: Current amount resolution from schedule ───
// Feature: budget-expense-linking, Property 3: Current amount resolution from schedule

describe('Feature: budget-expense-linking, Property 3: Current amount resolution from schedule', () => {
  /**
   * Validates: Requirements 3.2, 3.3
   *
   * For any expense with a base amount and an amountSchedule (a partial map
   * from month numbers 1–12 to amounts), and for any target month (1–12):
   * if the schedule contains an entry for that month, resolveCurrentAmount
   * SHALL return the schedule's value; otherwise it SHALL return the base amount.
   */
  it('returns schedule value when month is in schedule, base amount otherwise', () => {
    fc.assert(
      fc.property(
        positiveAmountArb,
        partialScheduleArb,
        monthArb,
        (baseAmount, schedule, month) => {
          const expense = { amount: baseAmount, amountSchedule: schedule };
          const result = resolveCurrentAmount(expense, month);
          const key = String(month);

          if (key in schedule) {
            expect(result).toBe(schedule[key]);
          } else {
            expect(result).toBe(baseAmount);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * Validates: Requirements 3.2, 3.3
   *
   * When amountSchedule is null, resolveCurrentAmount SHALL always return
   * the base amount regardless of the target month.
   */
  it('returns base amount when amountSchedule is null', () => {
    fc.assert(
      fc.property(positiveAmountArb, monthArb, (baseAmount, month) => {
        const expense = { amount: baseAmount, amountSchedule: null };
        const result = resolveCurrentAmount(expense, month);
        expect(result).toBe(baseAmount);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Generators for Property 4 ───

/** Generates either null or a Date (for pausedUntil / archivedAt) */
const nullableDateArb = fc.oneof(
  fc.constant(null),
  fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }),
);

/** Generates a single linked expense with random fields */
const linkedExpenseArb = fc.record({
  amount: positiveAmountArb,
  frequency: recurringFrequencyArb,
  amountSchedule: fc.oneof(fc.constant(null), partialScheduleArb),
  pausedUntil: nullableDateArb,
  archivedAt: nullableDateArb,
});

// ─── Property 4: Derived baseline is the sum of active linked expenses' monthly equivalents ───
// Feature: budget-expense-linking, Property 4: Derived baseline sum

describe('Feature: budget-expense-linking, Property 4: Derived baseline sum', () => {
  /**
   * Validates: Requirements 3.1, 5.4, 5.5
   *
   * For any set of linked expenses (each with an amount, frequency,
   * amountSchedule, pausedUntil, and archivedAt), computeDerivedBaseline
   * SHALL return the sum of computeExpenseMonthlyEquivalent(
   * resolveCurrentAmount(expense, month), expense.frequency) for only
   * those expenses where pausedUntil is null and archivedAt is null,
   * rounded to two decimal places.
   */
  it('returns sum of active expenses monthly equivalents, rounded to 2dp', () => {
    fc.assert(
      fc.property(
        fc.array(linkedExpenseArb, { minLength: 0, maxLength: 20 }),
        monthArb,
        (expenses, month) => {
          const result = computeDerivedBaseline(expenses, month);

          // Manually compute expected value
          const expectedSum = expenses.reduce((sum, expense) => {
            if (expense.pausedUntil !== null || expense.archivedAt !== null) {
              return sum;
            }
            const currentAmount = resolveCurrentAmount(expense, month);
            return sum + computeExpenseMonthlyEquivalent(currentAmount, expense.frequency);
          }, 0);
          const expected = Math.round(expectedSum * 100) / 100;

          expect(result).toBe(expected);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 5: High-water mark is monotonically non-decreasing ───
// Feature: budget-expense-linking, Property 5: High-water mark monotonicity

import { applyHighWaterMark } from './budget-linking.js';

/** Non-negative amount for derived baselines and HWM values */
const nonNegativeAmountArb = fc.double({
  min: 0,
  max: 100_000,
  noNaN: true,
  noDefaultInfinity: true,
});

describe('Feature: budget-expense-linking, Property 5: High-water mark monotonicity', () => {
  /**
   * Validates: Requirements 4.2, 4.3, 4.5, 4.6
   *
   * Single step: for any derived baseline and currentHWM,
   * applyHighWaterMark(derived, currentHWM).highWaterMark >= currentHWM.
   */
  it('single step: returned highWaterMark is always >= currentHWM', () => {
    fc.assert(
      fc.property(nonNegativeAmountArb, nonNegativeAmountArb, (derivedBaseline, currentHWM) => {
        const result = applyHighWaterMark(derivedBaseline, currentHWM);
        expect(result.highWaterMark).toBeGreaterThanOrEqual(currentHWM);
      }),
      { numRuns: 20 },
    );
  });

  /**
   * Validates: Requirements 4.2, 4.3, 4.5, 4.6
   *
   * Sequence: for any array of derived baselines, folding through
   * applyHighWaterMark starting from HWM=0, the HWM never decreases.
   */
  it('sequence: HWM is monotonically non-decreasing across a series of applications', () => {
    fc.assert(
      fc.property(
        fc.array(nonNegativeAmountArb, { minLength: 1, maxLength: 50 }),
        (derivedBaselines) => {
          let currentHWM = 0;

          for (const derived of derivedBaselines) {
            const result = applyHighWaterMark(derived, currentHWM);
            expect(result.highWaterMark).toBeGreaterThanOrEqual(currentHWM);
            currentHWM = result.highWaterMark;
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 6: Effective amount equals the high-water mark ───
// Feature: budget-expense-linking, Property 6: Effective amount equals high-water mark

describe('Feature: budget-expense-linking, Property 6: Effective amount equals high-water mark', () => {
  /**
   * Validates: Requirements 4.4
   *
   * For any derived baseline and current high-water mark,
   * applyHighWaterMark(derived, currentHWM).effectiveAmount SHALL equal
   * max(derived, currentHWM).
   */
  it('effectiveAmount equals max(derivedBaseline, currentHWM)', () => {
    fc.assert(
      fc.property(nonNegativeAmountArb, nonNegativeAmountArb, (derivedBaseline, currentHWM) => {
        const result = applyHighWaterMark(derivedBaseline, currentHWM);
        expect(result.effectiveAmount).toBe(Math.max(derivedBaseline, currentHWM));
      }),
      { numRuns: 20 },
    );
  });
});
