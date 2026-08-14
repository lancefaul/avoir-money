import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import {
  get,
  post,
  put,
  del,
  req,
  createGroup,
  createCategory,
  createExpense,
  createIncome,
} from '../test/helpers.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createYearPlan(year = 2026) {
  return prisma.yearPlan.create({ data: { year, status: 'DRAFT' } });
}

async function createBudgetAllocation(yearPlanId: string, budgetId: string) {
  const cb = await prisma.categoryBudget.create({
    data: { yearPlanId, budgetId },
  });
  // Add a version so the budget is meaningful
  await prisma.budgetVersion.create({
    data: {
      categoryBudgetId: cb.id,
      amount: 500,
      frequency: 'MONTHLY',
      monthlyEquivalent: 500,
      activeMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      effectiveDate: new Date('2026-01-01'),
    },
  });
  return cb;
}

async function createBudgetGoal(budgetId: string) {
  return prisma.budgetGoal.create({
    data: {
      name: 'Test Goal',
      type: 'SAVINGS',
      targetAmount: 1000,
      budgetId,
    },
  });
}

// ─── Budget Groups ──────────────────────────────────────────────────────────

describe('Budget Groups API', () => {
  describe('GET /budgets/groups', () => {
    it('returns empty initially', async () => {
      const res = await get('/budgets/groups');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });
  });

  describe('POST /budgets/groups', () => {
    it('creates a group', async () => {
      const res = await post('/budgets/groups', { name: 'HOUSING', color: '#3b82f6' });
      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.name).toBe('HOUSING');
      expect(body.color).toBe('#3b82f6');
    });

    it('rejects duplicate name', async () => {
      await post('/budgets/groups', { name: 'HOUSING' });
      const res = await post('/budgets/groups', { name: 'HOUSING' });
      expect(res.status).toBe(409);
    });
  });

  describe('PUT /budgets/groups/:id', () => {
    it('updates group color', async () => {
      const group = await createGroup('INCOME');
      const res = await put(`/budgets/groups/${group.id}`, { color: '#00ff00' });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).color).toBe('#00ff00');
    });
  });

  describe('DELETE /budgets/groups/:id', () => {
    it('deletes empty group', async () => {
      const group = await createGroup('EMPTY');
      const res = await del(`/budgets/groups/${group.id}`);
      expect(res.status).toBe(204);
    });

    it('rejects delete of non-empty group', async () => {
      const group = await createGroup('FULL');
      await createCategory(group.id);
      const res = await del(`/budgets/groups/${group.id}`);
      expect(res.status).toBe(409);
    });
  });
});

// ─── Budgets CRUD ───────────────────────────────────────────────────────────

