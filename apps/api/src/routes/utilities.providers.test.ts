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

// ═══════════════════════════════════════════════════════════════════════════════
// Task 4.4 — Provider CRUD integration tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Utility Providers API', () => {
  // ─── CRUD ───

  describe('CRUD', () => {
    it('POST /utilities/providers creates a provider and returns 201', async () => {
      const { res, body } = await createProvider('Metro Power');
      expect(res.status).toBe(201);
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Metro Power');
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();
    });

    it('POST /utilities/providers persists the record in the database', async () => {
      const { body } = await createProvider('Duke Energy');
      const record = await prisma.utilityProvider.findUnique({
        where: { id: body.id },
      });
      expect(record).toBeTruthy();
      expect(record!.name).toBe('Duke Energy');
    });

    it('GET /utilities/providers returns providers in alphabetical order', async () => {
      await createProvider('Zebra Utilities');
      await createProvider('Alpha Power');
      await createProvider('Metro Gas');

      const res = await get('/utilities/providers');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body).toHaveLength(3);
      expect(body[0].name).toBe('Alpha Power');
      expect(body[1].name).toBe('Metro Gas');
      expect(body[2].name).toBe('Zebra Utilities');
    });

    it('PUT /utilities/providers/:id updates the provider name', async () => {
      const { body: created } = await createProvider('Old Name');
      const res = await put(`/utilities/providers/${created.id}`, {
        name: 'New Name',
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.name).toBe('New Name');

      // Verify in DB
      const record = await prisma.utilityProvider.findUnique({
        where: { id: created.id },
      });
      expect(record!.name).toBe('New Name');
    });

    it('DELETE /utilities/providers/:id removes a provider with no services', async () => {
      const { body: created } = await createProvider('To Delete');
      const res = await del(`/utilities/providers/${created.id}`);
      expect(res.status).toBe(204);

      const record = await prisma.utilityProvider.findUnique({
        where: { id: created.id },
      });
      expect(record).toBeNull();
    });
  });

  // ─── Conflict: duplicate name (case-insensitive) ───

  describe('Duplicate name conflicts', () => {
    it('POST /utilities/providers returns 409 on case-insensitive duplicate name', async () => {
      await createProvider('Metro Power');
      const { res, body } = await createProvider('metro power');
      expect(res.status).toBe(409);
      expect(body.error).toContain('already exists');
    });

    it('POST /utilities/providers returns 409 on exact duplicate name', async () => {
      await createProvider('Duke Energy');
      const { res, body } = await createProvider('Duke Energy');
      expect(res.status).toBe(409);
      expect(body.error).toContain('already exists');
    });

    it('PUT /utilities/providers/:id returns 409 when renaming to existing name (case-insensitive)', async () => {
      const { body: providerA } = await createProvider('Provider A');
      await createProvider('Provider B');

      const res = await put(`/utilities/providers/${providerA.id}`, {
        name: 'provider b',
      });
      expect(res.status).toBe(409);
      const body: any = await res.json();
      expect(body.error).toContain('already exists');
    });

    it('PUT /utilities/providers/:id allows renaming to same name with different case', async () => {
      const { body: provider } = await createProvider('My Provider');
      const res = await put(`/utilities/providers/${provider.id}`, {
        name: 'MY PROVIDER',
      });
      // Should succeed — renaming self to a case variant is allowed
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.name).toBe('MY PROVIDER');
    });
  });

  // ─── Conflict: delete provider with services ───

  describe('Delete provider with services', () => {
    it('DELETE /utilities/providers/:id returns 409 when provider has active services', async () => {
      const { body: provider } = await createProvider('Has Services');
      await createService(provider.id, 'ELECTRIC');

      const res = await del(`/utilities/providers/${provider.id}`);
      expect(res.status).toBe(409);
      const body: any = await res.json();
      expect(body.error).toContain('active services');
    });
  });

  // ─── Not found ───

  describe('Not found', () => {
    it('PUT /utilities/providers/:id returns 404 for non-existent provider', async () => {
      const res = await put('/utilities/providers/clxxxxxxxxxxxxxxxxxxxxxxxxx', {
        name: 'Nope',
      });
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });

    it('DELETE /utilities/providers/:id returns 404 for non-existent provider', async () => {
      const res = await del('/utilities/providers/clxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Task 4.5 — Service CRUD and expense linking integration tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Utility Services API', () => {
  // ─── CRUD ───

  describe('CRUD', () => {
    it('POST /utilities/providers/:providerId/services creates a service and returns 201', async () => {
      const { body: provider } = await createProvider('Metro Power');
      const { res, body } = await createService(provider.id, 'ELECTRIC', 'METERED');
      expect(res.status).toBe(201);
      expect(body.id).toBeDefined();
      expect(body.providerId).toBe(provider.id);
      expect(body.serviceType).toBe('ELECTRIC');
      expect(body.metering).toBe('METERED');
      expect(body.expenseId).toBeNull();
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();
    });

    it('POST /utilities/providers/:providerId/services persists the record in the database', async () => {
      const { body: provider } = await createProvider('Duke Energy');
      const { body: service } = await createService(provider.id, 'GAS', 'UNMETERED');
      const record = await prisma.utilityService.findUnique({
        where: { id: service.id },
      });
      expect(record).toBeTruthy();
      expect(record!.serviceType).toBe('GAS');
      expect(record!.metering).toBe('UNMETERED');
    });

    it('GET /utilities/providers/:providerId/services returns services ordered by serviceType', async () => {
      const { body: provider } = await createProvider('Multi Service');
      await createService(provider.id, 'WATER', 'METERED');
      await createService(provider.id, 'ELECTRIC', 'METERED');
      await createService(provider.id, 'GAS', 'METERED');

      const res = await get(`/utilities/providers/${provider.id}/services`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body).toHaveLength(3);
      // Alphabetical by serviceType: ELECTRIC < GAS < WATER
      expect(body[0].serviceType).toBe('ELECTRIC');
      expect(body[1].serviceType).toBe('GAS');
      expect(body[2].serviceType).toBe('WATER');
    });

    it('PUT /utilities/services/:id updates the metering classification', async () => {
      const { body: provider } = await createProvider('Metro Power');
      const { body: service } = await createService(provider.id, 'INTERNET', 'METERED');

      const res = await put(`/utilities/services/${service.id}`, {
        metering: 'UNMETERED',
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.metering).toBe('UNMETERED');

      // Verify in DB
      const record = await prisma.utilityService.findUnique({
        where: { id: service.id },
      });
      expect(record!.metering).toBe('UNMETERED');
    });

    it('DELETE /utilities/services/:id removes a service with no readings', async () => {
      const { body: provider } = await createProvider('Metro Power');
      const { body: service } = await createService(provider.id, 'ELECTRIC');

      const res = await del(`/utilities/services/${service.id}`);
      expect(res.status).toBe(204);

      const record = await prisma.utilityService.findUnique({
        where: { id: service.id },
      });
      expect(record).toBeNull();
    });
  });

  // ─── Conflict: duplicate serviceType under same provider ───

  describe('Duplicate serviceType conflicts', () => {
    it('POST returns 409 on duplicate serviceType under same provider', async () => {
      const { body: provider } = await createProvider('Metro Power');
      await createService(provider.id, 'ELECTRIC');
      const { res, body } = await createService(provider.id, 'ELECTRIC');
      expect(res.status).toBe(409);
      expect(body.error).toContain('already has a service');
    });

    it('allows same serviceType under different providers', async () => {
      const { body: providerA } = await createProvider('Provider A');
      const { body: providerB } = await createProvider('Provider B');
      const { res: resA } = await createService(providerA.id, 'ELECTRIC');
      const { res: resB } = await createService(providerB.id, 'ELECTRIC');
      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
    });
  });

  // ─── Conflict: delete service with readings ───

  describe('Delete service with readings', () => {
    it('DELETE /utilities/services/:id returns 409 when service has readings', async () => {
      const { body: provider } = await createProvider('Metro Power');
      const { body: service } = await createService(provider.id, 'ELECTRIC');

      // Create a reading directly via Prisma
      await prisma.utilityReading.create({
        data: {
          serviceId: service.id,
          billDate: new Date(Date.UTC(2026, 2, 1)),
          cost: 150.5,
        },
      });

      const res = await del(`/utilities/services/${service.id}`);
      expect(res.status).toBe(409);
      const body: any = await res.json();
      expect(body.error).toContain('readings');
    });
  });

  // ─── Not found ───

  describe('Not found', () => {
    it('GET /utilities/providers/:providerId/services returns 404 for non-existent provider', async () => {
      const res = await get('/utilities/providers/clxxxxxxxxxxxxxxxxxxxxxxxxx/services');
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });

    it('POST /utilities/providers/:providerId/services returns 404 for non-existent provider', async () => {
      const res = await post('/utilities/providers/clxxxxxxxxxxxxxxxxxxxxxxxxx/services', {
        serviceType: 'ELECTRIC',
        metering: 'METERED',
      });
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });

    it('PUT /utilities/services/:id returns 404 for non-existent service', async () => {
      const res = await put('/utilities/services/clxxxxxxxxxxxxxxxxxxxxxxxxx', {
        metering: 'UNMETERED',
      });
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });

    it('DELETE /utilities/services/:id returns 404 for non-existent service', async () => {
      const res = await del('/utilities/services/clxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Task 4.5 — Expense linking integration tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Utility Service Expense Linking', () => {
  async function setupLinkedService() {
    const group = await createBudgetGroup('Utilities');
    const budget = await createBudget(group.id, 'Electric');
    const expense = await createExpense(budget.id, {
      name: 'Electric Bill',
      amount: 150,
      frequency: 'MONTHLY',
    });
    const { body: provider } = await createProvider('Metro Power');
    const { body: service } = await createService(provider.id, 'ELECTRIC');
    return { provider, service, expense };
  }

  it('PUT /utilities/services/:id/link links a service to an expense', async () => {
    const { service, expense } = await setupLinkedService();

    const res = await put(`/utilities/services/${service.id}/link`, {
      expenseId: expense.id,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.expenseId).toBe(expense.id);

    // Verify in DB
    const record = await prisma.utilityService.findUnique({
      where: { id: service.id },
    });
    expect(record!.expenseId).toBe(expense.id);
  });

  it('DELETE /utilities/services/:id/link unlinks a service from its expense', async () => {
    const { service, expense } = await setupLinkedService();

    // Link first
    await put(`/utilities/services/${service.id}/link`, {
      expenseId: expense.id,
    });

    // Unlink
    const res = await del(`/utilities/services/${service.id}/link`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.expenseId).toBeNull();

    // Verify in DB
    const record = await prisma.utilityService.findUnique({
      where: { id: service.id },
    });
    expect(record!.expenseId).toBeNull();
  });

  it('PUT /utilities/services/:id/link invalidates schedule for linked expense', async () => {
    const { service, expense } = await setupLinkedService();

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

    // Link the service — should invalidate the expense schedule
    await put(`/utilities/services/${service.id}/link`, {
      expenseId: expense.id,
    });

    // PENDING row should be deleted
    const pending = await prisma.scheduledTransaction.findMany({
      where: { sourceType: 'EXPENSE', sourceId: expense.id, status: 'PENDING' },
    });
    expect(pending).toHaveLength(0);
  });

  it('DELETE /utilities/services/:id/link invalidates schedule for previously linked expense', async () => {
    const { service, expense } = await setupLinkedService();

    // Link the service
    await put(`/utilities/services/${service.id}/link`, {
      expenseId: expense.id,
    });

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

    // Unlink — should invalidate the old expense schedule
    await del(`/utilities/services/${service.id}/link`);

    const pending = await prisma.scheduledTransaction.findMany({
      where: { sourceType: 'EXPENSE', sourceId: expense.id, status: 'PENDING' },
    });
    expect(pending).toHaveLength(0);
  });

  it('PUT /utilities/services/:id/link invalidates both old and new expense schedules when re-linking', async () => {
    const group = await createBudgetGroup('Utilities');
    const budget = await createBudget(group.id, 'Bills');
    const expenseA = await createExpense(budget.id, {
      name: 'Electric A',
      amount: 100,
      frequency: 'MONTHLY',
    });
    const expenseB = await createExpense(budget.id, {
      name: 'Electric B',
      amount: 200,
      frequency: 'MONTHLY',
    });
    const { body: provider } = await createProvider('Metro Power');
    const { body: service } = await createService(provider.id, 'ELECTRIC');

    // Link to expense A
    await put(`/utilities/services/${service.id}/link`, {
      expenseId: expenseA.id,
    });

    // Create PENDING rows for both expenses
    await prisma.scheduledTransaction.createMany({
      data: [
        {
          sourceType: 'EXPENSE',
          sourceId: expenseA.id,
          dueDate: new Date(Date.UTC(2026, 5, 1)),
          expectedAmount: 100,
          status: 'PENDING',
          expenseId: expenseA.id,
        },
        {
          sourceType: 'EXPENSE',
          sourceId: expenseB.id,
          dueDate: new Date(Date.UTC(2026, 5, 1)),
          expectedAmount: 200,
          status: 'PENDING',
          expenseId: expenseB.id,
        },
      ],
    });

    // Re-link to expense B — should invalidate both A and B
    await put(`/utilities/services/${service.id}/link`, {
      expenseId: expenseB.id,
    });

    const pendingA = await prisma.scheduledTransaction.findMany({
      where: { sourceType: 'EXPENSE', sourceId: expenseA.id, status: 'PENDING' },
    });
    const pendingB = await prisma.scheduledTransaction.findMany({
      where: { sourceType: 'EXPENSE', sourceId: expenseB.id, status: 'PENDING' },
    });
    expect(pendingA).toHaveLength(0);
    expect(pendingB).toHaveLength(0);
  });

  // ─── Not found for link/unlink ───

  it('PUT /utilities/services/:id/link returns 404 for non-existent service', async () => {
    const res = await put('/utilities/services/clxxxxxxxxxxxxxxxxxxxxxxxxx/link', {
      expenseId: 'some-expense-id',
    });
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.error).toContain('not found');
  });

  it('DELETE /utilities/services/:id/link returns 404 for non-existent service', async () => {
    const res = await del('/utilities/services/clxxxxxxxxxxxxxxxxxxxxxxxxx/link');
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.error).toContain('not found');
  });
});
