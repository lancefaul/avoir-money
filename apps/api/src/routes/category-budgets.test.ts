import { describe, it, expect } from 'vitest';
import {
  get,
  post,
  put,
  del,
  createGroup,
  createCategory,
  createAccount,
} from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createActivePlan(year: number) {
  return prisma.yearPlan.create({ data: { year, status: 'ACTIVE' } });
}

async function createArchivedPlan(year: number) {
  return prisma.yearPlan.create({ data: { year, status: 'ARCHIVED' } });
}

async function createBudgetViaAPI(
  yearPlanId: string,
  budgetId: string,
  overrides: Record<string, unknown> = {},
) {
  return post('/category-budgets', {
    yearPlanId,
    budgetId,
    amount: 500,
    frequency: 'MONTHLY',
    effectiveMonth: 1,
    ...overrides,
  });
}

async function createTransaction(budgetId: string, date: Date, amount: number, accountId: string) {
  return prisma.transaction.create({
    data: {
      type: 'EXPENSE',
      name: 'Test expense',
      amount,
      date,
      budgetId,
      accountId,
    },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Category Budgets API', () => {
  // ─── 1. Full CRUD lifecycle ────────────────────────────────────────────

  describe('Full CRUD lifecycle', () => {
    it('create → list → get → update → delete → restore', async () => {
      const plan = await createActivePlan(2030);
      const group = await createGroup();
      const cat = await createCategory(group.id);

      // CREATE
      const createRes = await createBudgetViaAPI(plan.id, cat.id, {
        amount: 300,
        frequency: 'MONTHLY',
        effectiveMonth: 1,
      });
      expect(createRes.status).toBe(201);
      const created: any = await createRes.json();
      expect(created.id).toBeDefined();
      expect(created.budgetId).toBe(cat.id);
      expect(created.yearPlanId).toBe(plan.id);
      expect(created.version).not.toBeNull();
      expect(created.version.amount).toBe(300);

      const budgetId = created.id;

      // LIST
      const listRes = await get(`/category-budgets?yearPlanId=${plan.id}&month=1&year=2030`);
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as any[];
      expect(list.length).toBe(1);
      expect(list[0].id).toBe(budgetId);

      // GET single
      const getRes = await get(`/category-budgets/${budgetId}?month=1&year=2030`);
      expect(getRes.status).toBe(200);
      const single: any = await getRes.json();
      expect(single.id).toBe(budgetId);
      expect(single.version.amount).toBe(300);

      // UPDATE
      const updateRes = await put(`/category-budgets/${budgetId}`, {
        amount: 450,
        effectiveMonth: 6,
      });
      expect(updateRes.status).toBe(200);
      const updated: any = await updateRes.json();
      expect(updated.version.amount).toBe(450);

      // DELETE (soft-delete)
      const deleteRes = await del(`/category-budgets/${budgetId}`);
      expect(deleteRes.status).toBe(204);

      // Verify excluded from list
      const listAfterDel = await get(`/category-budgets?yearPlanId=${plan.id}&month=1&year=2030`);
      const listDel = (await listAfterDel.json()) as any[];
      expect(listDel.length).toBe(0);

      // RESTORE
      const restoreRes = await post(`/category-budgets/${budgetId}/restore`, {});
      expect(restoreRes.status).toBe(200);
      const restored: any = await restoreRes.json();
      expect(restored.removedAt).toBeNull();

      // Verify back in list
      const listAfterRestore = await get(
        `/category-budgets?yearPlanId=${plan.id}&month=1&year=2030`,
      );
      const listRestored = (await listAfterRestore.json()) as any[];
      expect(listRestored.length).toBe(1);
    });
  });

  // ─── 2. Versioning ────────────────────────────────────────────────────

  describe('Versioning', () => {
    it('update creates a new version, old version preserved', async () => {
      const plan = await createActivePlan(2031);
      const group = await createGroup();
      const cat = await createCategory(group.id);

      const createRes = await createBudgetViaAPI(plan.id, cat.id, {
        amount: 200,
        effectiveMonth: 1,
      });
      const created: any = await createRes.json();
      const budgetId = created.id;

      // Update with a different effectiveMonth → new version
      await put(`/category-budgets/${budgetId}`, {
        amount: 350,
        effectiveMonth: 6,
      });

      // Check history — should have 2 versions
      const histRes = await get(`/category-budgets/${budgetId}/history`);
      expect(histRes.status).toBe(200);
      const history: any = await histRes.json();
      expect(history.versions.length).toBe(2);
    });

    it('history endpoint returns versions ordered by effectiveDate desc', async () => {
      const plan = await createActivePlan(2032);
      const group = await createGroup();
      const cat = await createCategory(group.id);

      const createRes = await createBudgetViaAPI(plan.id, cat.id, {
        amount: 100,
        effectiveMonth: 1,
      });
      const created: any = await createRes.json();
      const budgetId = created.id;

      await put(`/category-budgets/${budgetId}`, { amount: 200, effectiveMonth: 3 });
      await put(`/category-budgets/${budgetId}`, { amount: 300, effectiveMonth: 9 });

      const histRes = await get(`/category-budgets/${budgetId}/history`);
      const history: any = await histRes.json();
      expect(history.versions.length).toBe(3);

      // Verify descending order
      const dates = history.versions.map((v: any) => new Date(v.effectiveDate).getTime());
      for (let i = 0; i < dates.length - 1; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1]);
      }
    });
  });

  // ─── 4. Version replacement ───────────────────────────────────────────

  describe('Version replacement', () => {
    it('update with same effectiveDate replaces existing version', async () => {
      const plan = await createActivePlan(2033);
      const group = await createGroup();
      const cat = await createCategory(group.id);

      const createRes = await createBudgetViaAPI(plan.id, cat.id, {
        amount: 100,
        effectiveMonth: 3,
      });
      const created: any = await createRes.json();
      const budgetId = created.id;

      // Update with same effectiveMonth=3 → should replace, not add
      await put(`/category-budgets/${budgetId}`, { amount: 999, effectiveMonth: 3 });

      const histRes = await get(`/category-budgets/${budgetId}/history`);
      const history: any = await histRes.json();
      expect(history.versions.length).toBe(1);
      expect(history.versions[0].amount).toBe(999);
    });
  });

  // ─── 5 & 6. Soft-delete and restore ──────────────────────────────────

  describe('Soft-delete and restore', () => {
    it('DELETE sets removedAt, GET list excludes it', async () => {
      const plan = await createActivePlan(2034);
      const group = await createGroup();
      const cat = await createCategory(group.id);

      const createRes = await createBudgetViaAPI(plan.id, cat.id);
      const created: any = await createRes.json();

      await del(`/category-budgets/${created.id}`);

      const listRes = await get(`/category-budgets?yearPlanId=${plan.id}&month=1&year=2034`);
      const list = (await listRes.json()) as any[];
      expect(list.length).toBe(0);

      // Verify removedAt is set in DB
      const dbRecord = await prisma.categoryBudget.findUnique({ where: { id: created.id } });
      expect(dbRecord!.removedAt).not.toBeNull();
    });

    it('POST restore clears removedAt, budget appears in list again', async () => {
      const plan = await createActivePlan(2035);
      const group = await createGroup();
      const cat = await createCategory(group.id);

      const createRes = await createBudgetViaAPI(plan.id, cat.id);
      const created: any = await createRes.json();

      await del(`/category-budgets/${created.id}`);
      const restoreRes = await post(`/category-budgets/${created.id}/restore`, {});
      expect(restoreRes.status).toBe(200);
      const restored: any = await restoreRes.json();
      expect(restored.removedAt).toBeNull();

      const listRes = await get(`/category-budgets?yearPlanId=${plan.id}&month=1&year=2035`);
      const list = (await listRes.json()) as any[];
      expect(list.length).toBe(1);
    });
  });

  // ─── 7. Budget status computation ─────────────────────────────────────

  describe('Budget status computation', () => {
    it('computes under/near/over thresholds from transactions', async () => {
      const plan = await createActivePlan(2036);
      const group = await createGroup();
      const cat = await createCategory(group.id);
      const account = await createAccount();

      // Create budget with monthlyEquivalent = 1000 (MONTHLY frequency, amount 1000)
      const createRes = await createBudgetViaAPI(plan.id, cat.id, {
        amount: 1000,
        frequency: 'MONTHLY',
        effectiveMonth: 1,
      });
      expect(createRes.status).toBe(201);

      // Create expense transactions totaling 500 → status should be "under" (50% < 80%)
      await createTransaction(cat.id, new Date(Date.UTC(2036, 0, 15)), 500, account.id);

      let listRes = await get(`/category-budgets?yearPlanId=${plan.id}&month=1&year=2036`);
      let list = (await listRes.json()) as any[];
      expect(list.length).toBe(1);
      expect(list[0].actualSpending).toBe(500);
      expect(list[0].status).toBe('under');

      // Add more to total 850 → status should be "near" (85%)
      await createTransaction(cat.id, new Date(Date.UTC(2036, 0, 20)), 350, account.id);

      listRes = await get(`/category-budgets?yearPlanId=${plan.id}&month=1&year=2036`);
      list = (await listRes.json()) as any[];
      expect(list[0].actualSpending).toBe(850);
      expect(list[0].status).toBe('near');

      // Add more to total 1100 → status should be "over" (110%)
      await createTransaction(cat.id, new Date(Date.UTC(2036, 0, 25)), 250, account.id);

      listRes = await get(`/category-budgets?yearPlanId=${plan.id}&month=1&year=2036`);
      list = (await listRes.json()) as any[];
      expect(list[0].actualSpending).toBe(1100);
      expect(list[0].status).toBe('over');
    });
  });

  // ─── 8 & 9. Seasonal filtering ───────────────────────────────────────

  describe('Seasonal filtering', () => {
    it('seasonal budget does NOT appear for inactive month', async () => {
      const plan = await createActivePlan(2037);
      const group = await createGroup();
      const cat = await createCategory(group.id);

      await createBudgetViaAPI(plan.id, cat.id, {
        amount: 200,
        frequency: 'MONTHLY',
        effectiveMonth: 1,
        activeMonths: [11, 12],
      });

      // Query for month 6 → should NOT appear
      const listRes = await get(`/category-budgets?yearPlanId=${plan.id}&month=6&year=2037`);
      const list = (await listRes.json()) as any[];
      expect(list.length).toBe(0);
    });

    it('seasonal budget DOES appear for active month', async () => {
      const plan = await createActivePlan(2038);
      const group = await createGroup();
      const cat = await createCategory(group.id);

      await createBudgetViaAPI(plan.id, cat.id, {
        amount: 200,
        frequency: 'MONTHLY',
        effectiveMonth: 1,
        activeMonths: [11, 12],
      });

      // Query for month 11 → SHOULD appear
      const listRes = await get(`/category-budgets?yearPlanId=${plan.id}&month=11&year=2038`);
      const list = (await listRes.json()) as any[];
      expect(list.length).toBe(1);
      expect(list[0].seasonal).toBe(true);
    });

    it('includeSeasonal=true returns seasonal budgets for inactive months', async () => {
      const plan = await createActivePlan(2045);
      const group = await createGroup();
      const cat = await createCategory(group.id);

      await createBudgetViaAPI(plan.id, cat.id, {
        amount: 200,
        frequency: 'MONTHLY',
        effectiveMonth: 1,
        activeMonths: [11, 12],
      });

      // Without includeSeasonal, month 6 → excluded
      const filteredRes = await get(`/category-budgets?yearPlanId=${plan.id}&month=6&year=2045`);
      const filtered = (await filteredRes.json()) as any[];
      expect(filtered.length).toBe(0);

      // With includeSeasonal=true, month 6 → included
      const allRes = await get(
        `/category-budgets?yearPlanId=${plan.id}&month=6&year=2045&includeSeasonal=true`,
      );
      const all = (await allRes.json()) as any[];
      expect(all.length).toBe(1);
      expect(all[0].seasonal).toBe(true);
    });
  });

  // ─── 10. Validation errors ────────────────────────────────────────────

  describe('Validation errors', () => {
    it('effectiveMonth outside 1-12 returns 400', async () => {
      const plan = await createActivePlan(2039);
      const group = await createGroup();
      const cat = await createCategory(group.id);

      const res = await post('/category-budgets', {
        yearPlanId: plan.id,
        budgetId: cat.id,
        amount: 100,
        frequency: 'MONTHLY',
        effectiveMonth: 13,
      });
      expect(res.status).toBe(400);
    });

    it('duplicate category in same year returns 409', async () => {
      const plan = await createActivePlan(2040);
      const group = await createGroup();
      const cat = await createCategory(group.id);

      const first = await createBudgetViaAPI(plan.id, cat.id);
      expect(first.status).toBe(201);

      const second = await createBudgetViaAPI(plan.id, cat.id);
      expect(second.status).toBe(409);
    });

    it('modifications to ARCHIVED plan return 400', async () => {
      const plan = await createArchivedPlan(2041);
      const group = await createGroup();
      const cat = await createCategory(group.id);

      const res = await createBudgetViaAPI(plan.id, cat.id);
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('archived');
    });
  });

  // ─── 13. Default month ────────────────────────────────────────────────

  describe('Default month', () => {
    it('query without month parameter defaults to current month (200 response)', async () => {
      const plan = await createActivePlan(2042);
      const group = await createGroup();
      const cat = await createCategory(group.id);

      // Create budget effective from month 1 so it resolves for any month
      await createBudgetViaAPI(plan.id, cat.id, { effectiveMonth: 1 });

      const listRes = await get(`/category-budgets?yearPlanId=${plan.id}`);
      expect(listRes.status).toBe(200);
    });
  });

  // ─── 14. Response shape ───────────────────────────────────────────────

  describe('Response shape', () => {
    it('includes monthlyEquivalent, original amount, frequency, effectiveDate, seasonal flag', async () => {
      const plan = await createActivePlan(2043);
      const group = await createGroup();
      const cat = await createCategory(group.id);

      const createRes = await createBudgetViaAPI(plan.id, cat.id, {
        amount: 600,
        frequency: 'YEARLY',
        effectiveMonth: 1,
        activeMonths: [1, 2, 3],
      });
      expect(createRes.status).toBe(201);
      const body: any = await createRes.json();

      // Verify response shape
      expect(body.id).toBeDefined();
      expect(body.yearPlanId).toBeDefined();
      expect(body.budgetId).toBeDefined();
      expect(body.categoryName).toBeDefined();
      expect(body.categoryGroup).toBeDefined();
      expect(body.removedAt).toBeNull();
      expect(body.seasonal).toBe(true);
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();

      // Version shape
      expect(body.version).not.toBeNull();
      expect(body.version.id).toBeDefined();
      expect(body.version.amount).toBe(600);
      expect(body.version.frequency).toBe('YEARLY');
      expect(body.version.monthlyEquivalent).toBe(200); // 600 / 3 active months
      expect(body.version.activeMonths).toEqual([1, 2, 3]);
      expect(body.version.effectiveDate).toBeDefined();
      expect(body.version.createdAt).toBeDefined();
    });
  });

  // ─── 15 & 16. 404s ────────────────────────────────────────────────────

  describe('404s', () => {
    it('non-existent category budget returns 404', async () => {
      const res = await get('/category-budgets/clxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(res.status).toBe(404);
    });

    it('non-existent category in create returns 404', async () => {
      const plan = await createActivePlan(2044);

      const res = await post('/category-budgets', {
        yearPlanId: plan.id,
        budgetId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
        amount: 100,
        frequency: 'MONTHLY',
        effectiveMonth: 1,
      });
      expect(res.status).toBe(404);
    });

    it('PUT non-existent category budget returns 404', async () => {
      const res = await put('/category-budgets/clxxxxxxxxxxxxxxxxxxxxxxxxx', {
        amount: 200,
        frequency: 'MONTHLY',
        effectiveMonth: 1,
      });
      expect(res.status).toBe(404);
    });

    it('DELETE non-existent category budget returns 404', async () => {
      const res = await del('/category-budgets/clxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(res.status).toBe(404);
    });

    it('POST /category-budgets/:id/restore non-existent returns 404', async () => {
      const res = await post('/category-budgets/clxxxxxxxxxxxxxxxxxxxxxxxxx/restore', {});
      expect(res.status).toBe(404);
    });

    it('GET /category-budgets/:id/history non-existent returns 404', async () => {
      const res = await get('/category-budgets/clxxxxxxxxxxxxxxxxxxxxxxxxx/history');
      expect(res.status).toBe(404);
    });
  });
});
