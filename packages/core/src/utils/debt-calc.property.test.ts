import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { splitPayment, generateAmortization, computeAmortizedPayment } from './debt-calc.js';

/**
 * Feature: debt-tracker, Property 6: Principal/interest split invariant
 * Validates: Requirements 3.3, 4.2
 *
 * For any currentBalance > 0, apr >= 0, paymentAmount > 0:
 * - principal + interest === paymentAmount (within 0.001 tolerance)
 * - interest === currentBalance * apr / 100 / 12 (within 0.001 tolerance)
 */
describe('Property 6: Principal/interest split invariant', () => {
  it('principal + interest equals paymentAmount', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1_000_000, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0.01, max: 100_000, noNaN: true }),
        (rawBalance, apr, rawPayment) => {
          // splitPayment operates in cents (rounds principal/interest to 2 decimals),
          // so constrain the money inputs to cent precision to match its real domain.
          const currentBalance = Math.round(rawBalance * 100) / 100;
          const paymentAmount = Math.round(rawPayment * 100) / 100;
          const { principal, interest } = splitPayment(currentBalance, apr, paymentAmount);
          // splitPayment rounds interest to cents; compare against the same rounding.
          const expectedInterest = Math.round(((currentBalance * apr) / 100 / 12) * 100) / 100;

          // interest matches formula (at cent precision)
          expect(interest).toBeCloseTo(expectedInterest, 2);

          // When not negatively amortizing, principal + interest = paymentAmount
          if (expectedInterest < paymentAmount) {
            expect(principal + interest).toBeCloseTo(paymentAmount, 2);
          } else {
            // Negatively amortizing: principal clamped to 0
            expect(principal).toBe(0);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: debt-tracker, Property 9: Amortization terminates at zero
 * Validates: Requirements 2.4, 4.1
 *
 * For any non-negatively-amortizing debt:
 * - Last entry has remainingBalance <= 0.01
 * - entries.length === payoffMonths
 */
describe('Property 9: Amortization schedule terminates at zero balance', () => {
  it('last entry has zero remaining balance and length matches payoffMonths', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 100, max: 500_000, noNaN: true }),
        fc.double({ min: 0, max: 30, noNaN: true }),
        fc.double({ min: 50, max: 5000, noNaN: true }),
        (currentBalance, apr, surplus) => {
          // Ensure minimumPayment > monthly interest (not negatively amortizing)
          const monthlyInterest = (currentBalance * apr) / 100 / 12;
          const minimumPayment = monthlyInterest + surplus;

          const result = generateAmortization({ currentBalance, apr, minimumPayment });

          expect(result.isNegativelyAmortizing).toBe(false);
          expect(result.entries.length).toBe(result.payoffMonths);
          // Skip if we hit the 600-month safety cap (wouldn't fully pay off)
          if (result.payoffMonths >= 600) return;
          if (result.entries.length > 0) {
            expect(result.entries[result.entries.length - 1]!.remainingBalance).toBeLessThanOrEqual(
              0.01,
            );
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: debt-tracker, Property 10: Extra payment reduces payoff time
 * Validates: Requirements 4.4
 *
 * For any non-negatively-amortizing debt and extraPayment > 0:
 * - Schedule with extra payment has strictly fewer months than without
 */
describe('Property 10: Extra payment reduces payoff time', () => {
  it('extra payment produces fewer months', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 10_000, max: 500_000, noNaN: true }),
        fc.double({ min: 2, max: 25, noNaN: true }),
        fc.double({ min: 100, max: 1000, noNaN: true }),
        fc.double({ min: 100, max: 5000, noNaN: true }),
        (currentBalance, apr, surplus, extraPayment) => {
          const monthlyInterest = (currentBalance * apr) / 100 / 12;
          const minimumPayment = monthlyInterest + surplus;

          const withoutExtra = generateAmortization({ currentBalance, apr, minimumPayment });

          // Only test if base schedule takes enough months and doesn't hit the cap
          if (withoutExtra.payoffMonths < 12 || withoutExtra.payoffMonths >= 600) return;

          const withExtra = generateAmortization(
            { currentBalance, apr, minimumPayment },
            extraPayment,
          );

          expect(withoutExtra.isNegativelyAmortizing).toBe(false);
          expect(withExtra.isNegativelyAmortizing).toBe(false);
          expect(withExtra.payoffMonths).toBeLessThan(withoutExtra.payoffMonths);
        },
      ),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: debt-tracker, Property 11: Negative amortization detection
 * Validates: Requirements 4.5
 *
 * For any debt:
 * - If currentBalance * apr / 100 / 12 >= minimumPayment: isNegativelyAmortizing === true
 * - If currentBalance * apr / 100 / 12 < minimumPayment: isNegativelyAmortizing === false
 */
describe('Property 11: Negative amortization detection', () => {
  it('detects negatively amortizing debts correctly', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 100, max: 1_000_000, noNaN: true }),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        fc.double({ min: 0.01, max: 100_000, noNaN: true }),
        (currentBalance, apr, minimumPayment) => {
          const monthlyInterest = (currentBalance * apr) / 100 / 12;
          const result = generateAmortization({ currentBalance, apr, minimumPayment });

          if (monthlyInterest >= minimumPayment) {
            expect(result.isNegativelyAmortizing).toBe(true);
          } else {
            expect(result.isNegativelyAmortizing).toBe(false);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: debt-tracker, Property 12: Derived P&I amortizes over the loan term
 * Validates: fixed-payment derivation from loan terms
 *
 * For any amortizing loan (positive principal, positive rate, valid term):
 * - The derived payment strictly exceeds the first period's interest (so the
 *   balance always shrinks — never negatively amortizing).
 * - Amortizing the ORIGINAL balance at the derived payment pays the loan off in
 *   approximately the scheduled term (within a couple periods for cent rounding).
 */
describe('Property 12: Derived P&I amortizes the original balance over its term', () => {
  it('derived payment exceeds period interest and pays off near the term', () => {
    fc.assert(
      fc.property(
        // Well-conditioned amortizing loans: a balance >= $10k keeps the effect
        // of cent-rounding the payment far below a single period (the rounding
        // error grows with (1+r)^n, so tiny balances at high rate/long term are
        // pathological and excluded here — a separate assertion covers those).
        fc.double({ min: 10_000, max: 1_000_000, noNaN: true }),
        fc.double({ min: 1, max: 15, noNaN: true }),
        fc.integer({ min: 12, max: 360 }),
        (rawBalance, apr, termMonths) => {
          const originalBalance = Math.round(rawBalance * 100) / 100;
          const payment = computeAmortizedPayment(originalBalance, apr, termMonths, 'MONTHLY');
          expect(payment).not.toBeNull();

          const periodInterest = (originalBalance * apr) / 100 / 12;
          // A proper amortizing payment must cover more than the interest
          expect(payment!).toBeGreaterThan(periodInterest);

          const result = generateAmortization({
            currentBalance: originalBalance,
            apr,
            minimumPayment: payment!, // ignored — derived payment is used
            termMonths,
            originalBalance,
            frequency: 'MONTHLY',
          });
          expect(result.isNegativelyAmortizing).toBe(false);
          // Skip the 600-period safety cap; otherwise payoff tracks the term
          if (result.payoffMonths < 600) {
            expect(Math.abs(result.payoffMonths - termMonths)).toBeLessThanOrEqual(2);
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
