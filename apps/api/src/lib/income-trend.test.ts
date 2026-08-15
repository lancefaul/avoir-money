/**
 * Unit Tests for Income Trend Helper Functions
 *
 * Tests specific examples and edge cases for income-trend module functions.
 * All tests are pure (no DB needed) — they exercise the helper functions directly.
 */
import { describe, it, expect } from 'vitest';
import { getPeriodsPerYear, computePastPeriodTotals } from './income-trend.js';

// ─── getPeriodsPerYear Tests ───

describe('getPeriodsPerYear', () => {
  /**
   * **Validates: Requirements 5.9, 5.10**
   */

  it('returns 52 for WEEKLY schedule type', () => {
    expect(getPeriodsPerYear('WEEKLY')).toBe(52);
  });

  it('returns 26 for BIWEEKLY schedule type', () => {
    expect(getPeriodsPerYear('BIWEEKLY')).toBe(26);
  });

  it('returns 24 for SEMI_MONTHLY schedule type', () => {
    expect(getPeriodsPerYear('SEMI_MONTHLY')).toBe(24);
  });

  it('returns 12 for MONTHLY schedule type', () => {
    expect(getPeriodsPerYear('MONTHLY')).toBe(12);
  });

  it('returns 26 (default) for unknown schedule type', () => {
    expect(getPeriodsPerYear('UNKNOWN')).toBe(26);
    expect(getPeriodsPerYear('QUARTERLY')).toBe(26);
    expect(getPeriodsPerYear('')).toBe(26);
    expect(getPeriodsPerYear('invalid')).toBe(26);
  });
});

// ─── computePastPeriodTotals Tests ───

describe('computePastPeriodTotals', () => {
  /**
   * **Validates: Requirements 5.5**
   */

  it('skips child transactions (non-null parentId) to avoid double-counting', () => {
    const periodStart = new Date(Date.UTC(2024, 0, 1)); // Jan 1, 2024
    const periodEnd = new Date(Date.UTC(2024, 0, 31)); // Jan 31, 2024

    const transactions = [
      // Parent transaction: INCOME $1000
      {
        amount: 1000,
        netAmount: 1000,
        type: 'INCOME',
        parentId: null,
        date: new Date(Date.UTC(2024, 0, 15)),
      },
      // Child transaction: should be skipped
      {
        amount: 500,
        netAmount: 500,
        type: 'INCOME',
        parentId: 'parent-tx-id',
        date: new Date(Date.UTC(2024, 0, 15)),
      },
      // Parent transaction: EXPENSE charged $190 (sticker $200)
      {
        amount: 200,
        netAmount: 190,
        type: 'EXPENSE',
        parentId: null,
        date: new Date(Date.UTC(2024, 0, 20)),
      },
      // Child transaction: should be skipped
      {
        amount: 100,
        netAmount: 100,
        type: 'EXPENSE',
        parentId: 'parent-expense-id',
        date: new Date(Date.UTC(2024, 0, 20)),
      },
      // Parent transaction: TRADE $300
      {
        amount: 300,
        netAmount: 300,
        type: 'TRADE',
        parentId: null,
        date: new Date(Date.UTC(2024, 0, 25)),
      },
      // Child transaction: should be skipped
      {
        amount: 150,
        netAmount: 150,
        type: 'TRADE',
        parentId: 'parent-trade-id',
        date: new Date(Date.UTC(2024, 0, 25)),
      },
    ];

    const result = computePastPeriodTotals(transactions, periodStart, periodEnd);

    // Only parent transactions should be counted
    expect(result.income).toBe(1000); // Only the parent INCOME
    expect(result.expenses).toBe(190); // Only the parent EXPENSE (netAmount charged)
    expect(result.trades).toBe(300); // Only the parent TRADE
  });

  it('includes all transactions when none have parentId', () => {
    const periodStart = new Date(Date.UTC(2024, 0, 1));
    const periodEnd = new Date(Date.UTC(2024, 0, 31));

    const transactions = [
      {
        amount: 1000,
        netAmount: 1000,
        type: 'INCOME',
        parentId: null,
        date: new Date(Date.UTC(2024, 0, 15)),
      },
      {
        amount: 500,
        netAmount: 500,
        type: 'INCOME',
        parentId: null,
        date: new Date(Date.UTC(2024, 0, 16)),
      },
      {
        amount: 200,
        netAmount: 200,
        type: 'EXPENSE',
        parentId: null,
        date: new Date(Date.UTC(2024, 0, 20)),
      },
    ];

    const result = computePastPeriodTotals(transactions, periodStart, periodEnd);

    expect(result.income).toBe(1500); // Both INCOME transactions
    expect(result.expenses).toBe(200); // The EXPENSE transaction
    expect(result.trades).toBe(0);
  });
});
