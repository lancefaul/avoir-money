/**
 * Property-Based Test — Property 4: Effective date validation
 *
 * Verifies that the category-budgets POST endpoint rejects effectiveMonth
 * values outside 1-12 and accepts values within 1-12.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { post, createGroup, createCategory } from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';

describe('Feature: category-budgets, Property 4: Effective date validation', () => {
  it('rejects effectiveMonth values outside 1-12', async () => {
    // Create shared fixtures once before the property assertion
    const group = await createGroup('PBT4_GRP_reject');
    const category = await createCategory(group.id, 'PBT4_CAT_reject');
    const yearPlan = await prisma.yearPlan.create({
      data: { year: 2025, status: 'ACTIVE' },
    });

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 13 })),
        async (invalidMonth) => {
          const res = await post('/category-budgets', {
            yearPlanId: yearPlan.id,
            budgetId: category.id,
            amount: 100,
            frequency: 'MONTHLY',
            effectiveMonth: invalidMonth,
          });

          expect(res.status).toBe(400);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('accepts valid effectiveMonth values within 1-12', async () => {
    // Create shared fixtures once before the property assertion
    const group = await createGroup('PBT4_GRP_accept');
    const yearPlan = await prisma.yearPlan.create({
      data: { year: 2026, status: 'ACTIVE' },
    });

    let iteration = 0;

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 12 }), async (validMonth) => {
        iteration++;

        // Create a fresh category per iteration to avoid unique constraint conflicts
        const category = await createCategory(group.id, `PBT4_CAT_accept_${iteration}`);

        const res = await post('/category-budgets', {
          yearPlanId: yearPlan.id,
          budgetId: category.id,
          amount: 250,
          frequency: 'MONTHLY',
          effectiveMonth: validMonth,
        });

        expect(res.status).toBe(201);

        const body = (await res.json()) as any;
        expect(body.budgetId).toBe(category.id);
        expect(body.version).not.toBeNull();
      }),
      { numRuns: 20 },
    );
  });
});
