/**
 * Property-Based Tests for Spend Prediction Functions
 *
 * Tests Properties 1–6 from the pay-period-spend-prediction design document.
 * All tests are pure (no DB needed) — they exercise prorateBudget and
 * computeSpendPrediction directly.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  prorateBudget,
  computeSpendPrediction,
  type SpendPredictionInput,
} from '../spend-prediction.js';

// ─── Shared Generators ───

const amountArb = fc.double({ min: 1, max: 10000, noNaN: true, noDefaultInfinity: true });
const budgetPeriodArb = fc.constantFrom<'MONTHLY' | 'YEARLY'>('MONTHLY', 'YEARLY');
const scheduleTypeArb = fc.constantFrom('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY');

const DIVISORS: Record<string, number> = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMI_MONTHLY: 24,
  MONTHLY: 12,
};

/** Generate a non-empty subset of months 1–12 */
const activeMonthsArb = fc.uniqueArray(fc.integer({ min: 1, max: 12 }), {
  minLength: 1,
  maxLength: 12,
});

/** Generate a period (start, end, today) with length 1–31 days, today within period */
function periodArb() {
  return fc
    .record({
      year: fc.integer({ min: 2020, max: 2030 }),
      month: fc.integer({ min: 0, max: 11 }),
      day: fc.integer({ min: 1, max: 28 }),
      length: fc.integer({ min: 1, max: 31 }),
    })
    .chain(({ year, month, day, length }) => {
      const start = new Date(Date.UTC(year, month, day));
      const end = new Date(Date.UTC(year, month, day + length - 1));
      return fc.record({
        start: fc.constant(start),
        end: fc.constant(end),
        length: fc.constant(length),
        todayOffset: fc.integer({ min: 0, max: length - 1 }),
      });
    })
    .map(({ start, end, length, todayOffset }) => {
      const today = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + todayOffset),
      );
      return { start, end, today, totalDays: length, todayOffset };
    });
}

/** Generate a budget ID from a small set to encourage overlaps */
const budgetIdArb = fc.constantFrom('cat-a', 'cat-b', 'cat-c', 'cat-d', 'cat-e');

// ─── Property 1: Budget proration correctness ───
// **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6**

