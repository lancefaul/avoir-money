import { describe, it, expect } from 'vitest';
import { computePeriodExpensesTotal } from '../utils.js';

/**
 * Unit tests for computePeriodExpensesTotal
 * Validates: Requirements 1.1, 1.5
 */
describe('computePeriodExpensesTotal', () => {
  it('returns 0 for an empty array', () => {
    expect(computePeriodExpensesTotal([])).toBe(0);
  });

  it('uses actualAmount for all items when every actualAmount is set', () => {
    const items = [
      { amount: 100, actualAmount: 80 },
      { amount: 200, actualAmount: 150 },
      { amount: 50, actualAmount: 60 },
    ];
    expect(computePeriodExpensesTotal(items)).toBe(80 + 150 + 60);
  });

  it('falls back to amount when all actualAmount values are null', () => {
    const items = [
      { amount: 100, actualAmount: null },
      { amount: 200, actualAmount: null },
      { amount: 50, actualAmount: null },
    ];
    expect(computePeriodExpensesTotal(items)).toBe(100 + 200 + 50);
  });

  it('uses actualAmount where present and amount where null', () => {
    const items = [
      { amount: 100, actualAmount: 90 },
      { amount: 200, actualAmount: null },
      { amount: 50, actualAmount: 45 },
    ];
    // 90 + 200 + 45 = 335
    expect(computePeriodExpensesTotal(items)).toBe(335);
  });
});
