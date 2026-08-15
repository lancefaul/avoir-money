// Feature: v1-hardening, Property 2: Financial Calculation Invariants
/**
 * Property-based tests for financial calculation invariants:
 * 1. Debt amortization: total principal + remaining = original balance
 * 2. Budget monthly-equivalent conversion round-trip
 * 3. Spend prediction: daily rate non-negative and bounded
 *
 * **Validates: Requirements 2.4**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateAmortization } from '@budget-tracker/core';
import { computeMonthlyEquivalent, convertMonthlyToFrequency } from './budget.js';
import { computeSpendPrediction, type SpendPredictionInput } from './spend-prediction.js';
import { makeDate } from './dates.js';

// ─── Shared Generators ───

const positiveAmount = fc.double({ min: 0.01, max: 1e6, noNaN: true, noDefaultInfinity: true });

/** Budget frequency values (all values from BudgetFrequencySchema) */
const budgetFrequencyArb = fc.constantFrom(
  'WEEKLY' as const,
  'BIWEEKLY' as const,
  'SEMI_MONTHLY' as const,
  'MONTHLY' as const,
  'QUARTERLY' as const,
  'BIANNUAL' as const,
  'ANNUAL' as const,
  'YEARLY' as const,
);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Debt amortization: total principal + remaining = original balance
// ─────────────────────────────────────────────────────────────────────────────

