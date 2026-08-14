import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateAmortization } from './debt-calc.js';
import { computeEscrowChange, shouldShowEscrowReminder, type EscrowRecordInput } from './escrow.js';

/**
 * Feature: mortgage-escrow, Property 1: Escrow payment formula invariant
 * Validates: Requirements 3.1, 3.2, 6.2
 *
 * For any valid DebtInput with escrow enabled and any non-negative escrow amount,
 * every AmortizationEntry SHALL satisfy:
 *   paymentAmount === principalAmount + interestAmount + escrowAmount
 */
describe('Property 1: Escrow payment formula invariant', () => {
  it('paymentAmount === principalAmount + interestAmount + escrowAmount for every entry', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1000, max: 500_000, noNaN: true }),
        fc.double({ min: 1, max: 15, noNaN: true }),
        fc.double({ min: 100, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: 1000, noNaN: true }),
        (balance, apr, surplus, escrow) => {
          const monthlyInterest = (balance * apr) / 100 / 12;
          const minimumPayment = monthlyInterest + surplus;

          const result = generateAmortization(
            { currentBalance: balance, apr, minimumPayment },
            0,
            escrow,
          );

          if (result.isNegativelyAmortizing) return;

          for (const entry of result.entries) {
            const expected = entry.principalAmount + entry.interestAmount + entry.escrowAmount;
            expect(entry.paymentAmount).toBeCloseTo(expected, 1);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: mortgage-escrow, Property 2: Escrow is purely additive (metamorphic)
 * Validates: Requirements 3.5, 1.2, 1.4
 *
 * For any valid DebtInput and any non-negative escrow amount, generating
 * amortization with escrow vs. without escrow SHALL produce identical
 * principalAmount and interestAmount values in each corresponding entry.
 */
describe('Property 2: Escrow is purely additive', () => {
  it('principalAmount, interestAmount, and remainingBalance are identical with and without escrow', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1000, max: 500_000, noNaN: true }),
        fc.double({ min: 1, max: 15, noNaN: true }),
        fc.double({ min: 100, max: 5000, noNaN: true }),
        fc.double({ min: 1, max: 1000, noNaN: true }),
        (balance, apr, surplus, escrow) => {
          const monthlyInterest = (balance * apr) / 100 / 12;
          const minimumPayment = monthlyInterest + surplus;
          const debt = { currentBalance: balance, apr, minimumPayment };

          const withoutEscrow = generateAmortization(debt, 0, 0);
          const withEscrow = generateAmortization(debt, 0, escrow);

          if (withoutEscrow.isNegativelyAmortizing) return;

          expect(withEscrow.entries.length).toBe(withoutEscrow.entries.length);

          for (let i = 0; i < withoutEscrow.entries.length; i++) {
            expect(withEscrow.entries[i]!.principalAmount).toBe(
              withoutEscrow.entries[i]!.principalAmount,
            );
            expect(withEscrow.entries[i]!.interestAmount).toBe(
              withoutEscrow.entries[i]!.interestAmount,
            );
            expect(withEscrow.entries[i]!.remainingBalance).toBe(
              withoutEscrow.entries[i]!.remainingBalance,
            );
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: mortgage-escrow, Property 3: Total escrow summation invariant
 * Validates: Requirements 3.3, 6.3
 *
 * For any amortization result generated with escrow enabled,
 * totalEscrow SHALL equal the sum of escrowAmount across all entries.
 */
describe('Property 3: Total escrow summation invariant', () => {
  it('totalEscrow === sum of all entries escrowAmount', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1000, max: 500_000, noNaN: true }),
        fc.double({ min: 1, max: 15, noNaN: true }),
        fc.double({ min: 100, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: 1000, noNaN: true }),
        (balance, apr, surplus, escrow) => {
          const monthlyInterest = (balance * apr) / 100 / 12;
          const minimumPayment = monthlyInterest + surplus;

          const result = generateAmortization(
            { currentBalance: balance, apr, minimumPayment },
            0,
            escrow,
          );

          if (result.isNegativelyAmortizing) return;

          const sumEscrow = result.entries.reduce((sum, e) => sum + e.escrowAmount, 0);
          expect(result.totalEscrow).toBeCloseTo(sumEscrow, 1);
        },
      ),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: mortgage-escrow, Property 5: Year-over-year escrow change calculation
 * Validates: Requirements 4.2, 4.3, 4.4
 *
 * For any two consecutive escrow records with non-negative amounts where the
 * previous amount is greater than zero, computeEscrowChange SHALL return
 * dollarDiff = current - previous, percentChange = (current - previous) / previous * 100,
 * with direction being "up" when current > previous, "down" when current < previous,
 * and "flat" when equal.
 */
describe('Property 5: Year-over-year escrow change calculation', () => {
  it('dollarDiff, percentChange, and direction are correct', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10_000, noNaN: true }),
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        (current, previous) => {
          const result = computeEscrowChange(current, previous);

          expect(result.dollarDiff).toBeCloseTo(current - previous, 5);
          expect(result.percentChange).toBeCloseTo(((current - previous) / previous) * 100, 5);

          if (current > previous) {
            expect(result.direction).toBe('up');
          } else if (current < previous) {
            expect(result.direction).toBe('down');
          } else {
            expect(result.direction).toBe('flat');
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: mortgage-escrow, Property 6: Escrow reminder logic
 * Validates: Requirements 5.1, 5.2
 *
 * For any set of escrow records for a debt and any current date,
 * shouldShowEscrowReminder SHALL return true if and only if the current date
 * is on or after the periodEndDate of the most recent record AND no newer
 * record exists with a periodStartDate on or after that end date.
 */
describe('Property 6: Escrow reminder logic', () => {
  const ONE_DAY_MS = 1000 * 60 * 60 * 24;

  const arbEscrowRecord = fc
    .record({
      monthlyAmount: fc.double({ min: 0, max: 5000, noNaN: true }),
      periodStartDate: fc.date({
        min: new Date('2020-01-01'),
        max: new Date('2028-01-01'),
        noInvalidDate: true,
      }),
      periodEndDate: fc.date({
        min: new Date('2020-06-01'),
        max: new Date('2030-01-01'),
        noInvalidDate: true,
      }),
    })
    .filter((r) => r.periodStartDate < r.periodEndDate);

  it('returns true iff currentDate >= mostRecent.periodEndDate and no newer record covers the gap', () => {
    fc.assert(
      fc.property(
        fc.array(arbEscrowRecord, { minLength: 1, maxLength: 5 }),
        fc.date({ min: new Date('2019-01-01'), max: new Date('2031-01-01'), noInvalidDate: true }),
        (records, currentDate) => {
          const result = shouldShowEscrowReminder(records, currentDate);

          // Compute expected result manually
          const sorted = [...records].sort(
            (a, b) => b.periodStartDate.getTime() - a.periodStartDate.getTime(),
          );
          const mostRecent = sorted[0]!;

          if (currentDate >= mostRecent.periodEndDate) {
            const hasNewerRecord = sorted.some(
              (r) => r !== mostRecent && r.periodStartDate >= mostRecent.periodEndDate,
            );
            expect(result).toBe(!hasNewerRecord);
          } else {
            expect(result).toBe(false);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
