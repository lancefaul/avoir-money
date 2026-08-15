/**
 * Property-Based Tests for Cash Flow Timing Functions
 *
 * Tests Properties 1–3 from the cash-flow-timing design document.
 * All tests are pure (no DB needed) — they exercise the pure functions directly.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { classifyExpense, computeCashFlowSummary } from './cash-flow.js';
import type { CashFlowInput } from './cash-flow.js';

// ─── Shared Generators ───

/** Account type string: one of the known types, null, or an arbitrary string */
const accountTypeArb = fc.oneof(
  fc.constant(null as string | null),
  fc.constant('Checking' as string | null),
  fc.constant('Savings' as string | null),
  fc.constant('Credit Card' as string | null),
  fc.constant('Gift Card' as string | null),
  fc.string({ minLength: 0, maxLength: 50 }) as fc.Arbitrary<string | null>,
);

// ─── Property 1: Classification biconditional ───

describe('Feature: cash-flow-timing, Property 1: Classification biconditional', () => {
  /**
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
   *
   * For any account type string (or null), classifyExpense(accountType) returns
   * "credit" if and only if accountType === "Credit Card". For all other values
   * — including "Checking", "Savings", "Gift Card", null, and any unknown
   * string — it returns "cash".
   */

  it('returns "credit" if and only if accountType is "Credit Card"', () => {
    fc.assert(
      fc.property(accountTypeArb, (accountType) => {
        const result = classifyExpense(accountType);

        if (accountType === 'Credit Card') {
          expect(result).toBe('credit');
        } else {
          expect(result).toBe('cash');
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Shared CashFlowInput Generator ───

/** Single expense item: random type, amount 0–10000, random paid status */
const cashFlowExpenseItemArb = fc.record({
  expenseType: fc.oneof(fc.constant('cash' as const), fc.constant('credit' as const)),
  amount: fc.integer({ min: 0, max: 10000 }),
  isPaid: fc.boolean(),
});

/** Full CashFlowInput: 0–50 items, random previous-period credit, random CC payments */
const cashFlowInputArb: fc.Arbitrary<CashFlowInput> = fc.record({
  expenseItems: fc.array(cashFlowExpenseItemArb, { minLength: 0, maxLength: 50 }),
  previousPeriodCreditTotal: fc.integer({ min: 0, max: 50000 }),
  previousPeriodBankBalance: fc.integer({ min: 0, max: 100000 }),
  creditCardPayments: fc.integer({ min: 0, max: 50000 }),
});

// ─── Property 2: Cash needed equals cash expenses plus previous period credit ───

describe('Feature: cash-flow-timing, Property 2: Cash needed equals cash expenses plus previous period credit', () => {
  /**
   * **Validates: Requirements 2.1, 8.5**
   *
   * For any valid CashFlowInput, computeCashFlowSummary(input).cashNeeded
   * SHALL equal computeCashFlowSummary(input).cashExpenses +
   * computeCashFlowSummary(input).previousPeriodCreditExpenses.
   */

  it('cashNeeded === cashExpenses + previousPeriodCreditExpenses for all inputs', () => {
    fc.assert(
      fc.property(cashFlowInputArb, (input) => {
        const summary = computeCashFlowSummary(input);

        expect(summary.cashNeeded).toBe(
          summary.cashExpenses + summary.previousPeriodCreditExpenses,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 3: Expense partition invariant ───

describe('Feature: cash-flow-timing, Property 3: Expense partition invariant', () => {
  /**
   * **Validates: Requirements 8.6**
   *
   * For any valid CashFlowInput, cashExpenses + creditExpenses SHALL equal
   * the sum of all expense amounts in the input.
   */

  it('cashExpenses + creditExpenses === sum of all input expense amounts', () => {
    fc.assert(
      fc.property(cashFlowInputArb, (input) => {
        const summary = computeCashFlowSummary(input);
        const totalInputExpenses = input.expenseItems.reduce((sum, item) => sum + item.amount, 0);

        expect(summary.cashExpenses + summary.creditExpenses).toBe(totalInputExpenses);
      }),
      { numRuns: 100 },
    );
  });
});
