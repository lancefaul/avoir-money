/**
 * Integration tests for Utility Readings CRUD (Task 5.2)
 *
 * Tests reading create, list (with serviceId and date range filters),
 * update, delete, 400 on non-existent serviceId, expense transaction
 * amount update, and schedule invalidation.
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import {
  get,
  post,
  put,
  del,
  createBudgetGroup,
  createBudget,
  createExpense,
  createAccount,
  createTransaction,
} from '../test/helpers.js';

// ─── Helpers ───

async function createProvider(name = 'Test Provider') {
  const res = await post('/utilities/providers', { name });
  return { res, body: (await res.json()) as any };
}

async function createService(providerId: string, serviceType = 'ELECTRIC', metering = 'METERED') {
  const res = await post(`/utilities/providers/${providerId}/services`, {
    serviceType,
    metering,
  });
  return { res, body: (await res.json()) as any };
}

async function setupProviderAndService() {
  const { body: provider } = await createProvider('Reading Test Provider');
  const { body: service } = await createService(provider.id, 'ELECTRIC', 'METERED');
  return { provider, service };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Reading CRUD
// ═══════════════════════════════════════════════════════════════════════════════

describe('Utility Readings API', () => {
  describe('CRUD', () => {
    it('POST /utilities/readings creates a reading and returns 201', async () => {
      const { service } = await setupProviderAndService();

      const res = await post('/utilities/readings', {
        serviceId: service.id,
        billDate: new Date(Date.UTC(2026, 2, 1)).toISOString(),
        cost: 150.5,
      });
      expect(res.status).toBe(201);

      const body: any = await res.json();
      expect(body.id).toBeDefined();
      expect(body.serviceId).toBe(service.id);
      expect(body.cost).toBeCloseTo(150.5);
      expect(body.createdAt).toBeDefined();
    });

    it('POST /utilities/readings persists the record in the database', async () => {
      const { service } = await setupProviderAndService();

      const res = await post('/utilities/readings', {
        serviceId: service.id,
        billDate: new Date(Date.UTC(2026, 3, 1)).toISOString(),
        cost: 200,
      });
      const body: any = await res.json();

      const record = await prisma.utilityReading.findUnique({
        where: { id: body.id },
      });
      expect(record).toBeTruthy();
      expect(Number(record!.cost)).toBeCloseTo(200);
    });

    it('GET /utilities/readings lists readings filtered by serviceId', async () => {
      const { body: provider } = await createProvider('Multi Service Provider');
      const { body: serviceA } = await createService(provider.id, 'ELECTRIC');
      const { body: serviceB } = await createService(provider.id, 'GAS');

      await post('/utilities/readings', {
        serviceId: serviceA.id,
        billDate: new Date(Date.UTC(2026, 2, 1)).toISOString(),
        cost: 100,
      });
      await post('/utilities/readings', {
        serviceId: serviceB.id,
        billDate: new Date(Date.UTC(2026, 2, 1)).toISOString(),
        cost: 50,
      });

      const res = await get(`/utilities/readings?serviceId=${serviceA.id}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].serviceId).toBe(serviceA.id);
    });

    it('GET /utilities/readings lists readings filtered by date range', async () => {
      const { service } = await setupProviderAndService();

      await post('/utilities/readings', {
        serviceId: service.id,
        billDate: new Date(Date.UTC(2026, 0, 15)).toISOString(),
        cost: 100,
      });
      await post('/utilities/readings', {
        serviceId: service.id,
        billDate: new Date(Date.UTC(2026, 3, 15)).toISOString(),
        cost: 200,
      });
      await post('/utilities/readings', {
        serviceId: service.id,
        billDate: new Date(Date.UTC(2026, 6, 15)).toISOString(),
        cost: 300,
      });

      const dateFrom = new Date(Date.UTC(2026, 2, 1)).toISOString();
      const dateTo = new Date(Date.UTC(2026, 5, 30)).toISOString();
      const res = await get(`/utilities/readings?dateFrom=${dateFrom}&dateTo=${dateTo}`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].cost).toBeCloseTo(200);
    });

    it('PUT /utilities/readings/:id updates a reading', async () => {
      const { service } = await setupProviderAndService();

      const createRes = await post('/utilities/readings', {
        serviceId: service.id,
        billDate: new Date(Date.UTC(2026, 2, 1)).toISOString(),
        cost: 100,
      });
      const created: any = await createRes.json();

      const res = await put(`/utilities/readings/${created.id}`, {
        cost: 175.25,
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.cost).toBeCloseTo(175.25);

      // Verify in DB
      const record = await prisma.utilityReading.findUnique({
        where: { id: created.id },
      });
      expect(Number(record!.cost)).toBeCloseTo(175.25);
    });

    it('DELETE /utilities/readings/:id removes a reading', async () => {
      const { service } = await setupProviderAndService();

      const createRes = await post('/utilities/readings', {
        serviceId: service.id,
        billDate: new Date(Date.UTC(2026, 2, 1)).toISOString(),
        cost: 100,
      });
      const created: any = await createRes.json();

      const res = await del(`/utilities/readings/${created.id}`);
      expect(res.status).toBe(204);

      const record = await prisma.utilityReading.findUnique({
        where: { id: created.id },
      });
      expect(record).toBeNull();
    });
  });

  // ─── 400 on non-existent serviceId ───

  describe('Validation', () => {
    it('POST /utilities/readings returns 400 for non-existent serviceId', async () => {
      const res = await post('/utilities/readings', {
        serviceId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
        billDate: new Date(Date.UTC(2026, 2, 1)).toISOString(),
        cost: 100,
      });
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });
  });

  // ─── Not found ───

  describe('Not found', () => {
    it('PUT /utilities/readings/:id returns 404 for non-existent reading', async () => {
      const res = await put('/utilities/readings/clxxxxxxxxxxxxxxxxxxxxxxxxx', {
        cost: 100,
      });
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });

    it('DELETE /utilities/readings/:id returns 404 for non-existent reading', async () => {
      const res = await del('/utilities/readings/clxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });
  });

  // ─── Expense transaction amount update ───

  describe('Expense transaction amount update', () => {
    it('updates linked expense transaction amount on reading create', async () => {
      // Setup: provider → service → link to expense → create transaction
      const group = await createBudgetGroup('Utilities');
      const budget = await createBudget(group.id, 'Electric');
      const expense = await createExpense(budget.id, {
        name: 'Electric Bill',
        amount: 150,
        frequency: 'MONTHLY',
      });
      const account = await createAccount('Checking');

      const { body: provider } = await createProvider('Metro Power');
      const { body: service } = await createService(provider.id, 'ELECTRIC');

      // Link service to expense
      await put(`/utilities/services/${service.id}/link`, {
        expenseId: expense.id,
      });

      // Create a transaction for the expense in March 2026
      const tx = await createTransaction(account.id, {
        name: 'Electric Bill March',
        amount: 150,
        type: 'EXPENSE',
        date: new Date(Date.UTC(2026, 2, 15)),
        expenseId: expense.id,
      });

      // Create a reading for March 2026 — should update the transaction amount
      // Total = 175.50 + 3.00 (dollar fee) + 2.50 (other) = 181.00
      const readingRes = await post('/utilities/readings', {
        serviceId: service.id,
        billDate: new Date(Date.UTC(2026, 2, 1)).toISOString(),
        cost: 175.5,
        convenienceFee: 3.0,
        convenienceFeeType: 'dollar',
        otherFees: 2.5,
      });
      expect(readingRes.status).toBe(201);

      // Verify the transaction amount was updated to total bill
      const updatedTx = await prisma.transaction.findUnique({
        where: { id: tx.id },
      });
      expect(Number(updatedTx!.amount)).toBeCloseTo(181.0);
    });
  });

  // ─── Schedule invalidation ───

  describe('Schedule invalidation', () => {
    it('invalidates PENDING scheduled transactions on reading create', async () => {
      const group = await createBudgetGroup('Utilities');
      const budget = await createBudget(group.id, 'Electric');
      const expense = await createExpense(budget.id, {
        name: 'Electric Bill',
        amount: 150,
        frequency: 'MONTHLY',
      });

      const { body: provider } = await createProvider('Metro Power');
      const { body: service } = await createService(provider.id, 'ELECTRIC');

      // Link service to expense
      await put(`/utilities/services/${service.id}/link`, {
        expenseId: expense.id,
      });

      // Create a PENDING scheduled transaction for the expense
      await prisma.scheduledTransaction.create({
        data: {
          sourceType: 'EXPENSE',
          sourceId: expense.id,
          dueDate: new Date(Date.UTC(2026, 5, 1)),
          expectedAmount: 150,
          status: 'PENDING',
          expenseId: expense.id,
        },
      });

      // Create a reading — should invalidate the PENDING row
      await post('/utilities/readings', {
        serviceId: service.id,
        billDate: new Date(Date.UTC(2026, 5, 1)).toISOString(),
        cost: 200,
      });

      const pending = await prisma.scheduledTransaction.findMany({
        where: {
          sourceType: 'EXPENSE',
          sourceId: expense.id,
          status: 'PENDING',
        },
      });
      expect(pending).toHaveLength(0);
    });

    it('invalidates PENDING scheduled transactions on reading update', async () => {
      const group = await createBudgetGroup('Utilities');
      const budget = await createBudget(group.id, 'Electric');
      const expense = await createExpense(budget.id, {
        name: 'Electric Bill',
        amount: 150,
        frequency: 'MONTHLY',
      });

      const { body: provider } = await createProvider('Metro Power');
      const { body: service } = await createService(provider.id, 'ELECTRIC');

      // Link service to expense
      await put(`/utilities/services/${service.id}/link`, {
        expenseId: expense.id,
      });

      // Create a reading first
      const createRes = await post('/utilities/readings', {
        serviceId: service.id,
        billDate: new Date(Date.UTC(2026, 5, 1)).toISOString(),
        cost: 200,
      });
      const reading: any = await createRes.json();

      // Create a PENDING scheduled transaction
      await prisma.scheduledTransaction.create({
        data: {
          sourceType: 'EXPENSE',
          sourceId: expense.id,
          dueDate: new Date(Date.UTC(2026, 6, 1)),
          expectedAmount: 150,
          status: 'PENDING',
          expenseId: expense.id,
        },
      });

      // Update the reading — should invalidate the PENDING row
      await put(`/utilities/readings/${reading.id}`, {
        cost: 250,
      });

      const pending = await prisma.scheduledTransaction.findMany({
        where: {
          sourceType: 'EXPENSE',
          sourceId: expense.id,
          status: 'PENDING',
        },
      });
      expect(pending).toHaveLength(0);
    });
  });
});
