/**
 * Unit tests for spend prediction edge cases.
 *
 * Tests specific scenarios not covered by property-based tests.
 */
import { describe, it, expect } from 'vitest';
import {
  prorateBudget,
  computeSpendPrediction,
  type SpendPredictionInput,
} from '../spend-prediction.js';

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m, day));

describe('prorateBudget edge cases', () => {
  it('returns 0 for unknown schedule type', () => {
    expect(prorateBudget(100, 'MONTHLY', null, 'UNKNOWN', d(2026, 0, 1), d(2026, 0, 14))).toBe(0);
  });

  it('seasonal budget excluded when no active months overlap period', () => {
    // Period is Feb 1–14, active months are [7, 8] (Jul, Aug)
    const result = prorateBudget(500, 'MONTHLY', [7, 8], 'BIWEEKLY', d(2026, 1, 1), d(2026, 1, 14));
    expect(result).toBe(0);
  });

  it('seasonal budget included when active month overlaps period', () => {
    // Period is Jan 1–14, active months include 1 (Jan)
    const result = prorateBudget(500, 'MONTHLY', [1, 6], 'BIWEEKLY', d(2026, 0, 1), d(2026, 0, 14));
    expect(result).toBeCloseTo((500 * 12) / 26, 8);
  });

  it('year boundary wrap-around: Dec→Jan period with December active month', () => {
    // Period spans Dec 20 (month 12) → Jan 3 (month 1)
    // Active months include 12 (December) → should detect overlap via wrap-around logic
    const result = prorateBudget(600, 'MONTHLY', [12], 'BIWEEKLY', d(2025, 11, 20), d(2026, 0, 3));
    expect(result).toBeCloseTo((600 * 12) / 26, 8);
  });

  it('year boundary wrap-around: Dec→Jan period with January active month', () => {
    // Period spans Dec 20 (month 12) → Jan 3 (month 1)
    // Active months include 1 (January) → should detect overlap via wrap-around logic
    const result = prorateBudget(600, 'MONTHLY', [1], 'BIWEEKLY', d(2025, 11, 20), d(2026, 0, 3));
    expect(result).toBeCloseTo((600 * 12) / 26, 8);
  });
});

describe('computeSpendPrediction edge cases', () => {
  const baseInput: SpendPredictionInput = {
    periodStart: d(2026, 3, 1),
    periodEnd: d(2026, 3, 14),
    today: d(2026, 3, 7),
    scheduleType: 'BIWEEKLY',
    periodExpenses: [],
    budgetAllocations: [],
    transactions: [],
  };

  it('zero budgets and zero expenses → expectedPeriodSpend = 0', () => {
    const result = computeSpendPrediction(baseInput);
    expect(result.expectedPeriodSpend).toBe(0);
    expect(result.overUnderAmount).toBe(0);
    expect(result.totalDays).toBe(14);
    expect(result.dailyData).toHaveLength(14);
  });

  it('single-day period', () => {
    const input: SpendPredictionInput = {
      ...baseInput,
      periodStart: d(2026, 3, 10),
      periodEnd: d(2026, 3, 10),
      today: d(2026, 3, 10),
      budgetAllocations: [
        {
          budgetId: 'cat1',
          amount: 260,
          period: 'MONTHLY',
          activeMonths: null,
          hasLinkedExpenses: false,
        },
      ],
    };
    const result = computeSpendPrediction(input);
    expect(result.totalDays).toBe(1);
    expect(result.currentDayNumber).toBe(1);
    expect(result.dailyData).toHaveLength(1);
    expect(result.dailyData[0]!.expectedCumulative).toBeCloseTo(result.expectedPeriodSpend, 8);
  });

  it('period boundary dates are correct', () => {
    const result = computeSpendPrediction(baseInput);
    expect(result.periodStartDate).toEqual(d(2026, 3, 1));
    expect(result.periodEndDate).toEqual(d(2026, 3, 14));
    expect(result.dailyData[0]!.date).toEqual(d(2026, 3, 1));
    expect(result.dailyData[13]!.date).toEqual(d(2026, 3, 14));
  });

  it('carry-forward of actual cumulative on days with no transactions', () => {
    const input: SpendPredictionInput = {
      ...baseInput,
      transactions: [
        { date: d(2026, 3, 1), amount: 50 },
        { date: d(2026, 3, 1), amount: 25 },
        { date: d(2026, 3, 5), amount: 100 },
      ],
    };
    const result = computeSpendPrediction(input);

    expect(result.dailyData[0]!.actualCumulative).toBeCloseTo(75, 8);
    expect(result.dailyData[1]!.actualCumulative).toBeCloseTo(75, 8);
    expect(result.dailyData[2]!.actualCumulative).toBeCloseTo(75, 8);
    expect(result.dailyData[4]!.actualCumulative).toBeCloseTo(175, 8);
    expect(result.dailyData[6]!.actualCumulative).toBeCloseTo(175, 8);
    expect(result.dailyData[7]!.actualCumulative).toBeNull();
  });

  it('currentDayNumber is clamped to totalDays when today is at period end', () => {
    const input: SpendPredictionInput = {
      ...baseInput,
      today: d(2026, 3, 14),
    };
    const result = computeSpendPrediction(input);
    expect(result.currentDayNumber).toBe(14);
  });

  it('currentDayNumber is clamped to totalDays when today is past period end', () => {
    const input: SpendPredictionInput = {
      ...baseInput,
      periodStart: d(2026, 3, 1),
      periodEnd: d(2026, 3, 14),
      today: d(2026, 3, 20), // 6 days after period end
    };
    const result = computeSpendPrediction(input);
    expect(result.currentDayNumber).toBe(14); // clamped to totalDays
    expect(result.totalDays).toBe(14);
  });
});

