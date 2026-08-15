/**
 * Property-Based Tests for budget-utils.ts
 *
 * Feature: budget-ui-and-deletion
 * Tests the pure utility functions used by the budget UI:
 *   1. Budget row remaining amount (transformBudgetRow)
 *   2. Grouping subtotals and overall totals (groupCategoriesWithBudgets + computeOverallTotals)
 *   3. Version change detection (detectVersionChange)
 *   4. Frequency conversion round-trip (convertToFrequency ↔ convertFromFrequency)
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { BudgetStatusResponse } from '@budget-tracker/core';
import type { CategoryWithBudget } from './types.js';
import {
  transformBudgetRow,
  groupCategoriesWithBudgets,
  computeOverallTotals,
  detectVersionChange,
  convertToFrequency,
  convertFromFrequency,
} from './budget-utils.js';

// ─── Shared Generators ───

const positiveAmount = fc.double({
  min: 0.01,
  max: 1e9,
  noNaN: true,
  noDefaultInfinity: true,
});

const anyAmount = fc.double({
  min: -1e9,
  max: 1e9,
  noNaN: true,
  noDefaultInfinity: true,
});

const nonNegativeAmount = fc.double({
  min: 0,
  max: 1e9,
  noNaN: true,
  noDefaultInfinity: true,
});

const displayFrequency = fc.constantFrom(
  'WEEKLY' as const,
  'BIWEEKLY' as const,
  'MONTHLY' as const,
  'ANNUAL' as const,
);

const budgetStatus = fc.constantFrom('under' as const, 'near' as const, 'over' as const);

const cuid = fc
  .string({ minLength: 8, maxLength: 25 })
  .map((s) => `c${s.replace(/[^a-z0-9]/gi, 'x')}`);

const nullableString = fc.option(cuid, { nil: null });

/** Build a mock BudgetStatusResponse with controlled monthlyEquivalent and actualSpending. */
function makeBudgetStatus(
  monthlyEquivalent: number,
  actualSpending: number,
  status: 'under' | 'near' | 'over',
): BudgetStatusResponse {
  return {
    id: 'budget-1',
    yearPlanId: 'plan-1',
    budgetId: 'cat-1',
    categoryName: 'Test Category',
    categoryGroup: 'Test Group',
    removedAt: null,
    seasonal: false,
    highWaterMark: 0,
    linkedExpenseCount: 0,
    doneForYear: false,
    version: {
      id: 'ver-1',
      amount: monthlyEquivalent,
      frequency: 'MONTHLY',
      monthlyEquivalent,
      activeMonths: [],
      effectiveDate: '2025-01-01T00:00:00.000Z',
      createdAt: '2025-01-01T00:00:00.000Z',
      manualOverride: false,
    },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    actualSpending,
    status,
  };
}

function makeCategoryRow(
  overrides?: Partial<{
    id: string;
    name: string;
    groupId: string;
    groupName: string;
    groupColor: string;
    icon: string | null;
  }>,
) {
  return {
    id: overrides?.id ?? 'cat-1',
    name: overrides?.name ?? 'Test Category',
    groupId: overrides?.groupId ?? 'grp-1',
    groupName: overrides?.groupName ?? 'Group A',
    groupColor: overrides?.groupColor ?? '#ff0000',
    icon: overrides?.icon ?? null,
  };
}

/** Build a CategoryWithBudget row with controlled values for grouping tests. */
function makeCategoryWithBudget(
  overrides: Partial<CategoryWithBudget> & { groupId: string },
): CategoryWithBudget {
  return {
    id: overrides.id ?? 'cat-1',
    name: overrides.name ?? 'Category',
    groupId: overrides.groupId,
    groupName: overrides.groupName ?? 'Group',
    groupColor: overrides.groupColor ?? '#000000',
    icon: overrides.icon ?? null,
    budgetId: overrides.budgetId ?? null,
    monthlyEquivalent: overrides.monthlyEquivalent ?? 0,
    nativeAmount: overrides.nativeAmount ?? 0,
    budgetFrequency: overrides.budgetFrequency ?? 'MONTHLY',
    activeMonths: overrides.activeMonths ?? [],
    actualSpending: overrides.actualSpending ?? 0,
    remaining: overrides.remaining ?? 0,
    status: overrides.status ?? null,
    isVersionChanged: overrides.isVersionChanged ?? false,
    seasonal: overrides.seasonal ?? false,
    versionId: overrides.versionId ?? null,
    linkedExpenseCount: overrides.linkedExpenseCount ?? 0,
    manualOverride: overrides.manualOverride ?? false,
  };
}

