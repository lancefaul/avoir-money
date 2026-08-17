import { describe, it, expect } from 'vitest';
import {
  get,
  post,
  put,
  del,
  createAccount,
  createBudgetGroup,
  createBudget,
  createTransaction,
} from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';

describe('Transaction Children API', () => {
  /** Seed: account → budget group → budget → parent EXPENSE transaction */
  async function setup() {
    const account = await createAccount();
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const parent = await createTransaction(account.id, {
      type: 'EXPENSE',
      amount: 100,
    });
    return { account, group, budget, parent };
  }

  // ─── POST /:id/children ───

  describe('POST /transactions/:id/children', () => {
    it('creates a child transaction with valid data — returns 201', async () => {
      const { budget, parent } = await setup();

      const res = await post(`/transactions/${parent.id}/children`, {
        budgetId: budget.id,
        preTaxAmount: 30,
        taxAmount: 2.5,
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.parentId).toBe(parent.id);
      expect(body.budgetId).toBe(budget.id);
      expect(body.preTaxAmount).toBe(30);
      expect(body.taxAmount).toBe(2.5);
      expect(body.lineTotal).toBe(32.5);
      expect(body.id).toBeDefined();

      // Verify DB state
      const dbChild = await prisma.transaction.findUnique({ where: { id: body.id } });
      expect(dbChild).toBeTruthy();
      expect(dbChild!.parentId).toBe(parent.id);
      expect(Number(dbChild!.amount)).toBe(32.5);
    });

    it('creates a child with taxRate instead of taxAmount', async () => {
      const { budget, parent } = await setup();

      const res = await post(`/transactions/${parent.id}/children`, {
        budgetId: budget.id,
        preTaxAmount: 50,
        taxRate: 10,
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.preTaxAmount).toBe(50);
      expect(body.taxAmount).toBe(5);
      expect(body.lineTotal).toBe(55);
    });

    it('returns 400 when child amount exceeds remaining parent amount', async () => {
      const { budget, parent } = await setup();

      const res = await post(`/transactions/${parent.id}/children`, {
        budgetId: budget.id,
        preTaxAmount: 150,
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('exceeds remaining amount');
    });

    it('returns 404 for a non-existent parent transaction', async () => {
      const { budget } = await setup();

      const res = await post('/transactions/nonexistent-id/children', {
        budgetId: budget.id,
        preTaxAmount: 10,
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 when trying to split a child transaction', async () => {
      const { budget, parent } = await setup();

      // Create a child first
      const childRes = await post(`/transactions/${parent.id}/children`, {
        budgetId: budget.id,
        preTaxAmount: 20,
      });
      const child: any = await childRes.json();

      // Try to create a child of the child
      const res = await post(`/transactions/${child.id}/children`, {
        budgetId: budget.id,
        preTaxAmount: 5,
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('Cannot split a child transaction');
    });
  });

  // ─── DELETE /:id/children/:childId ───

  describe('DELETE /transactions/:id/children/:childId', () => {
    it('deletes a child transaction — returns 204', async () => {
      const { budget, parent } = await setup();

      // Create a child
      const createRes = await post(`/transactions/${parent.id}/children`, {
        budgetId: budget.id,
        preTaxAmount: 25,
      });
      const child: any = await createRes.json();

      // Delete the child
      const res = await del(`/transactions/${parent.id}/children/${child.id}`);
      expect(res.status).toBe(204);

      // Verify DB state — child should be gone
      const dbChild = await prisma.transaction.findUnique({ where: { id: child.id } });
      expect(dbChild).toBeNull();
    });

    it('returns 404 when parent does not exist', async () => {
      const { budget, parent } = await setup();

      const createRes = await post(`/transactions/${parent.id}/children`, {
        budgetId: budget.id,
        preTaxAmount: 10,
      });
      const child: any = await createRes.json();

      const res = await del(`/transactions/nonexistent-id/children/${child.id}`);
      expect(res.status).toBe(404);
    });

    it('returns 404 when child does not exist', async () => {
      const { parent } = await setup();

      const res = await del(`/transactions/${parent.id}/children/nonexistent-child-id`);
      expect(res.status).toBe(404);
    });
  });

  // ─── PUT /:id/children/:childId ───

  describe('PUT /transactions/:id/children/:childId', () => {
    it('updates a child transaction — returns 200 with updated data', async () => {
      const { budget, parent, group } = await setup();
      const budget2 = await createBudget(group.id);

      // Create a child
      const createRes = await post(`/transactions/${parent.id}/children`, {
        budgetId: budget.id,
        preTaxAmount: 30,
        taxAmount: 3,
      });
      expect(createRes.status).toBe(201);
      const child: any = await createRes.json();

      // Update the child — change category and preTaxAmount
      const res = await put(`/transactions/${parent.id}/children/${child.id}`, {
        budgetId: budget2.id,
        preTaxAmount: 40,
        taxAmount: 4,
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.budgetId).toBe(budget2.id);
      expect(body.preTaxAmount).toBe(40);
      expect(body.taxAmount).toBe(4);
      expect(body.lineTotal).toBe(44);

      // Verify DB state
      const dbChild = await prisma.transaction.findUnique({ where: { id: child.id } });
      expect(dbChild).toBeTruthy();
      expect(Number(dbChild!.amount)).toBe(44);
      expect(dbChild!.budgetId).toBe(budget2.id);
    });

    it('returns 400 when updated amount exceeds parent total', async () => {
      const { budget, parent } = await setup();

      // Create a child using most of the parent amount
      const createRes = await post(`/transactions/${parent.id}/children`, {
        budgetId: budget.id,
        preTaxAmount: 30,
      });
      const child: any = await createRes.json();

      // Try to update to exceed parent total
      const res = await put(`/transactions/${parent.id}/children/${child.id}`, {
        preTaxAmount: 150,
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('exceed parent total');
    });

    it('returns 404 when parent does not exist', async () => {
      const { budget, parent } = await setup();

      const createRes = await post(`/transactions/${parent.id}/children`, {
        budgetId: budget.id,
        preTaxAmount: 10,
      });
      const child: any = await createRes.json();

      const res = await put(`/transactions/nonexistent-id/children/${child.id}`, {
        preTaxAmount: 15,
      });

      expect(res.status).toBe(404);
    });

    it('returns 404 when child does not exist', async () => {
      const { parent } = await setup();

      const res = await put(`/transactions/${parent.id}/children/nonexistent-child-id`, {
        preTaxAmount: 15,
      });

      expect(res.status).toBe(404);
    });

    it('allows partial update — only note field', async () => {
      const { budget, parent } = await setup();

      const createRes = await post(`/transactions/${parent.id}/children`, {
        budgetId: budget.id,
        preTaxAmount: 20,
        note: 'original note',
      });
      const child: any = await createRes.json();

      const res = await put(`/transactions/${parent.id}/children/${child.id}`, {
        note: 'updated note',
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.note).toBe('updated note');
      expect(body.preTaxAmount).toBe(20); // unchanged
    });
  });

  // ─── GET /:id/children ───

  describe('GET /transactions/:id/children', () => {
    it('lists children with remaining amount', async () => {
      const { budget, parent } = await setup();

      // Create two children
      await post(`/transactions/${parent.id}/children`, {
        budgetId: budget.id,
        preTaxAmount: 30,
      });
      await post(`/transactions/${parent.id}/children`, {
        budgetId: budget.id,
        preTaxAmount: 25,
      });

      const res = await get(`/transactions/${parent.id}/children`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.children).toHaveLength(2);
      expect(body.parentAmount).toBe(100);
      expect(body.remainingAmount).toBe(45); // 100 - 30 - 25
    });

    it('returns 404 for non-existent parent', async () => {
      const res = await get('/transactions/nonexistent-id/children');
      expect(res.status).toBe(404);
    });
  });

  // ─── Sub-cent inputs (2026-07-18) ───

  describe('sub-cent precision', () => {
    /**
     * The route used to store the raw request `preTaxAmount` while deriving
     * taxAmount and lineTotal from the rounded value, so a 3-decimal input left
     * the three columns disagreeing. Decimal columns now persist exactly what
     * they are given, so an unrounded value would be written verbatim.
     */
    it('stores a 3-decimal preTaxAmount rounded to cents — POST', async () => {
      const { budget, parent } = await setup();

      const res = await post(`/transactions/${parent.id}/children`, {
        budgetId: budget.id,
        preTaxAmount: 10.005,
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.preTaxAmount).toBe(10.01);
      expect(body.lineTotal).toBe(10.01);

      const dbChild = await prisma.transaction.findUnique({ where: { id: body.id } });
      expect(Number(dbChild!.preTaxAmount)).toBe(10.01);
      expect(Number(dbChild!.amount)).toBe(10.01);
      expect(Number(dbChild!.netAmount)).toBe(10.01);
    });

    it('stores a 3-decimal preTaxAmount rounded to cents — PUT', async () => {
      const { budget, parent } = await setup();
      const created: any = await (
        await post(`/transactions/${parent.id}/children`, {
          budgetId: budget.id,
          preTaxAmount: 20,
        })
      ).json();

      const res = await put(`/transactions/${parent.id}/children/${created.id}`, {
        preTaxAmount: 33.334,
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.preTaxAmount).toBe(33.33);

      const dbChild = await prisma.transaction.findUnique({ where: { id: created.id } });
      expect(Number(dbChild!.preTaxAmount)).toBe(33.33);
      expect(Number(dbChild!.amount)).toBe(33.33);
    });
  });
});
