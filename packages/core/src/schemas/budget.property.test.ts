import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { CreateCategoryBudgetSchema } from '../schemas/budget.js';

/**
 * Feature: category-budgets, Property 5: Non-positive amounts are rejected
 *
 * CreateCategoryBudgetSchema.amount uses z.number().positive(), so any value ≤ 0
 * must be rejected and any value > 0 must be accepted (given valid sibling fields).
 */
describe('Feature: category-budgets, Property 5: Negative amounts are rejected', () => {
  const validYearPlanId = 'plan-1';
  const validBudgetId = 'clxxxxxxxxxxxxxxxxxxxxxxxxx';
  const validFrequency = 'MONTHLY' as const;
  const validEffectiveMonth = 6;

  it('rejects any amount < 0', () => {
    fc.assert(
      fc.property(fc.double({ max: -Number.MIN_VALUE, noNaN: true }), (amount) => {
        const result = CreateCategoryBudgetSchema.safeParse({
          yearPlanId: validYearPlanId,
          budgetId: validBudgetId,
          amount,
          frequency: validFrequency,
          effectiveMonth: validEffectiveMonth,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('accepts any non-negative amount', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, noNaN: true, noDefaultInfinity: true }), (amount) => {
        const result = CreateCategoryBudgetSchema.safeParse({
          yearPlanId: validYearPlanId,
          budgetId: validBudgetId,
          amount,
          frequency: validFrequency,
          effectiveMonth: validEffectiveMonth,
        });
        expect(result.success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: category-budgets, Property 6: Invalid activeMonths are rejected
 *
 * CreateCategoryBudgetSchema.activeMonths uses z.array(z.number().int().min(1).max(12))
 * with a refinement that rejects duplicate values. This property group verifies:
 *   - Out-of-range month values (≤0 or ≥13) are rejected
 *   - Duplicate month values are rejected
 *   - Valid unique month arrays (1-12) are accepted
 */
describe('Feature: category-budgets, Property 6: Invalid activeMonths are rejected', () => {
  const validBase = {
    yearPlanId: 'plan-1',
    budgetId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
    amount: 100,
    frequency: 'MONTHLY' as const,
    effectiveMonth: 6,
  };

  it('rejects activeMonths with values outside 1-12', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 13 })), { minLength: 1 }),
        (badMonths) => {
          const result = CreateCategoryBudgetSchema.safeParse({
            ...validBase,
            activeMonths: badMonths,
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects activeMonths with duplicate values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }).chain((dup) =>
          fc
            .uniqueArray(fc.integer({ min: 1, max: 12 }), {
              minLength: 0,
              maxLength: 10,
            })
            .map((rest) => {
              // Ensure `dup` appears at least twice in the final array
              const filtered = rest.filter((v) => v !== dup);
              return [dup, ...filtered, dup];
            }),
        ),
        (dupeMonths) => {
          const result = CreateCategoryBudgetSchema.safeParse({
            ...validBase,
            activeMonths: dupeMonths,
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('accepts valid activeMonths arrays', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 12 })), (validMonths) => {
        const result = CreateCategoryBudgetSchema.safeParse({
          ...validBase,
          activeMonths: validMonths,
        });
        expect(result.success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});