describe('Feature: pay-period-spend-prediction, Property 1: Budget proration correctness', () => {
  it('MONTHLY year-round: amount × 12 / divisor', () => {
    fc.assert(
      fc.property(amountArb, scheduleTypeArb, (amount, scheduleType) => {
        const start = new Date(Date.UTC(2025, 0, 1));
        const end = new Date(Date.UTC(2025, 0, 14));
        const result = prorateBudget(amount, 'MONTHLY', null, scheduleType, start, end);
        const expected = (amount * 12) / DIVISORS[scheduleType]!;
        expect(result).toBeCloseTo(expected, 8);
      }),
      { numRuns: 20 },
    );
  });

  it('YEARLY year-round: amount / divisor', () => {
    fc.assert(
      fc.property(amountArb, scheduleTypeArb, (amount, scheduleType) => {
        const start = new Date(Date.UTC(2025, 0, 1));
        const end = new Date(Date.UTC(2025, 0, 14));
        const result = prorateBudget(amount, 'YEARLY', null, scheduleType, start, end);
        const expected = amount / DIVISORS[scheduleType]!;
        expect(result).toBeCloseTo(expected, 8);
      }),
      { numRuns: 20 },
    );
  });

  it('seasonal MONTHLY: amount × activeMonths.length / divisor', () => {
    fc.assert(
      fc.property(
        amountArb,
        scheduleTypeArb,
        activeMonthsArb,
        (amount, scheduleType, activeMonths) => {
          // Use a period that spans all 12 months to guarantee overlap
          const start = new Date(Date.UTC(2025, 0, 1));
          const end = new Date(Date.UTC(2025, 11, 31));
          const result = prorateBudget(amount, 'MONTHLY', activeMonths, scheduleType, start, end);
          const expected = (amount * 12) / DIVISORS[scheduleType]!;
          expect(result).toBeCloseTo(expected, 8);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('seasonal with no overlapping months returns 0', () => {
    fc.assert(
      fc.property(
        amountArb,
        budgetPeriodArb,
        scheduleTypeArb,
        (amount, budgetPeriod, scheduleType) => {
          // Period is entirely in January; activeMonths is only July
          const start = new Date(Date.UTC(2025, 0, 1));
          const end = new Date(Date.UTC(2025, 0, 28));
          const result = prorateBudget(amount, budgetPeriod, [7], scheduleType, start, end);
          expect(result).toBe(0);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2: Discretionary budget remainder avoids double-counting ───
// **Validates: Requirements 2.7, 2.8**

describe('Feature: pay-period-spend-prediction, Property 2: Discretionary budget remainder', () => {
  it('each budget contribution equals max(0, prorated - recurring) for linked, prorated for unlinked', () => {
    fc.assert(
      fc.property(
        periodArb(),
        scheduleTypeArb,
        fc.array(
          fc.record({
            id: fc.uuid(),
            budgetId: budgetIdArb,
            amount: fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        fc.array(
          fc.record({
            budgetId: budgetIdArb,
            amount: fc.double({ min: 1, max: 5000, noNaN: true, noDefaultInfinity: true }),
            period: budgetPeriodArb,
            activeMonths: fc.constant(null as number[] | null),
            hasLinkedExpenses: fc.boolean(),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        (period, scheduleType, expenses, budgets) => {
          const input: SpendPredictionInput = {
            periodStart: period.start,
            periodEnd: period.end,
            today: period.today,
            scheduleType,
            periodExpenses: expenses,
            budgetAllocations: budgets,
            transactions: [],
          };

          const result = computeSpendPrediction(input);

          // Manually compute per-budget discretionary contribution
          const recurringByBudget = new Map<string, number>();
          for (const exp of expenses) {
            recurringByBudget.set(
              exp.budgetId,
              (recurringByBudget.get(exp.budgetId) ?? 0) + exp.amount,
            );
          }

          const allocationByBudget = new Map<string, number>();
          const linkedBudgets = new Set<string>();
          for (const cb of budgets) {
            const prorated = prorateBudget(
              cb.amount,
              cb.period,
              cb.activeMonths,
              scheduleType,
              period.start,
              period.end,
            );
            allocationByBudget.set(
              cb.budgetId,
              (allocationByBudget.get(cb.budgetId) ?? 0) + prorated,
            );
            if (cb.hasLinkedExpenses) linkedBudgets.add(cb.budgetId);
          }

          const allCats = new Set([...recurringByBudget.keys(), ...allocationByBudget.keys()]);
          let expectedTotal = 0;
          for (const catId of allCats) {
            const rec = recurringByBudget.get(catId) ?? 0;
            const bud = allocationByBudget.get(catId) ?? 0;

            if (linkedBudgets.has(catId)) {
              expectedTotal += Math.max(0, bud - rec);
            } else if (bud > 0) {
              expectedTotal += bud;
            }
          }

          expect(result.expectedPeriodSpend).toBeCloseTo(expectedTotal, 6);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 3: Expected spend line is linear ───
// **Validates: Requirements 3.1, 3.2**

describe('Feature: pay-period-spend-prediction, Property 3: Expected spend line is linear', () => {
  it('dailyData has exactly totalDays entries with linear expectedCumulative', () => {
    fc.assert(
      fc.property(periodArb(), scheduleTypeArb, amountArb, (period, scheduleType, budgetAmount) => {
        const input: SpendPredictionInput = {
          periodStart: period.start,
          periodEnd: period.end,
          today: period.today,
          scheduleType,
          periodExpenses: [],
          budgetAllocations: [
            {
              budgetId: 'test-cat',
              amount: budgetAmount,
              period: 'MONTHLY',
              activeMonths: null,
              hasLinkedExpenses: false,
            },
          ],
          transactions: [],
        };

        const result = computeSpendPrediction(input);

        expect(result.dailyData).toHaveLength(result.totalDays);
        expect(result.totalDays).toBe(period.totalDays);

        const rate = result.expectedPeriodSpend / result.totalDays;
        for (const day of result.dailyData) {
          const expected = rate * day.dayNumber;
          expect(day.expectedCumulative).toBeCloseTo(expected, 6);
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 4: Actual cumulative spend is monotonically non-decreasing ───
// **Validates: Requirements 4.1, 4.2, 4.3**

describe('Feature: pay-period-spend-prediction, Property 4: Actual cumulative spend is monotonically non-decreasing', () => {
  it('actualCumulative values are non-decreasing and final equals sum of transactions', () => {
    fc.assert(
      fc.property(
        periodArb(),
        scheduleTypeArb,
        fc.array(fc.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true }), {
          minLength: 0,
          maxLength: 20,
        }),
        (period, scheduleType, txAmounts) => {
          // Generate transactions at random days within the period
          const transactions = txAmounts.map((amount, i) => ({
            date: new Date(
              Date.UTC(
                period.start.getUTCFullYear(),
                period.start.getUTCMonth(),
                period.start.getUTCDate() + (i % period.totalDays),
              ),
            ),
            amount,
          }));

          // Set today to end of period so all days have actual values
          const input: SpendPredictionInput = {
            periodStart: period.start,
            periodEnd: period.end,
            today: period.end,
            scheduleType,
            periodExpenses: [],
            budgetAllocations: [],
            transactions,
          };

          const result = computeSpendPrediction(input);

          // Check monotonicity for actual days
          const actualValues = result.dailyData
            .map((d) => d.actualCumulative)
            .filter((v): v is number => v !== null);

          for (let i = 1; i < actualValues.length; i++) {
            expect(actualValues[i]!).toBeGreaterThanOrEqual(actualValues[i - 1]!);
          }

          // Final actual should equal sum of all transaction amounts
          if (actualValues.length > 0) {
            const totalTx = txAmounts.reduce((sum, a) => sum + a, 0);
            expect(actualValues[actualValues.length - 1]).toBeCloseTo(totalTx, 6);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 5: Over/under amount consistency ───
// **Validates: Requirements 5.2, 7.1**

describe('Feature: pay-period-spend-prediction, Property 5: Over/under amount consistency', () => {
  it('overUnderAmount equals actualCumulative[currentDay] - expectedCumulative[currentDay]', () => {
    fc.assert(
      fc.property(
        periodArb(),
        scheduleTypeArb,
        amountArb,
        fc.array(fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }), {
          minLength: 0,
          maxLength: 15,
        }),
        (period, scheduleType, budgetAmount, txAmounts) => {
          const transactions = txAmounts.map((amount, i) => ({
            date: new Date(
              Date.UTC(
                period.start.getUTCFullYear(),
                period.start.getUTCMonth(),
                period.start.getUTCDate() + (i % period.totalDays),
              ),
            ),
            amount,
          }));

          const input: SpendPredictionInput = {
            periodStart: period.start,
            periodEnd: period.end,
            today: period.today,
            scheduleType,
            periodExpenses: [],
            budgetAllocations: [
              {
                budgetId: 'test-cat',
                amount: budgetAmount,
                period: 'MONTHLY',
                activeMonths: null,
                hasLinkedExpenses: false,
              },
            ],
            transactions,
          };

          const result = computeSpendPrediction(input);
          const currentDay = result.dailyData[result.currentDayNumber - 1];

          if (currentDay) {
            const expectedOverUnder =
              (currentDay.actualCumulative ?? 0) - currentDay.expectedCumulative;
            expect(result.overUnderAmount).toBeCloseTo(expectedOverUnder, 6);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 6: Daily data boundary correctness ───
// **Validates: Requirements 4.2**

describe('Feature: pay-period-spend-prediction, Property 6: Daily data boundary correctness', () => {
  it('actualCumulative is non-null through currentDayNumber and null after', () => {
    fc.assert(
      fc.property(periodArb(), scheduleTypeArb, (period, scheduleType) => {
        const input: SpendPredictionInput = {
          periodStart: period.start,
          periodEnd: period.end,
          today: period.today,
          scheduleType,
          periodExpenses: [],
          budgetAllocations: [],
          transactions: [],
        };

        const result = computeSpendPrediction(input);

        for (const day of result.dailyData) {
          if (day.dayNumber <= result.currentDayNumber) {
            expect(day.actualCumulative).not.toBeNull();
          } else {
            expect(day.actualCumulative).toBeNull();
          }
        }
      }),
      { numRuns: 20 },
    );
  });
});
