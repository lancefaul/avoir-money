import { describe, it, expect } from 'vitest';
import { get, post, createGroup, createCategory } from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createYearPlan(year: number, status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' = 'DRAFT') {
  return prisma.yearPlan.create({ data: { year, status } });
}

function jan1(year: number) {
  return new Date(Date.UTC(year, 0, 1));
}

async function createBudgetWithVersion(
  yearPlanId: string,
  budgetId: string,
  opts: {
    amount?: number;
    frequency?: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY';
    removedAt?: Date;
    effectiveDate?: Date;
    activeMonths?: number[];
  } = {},
) {
  const amount = opts.amount ?? 500;
  const frequency = opts.frequency ?? 'MONTHLY';
  const effectiveDate = opts.effectiveDate ?? jan1(2025);
  const activeMonths = opts.activeMonths ?? [];
  const monthlyEquivalent = frequency === 'MONTHLY' ? amount : amount;

  return prisma.categoryBudget.create({
    data: {
      yearPlanId,
      budgetId: budgetId,
      removedAt: opts.removedAt ?? null,
      versions: {
        create: {
          amount,
          frequency,
          monthlyEquivalent,
          activeMonths,
          effectiveDate,
        },
      },
    },
    include: { versions: true },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Year Plans API', () => {
  // ─── CRUD lifecycle ──────────────────────────────────────────────────────

  describe('POST /year-plans', () => {
    it('creates a DRAFT year plan', async () => {
      const res = await post('/year-plans', { year: 2030 });
      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.year).toBe(2030);
      expect(body.status).toBe('DRAFT');
      expect(body.id).toBeDefined();
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();
    });
  });

  describe('GET /year-plans', () => {
    it('returns plans ordered by year descending', async () => {
      await createYearPlan(2020);
      await createYearPlan(2025);
      await createYearPlan(2022);

      const res = await get('/year-plans');
      expect(res.status).toBe(200);
      const body = (await res.json()) as any[];
      expect(body.length).toBe(3);
      expect(body[0].year).toBe(2025);
      expect(body[1].year).toBe(2022);
      expect(body[2].year).toBe(2020);
    });
  });

  describe('GET /year-plans/:id', () => {
    it('returns a year plan by ID', async () => {
      const plan = await createYearPlan(2031);
      const res = await get(`/year-plans/${plan.id}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.id).toBe(plan.id);
      expect(body.year).toBe(2031);
      expect(body.status).toBe('DRAFT');
    });

    it('returns 404 for non-existent plan', async () => {
      const res = await get('/year-plans/clxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(res.status).toBe(404);
    });
  });

  // ─── Duplicate year ────────────────────────────────────────────────────

  describe('duplicate year', () => {
    it('returns 409 when creating a plan for an existing year', async () => {
      await post('/year-plans', { year: 2040 });
      const res = await post('/year-plans', { year: 2040 });
      expect(res.status).toBe(409);
      const body: any = await res.json();
      expect(body.error).toContain('2040');
    });
  });

  // ─── Confirm flow ─────────────────────────────────────────────────────

  describe('POST /year-plans/:id/confirm', () => {
    it('confirms a DRAFT plan for the current year', async () => {
      // Use year 2026 — current year, so Date.now() >= Jan 1 2026
      const plan = await createYearPlan(2026);
      const res = await post(`/year-plans/${plan.id}/confirm`, {});
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.status).toBe('ACTIVE');
    });

    it('rejects confirming a plan for a future year', async () => {
      const plan = await createYearPlan(2099);
      const res = await post(`/year-plans/${plan.id}/confirm`, {});
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('Cannot confirm plan before January 1');
    });

    it('rejects confirming an already ACTIVE plan', async () => {
      const plan = await createYearPlan(2026, 'ACTIVE');
      const res = await post(`/year-plans/${plan.id}/confirm`, {});
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('Only DRAFT plans can be confirmed');
    });
  });

  // ─── ARCHIVED plan ────────────────────────────────────────────────────

  describe('carry-forward into ARCHIVED plan', () => {
    it('rejects carry-forward into an ARCHIVED plan', async () => {
      const source = await createYearPlan(2024, 'ACTIVE');
      const target = await createYearPlan(2025);
      // Archive the target directly
      await prisma.yearPlan.update({ where: { id: target.id }, data: { status: 'ARCHIVED' } });

      const res = await post(`/year-plans/${target.id}/carry-forward`, { sourceYear: 2024 });
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('archived');
    });
  });

  // ─── Carry-forward ────────────────────────────────────────────────────

  describe('POST /year-plans/:id/carry-forward', () => {
    it('copies budgets from source to target plan', async () => {
      // Set up source plan with 2 categories and budget versions
      const group = await createGroup('CF_GROUP');
      const catA = await createCategory(group.id, 'CF_CatA');
      const catB = await createCategory(group.id, 'CF_CatB');

      const source = await createYearPlan(2025, 'ACTIVE');
      await createBudgetWithVersion(source.id, catA.id, {
        amount: 1000,
        frequency: 'MONTHLY',
        effectiveDate: jan1(2025),
      });
      await createBudgetWithVersion(source.id, catB.id, {
        amount: 200,
        frequency: 'MONTHLY',
        effectiveDate: jan1(2025),
      });

      // Create DRAFT target
      const target = await createYearPlan(2026);

      const res = await post(`/year-plans/${target.id}/carry-forward`, { sourceYear: 2025 });
      expect(res.status).toBe(200);

      // Verify target has 2 CategoryBudgets
      const budgets = await prisma.categoryBudget.findMany({
        where: { yearPlanId: target.id },
        include: { versions: true },
      });
      expect(budgets.length).toBe(2);

      // Each has 1 BudgetVersion with effectiveDate = Jan 1 2026
      for (const b of budgets) {
        expect(b.versions.length).toBe(1);
        expect(b.versions[0]!.effectiveDate.toISOString()).toBe(jan1(2026).toISOString());
      }

      // Verify amounts match source
      const catABudget = budgets.find((b) => b.budgetId === catA.id)!;
      expect(catABudget.versions[0]!.amount.toNumber()).toBe(1000);
      expect(catABudget.versions[0]!.frequency).toBe('MONTHLY');

      const catBBudget = budgets.find((b) => b.budgetId === catB.id)!;
      expect(catBBudget.versions[0]!.amount.toNumber()).toBe(200);
      expect(catBBudget.versions[0]!.frequency).toBe('MONTHLY');
    });

    it('skips soft-deleted category budgets', async () => {
      const group = await createGroup('SD_GROUP');
      const cat = await createCategory(group.id, 'SD_Cat');

      const source = await createYearPlan(2025, 'ACTIVE');
      await createBudgetWithVersion(source.id, cat.id, {
        amount: 300,
        frequency: 'MONTHLY',
        removedAt: new Date(),
      });

      const target = await createYearPlan(2026);
      const res = await post(`/year-plans/${target.id}/carry-forward`, { sourceYear: 2025 });
      expect(res.status).toBe(200);

      const budgets = await prisma.categoryBudget.findMany({
        where: { yearPlanId: target.id },
      });
      expect(budgets.length).toBe(0);
    });

    it('skips budgets for deleted categories', async () => {
      const group = await createGroup('DC_GROUP');
      const cat = await createCategory(group.id, 'DC_Cat');

      const source = await createYearPlan(2025, 'ACTIVE');
      const cb = await createBudgetWithVersion(source.id, cat.id, {
        amount: 400,
        frequency: 'MONTHLY',
      });

      // Simulate an orphaned budgetId: delete CategoryBudget + Budget, then
      // re-insert CategoryBudget with the now-missing budgetId in a single
      // transaction so session_replication_role applies to the same connection.
      await prisma.budgetVersion.deleteMany({ where: { categoryBudgetId: cb.id } });
      await prisma.categoryBudget.delete({ where: { id: cb.id } });
      await prisma.budget.delete({ where: { id: cat.id } });
      await prisma.$transaction([
        prisma.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`),
        prisma.$executeRawUnsafe(
          `INSERT INTO "CategoryBudget" (id, "yearPlanId", "budgetId", "removedAt", "doneForYear", "createdAt", "updatedAt") VALUES ('${cb.id}', '${source.id}', '${cat.id}', NULL, false, NOW(), NOW())`,
        ),
      ]);

      const target = await createYearPlan(2026);
      const res = await post(`/year-plans/${target.id}/carry-forward`, { sourceYear: 2025 });
      expect(res.status).toBe(200);

      const budgets = await prisma.categoryBudget.findMany({
        where: { yearPlanId: target.id },
      });
      expect(budgets.length).toBe(0);
    });

    it('only copies budgeted categories (skips those without versions)', async () => {
      const group = await createGroup('BU_GROUP');
      const budgetedCat = await createCategory(group.id, 'BU_Budgeted');
      const unbudgetedCat = await createCategory(group.id, 'BU_Unbudgeted');

      const source = await createYearPlan(2025, 'ACTIVE');
      // Budgeted category has a version
      await createBudgetWithVersion(source.id, budgetedCat.id, {
        amount: 600,
        frequency: 'MONTHLY',
      });
      // Unbudgeted category has a CategoryBudget but no versions
      await prisma.categoryBudget.create({
        data: {
          yearPlanId: source.id,
          budgetId: unbudgetedCat.id,
        },
      });

      const target = await createYearPlan(2026);
      const res = await post(`/year-plans/${target.id}/carry-forward`, { sourceYear: 2025 });
      expect(res.status).toBe(200);

      const budgets = await prisma.categoryBudget.findMany({
        where: { yearPlanId: target.id },
        include: { versions: true },
      });
      expect(budgets.length).toBe(1);
      expect(budgets[0]!.budgetId).toBe(budgetedCat.id);
    });

    it('returns 404 for non-existent source year', async () => {
      const target = await createYearPlan(2026);
      const res = await post(`/year-plans/${target.id}/carry-forward`, { sourceYear: 1999 });
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('Source year plan not found');
    });

    it('returns 404 for non-existent target plan', async () => {
      await createYearPlan(2025, 'ACTIVE');
      const res = await post('/year-plans/clxxxxxxxxxxxxxxxxxxxxxxxxx/carry-forward', {
        sourceYear: 2025,
      });
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });

    it('rejects carry-forward into an ACTIVE (non-DRAFT) plan', async () => {
      const source = await createYearPlan(2024, 'ACTIVE');
      const target = await createYearPlan(2025, 'ACTIVE');

      const res = await post(`/year-plans/${target.id}/carry-forward`, { sourceYear: 2024 });
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('Only DRAFT plans');
    });

    it('silently skips duplicate categories during carry-forward', async () => {
      const group = await createGroup('DUP_GROUP');
      const cat = await createCategory(group.id, 'DUP_Cat');

      const source = await createYearPlan(2025, 'ACTIVE');
      await createBudgetWithVersion(source.id, cat.id, {
        amount: 500,
        frequency: 'MONTHLY',
      });

      const target = await createYearPlan(2026);

      // First carry-forward
      const res1 = await post(`/year-plans/${target.id}/carry-forward`, { sourceYear: 2025 });
      expect(res1.status).toBe(200);

      // Second carry-forward — should skip the duplicate
      const res2 = await post(`/year-plans/${target.id}/carry-forward`, { sourceYear: 2025 });
      expect(res2.status).toBe(200);

      // Still only 1 CategoryBudget in target
      const budgets = await prisma.categoryBudget.findMany({
        where: { yearPlanId: target.id },
      });
      expect(budgets.length).toBe(1);
    });

    it('carries forward budgets with activeMonths', async () => {
      const group = await createGroup('AM_GROUP');
      const cat = await createCategory(group.id, 'AM_Cat');

      const source = await createYearPlan(2025, 'ACTIVE');
      await createBudgetWithVersion(source.id, cat.id, {
        amount: 1200,
        frequency: 'YEARLY',
        activeMonths: [6, 7, 8], // summer months
      });

      const target = await createYearPlan(2026);
      const res = await post(`/year-plans/${target.id}/carry-forward`, { sourceYear: 2025 });
      expect(res.status).toBe(200);

      const budgets = await prisma.categoryBudget.findMany({
        where: { yearPlanId: target.id },
        include: { versions: true },
      });
      expect(budgets.length).toBe(1);
      expect(budgets[0]!.versions[0]!.activeMonths).toEqual([6, 7, 8]);
      expect(budgets[0]!.versions[0]!.amount.toNumber()).toBe(1200);
    });
  });

  describe('POST /year-plans/:id/confirm — 404 handling', () => {
    it('returns 404 for non-existent plan', async () => {
      const res = await post('/year-plans/clxxxxxxxxxxxxxxxxxxxxxxxxx/confirm', {});
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });
  });
});