describe('prorateBudget — schedule types', () => {
  it('WEEKLY: amount × 12 / 52', () => {
    const result = prorateBudget(100, 'MONTHLY', null, 'WEEKLY', d(2026, 0, 1), d(2026, 0, 7));
    expect(result).toBeCloseTo((100 * 12) / 52, 8);
  });

  it('BIWEEKLY: amount × 12 / 26', () => {
    const result = prorateBudget(100, 'MONTHLY', null, 'BIWEEKLY', d(2026, 0, 1), d(2026, 0, 14));
    expect(result).toBeCloseTo((100 * 12) / 26, 8);
  });

  it('SEMI_MONTHLY: amount × 12 / 24', () => {
    const result = prorateBudget(
      100,
      'MONTHLY',
      null,
      'SEMI_MONTHLY',
      d(2026, 0, 1),
      d(2026, 0, 15),
    );
    expect(result).toBeCloseTo((100 * 12) / 24, 8);
  });

  it('MONTHLY: amount × 12 / 12 = amount', () => {
    const result = prorateBudget(100, 'MONTHLY', null, 'MONTHLY', d(2026, 0, 1), d(2026, 0, 31));
    expect(result).toBe(100);
  });

  it('YEARLY budget: amount / divisor', () => {
    const result = prorateBudget(1200, 'YEARLY', null, 'BIWEEKLY', d(2026, 0, 1), d(2026, 0, 14));
    expect(result).toBeCloseTo(1200 / 26, 8);
  });
});