// ─── Property 1: Budget row remaining amount ───

describe('Feature: budget-ui-and-deletion, Property 1: Budget row remaining amount', () => {
  it('remaining equals monthlyEquivalent minus actualSpending', () => {
    fc.assert(
      fc.property(anyAmount, anyAmount, budgetStatus, (monthlyEq, actual, status) => {
        const bs = makeBudgetStatus(monthlyEq, actual, status);
        const row = transformBudgetRow(makeCategoryRow(), bs);

        expect(row.remaining).toBeCloseTo(monthlyEq - actual, 10);
      }),
      { numRuns: 20 },
    );
  });

  it('preserves all category fields from the input', () => {
    fc.assert(
      fc.property(
        nonNegativeAmount,
        nonNegativeAmount,
        budgetStatus,
        (monthlyEq, actual, status) => {
          const cat = makeCategoryRow({
            id: 'cat-42',
            name: 'Groceries',
            groupId: 'grp-7',
            groupName: 'Food',
            groupColor: '#00ff00',
            icon: 'cart',
          });
          const bs = makeBudgetStatus(monthlyEq, actual, status);
          const row = transformBudgetRow(cat, bs);

          expect(row.id).toBe('cat-42');
          expect(row.name).toBe('Groceries');
          expect(row.groupId).toBe('grp-7');
          expect(row.groupName).toBe('Food');
          expect(row.groupColor).toBe('#00ff00');
          expect(row.icon).toBe('cart');
        },
      ),
      { numRuns: 20 },
    );
  });

  it('returns zero budget fields when budgetStatus is null', () => {
    const row = transformBudgetRow(makeCategoryRow(), null);

    expect(row.monthlyEquivalent).toBe(0);
    expect(row.actualSpending).toBe(0);
    expect(row.remaining).toBe(0);
    expect(row.budgetId).toBeNull();
    expect(row.status).toBeNull();
    expect(row.versionId).toBeNull();
  });
});

// ─── Property 2: Grouping subtotals and overall totals ───

/** Arbitrary for a single CategoryWithBudget row with a given groupId. */
const categoryWithBudgetArb = (groupIds: string[]) =>
  fc
    .record({
      groupId: fc.constantFrom(...groupIds),
      monthlyEquivalent: nonNegativeAmount,
      actualSpending: nonNegativeAmount,
    })
    .map(({ groupId, monthlyEquivalent, actualSpending }) =>
      makeCategoryWithBudget({
        id: `cat-${Math.random().toString(36).slice(2, 8)}`,
        groupId,
        groupName: `Group ${groupId}`,
        monthlyEquivalent,
        actualSpending,
        remaining: monthlyEquivalent - actualSpending,
      }),
    );

