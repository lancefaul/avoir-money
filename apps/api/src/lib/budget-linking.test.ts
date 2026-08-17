import { describe, it, expect } from 'vitest';
import {
  computeExpenseMonthlyEquivalent,
  resolveCurrentAmount,
  computeDerivedBaseline,
  applyHighWaterMark,
} from './budget-linking.js';

describe('computeExpenseMonthlyEquivalent', () => {
  it('converts WEEKLY: amount × 52/12', () => {
    expect(computeExpenseMonthlyEquivalent(100, 'WEEKLY')).toBeCloseTo(433.33, 2);
  });

  it('converts BIWEEKLY: amount × 26/12', () => {
    expect(computeExpenseMonthlyEquivalent(100, 'BIWEEKLY')).toBeCloseTo(216.67, 2);
  });

  it('converts SEMI_MONTHLY: amount × 2', () => {
    expect(computeExpenseMonthlyEquivalent(100, 'SEMI_MONTHLY')).toBe(200);
  });

  it('converts MONTHLY: amount × 1', () => {
    expect(computeExpenseMonthlyEquivalent(100, 'MONTHLY')).toBe(100);
  });

  it('converts QUARTERLY: amount ÷ 3', () => {
    expect(computeExpenseMonthlyEquivalent(300, 'QUARTERLY')).toBe(100);
  });

  it('converts BIANNUAL: amount ÷ 6', () => {
    expect(computeExpenseMonthlyEquivalent(600, 'BIANNUAL')).toBe(100);
  });

  it('converts ANNUAL: amount ÷ 12', () => {
    expect(computeExpenseMonthlyEquivalent(1200, 'ANNUAL')).toBe(100);
  });

  it('returns 0 for ONE_TIME', () => {
    expect(computeExpenseMonthlyEquivalent(500, 'ONE_TIME')).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    // 10 * 52/12 = 43.3333... → 43.33
    expect(computeExpenseMonthlyEquivalent(10, 'WEEKLY')).toBe(43.33);
    // 10 * 26/12 = 21.6666... → 21.67
    expect(computeExpenseMonthlyEquivalent(10, 'BIWEEKLY')).toBe(21.67);
    // 10 / 3 = 3.3333... → 3.33
    expect(computeExpenseMonthlyEquivalent(10, 'QUARTERLY')).toBe(3.33);
  });

  it('handles zero amount', () => {
    expect(computeExpenseMonthlyEquivalent(0, 'MONTHLY')).toBe(0);
    expect(computeExpenseMonthlyEquivalent(0, 'WEEKLY')).toBe(0);
  });
});

describe('resolveCurrentAmount', () => {
  it('returns schedule entry when month is present', () => {
    const expense = { amount: 100, amountSchedule: { '3': 150, '6': 200 } };
    expect(resolveCurrentAmount(expense, 3)).toBe(150);
    expect(resolveCurrentAmount(expense, 6)).toBe(200);
  });

  it('returns base amount when month is not in schedule', () => {
    const expense = { amount: 100, amountSchedule: { '3': 150 } };
    expect(resolveCurrentAmount(expense, 1)).toBe(100);
    expect(resolveCurrentAmount(expense, 12)).toBe(100);
  });

  it('returns base amount when amountSchedule is null', () => {
    const expense = { amount: 100, amountSchedule: null };
    expect(resolveCurrentAmount(expense, 5)).toBe(100);
  });

  it('returns base amount when amountSchedule is empty', () => {
    const expense = { amount: 100, amountSchedule: {} };
    expect(resolveCurrentAmount(expense, 5)).toBe(100);
  });
});