describe('computeSpendPrediction — discretionary model (linked vs unlinked budgets)', () => {
  it('linked budget with no recurring expenses → full budget is discretionary', () => {
    // No recurring expenses due this period, so the entire budget is available
    const input: SpendPredictionInput = {
      periodStart: d(2026, 3, 1),
      periodEnd: d(2026, 3, 14),
      today: d(2026, 3, 7),
      scheduleType: 'BIWEEKLY',
      periodExpenses: [],
      budgetAllocations: [
        {
          budgetId: 'linked1',
          amount: 500,
          period: 'MONTHLY',
          activeMonths: null,
          hasLinkedExpenses: true,
        },
      ],
      transactions: [],
    };
    const result = computeSpendPrediction(input);
    // max(0, prorated - 0) = prorated
    expect(result.expectedPeriodSpend).toBeCloseTo((500 * 12) / 26, 8);
  });

  it('linked budget with recurring expenses → only remainder is discretionary', () => {
    // Budget is $500/mo prorated to biweekly ≈ $230.77
    // Recurring expense is $150 → discretionary remainder ≈ $80.77
    const prorated = (500 * 12) / 26;
    const input: SpendPredictionInput = {
      periodStart: d(2026, 3, 1),
      periodEnd: d(2026, 3, 14),
      today: d(2026, 3, 7),
      scheduleType: 'BIWEEKLY',
      periodExpenses: [{ id: 'exp1', budgetId: 'linked1', amount: 150 }],
      budgetAllocations: [
        {
          budgetId: 'linked1',
          amount: 500,
          period: 'MONTHLY',
          activeMonths: null,
          hasLinkedExpenses: true,
        },
      ],
      transactions: [],
    };
    const result = computeSpendPrediction(input);
    expect(result.expectedPeriodSpend).toBeCloseTo(Math.max(0, prorated - 150), 8);
  });

  it('linked budget fully consumed by recurring → $0 discretionary', () => {
    // Recurring expense exceeds the prorated budget → no discretionary remainder
    const input: SpendPredictionInput = {
      periodStart: d(2026, 3, 1),
      periodEnd: d(2026, 3, 14),
      today: d(2026, 3, 7),
      scheduleType: 'BIWEEKLY',
      periodExpenses: [{ id: 'exp1', budgetId: 'linked1', amount: 300 }],
      budgetAllocations: [
        {
          budgetId: 'linked1',
          amount: 500,
          period: 'MONTHLY',
          activeMonths: null,
          hasLinkedExpenses: true,
        },
      ],
      transactions: [],
    };
    const result = computeSpendPrediction(input);
    // prorated ≈ $230.77, recurring = $300 → max(0, 230.77 - 300) = 0
    expect(result.expectedPeriodSpend).toBe(0);
  });

  it('unlinked budget always contributes prorated amount', () => {
    const input: SpendPredictionInput = {
      periodStart: d(2026, 3, 1),
      periodEnd: d(2026, 3, 14),
      today: d(2026, 3, 7),
      scheduleType: 'BIWEEKLY',
      periodExpenses: [],
      budgetAllocations: [
        {
          budgetId: 'unlinked1',
          amount: 260,
          period: 'MONTHLY',
          activeMonths: null,
          hasLinkedExpenses: false,
        },
      ],
      transactions: [],
    };
    const result = computeSpendPrediction(input);
    expect(result.expectedPeriodSpend).toBeCloseTo((260 * 12) / 26, 8);
  });

  it('recurring expense with no budget allocation → $0 discretionary', () => {
    // An expense exists but has no budget allocation — contributes nothing
    const input: SpendPredictionInput = {
      periodStart: d(2026, 3, 1),
      periodEnd: d(2026, 3, 14),
      today: d(2026, 3, 7),
      scheduleType: 'BIWEEKLY',
      periodExpenses: [{ id: 'exp1', budgetId: 'orphan', amount: 200 }],
      budgetAllocations: [],
      transactions: [],
    };
    const result = computeSpendPrediction(input);
    expect(result.expectedPeriodSpend).toBe(0);
  });

  it('overUnderAmount is positive when overspending', () => {
    const input: SpendPredictionInput = {
      periodStart: d(2026, 3, 1),
      periodEnd: d(2026, 3, 14),
      today: d(2026, 3, 2),
      scheduleType: 'BIWEEKLY',
      periodExpenses: [],
      budgetAllocations: [
        {
          budgetId: 'b1',
          amount: 140,
          period: 'MONTHLY',
          activeMonths: null,
          hasLinkedExpenses: false,
        },
      ],
      transactions: [{ date: d(2026, 3, 1), amount: 100 }],
    };
    const result = computeSpendPrediction(input);
    expect(result.overUnderAmount).toBeGreaterThan(0);
  });
});