describe('Budgets API', () => {
  describe('GET /budgets', () => {
    it('returns empty initially', async () => {
      const res = await get('/budgets');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });
  });

  describe('POST /budgets', () => {
    it('creates a budget', async () => {
      const group = await createGroup();
      const res = await post('/budgets', { name: 'Mortgage', groupId: group.id, icon: 'home' });
      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.name).toBe('Mortgage');
      expect(body.groupId).toBe(group.id);
      expect(body.groupName).toBe(group.name);
      expect(body.isCustom).toBe(true);
    });
  });

  describe('PUT /budgets/:id', () => {
    it('updates a budget', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id, 'Old Name');
      const res = await put(`/budgets/${cat.id}`, { name: 'New Name' });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).name).toBe('New Name');
    });
  });

  // ─── Hard Delete ────────────────────────────────────────────────────────

  describe('DELETE /budgets/:id?mode=hard', () => {
    it('hard deletes budget with expenses, incomes, and allocations — all records removed', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id, 'ToHardDelete');
      const plan = await createYearPlan(2026);

      const expense = await createExpense(cat.id);
      const income = await createIncome(cat.id);
      const allocation = await createBudgetAllocation(plan.id, cat.id);
      const goal = await createBudgetGoal(cat.id);

      const res = await req('DELETE', `/budgets/${cat.id}?mode=hard`);
      expect(res.status).toBe(200);

      const body: any = await res.json();
      expect(body.deleted).toBe(true);
      expect(body.transactionsDeleted).toBe(3);
      expect(body.budgetsDeleted).toBe(1);

      const dbBudget = await prisma.budget.findUnique({ where: { id: cat.id } });
      expect(dbBudget).toBeNull();

      const dbExpense = await prisma.expense.findUnique({ where: { id: expense.id } });
      expect(dbExpense).toBeNull();

      const dbIncome = await prisma.income.findUnique({ where: { id: income.id } });
      expect(dbIncome).toBeNull();

      const dbGoal = await prisma.budgetGoal.findUnique({ where: { id: goal.id } });
      expect(dbGoal).toBeNull();

      const dbAllocation = await prisma.categoryBudget.findUnique({ where: { id: allocation.id } });
      expect(dbAllocation).toBeNull();

      const versions = await prisma.budgetVersion.findMany({
        where: { categoryBudgetId: allocation.id },
      });
      expect(versions).toHaveLength(0);
    });

    it('returns 404 for non-existent budget', async () => {
      const res = await req('DELETE', '/budgets/nonexistent-id?mode=hard');
      expect(res.status).toBe(404);
    });
  });

  // ─── Soft Delete ────────────────────────────────────────────────────────

  describe('DELETE /budgets/:id?mode=soft', () => {
    it('soft deletes budget — sets deletedAt, retains transactions, sets allocation removedAt', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id, 'ToSoftDelete');
      const plan = await createYearPlan(2026);

      const expense = await createExpense(cat.id);
      const income = await createIncome(cat.id);
      const allocation = await createBudgetAllocation(plan.id, cat.id);

      const res = await req('DELETE', `/budgets/${cat.id}?mode=soft`);
      expect(res.status).toBe(200);

      const body: any = await res.json();
      expect(body.softDeleted).toBe(true);

      const dbBudget = await prisma.budget.findUnique({ where: { id: cat.id } });
      expect(dbBudget).not.toBeNull();
      expect(dbBudget!.deletedAt).not.toBeNull();

      const dbExpense = await prisma.expense.findUnique({ where: { id: expense.id } });
      expect(dbExpense).not.toBeNull();

      const dbIncome = await prisma.income.findUnique({ where: { id: income.id } });
      expect(dbIncome).not.toBeNull();

      const dbAllocation = await prisma.categoryBudget.findUnique({ where: { id: allocation.id } });
      expect(dbAllocation).not.toBeNull();
      expect(dbAllocation!.removedAt).not.toBeNull();
    });

    it('returns 400 when soft-deleting an already soft-deleted budget', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id, 'AlreadyDeleted');

      const res1 = await req('DELETE', `/budgets/${cat.id}?mode=soft`);
      expect(res1.status).toBe(200);

      const res2 = await req('DELETE', `/budgets/${cat.id}?mode=soft`);
      expect(res2.status).toBe(400);
      const body: any = await res2.json();
      expect(body.error).toMatch(/already soft-deleted/i);
    });

    it('returns 404 for non-existent budget', async () => {
      const res = await req('DELETE', '/budgets/nonexistent-id?mode=soft');
      expect(res.status).toBe(404);
    });
  });

  // ─── Reassign ─────────────────────────────────────────────────────────

  describe('POST /budgets/:id/reassign', () => {
    it('reassigns transactions and allocations from source to target, deletes source', async () => {
      const group = await createGroup();
      const source = await createCategory(group.id, 'Source');
      const target = await createCategory(group.id, 'Target');
      const plan = await createYearPlan(2026);

      const expense = await createExpense(source.id);
      const income = await createIncome(source.id);
      const goal = await createBudgetGoal(source.id);
      const allocation = await createBudgetAllocation(plan.id, source.id);

      const res = await post(`/budgets/${source.id}/reassign`, {
        targetBudgetId: target.id,
      });
      expect(res.status).toBe(200);

      const body: any = await res.json();
      expect(body.reassigned).toBe(3);
      expect(body.budgetsDeleted).toBe(1);
      expect(body.deleted).toBe(true);

      const dbSource = await prisma.budget.findUnique({ where: { id: source.id } });
      expect(dbSource).toBeNull();

      const dbExpense = await prisma.expense.findUnique({ where: { id: expense.id } });
      expect(dbExpense).not.toBeNull();
      expect(dbExpense!.budgetId).toBe(target.id);

      const dbIncome = await prisma.income.findUnique({ where: { id: income.id } });
      expect(dbIncome).not.toBeNull();
      expect(dbIncome!.budgetId).toBe(target.id);

      const dbGoal = await prisma.budgetGoal.findUnique({ where: { id: goal.id } });
      expect(dbGoal).not.toBeNull();
      expect(dbGoal!.budgetId).toBe(target.id);

      const dbAllocation = await prisma.categoryBudget.findUnique({ where: { id: allocation.id } });
      expect(dbAllocation).toBeNull();
    });

    it('returns 404 when source does not exist', async () => {
      const group = await createGroup();
      const target = await createCategory(group.id, 'Target');
      const res = await post('/budgets/nonexistent-id/reassign', {
        targetBudgetId: target.id,
      });
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toMatch(/source/i);
    });

    it('returns 404 when target does not exist', async () => {
      const group = await createGroup();
      const source = await createCategory(group.id, 'Source');
      const res = await post(`/budgets/${source.id}/reassign`, {
        targetBudgetId: 'nonexistent-id',
      });
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toMatch(/target/i);
    });
  });

  // ─── GET /budgets filtering ───────────────────────────────────────────

  describe('GET /budgets — soft-delete filtering', () => {
    it('excludes soft-deleted budgets by default', async () => {
      const group = await createGroup();
      const active = await createCategory(group.id, 'Active');
      const deleted = await createCategory(group.id, 'Deleted');

      await req('DELETE', `/budgets/${deleted.id}?mode=soft`);

      const res = await get('/budgets');
      expect(res.status).toBe(200);
      const body = (await res.json()) as any[];

      const ids = body.map((c: any) => c.id);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(deleted.id);
    });

    it('includes soft-deleted budgets when includeDeleted=true', async () => {
      const group = await createGroup();
      const active = await createCategory(group.id, 'Active');
      const deleted = await createCategory(group.id, 'Deleted');

      await req('DELETE', `/budgets/${deleted.id}?mode=soft`);

      const res = await get('/budgets?includeDeleted=true');
      expect(res.status).toBe(200);
      const body = (await res.json()) as any[];

      const ids = body.map((c: any) => c.id);
      expect(ids).toContain(active.id);
      expect(ids).toContain(deleted.id);
    });
  });

  // ─── Backward Compatibility ───────────────────────────────────────────

  describe('DELETE /budgets/:id — backward compatibility', () => {
    it('defaults to hard delete when no mode param is provided', async () => {
      const group = await createGroup();
      const cat = await createCategory(group.id, 'DefaultDelete');
      const expense = await createExpense(cat.id);

      const res = await req('DELETE', `/budgets/${cat.id}`);
      expect(res.status).toBe(200);

      const body: any = await res.json();
      expect(body.deleted).toBe(true);
      expect(body.transactionsDeleted).toBe(1);

      const dbBudget = await prisma.budget.findUnique({ where: { id: cat.id } });
      expect(dbBudget).toBeNull();

      const dbExpense = await prisma.expense.findUnique({ where: { id: expense.id } });
      expect(dbExpense).toBeNull();
    });
  });
});
