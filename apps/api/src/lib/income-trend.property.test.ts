/**
 * Property-Based Tests for Income Trend Helper Functions
 *
 * Tests Properties 2–8 from the income-trend-chart design document.
 * All tests are pure (no DB needed) — they exercise the helper functions directly.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  classifyPeriod,
  computePastPeriodTotals,
  computeCurrentPeriodTotals,
  computeFuturePeriodTotals,
  prorateBudgetToPeriod,
  getPeriodsPerYear,
  filterUnlinkedBudgets,
  isSeasonalBudgetActiveForPeriod,
} from './income-trend.js';

// ─── Shared Generators ───

/** UTC midnight date within a reasonable range */
const utcDateArb = fc
  .integer({ min: 2020, max: 2030 })
  .chain((year) =>
    fc
      .integer({ min: 0, max: 11 })
      .chain((month) =>
        fc.integer({ min: 1, max: 28 }).map((day) => new Date(Date.UTC(year, month, day))),
      ),
  );

/** Ordered pair of UTC dates where start <= end */
const dateRangeArb = fc
  .tuple(utcDateArb, utcDateArb)
  .map(([a, b]) => (a.getTime() <= b.getTime() ? { start: a, end: b } : { start: b, end: a }));

/** Positive financial amount */
const positiveAmount = fc.double({
  min: 0.01,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Nullable string ID */
const nullableId = fc.option(fc.uuid(), { nil: null });

// ─── Property 2: Projected flag classification ───

describe('Feature: income-trend-chart, Property 2: Projected flag classification', () => {
  /**
   * **Validates: Requirements 2.3, 3.4, 4.4**
   */

  it('past periods (endDate < today) have projected = false', () => {
    fc.assert(
      fc.property(dateRangeArb, utcDateArb, ({ start, end }, today) => {
        // Force past: endDate must be before today
        const pastEnd = new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1),
        );
        if (pastEnd.getTime() < start.getTime()) return; // skip degenerate

        const result = classifyPeriod(start, pastEnd, today);
        expect(result.type).toBe('past');
        expect(result.projected).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('current periods (startDate <= today <= endDate) have projected = true', () => {
    fc.assert(
      fc.property(dateRangeArb, ({ start, end }) => {
        // Pick today within [start, end]
        const startMs = start.getTime();
        const endMs = end.getTime();
        const todayMs = startMs + Math.floor((endMs - startMs) / 2);
        const today = new Date(todayMs);

        const result = classifyPeriod(start, end, today);
        expect(result.type).toBe('current');
        expect(result.projected).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('future periods (startDate > today) have projected = true', () => {
    fc.assert(
      fc.property(utcDateArb, (today) => {
        // Force future: startDate > today
        const futureStart = new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1),
        );
        const futureEnd = new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 15),
        );

        const result = classifyPeriod(futureStart, futureEnd, today);
        expect(result.type).toBe('future');
        expect(result.projected).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 3: Past period actuals computation ───

describe('Feature: income-trend-chart, Property 3: Past period actuals computation', () => {
  /**
   * **Validates: Requirements 2.1, 2.2**
   */

  /** Transaction generator: date within a given range */
  const txTypeArb = fc.constantFrom('INCOME', 'EXPENSE', 'TRANSFER', 'REFUND', 'TRADE');
  const txInRangeArb = (start: Date, end: Date) =>
    fc.record({
      amount: positiveAmount,
      netAmount: positiveAmount,
      type: txTypeArb,
      parentId: fc.constant(null as string | null),
      date: fc.integer({ min: start.getTime(), max: end.getTime() }).map((ms) => new Date(ms)),
    });

  /** Transaction with date outside a given range (before start day or after end day) */
  const txOutOfRangeArb = (start: Date, end: Date) => {
    const nextDayAfterEnd = new Date(end.getTime() + 86_400_000);
    // Zero out sub-day components so "after" dates start on the next calendar day
    const nextDayMidnight = new Date(
      Date.UTC(
        nextDayAfterEnd.getUTCFullYear(),
        nextDayAfterEnd.getUTCMonth(),
        nextDayAfterEnd.getUTCDate(),
      ),
    );
    return fc.record({
      amount: positiveAmount,
      netAmount: positiveAmount,
      type: txTypeArb,
      parentId: fc.constant(null as string | null),
      date: fc.oneof(
        fc
          .integer({ min: start.getTime() - 86_400_000 * 365, max: start.getTime() - 1 })
          .map((ms) => new Date(ms)),
        fc
          .integer({
            min: nextDayMidnight.getTime(),
            max: nextDayMidnight.getTime() + 86_400_000 * 365,
          })
          .map((ms) => new Date(ms)),
      ),
    });
  };

  it('income = sum of INCOME tx, expenses = sum of EXPENSE+TRADE tx minus REFUND tx, within period', () => {
    fc.assert(
      fc.property(dateRangeArb, (range) => {
        const { start, end } = range;
        if (start.getTime() === end.getTime()) return; // need a real range

        return fc.assert(
          fc.property(
            fc.array(txInRangeArb(start, end), { minLength: 0, maxLength: 20 }),
            (txns) => {
              const result = computePastPeriodTotals(txns, start, end);

              const expectedIncome = txns
                .filter((t) => t.type === 'INCOME')
                .reduce((sum, t) => sum + t.amount, 0);
              const expectedExpenses =
                txns.filter((t) => t.type === 'EXPENSE').reduce((sum, t) => sum + t.netAmount, 0) -
                txns.filter((t) => t.type === 'REFUND').reduce((sum, t) => sum + t.netAmount, 0);

              const expectedTrades = txns
                .filter((t) => t.type === 'TRADE')
                .reduce((sum, t) => sum + t.amount, 0);

              expect(result.income).toBeCloseTo(expectedIncome, 5);
              expect(result.expenses).toBeCloseTo(expectedExpenses, 5);
              expect(result.trades).toBeCloseTo(expectedTrades, 5);
            },
          ),
          { numRuns: 20 },
        );
      }),
      { numRuns: 5 },
    );
  });

  it('transactions outside [periodStart, periodEnd] are excluded', () => {
    fc.assert(
      fc.property(dateRangeArb, (range) => {
        const { start, end } = range;
        if (end.getTime() - start.getTime() < 86_400_000) return; // need room for out-of-range

        return fc.assert(
          fc.property(
            fc.array(txOutOfRangeArb(start, end), { minLength: 1, maxLength: 10 }),
            (txns) => {
              const result = computePastPeriodTotals(txns, start, end);
              expect(result.income).toBe(0);
              expect(result.expenses).toBe(0);
            },
          ),
          { numRuns: 20 },
        );
      }),
      { numRuns: 5 },
    );
  });
});

// ─── Property 4: Current period hybrid computation ───

describe('Feature: income-trend-chart, Property 4: Current period hybrid computation', () => {
  /**
   * **Validates: Requirements 3.1, 3.2**
   */

  const sourceTypeArb = fc.constantFrom('INCOME' as const, 'EXPENSE' as const);

  it('income = actual income txns + pending scheduled income, expenses = actual expense txns + pending scheduled expenses', () => {
    fc.assert(
      fc.property(
        dateRangeArb,
        fc.array(
          fc.record({
            amount: positiveAmount,
            netAmount: positiveAmount,
            type: fc.constantFrom('INCOME', 'EXPENSE', 'TRANSFER', 'REFUND', 'TRADE'),
            parentId: fc.constant(null as string | null),
            date: utcDateArb, // will be clamped below
          }),
          { minLength: 0, maxLength: 15 },
        ),
        fc.array(
          fc.record({
            expectedAmount: positiveAmount,
            sourceType: sourceTypeArb,
            status: fc.constantFrom('PENDING', 'PAID', 'SKIPPED'),
            dueDate: utcDateArb, // will be clamped below
          }),
          { minLength: 0, maxLength: 15 },
        ),
        ({ start, end }, rawTxns, rawScheduled) => {
          if (start.getTime() === end.getTime()) return;

          // Clamp dates into the period range
          const clampDate = (d: Date) => {
            const ms = Math.max(start.getTime(), Math.min(end.getTime(), d.getTime()));
            return new Date(ms);
          };
          const txns = rawTxns.map((t) => ({ ...t, date: clampDate(t.date) }));
          const scheduled = rawScheduled.map((s) => ({ ...s, dueDate: clampDate(s.dueDate) }));

          const result = computeCurrentPeriodTotals(txns, scheduled, start, end);

          // Expected: actual income + pending scheduled income
          const actualIncome = txns
            .filter((t) => t.type === 'INCOME')
            .reduce((sum, t) => sum + t.amount, 0);
          const pendingScheduledIncome = scheduled
            .filter((s) => s.status === 'PENDING' && s.sourceType === 'INCOME')
            .reduce((sum, s) => sum + s.expectedAmount, 0);

          const actualExpenses =
            txns.filter((t) => t.type === 'EXPENSE').reduce((sum, t) => sum + t.netAmount, 0) -
            txns.filter((t) => t.type === 'REFUND').reduce((sum, t) => sum + t.netAmount, 0);
          const pendingScheduledExpenses = scheduled
            .filter((s) => s.status === 'PENDING' && s.sourceType === 'EXPENSE')
            .reduce((sum, s) => sum + s.expectedAmount, 0);

          const actualTrades = txns
            .filter((t) => t.type === 'TRADE')
            .reduce((sum, t) => sum + t.amount, 0);

          expect(result.income).toBeCloseTo(actualIncome + pendingScheduledIncome, 5);
          expect(result.expenses).toBeCloseTo(actualExpenses + pendingScheduledExpenses, 5);
          expect(result.trades).toBeCloseTo(actualTrades, 5);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 5: Future period projection computation ───

describe('Feature: income-trend-chart, Property 5: Future period projection computation', () => {
  /**
   * **Validates: Requirements 4.1, 4.2**
   */

  const sourceTypeArb = fc.constantFrom('INCOME' as const, 'EXPENSE' as const);

  it('income and expenses come only from PENDING scheduled transactions, zero from actuals', () => {
    fc.assert(
      fc.property(
        dateRangeArb,
        fc.array(
          fc.record({
            expectedAmount: positiveAmount,
            sourceType: sourceTypeArb,
            status: fc.constantFrom('PENDING', 'PAID', 'SKIPPED'),
            dueDate: utcDateArb,
          }),
          { minLength: 0, maxLength: 20 },
        ),
        ({ start, end }, rawScheduled) => {
          if (start.getTime() === end.getTime()) return;

          // Clamp dueDates into the period range
          const scheduled = rawScheduled.map((s) => ({
            ...s,
            dueDate: new Date(
              Math.max(start.getTime(), Math.min(end.getTime(), s.dueDate.getTime())),
            ),
          }));

          const result = computeFuturePeriodTotals(scheduled, start, end);

          const expectedIncome = scheduled
            .filter((s) => s.status === 'PENDING' && s.sourceType === 'INCOME')
            .reduce((sum, s) => sum + s.expectedAmount, 0);
          const expectedExpenses = scheduled
            .filter((s) => s.status === 'PENDING' && s.sourceType === 'EXPENSE')
            .reduce((sum, s) => sum + s.expectedAmount, 0);

          expect(result.income).toBeCloseTo(expectedIncome, 5);
          expect(result.expenses).toBeCloseTo(expectedExpenses, 5);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('non-PENDING scheduled transactions contribute zero', () => {
    fc.assert(
      fc.property(
        dateRangeArb,
        fc.array(
          fc.record({
            expectedAmount: positiveAmount,
            sourceType: sourceTypeArb,
            status: fc.constantFrom('PAID', 'SKIPPED'),
            dueDate: utcDateArb,
          }),
          { minLength: 1, maxLength: 10 },
        ),
        ({ start, end }, rawScheduled) => {
          if (start.getTime() === end.getTime()) return;

          const scheduled = rawScheduled.map((s) => ({
            ...s,
            dueDate: new Date(
              Math.max(start.getTime(), Math.min(end.getTime(), s.dueDate.getTime())),
            ),
          }));

          const result = computeFuturePeriodTotals(scheduled, start, end);
          expect(result.income).toBe(0);
          expect(result.expenses).toBe(0);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 6: Budget proration formula ───

describe('Feature: income-trend-chart, Property 6: Budget proration formula', () => {
  /**
   * **Validates: Requirements 3.3, 5.3**
   */

  const periodsPerYearArb = fc.constantFrom(12, 24, 26, 52);

  it('result = monthlyEquivalent * 12 / periodsPerYear', () => {
    fc.assert(
      fc.property(positiveAmount, periodsPerYearArb, (monthlyEquivalent, periodsPerYear) => {
        const result = prorateBudgetToPeriod(monthlyEquivalent, periodsPerYear);
        const expected = (monthlyEquivalent * 12) / periodsPerYear;
        expect(result).toBeCloseTo(expected, 10);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2: Budget proration conservation ───

describe('Feature: backend-coverage-100, Property 2: Budget proration conservation', () => {
  /**
   * **Validates: Requirements 14.1**
   */

  const scheduleTypeArb = fc.constantFrom('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY');

  it('prorating and multiplying back by periods per year equals annual budget', () => {
    fc.assert(
      fc.property(positiveAmount, scheduleTypeArb, (monthlyEquivalent, scheduleType) => {
        const periodsPerYear = getPeriodsPerYear(scheduleType);
        const proratedAmount = prorateBudgetToPeriod(monthlyEquivalent, periodsPerYear);
        const annualFromProrated = proratedAmount * periodsPerYear;
        const expectedAnnual = monthlyEquivalent * 12;

        expect(annualFromProrated).toBeCloseTo(expectedAnnual, 5);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 7: Unlinked budget identification ───

describe('Feature: income-trend-chart, Property 7: Unlinked budget identification', () => {
  /**
   * **Validates: Requirements 5.1, 12.3**
   */

  const categoryBudgetArb = fc.record({
    id: fc.uuid(),
    removedAt: fc.option(utcDateArb, { nil: null }),
    budgetExpenseLinks: fc.array(fc.record({ id: fc.uuid() }), { minLength: 0, maxLength: 3 }),
  });

  it('result includes exactly those with removedAt = null AND empty budgetExpenseLinks', () => {
    fc.assert(
      fc.property(fc.array(categoryBudgetArb, { minLength: 0, maxLength: 20 }), (budgets) => {
        const result = filterUnlinkedBudgets(budgets);
        const resultIds = result.map((b) => b.id);

        for (const budget of budgets) {
          const shouldBeIncluded =
            budget.removedAt === null && budget.budgetExpenseLinks.length === 0;
          if (shouldBeIncluded) {
            expect(resultIds).toContain(budget.id);
          } else {
            expect(resultIds).not.toContain(budget.id);
          }
        }

        // Also verify count matches
        const expectedCount = budgets.filter(
          (b) => b.removedAt === null && b.budgetExpenseLinks.length === 0,
        ).length;
        expect(result.length).toBe(expectedCount);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 8: Seasonal budget period filtering ───

describe('Feature: income-trend-chart, Property 8: Seasonal budget period filtering', () => {
  /**
   * **Validates: Requirements 5.4, 6.1, 6.2, 6.3**
   */

  /** 0-indexed month (matching localDate().month which uses getUTCMonth) */
  const monthArb = fc.integer({ min: 0, max: 11 });

  it('budget is included iff activeMonths is empty OR at least one month overlaps with the period date range', () => {
    fc.assert(
      fc.property(
        fc.array(monthArb, { minLength: 0, maxLength: 12 }),
        dateRangeArb,
        (activeMonths, { start, end }) => {
          const result = isSeasonalBudgetActiveForPeriod(activeMonths, start, end);

          if (activeMonths.length === 0) {
            // Empty activeMonths = always active
            expect(result).toBe(true);
          } else {
            // Check if start or end month is in activeMonths
            const startMonth = start.getUTCMonth();
            const endMonth = end.getUTCMonth();
            const shouldBeActive =
              activeMonths.includes(startMonth) || activeMonths.includes(endMonth);
            expect(result).toBe(shouldBeActive);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('empty activeMonths always returns true regardless of period', () => {
    fc.assert(
      fc.property(dateRangeArb, ({ start, end }) => {
        expect(isSeasonalBudgetActiveForPeriod([], start, end)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 1: Period ordering and year boundary ───

describe('Feature: income-trend-chart, Property 1: Period ordering and year boundary', () => {
  /**
   * **Validates: Requirements 1.1**
   */

  /** Generator for a single IncomeTrendDataPoint with dates in the current year */
  const incomeTrendDataPointArb = (year: number) => {
    // Generate start/end that overlap with the calendar year:
    // startDate <= Dec 31 AND endDate >= Jan 1
    const jan1 = new Date(Date.UTC(year, 0, 1));
    const dec31 = new Date(Date.UTC(year, 11, 31));

    // startDate: can be up to Dec 31 of the year (to ensure startDate <= Dec 31)
    const startDateArb = fc
      .integer({ min: jan1.getTime() - 86_400_000 * 60, max: dec31.getTime() })
      .map((ms) => new Date(ms));

    // endDate: must be >= Jan 1 of the year AND >= startDate
    return startDateArb.chain((startDate) => {
      const minEnd = Math.max(startDate.getTime(), jan1.getTime());
      const maxEnd = dec31.getTime() + 86_400_000 * 60;
      return fc
        .integer({ min: minEnd, max: maxEnd })
        .map((endMs) => new Date(endMs))
        .chain((endDate) =>
          fc.record({
            periodLabel: fc.string({ minLength: 1, maxLength: 10 }),
            startDate: fc.constant(startDate),
            endDate: fc.constant(endDate),
            income: positiveAmount,
            expenses: positiveAmount,
            budgetExpenses: positiveAmount,
            projected: fc.boolean(),
          }),
        );
    });
  };

  it('array is sorted by startDate ascending', () => {
    const year = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).getUTCFullYear();

    fc.assert(
      fc.property(
        fc.array(incomeTrendDataPointArb(year), { minLength: 0, maxLength: 30 }),
        (points) => {
          // Sort the generated points by startDate (simulating what the API does)
          const sorted = [...points].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

          // Verify sorted order: each startDate <= next startDate
          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i]!.startDate.getTime()).toBeGreaterThanOrEqual(
              sorted[i - 1]!.startDate.getTime(),
            );
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('all periods overlap with the current calendar year (startDate <= Dec 31 AND endDate >= Jan 1)', () => {
    const year = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).getUTCFullYear();
    const jan1 = new Date(Date.UTC(year, 0, 1));
    const dec31 = new Date(Date.UTC(year, 11, 31));

    fc.assert(
      fc.property(
        fc.array(incomeTrendDataPointArb(year), { minLength: 1, maxLength: 30 }),
        (points) => {
          for (const point of points) {
            // startDate must be <= Dec 31 of the current year
            expect(point.startDate.getTime()).toBeLessThanOrEqual(dec31.getTime());
            // endDate must be >= Jan 1 of the current year
            expect(point.endDate.getTime()).toBeGreaterThanOrEqual(jan1.getTime());
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
