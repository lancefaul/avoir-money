import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { occurrences } from '../recurring.js';
import { makeDate } from '../dates.js';

// ─── Generators ───

/** Random month 0–11 */
const monthArb = fc.integer({ min: 0, max: 11 });

/** Random year in a reasonable range */
const yearArb = fc.integer({ min: 2000, max: 2050 });

/** Random day 1–28 (safe for all months) */
const safeDayArb = fc.integer({ min: 1, max: 28 });

/** Generate a UTC midnight start date with safe day values */
const startDateArb = fc.tuple(yearArb, monthArb, safeDayArb).map(([y, m, d]) => makeDate(y, m, d));

/** Due day 1–31 (full range, clamping is tested separately) */
const dueDayArb = fc.integer({ min: 1, max: 28 });

/**
 * Generate a test scenario: start date + a date range spanning 2–5 years
 * to ensure multiple biannual occurrences.
 */
const scenarioArb = fc
  .tuple(startDateArb, dueDayArb, fc.integer({ min: 2, max: 5 }))
  .map(([startDate, dueDay, spanYears]) => {
    const startYear = startDate.getUTCFullYear();
    const from = makeDate(startYear, 0, 1);
    const to = makeDate(startYear + spanYears, 11, 31);
    return { startDate, dueDay, from, to };
  });

// ─── Property 1: Biannual occurrences are 6 months apart ───

describe('Feature: biannual-frequency, Property 1: Biannual occurrences are 6 months apart', () => {
  /**
   * Validates: Requirements 2.1
   *
   * For any valid start date and date range, all dates yielded by the
   * occurrence generator with frequency BIANNUAL shall fall in months
   * that are exactly 0 or 6 months offset from the start date's month
   * (mod 12), and consecutive occurrences shall be exactly 6 months apart.
   */
  it('all biannual occurrences fall in correct months and consecutive ones are 6 months apart', () => {
    fc.assert(
      fc.property(scenarioArb, ({ startDate, dueDay, from, to }) => {
        const dates = [...occurrences('BIANNUAL', dueDay, null, null, startDate, null, from, to)];

        const startMonth = startDate.getUTCMonth();
        const validMonths = new Set([startMonth, (startMonth + 6) % 12]);

        // Assert all yielded months are exactly 0 or 6 months offset from start month
        for (const d of dates) {
          expect(validMonths.has(d.getUTCMonth())).toBe(true);
        }

        // Assert consecutive occurrences are 6 months apart
        for (let i = 1; i < dates.length; i++) {
          const prev = dates[i - 1]!;
          const curr = dates[i]!;
          const monthDiff =
            (curr.getUTCFullYear() - prev.getUTCFullYear()) * 12 +
            (curr.getUTCMonth() - prev.getUTCMonth());
          expect(monthDiff).toBe(6);
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2: Biannual due day clamping ───

describe('Feature: biannual-frequency, Property 2: Biannual due day clamping', () => {
  /** Due day across the full 1–31 range to exercise clamping */
  const fullDueDayArb = fc.integer({ min: 1, max: 31 });

  /**
   * Scenario generator for clamping tests:
   * - Random start date (determines which two months are biannual)
   * - Due day 1–31 (may exceed month length → clamping expected)
   * - Range spanning 2–5 years so we hit both biannual months repeatedly
   */
  const clampScenarioArb = fc
    .tuple(startDateArb, fullDueDayArb, fc.integer({ min: 2, max: 5 }))
    .map(([startDate, dueDay, spanYears]) => {
      const startYear = startDate.getUTCFullYear();
      const from = makeDate(startYear, 0, 1);
      const to = makeDate(startYear + spanYears, 11, 31);
      return { startDate, dueDay, from, to };
    });

  /**
   * Validates: Requirements 2.2
   *
   * For any due day between 1 and 31 and any biannual occurrence month,
   * the occurrence date's day-of-month shall equal
   * min(dueDay, lastDayOfMonth) — i.e., the requested due day or the
   * last day of the month, whichever is smaller.
   */
  it('each occurrence day-of-month equals min(dueDay, lastDayOfMonth)', () => {
    fc.assert(
      fc.property(clampScenarioArb, ({ startDate, dueDay, from, to }) => {
        const dates = [...occurrences('BIANNUAL', dueDay, null, null, startDate, null, from, to)];

        for (const d of dates) {
          const year = d.getUTCFullYear();
          const month = d.getUTCMonth();
          const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
          const expected = Math.min(dueDay, lastDayOfMonth);

          expect(d.getUTCDate()).toBe(expected);
        }
      }),
      { numRuns: 20 },
    );
  });
});