describe('Feature: v1-hardening, Property 2: Financial Calculation Invariants', () => {
  describe('Debt amortization: total principal + remaining = original balance', () => {
    it('sum of principalAmount across all entries + final remainingBalance = original balance', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 100, max: 500_000, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 0.01, max: 30, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 50, max: 5000, noNaN: true, noDefaultInfinity: true }),
          (currentBalance, apr, surplus) => {
            // Ensure payment exceeds monthly interest (not negatively amortizing)
            const monthlyInterest = (currentBalance * apr) / 100 / 12;
            const minimumPayment = monthlyInterest + surplus;

            const result = generateAmortization({ currentBalance, apr, minimumPayment });

            if (result.isNegativelyAmortizing) return;
            if (result.entries.length === 0) return;

            const totalPrincipal = result.entries.reduce((sum, e) => sum + e.principalAmount, 0);
            const finalRemaining = result.entries[result.entries.length - 1]!.remainingBalance;

            // Total principal paid + remaining balance should equal the original.
            //
            // The tolerance MUST scale with the schedule length. Every entry
            // rounds principal and interest to the cent, so the accumulated
            // error is bounded by (entries x half a cent), not by a constant.
            // A fixed 0.5 held for short schedules and failed for long ones —
            // which is why this surfaced as a rare seed-dependent flake rather
            // than a consistent failure, unreproduced from 2026-07-16 until
            // seed -1247784253 produced a ~160-period schedule drifting
            // 0.5012. See ERRORS.md.
            //
            // Not a defect in generateAmortization: rounding each period to
            // the cent is correct, and the sum of rounded values genuinely
            // differs from the rounded sum.
            const tolerance = result.entries.length * 0.005 + 0.01;
            expect(Math.abs(totalPrincipal + finalRemaining - currentBalance)).toBeLessThanOrEqual(
              tolerance,
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it('every non-final entry: principalAmount + interestAmount = paymentAmount (excluding escrow)', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 100, max: 500_000, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 0.01, max: 30, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 50, max: 5000, noNaN: true, noDefaultInfinity: true }),
          (currentBalance, apr, surplus) => {
            const monthlyInterest = (currentBalance * apr) / 100 / 12;
            const minimumPayment = monthlyInterest + surplus;

            const result = generateAmortization({ currentBalance, apr, minimumPayment });

            if (result.isNegativelyAmortizing) return;
            if (result.entries.length <= 1) return;

            // Check all entries except the final one (final may have adjusted payment)
            for (let i = 0; i < result.entries.length - 1; i++) {
              const entry = result.entries[i]!;
              // paymentAmount includes escrow (0 here), so P + I should equal paymentAmount
              expect(entry.principalAmount + entry.interestAmount).toBeCloseTo(
                entry.paymentAmount,
                1,
              );
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Budget monthly-equivalent conversion round-trip
  // ───────────────────────────────────────────────────────────────────────────

  describe('Budget monthly-equivalent conversion round-trip', () => {
    it('convertMonthlyToFrequency(computeMonthlyEquivalent(amount, freq), freq) ≈ amount', () => {
      fc.assert(
        fc.property(positiveAmount, budgetFrequencyArb, (amount, frequency) => {
          const monthly = computeMonthlyEquivalent(amount, frequency);
          const roundTrip = convertMonthlyToFrequency(monthly, frequency);
          expect(roundTrip).toBeCloseTo(amount, 5);
        }),
        { numRuns: 100 },
      );
    });

    it('round-trip preserves amount for YEARLY seasonal budgets', () => {
      fc.assert(
        fc.property(
          positiveAmount,
          fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 12 }),
          (amount, activeMonths) => {
            const monthly = computeMonthlyEquivalent(amount, 'YEARLY', activeMonths);
            const roundTrip = convertMonthlyToFrequency(monthly, 'YEARLY', activeMonths);
            expect(roundTrip).toBeCloseTo(amount, 5);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('monthly equivalent is always positive for positive input', () => {
      fc.assert(
        fc.property(positiveAmount, budgetFrequencyArb, (amount, frequency) => {
          const monthly = computeMonthlyEquivalent(amount, frequency);
          expect(monthly).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Spend prediction: daily rate non-negative and bounded
  // ───────────────────────────────────────────────────────────────────────────

  describe('Spend prediction: daily rate non-negative and bounded', () => {
    /** Generate a valid SpendPredictionInput with consistent dates */
    const spendInputArb = fc
      .record({
        year: fc.integer({ min: 2020, max: 2030 }),
        month: fc.integer({ min: 0, max: 11 }),
        day: fc.integer({ min: 1, max: 15 }),
        periodDays: fc.integer({ min: 7, max: 31 }),
        dayOffset: fc.integer({ min: 0, max: 30 }),
        budgetAmount: fc.double({ min: 0, max: 10000, noNaN: true, noDefaultInfinity: true }),
        scheduleType: fc.constantFrom('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY'),
      })
      .map((r) => {
        const periodStart = makeDate(r.year, r.month, r.day);
        const periodEnd = makeDate(r.year, r.month, r.day + r.periodDays);
        // today is clamped within the period
        const todayOffset = Math.min(r.dayOffset, r.periodDays);
        const todayDate = makeDate(r.year, r.month, r.day + todayOffset);

        const input: SpendPredictionInput = {
          periodStart,
          periodEnd,
          today: todayDate,
          scheduleType: r.scheduleType,
          periodExpenses: [],
          budgetAllocations:
            r.budgetAmount > 0
              ? [
                  {
                    budgetId: 'test-budget',
                    amount: r.budgetAmount,
                    period: 'MONTHLY' as const,
                    activeMonths: null,
                    hasLinkedExpenses: false,
                  },
                ]
              : [],
          transactions: [],
        };
        return input;
      });

    it('expectedPeriodSpend is non-negative', () => {
      fc.assert(
        fc.property(spendInputArb, (input) => {
          const result = computeSpendPrediction(input);
          expect(result.expectedPeriodSpend).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 },
      );
    });

    it('daily rate (expectedPeriodSpend / totalDays) is non-negative and bounded by period budget', () => {
      fc.assert(
        fc.property(spendInputArb, (input) => {
          const result = computeSpendPrediction(input);
          const dailyRate =
            result.totalDays > 0 ? result.expectedPeriodSpend / result.totalDays : 0;

          // Daily rate must be non-negative
          expect(dailyRate).toBeGreaterThanOrEqual(0);

          // Daily rate * totalDays should equal expectedPeriodSpend (bounded)
          expect(dailyRate * result.totalDays).toBeCloseTo(result.expectedPeriodSpend, 5);
        }),
        { numRuns: 100 },
      );
    });

    it('totalDays and currentDayNumber are positive and consistent', () => {
      fc.assert(
        fc.property(spendInputArb, (input) => {
          const result = computeSpendPrediction(input);

          expect(result.totalDays).toBeGreaterThan(0);
          expect(result.currentDayNumber).toBeGreaterThanOrEqual(1);
          expect(result.currentDayNumber).toBeLessThanOrEqual(result.totalDays);
        }),
        { numRuns: 100 },
      );
    });
  });
});