describe('Feature: budget-ui-and-deletion, Property 2: Grouping subtotals and overall totals', () => {
  it('each group subtotal equals the sum of its rows', () => {
    const groupIds = ['g1', 'g2', 'g3'];
    fc.assert(
      fc.property(
        fc.array(categoryWithBudgetArb(groupIds), { minLength: 1, maxLength: 50 }),
        (rows) => {
          const groups = groupCategoriesWithBudgets(rows);

          for (const group of groups) {
            const expectedBudgeted = group.rows.reduce((s, r) => s + r.monthlyEquivalent, 0);
            const expectedActual = group.rows.reduce((s, r) => s + r.actualSpending, 0);
            const expectedRemaining = group.rows.reduce((s, r) => s + r.remaining, 0);

            expect(group.subtotalBudgeted).toBeCloseTo(expectedBudgeted, 5);
            expect(group.subtotalActual).toBeCloseTo(expectedActual, 5);
            expect(group.subtotalRemaining).toBeCloseTo(expectedRemaining, 5);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('overall totals equal the sum of all group subtotals', () => {
    const groupIds = ['g1', 'g2', 'g3', 'g4'];
    fc.assert(
      fc.property(
        fc.array(categoryWithBudgetArb(groupIds), { minLength: 1, maxLength: 50 }),
        (rows) => {
          const groups = groupCategoriesWithBudgets(rows);
          const totals = computeOverallTotals(groups);

          const expectedBudgeted = groups.reduce((s, g) => s + g.subtotalBudgeted, 0);
          const expectedActual = groups.reduce((s, g) => s + g.subtotalActual, 0);
          const expectedRemaining = groups.reduce((s, g) => s + g.subtotalRemaining, 0);

          expect(totals.totalBudgeted).toBeCloseTo(expectedBudgeted, 5);
          expect(totals.totalActual).toBeCloseTo(expectedActual, 5);
          expect(totals.totalRemaining).toBeCloseTo(expectedRemaining, 5);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('total row count across groups equals input row count', () => {
    const groupIds = ['g1', 'g2'];
    fc.assert(
      fc.property(
        fc.array(categoryWithBudgetArb(groupIds), { minLength: 0, maxLength: 30 }),
        (rows) => {
          const groups = groupCategoriesWithBudgets(rows);
          const totalRows = groups.reduce((s, g) => s + g.rows.length, 0);
          expect(totalRows).toBe(rows.length);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('empty input produces empty groups and zero totals', () => {
    const groups = groupCategoriesWithBudgets([]);
    const totals = computeOverallTotals(groups);

    expect(groups).toHaveLength(0);
    expect(totals.totalBudgeted).toBe(0);
    expect(totals.totalActual).toBe(0);
    expect(totals.totalRemaining).toBe(0);
  });
});

// ─── Property 3: Version change detection ───

describe('Feature: budget-ui-and-deletion, Property 3: Version change detection', () => {
  it('returns true when current and previous differ', () => {
    fc.assert(
      fc.property(nullableString, nullableString, (current, previous) => {
        const result = detectVersionChange(current, previous);
        if (current === previous) {
          expect(result).toBe(false);
        } else {
          expect(result).toBe(true);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('returns false when both are identical non-null strings', () => {
    fc.assert(
      fc.property(cuid, (id) => {
        expect(detectVersionChange(id, id)).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('returns false when both are null', () => {
    expect(detectVersionChange(null, null)).toBe(false);
  });

  it('returns true for null → non-null transition', () => {
    fc.assert(
      fc.property(cuid, (id) => {
        expect(detectVersionChange(id, null)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('returns true for non-null → null transition', () => {
    fc.assert(
      fc.property(cuid, (id) => {
        expect(detectVersionChange(null, id)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 4: Frequency conversion round-trip ───

describe('Feature: budget-ui-and-deletion, Property 4: Frequency conversion round-trip', () => {
  it('convertFromFrequency(convertToFrequency(amount, freq), freq) ≈ amount', () => {
    fc.assert(
      fc.property(positiveAmount, displayFrequency, (amount, freq) => {
        const displayed = convertToFrequency(amount, freq);
        const roundTripped = convertFromFrequency(displayed, freq);
        expect(roundTripped).toBeCloseTo(amount, 2);
      }),
      { numRuns: 20 },
    );
  });

  it('convertToFrequency(convertFromFrequency(amount, freq), freq) ≈ amount', () => {
    fc.assert(
      fc.property(positiveAmount, displayFrequency, (amount, freq) => {
        const monthly = convertFromFrequency(amount, freq);
        const roundTripped = convertToFrequency(monthly, freq);
        expect(roundTripped).toBeCloseTo(amount, 2);
      }),
      { numRuns: 20 },
    );
  });

  it('MONTHLY frequency is identity (no conversion)', () => {
    fc.assert(
      fc.property(positiveAmount, (amount) => {
        expect(convertToFrequency(amount, 'MONTHLY')).toBeCloseTo(amount, 10);
        expect(convertFromFrequency(amount, 'MONTHLY')).toBeCloseTo(amount, 10);
      }),
      { numRuns: 20 },
    );
  });

  it('WEEKLY conversion uses 52/12 multiplier', () => {
    fc.assert(
      fc.property(positiveAmount, (monthlyAmount) => {
        const weekly = convertToFrequency(monthlyAmount, 'WEEKLY');
        expect(weekly).toBeCloseTo(monthlyAmount * (12 / 52), 5);
      }),
      { numRuns: 20 },
    );
  });

  it('BIWEEKLY conversion uses 26/12 multiplier', () => {
    fc.assert(
      fc.property(positiveAmount, (monthlyAmount) => {
        const biweekly = convertToFrequency(monthlyAmount, 'BIWEEKLY');
        expect(biweekly).toBeCloseTo(monthlyAmount * (12 / 26), 5);
      }),
      { numRuns: 20 },
    );
  });

  it('ANNUAL conversion uses 12 multiplier', () => {
    fc.assert(
      fc.property(positiveAmount, (monthlyAmount) => {
        const annual = convertToFrequency(monthlyAmount, 'ANNUAL');
        expect(annual).toBeCloseTo(monthlyAmount * 12, 5);
      }),
      { numRuns: 20 },
    );
  });
});
