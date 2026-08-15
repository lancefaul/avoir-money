/**
 * Property-Based Test — Property 8: Carry-forward correctness
 *
 * Generates random category/budget configurations and verifies that
 * carry-forward copies exactly the final effective version per category.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { post, createGroup, createCategory } from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';
import { computeMonthlyEquivalent } from '../lib/budget.js';

// ─── Generators ───

const frequencyArb = fc.constantFrom('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY') as fc.Arbitrary<
  'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY'
>;

const positiveAmount = fc.double({ min: 0.01, max: 100_000, noNaN: true, noDefaultInfinity: true });

/**
 * Generate a category spec with 1-3 budget versions, each with a unique effectiveMonth.
 * Uniqueness ensures no duplicate effectiveDate constraint violations.
 */
const categorySpecArb = fc
  .uniqueArray(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 3 })
  .chain((months) =>
    fc.tuple(
      ...months.map((month) =>
        fc.record({
          amount: positiveAmount,
          frequency: frequencyArb,
          effectiveMonth: fc.constant(month),
        }),
      ),
    ),
  );

/** Generate 1-5 category specs for a single property run. */
const scenarioArb = fc.record({
  categories: fc.array(categorySpecArb, { minLength: 1, maxLength: 5 }),
});

// ─── Property 8 ───

describe('Feature: category-budgets, Property 8: Carry-forward correctness', () => {
  it('copies the final effective version per category into the target plan', async () => {
    let iteration = 0;

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ categories }) => {
        iteration++;

        // Use unique years per iteration to avoid conflicts without TRUNCATE
        const sourceYear = 1000 + iteration * 2;
        const targetYear = sourceYear + 1;

        // ── Create categories ──
        const group = await createGroup(`PBT8_GRP_${iteration}`);
        const createdCategories: {
          id: string;
          versions: typeof categorySpecArb extends fc.Arbitrary<infer T> ? T : never;
        }[] = [];

        for (const catVersions of categories) {
          const cat = await createCategory(
            group.id,
            `PBT8_CAT_${iteration}_${createdCategories.length}`,
          );
          createdCategories.push({ id: cat.id, versions: catVersions });
        }

        // ── Create source year plan with budgets ──
        const sourcePlan = await prisma.yearPlan.create({
          data: { year: sourceYear, status: 'ACTIVE' },
        });

        for (const { id: budgetId, versions } of createdCategories) {
          await prisma.categoryBudget.create({
            data: {
              yearPlanId: sourcePlan.id,
              budgetId: budgetId,
              versions: {
                create: versions.map((v) => ({
                  amount: v.amount,
                  frequency: v.frequency,
                  monthlyEquivalent: computeMonthlyEquivalent(v.amount, v.frequency),
                  activeMonths: [],
                  effectiveDate: new Date(Date.UTC(sourceYear, v.effectiveMonth - 1, 1)),
                })),
              },
            },
          });
        }

        // ── Create target DRAFT plan ──
        const targetPlan = await prisma.yearPlan.create({
          data: { year: targetYear, status: 'DRAFT' },
        });

        // ── Call carry-forward ──
        const res = await post(`/year-plans/${targetPlan.id}/carry-forward`, {
          sourceYear,
        });
        expect(res.status).toBe(200);

        // ── Assertion 1: target has exactly N CategoryBudgets ──
        const targetBudgets = await prisma.categoryBudget.findMany({
          where: { yearPlanId: targetPlan.id },
          include: { versions: true },
        });
        expect(targetBudgets.length).toBe(createdCategories.length);

        // ── Assertion 2 & 3 & 4: each target budget has 1 version matching the latest source version ──
        for (const { id: budgetId, versions } of createdCategories) {
          const targetBudget = targetBudgets.find((b) => b.budgetId === budgetId);
          expect(targetBudget).toBeDefined();

          // Assertion 2: exactly 1 version
          expect(targetBudget!.versions.length).toBe(1);

          const targetVersion = targetBudget!.versions[0];

          // Find the source's latest effective version (highest effectiveMonth)
          const latestSource = versions.reduce((best, v) =>
            v.effectiveMonth > best.effectiveMonth ? v : best,
          );

          // Assertion 3: amount and frequency match the latest source version
          expect(targetVersion!.amount.toNumber()).toBeCloseTo(latestSource.amount, 5);
          expect(targetVersion!.frequency).toBe(latestSource.frequency);

          // Assertion 4: effectiveDate is January 1 of the target year
          const expectedDate = new Date(Date.UTC(targetYear, 0, 1));
          expect(targetVersion!.effectiveDate.toISOString()).toBe(expectedDate.toISOString());
        }
      }),
      { numRuns: 20 },
    );
  }, 120_000);
});