describe('computeDerivedBaseline', () => {
  it('sums monthly equivalents of active expenses', () => {
    const expenses = [
      {
        amount: 100,
        frequency: 'MONTHLY' as const,
        amountSchedule: null,
        pausedUntil: null,
        archivedAt: null,
      },
      {
        amount: 50,
        frequency: 'MONTHLY' as const,
        amountSchedule: null,
        pausedUntil: null,
        archivedAt: null,
      },
    ];
    expect(computeDerivedBaseline(expenses, 1)).toBe(150);
  });

  it('excludes paused expenses', () => {
    const expenses = [
      {
        amount: 100,
        frequency: 'MONTHLY' as const,
        amountSchedule: null,
        pausedUntil: null,
        archivedAt: null,
      },
      {
        amount: 50,
        frequency: 'MONTHLY' as const,
        amountSchedule: null,
        pausedUntil: new Date('2025-12-31'),
        archivedAt: null,
      },
    ];
    expect(computeDerivedBaseline(expenses, 1)).toBe(100);
  });

  it('excludes archived expenses', () => {
    const expenses = [
      {
        amount: 100,
        frequency: 'MONTHLY' as const,
        amountSchedule: null,
        pausedUntil: null,
        archivedAt: null,
      },
      {
        amount: 50,
        frequency: 'MONTHLY' as const,
        amountSchedule: null,
        pausedUntil: null,
        archivedAt: new Date('2025-01-01'),
      },
    ];
    expect(computeDerivedBaseline(expenses, 1)).toBe(100);
  });

  it('returns 0 for empty expense list', () => {
    expect(computeDerivedBaseline([], 1)).toBe(0);
  });

  it('returns 0 when all expenses are paused or archived', () => {
    const expenses = [
      {
        amount: 100,
        frequency: 'MONTHLY' as const,
        amountSchedule: null,
        pausedUntil: new Date(),
        archivedAt: null,
      },
      {
        amount: 200,
        frequency: 'MONTHLY' as const,
        amountSchedule: null,
        pausedUntil: null,
        archivedAt: new Date(),
      },
    ];
    expect(computeDerivedBaseline(expenses, 1)).toBe(0);
  });

  it('converts different frequencies to monthly equivalents', () => {
    const expenses = [
      {
        amount: 100,
        frequency: 'WEEKLY' as const,
        amountSchedule: null,
        pausedUntil: null,
        archivedAt: null,
      },
      {
        amount: 300,
        frequency: 'QUARTERLY' as const,
        amountSchedule: null,
        pausedUntil: null,
        archivedAt: null,
      },
    ];
    // 100 * 52/12 = 433.33, 300 / 3 = 100 → 533.33
    expect(computeDerivedBaseline(expenses, 1)).toBe(533.33);
  });

  it('uses amountSchedule for the given month', () => {
    const expenses = [
      {
        amount: 100,
        frequency: 'MONTHLY' as const,
        amountSchedule: { '3': 200 },
        pausedUntil: null,
        archivedAt: null,
      },
    ];
    expect(computeDerivedBaseline(expenses, 3)).toBe(200);
    expect(computeDerivedBaseline(expenses, 4)).toBe(100);
  });

  it('rounds the final sum to 2 decimal places', () => {
    const expenses = [
      {
        amount: 10,
        frequency: 'WEEKLY' as const,
        amountSchedule: null,
        pausedUntil: null,
        archivedAt: null,
      },
      {
        amount: 10,
        frequency: 'BIWEEKLY' as const,
        amountSchedule: null,
        pausedUntil: null,
        archivedAt: null,
      },
    ];
    // 10 * 52/12 = 43.33, 10 * 26/12 = 21.67 → 65.00
    expect(computeDerivedBaseline(expenses, 1)).toBe(65);
  });
});

describe('applyHighWaterMark', () => {
  it('returns derived baseline when it exceeds current HWM', () => {
    const result = applyHighWaterMark(500, 300);
    expect(result).toEqual({ effectiveAmount: 500, highWaterMark: 500 });
  });

  it('returns current HWM when derived baseline is lower', () => {
    const result = applyHighWaterMark(200, 500);
    expect(result).toEqual({ effectiveAmount: 500, highWaterMark: 500 });
  });

  it('returns equal values when derived equals HWM', () => {
    const result = applyHighWaterMark(300, 300);
    expect(result).toEqual({ effectiveAmount: 300, highWaterMark: 300 });
  });

  it('handles zero values', () => {
    expect(applyHighWaterMark(0, 0)).toEqual({ effectiveAmount: 0, highWaterMark: 0 });
    expect(applyHighWaterMark(100, 0)).toEqual({ effectiveAmount: 100, highWaterMark: 100 });
    expect(applyHighWaterMark(0, 100)).toEqual({ effectiveAmount: 100, highWaterMark: 100 });
  });
});
