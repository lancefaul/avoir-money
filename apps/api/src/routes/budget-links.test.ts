import { describe, it, expect } from 'vitest';
import {
  get,
  post,
  put,
  del,
  createGroup,
  createCategory,
  createExpense,
} from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createActivePlan(year: number) {
  return prisma.yearPlan.create({ data: { year, status: 'ACTIVE' } });
}

async function createArchivedPlan(year: number) {
  return prisma.yearPlan.create({ data: { year, status: 'ARCHIVED' } });
}

async function createBudgetWithVersion(yearPlanId: string, budgetId: string) {
  const res = await post('/category-budgets', {
    yearPlanId,
    budgetId,
    amount: 500,
    frequency: 'MONTHLY',
    effectiveMonth: 1,
  });
  return (await res.json()) as any;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Budget Links API', () => {
  // ─── Link a single expense ─────────────────────────────────────────────

  describe('POST /:id/links — link single expense', () => {
    it('links an expense and returns 201 with link data', async () => {
      const plan = await createActivePlan(2050);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const expense = await createExpense(cat.id, { amount: 200, frequency: 'MONTHLY' });

      const res = await post(`/category-budgets/${budget.id}/links`, { expenseId: expense.id });
      expect(res.status).toBe(201);

      const body: any = await res.json();
      expect(body.id).toBeDefined();
      expect(body.categoryBudgetId).toBe(budget.id);
      expect(body.expenseId).toBe(expense.id);
      expect(body.expenseName).toBe(expense.name);
      expect(body.expenseAmount).toBe(200);
      expect(body.expenseFrequency).toBe('MONTHLY');
      expect(body.monthlyEquivalent).toBe(200);
      expect(body.isPaused).toBe(false);
      expect(body.isArchived).toBe(false);
      expect(body.createdAt).toBeDefined();
    });

    it('returns 409 when expense is already linked', async () => {
      const plan = await createActivePlan(2051);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const expense = await createExpense(cat.id);

      await post(`/category-budgets/${budget.id}/links`, { expenseId: expense.id });
      const res = await post(`/category-budgets/${budget.id}/links`, { expenseId: expense.id });
      expect(res.status).toBe(409);
      const body: any = await res.json();
      expect(body.error).toContain('already linked');
    });

    it('returns 400 when expense category does not match budget category', async () => {
      const plan = await createActivePlan(2052);
      const group = await createGroup();
      const cat1 = await createCategory(group.id);
      const cat2 = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat1.id);
      const expense = await createExpense(cat2.id);

      const res = await post(`/category-budgets/${budget.id}/links`, { expenseId: expense.id });
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('category');
    });

    it('returns 400 when expense is ONE_TIME', async () => {
      const plan = await createActivePlan(2053);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const expense = await createExpense(cat.id, { frequency: 'ONE_TIME' });

      const res = await post(`/category-budgets/${budget.id}/links`, { expenseId: expense.id });
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('one-time');
    });

    it('returns 400 when year plan is archived', async () => {
      const plan = await createArchivedPlan(2054);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      // Create budget directly in DB since API won't allow it on archived plan
      const budget = await prisma.categoryBudget.create({
        data: {
          yearPlanId: plan.id,
          budgetId: cat.id,
          versions: {
            create: {
              amount: 500,
              frequency: 'MONTHLY',
              monthlyEquivalent: 500,
              activeMonths: [],
              effectiveDate: new Date(Date.UTC(2054, 0, 1)),
            },
          },
        },
      });
      const expense = await createExpense(cat.id);

      const res = await post(`/category-budgets/${budget.id}/links`, { expenseId: expense.id });
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('archived');
    });

    it('returns 404 when budget does not exist', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const expense = await createExpense(cat.id);

      const res = await post('/category-budgets/clxxxxxxxxxxxxxxxxxxxxxxxxx/links', {
        expenseId: expense.id,
      });
      expect(res.status).toBe(404);
    });

    it('returns 404 when expense does not exist', async () => {
      const plan = await createActivePlan(2055);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);

      const res = await post(`/category-budgets/${budget.id}/links`, {
        expenseId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Bulk-link expenses ──────────────────────────────────────────────

  describe('POST /:id/links/bulk — bulk-link expenses', () => {
    it('bulk-links multiple expenses and returns 207 with results', async () => {
      const plan = await createActivePlan(2080);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const exp1 = await createExpense(cat.id, { amount: 100, frequency: 'MONTHLY' });
      const exp2 = await createExpense(cat.id, { amount: 200, frequency: 'MONTHLY' });

      const res = await post(`/category-budgets/${budget.id}/links/bulk`, {
        expenseIds: [exp1.id, exp2.id],
      });
      expect(res.status).toBe(207);
      const body: any = await res.json();
      expect(body.results.length).toBe(2);
      expect(body.results[0].expenseId).toBe(exp1.id);
      expect(body.results[1].expenseId).toBe(exp2.id);

      // Verify links exist in DB
      const links = await prisma.budgetExpenseLink.findMany({
        where: { categoryBudgetId: budget.id },
      });
      expect(links.length).toBe(2);
    });

    it('returns partial errors for invalid expenses in bulk', async () => {
      const plan = await createActivePlan(2081);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const validExp = await createExpense(cat.id, { amount: 100, frequency: 'MONTHLY' });

      const res = await post(`/category-budgets/${budget.id}/links/bulk`, {
        expenseIds: [validExp.id, 'clxxxxxxxxxxxxxxxxxxxxxxxxx'],
      });
      expect(res.status).toBe(207);
      const body: any = await res.json();
      expect(body.results.length).toBe(2);
      // First should succeed
      expect(body.results[0].expenseId).toBe(validExp.id);
      // Second should be an error
      expect(body.results[1].error).toContain('not found');
    });

    it('returns 404 when budget does not exist for bulk link', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const expense = await createExpense(cat.id);

      const res = await post('/category-budgets/clxxxxxxxxxxxxxxxxxxxxxxxxx/links/bulk', {
        expenseIds: [expense.id],
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when year plan is archived for bulk link', async () => {
      const plan = await createArchivedPlan(2082);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await prisma.categoryBudget.create({
        data: {
          yearPlanId: plan.id,
          budgetId: cat.id,
          versions: {
            create: {
              amount: 500,
              frequency: 'MONTHLY',
              monthlyEquivalent: 500,
              activeMonths: [],
              effectiveDate: new Date(Date.UTC(2082, 0, 1)),
            },
          },
        },
      });
      const expense = await createExpense(cat.id);

      const res = await post(`/category-budgets/${budget.id}/links/bulk`, {
        expenseIds: [expense.id],
      });
      expect(res.status).toBe(400);
    });

    it('rejects ONE_TIME expenses in bulk', async () => {
      const plan = await createActivePlan(2083);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const expense = await createExpense(cat.id, { frequency: 'ONE_TIME' });

      const res = await post(`/category-budgets/${budget.id}/links/bulk`, {
        expenseIds: [expense.id],
      });
      expect(res.status).toBe(207);
      const body: any = await res.json();
      expect(body.results[0].error).toContain('one-time');
    });

    it('rejects already-linked expenses in bulk', async () => {
      const plan = await createActivePlan(2084);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const expense = await createExpense(cat.id);

      // Link first
      await post(`/category-budgets/${budget.id}/links`, { expenseId: expense.id });

      // Try to bulk-link the same expense
      const res = await post(`/category-budgets/${budget.id}/links/bulk`, {
        expenseIds: [expense.id],
      });
      expect(res.status).toBe(207);
      const body: any = await res.json();
      expect(body.results[0].error).toContain('already linked');
    });

    it('rejects category-mismatched expenses in bulk', async () => {
      const plan = await createActivePlan(2085);
      const group = await createGroup();
      const cat1 = await createCategory(group.id);
      const cat2 = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat1.id);
      const expense = await createExpense(cat2.id);

      const res = await post(`/category-budgets/${budget.id}/links/bulk`, {
        expenseIds: [expense.id],
      });
      expect(res.status).toBe(207);
      const body: any = await res.json();
      expect(body.results[0].error).toContain('category');
    });
  });

  // ─── Unlink an expense ──────────────────────────────────────────────────

  describe('DELETE /:id/links/:linkId — unlink expense', () => {
    it('unlinks an expense and returns 204', async () => {
      const plan = await createActivePlan(2056);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const expense = await createExpense(cat.id);

      const linkRes = await post(`/category-budgets/${budget.id}/links`, { expenseId: expense.id });
      const link: any = await linkRes.json();

      const unlinkRes = await del(`/category-budgets/${budget.id}/links/${link.id}`);
      expect(unlinkRes.status).toBe(204);

      // Verify link is gone
      const listRes = await get(`/category-budgets/${budget.id}/links`);
      const links = (await listRes.json()) as any[];
      expect(links.length).toBe(0);
    });

    it('returns 404 when link does not exist', async () => {
      const plan = await createActivePlan(2057);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);

      const res = await del(`/category-budgets/${budget.id}/links/clxxxxxxxxxxxxxxxxxxxxxxxxx`);
      expect(res.status).toBe(404);
    });
  });

  // ─── List linked expenses ─────────────────────────────────────────────

  describe('GET /:id/links — list linked expenses', () => {
    it('returns linked expenses with monthly equivalents', async () => {
      const plan = await createActivePlan(2058);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const exp1 = await createExpense(cat.id, { amount: 100, frequency: 'MONTHLY' });
      const exp2 = await createExpense(cat.id, { amount: 50, frequency: 'WEEKLY' });

      await post(`/category-budgets/${budget.id}/links`, { expenseId: exp1.id });
      await post(`/category-budgets/${budget.id}/links`, { expenseId: exp2.id });

      const res = await get(`/category-budgets/${budget.id}/links`);
      expect(res.status).toBe(200);
      const links = (await res.json()) as any[];
      expect(links.length).toBe(2);

      // Verify first link (MONTHLY: 100 * 1 = 100)
      const monthly = links.find((l: any) => l.expenseId === exp1.id);
      expect(monthly.monthlyEquivalent).toBe(100);

      // Verify second link (WEEKLY: 50 * 52/12 ≈ 216.67)
      const weekly = links.find((l: any) => l.expenseId === exp2.id);
      expect(weekly.monthlyEquivalent).toBeCloseTo(216.67, 1);
    });

    it('returns empty array when no links exist', async () => {
      const plan = await createActivePlan(2059);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);

      const res = await get(`/category-budgets/${budget.id}/links`);
      expect(res.status).toBe(200);
      const links = (await res.json()) as any[];
      expect(links.length).toBe(0);
    });

    it('returns 404 when budget does not exist', async () => {
      const res = await get('/category-budgets/clxxxxxxxxxxxxxxxxxxxxxxxxx/links');
      expect(res.status).toBe(404);
    });
  });

  // ─── Full round-trip ────────────────────────────────────────────────────

  describe('Full round-trip', () => {
    it('link → list → verify → unlink → verify empty', async () => {
      const plan = await createActivePlan(2063);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const expense = await createExpense(cat.id, { amount: 300, frequency: 'MONTHLY' });

      // Link
      const linkRes = await post(`/category-budgets/${budget.id}/links`, { expenseId: expense.id });
      expect(linkRes.status).toBe(201);
      const link: any = await linkRes.json();

      // List and verify
      const listRes = await get(`/category-budgets/${budget.id}/links`);
      const links = (await listRes.json()) as any[];
      expect(links.length).toBe(1);
      expect(links[0].expenseId).toBe(expense.id);

      // Unlink
      const unlinkRes = await del(`/category-budgets/${budget.id}/links/${link.id}`);
      expect(unlinkRes.status).toBe(204);

      // Verify empty
      const listAfter = await get(`/category-budgets/${budget.id}/links`);
      const linksAfter = (await listAfter.json()) as any[];
      expect(linksAfter.length).toBe(0);
    });
  });

  // ─── Auto-adjustment triggers ────────────────────────────────────────

  describe('Auto-adjustment triggers', () => {
    async function getBudgetAmount(budgetId: string, month: number, year: number): Promise<number> {
      const res = await get(`/category-budgets/${budgetId}?month=${month}&year=${year}`);
      const body: any = await res.json();
      return body.version?.amount ?? 0;
    }

    it('update expense amount → budget recomputes (Req 5.1)', async () => {
      const plan = await createActivePlan(2070);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const expense = await createExpense(cat.id, { amount: 200, frequency: 'MONTHLY' });

      // Link expense → budget auto-adjusts to expense amount
      await post(`/category-budgets/${budget.id}/links`, { expenseId: expense.id });
      expect(await getBudgetAmount(budget.id, 1, 2070)).toBe(200);

      // Update expense amount to 600 → budget should auto-adjust to 600 (exceeds initial 500 HWM)
      await put(`/expenses/${expense.id}`, { amount: 600 });
      expect(await getBudgetAmount(budget.id, 1, 2070)).toBe(600);
    });

    it('pause expense → excluded from baseline, HWM holds (Req 5.4)', async () => {
      const plan = await createActivePlan(2071);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const exp1 = await createExpense(cat.id, { amount: 300, frequency: 'MONTHLY' });
      const exp2 = await createExpense(cat.id, { amount: 200, frequency: 'MONTHLY' });

      // Link both expenses → budget = 300 + 200 = 500
      await post(`/category-budgets/${budget.id}/links`, { expenseId: exp1.id });
      await post(`/category-budgets/${budget.id}/links`, { expenseId: exp2.id });
      expect(await getBudgetAmount(budget.id, 1, 2071)).toBe(500);

      // Pause exp1 → derived baseline drops to 200, but HWM holds at 500
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      await post(`/expenses/${exp1.id}/pause`, { until: futureDate.toISOString() });
      expect(await getBudgetAmount(budget.id, 1, 2071)).toBe(500);
    });

    it('resume expense → included in baseline (Req 5.6)', async () => {
      const plan = await createActivePlan(2072);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const expense = await createExpense(cat.id, { amount: 400, frequency: 'MONTHLY' });

      // Link expense → budget = 400
      await post(`/category-budgets/${budget.id}/links`, { expenseId: expense.id });
      expect(await getBudgetAmount(budget.id, 1, 2072)).toBe(400);

      // Pause expense → HWM holds at 400
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      await post(`/expenses/${expense.id}/pause`, { until: futureDate.toISOString() });
      expect(await getBudgetAmount(budget.id, 1, 2072)).toBe(400);

      // Resume expense → derived baseline back to 400, budget stays 400
      await post(`/expenses/${expense.id}/resume`, { immediately: true });
      expect(await getBudgetAmount(budget.id, 1, 2072)).toBe(400);
    });

    it('manual override version → skip auto-adjust (Property 7, Req 5.9)', async () => {
      const plan = await createActivePlan(2073);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const expense = await createExpense(cat.id, { amount: 200, frequency: 'MONTHLY' });

      // Link expense → budget auto-adjusts to 200
      await post(`/category-budgets/${budget.id}/links`, { expenseId: expense.id });
      expect(await getBudgetAmount(budget.id, 1, 2073)).toBe(200);

      // Set manualOverride on the latest version directly via Prisma
      const latestVersion = await prisma.budgetVersion.findFirst({
        where: { categoryBudgetId: budget.id },
        orderBy: { effectiveDate: 'desc' },
      });
      await prisma.budgetVersion.update({
        where: { id: latestVersion!.id },
        data: { manualOverride: true },
      });

      // Update expense amount to 500 → budget should NOT change (manual override)
      await put(`/expenses/${expense.id}`, { amount: 500 });
      expect(await getBudgetAmount(budget.id, 1, 2073)).toBe(200);
    });
  });

  // ─── Cascade deletes ──────────────────────────────────────────────────

  describe('Cascade deletes', () => {
    it('deleting a budget removes its links', async () => {
      const plan = await createActivePlan(2064);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const expense = await createExpense(cat.id);

      await post(`/category-budgets/${budget.id}/links`, { expenseId: expense.id });

      // Verify link exists in DB
      const linksBefore = await prisma.budgetExpenseLink.findMany({
        where: { categoryBudgetId: budget.id },
      });
      expect(linksBefore.length).toBe(1);

      // Hard-delete the budget (cascade should remove links)
      await prisma.categoryBudget.delete({ where: { id: budget.id } });

      // Verify links are gone
      const linksAfter = await prisma.budgetExpenseLink.findMany({
        where: { categoryBudgetId: budget.id },
      });
      expect(linksAfter.length).toBe(0);
    });

    it('deleting an expense removes its link', async () => {
      const plan = await createActivePlan(2065);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const budget = await createBudgetWithVersion(plan.id, cat.id);
      const expense = await createExpense(cat.id);

      await post(`/category-budgets/${budget.id}/links`, { expenseId: expense.id });

      // Verify link exists
      const linksBefore = await prisma.budgetExpenseLink.findMany({
        where: { expenseId: expense.id },
      });
      expect(linksBefore.length).toBe(1);

      // Delete the expense (cascade should remove link)
      await prisma.expense.delete({ where: { id: expense.id } });

      // Verify link is gone
      const linksAfter = await prisma.budgetExpenseLink.findMany({
        where: { expenseId: expense.id },
      });
      expect(linksAfter.length).toBe(0);
    });
  });
});
