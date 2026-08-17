import { describe, it, expect } from 'vitest';
import {
  get,
  post,
  put,
  del,
  createBudgetGroup,
  createBudget,
  createExpense,
  createPaySchedule,
  createPayPeriod,
} from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';

describe('Pay Schedules API', () => {
  const validSchedule = {
    name: 'Primary',
    type: 'BIWEEKLY',
    anchorDate: '2026-03-20',
    isDefault: true,
  };

  it('creates a schedule', async () => {
    const res = await post('/pay-schedules', validSchedule);
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.name).toBe('Primary');
    expect(body.type).toBe('BIWEEKLY');
    expect(body.isDefault).toBe(true);
  });

  it('lists schedules', async () => {
    await post('/pay-schedules', validSchedule);
    await post('/pay-schedules', { ...validSchedule, name: 'Secondary', isDefault: false });
    const res = await get('/pay-schedules');
    expect(((await res.json()) as any).length).toBe(2);
  });

  it('gets by id', async () => {
    const create = await post('/pay-schedules', validSchedule);
    const { id } = (await create.json()) as any;
    const res = await get(`/pay-schedules/${id}`);
    expect(res.status).toBe(200);
  });

  it('updates a schedule', async () => {
    const create = await post('/pay-schedules', validSchedule);
    const { id } = (await create.json()) as any;
    const res = await put(`/pay-schedules/${id}`, { name: 'Updated' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).name).toBe('Updated');
  });

  it('deletes a schedule', async () => {
    const create = await post('/pay-schedules', {
      ...validSchedule,
      name: 'Deletable',
      isDefault: false,
    });
    const { id } = (await create.json()) as any;
    expect((await del(`/pay-schedules/${id}`)).status).toBe(204);
  });

  describe('POST /pay-schedules/:id/generate', () => {
    it('generates pay periods', async () => {
      const create = await post('/pay-schedules', validSchedule);
      const { id } = (await create.json()) as any;
      const res = await post(`/pay-schedules/${id}/generate`, {
        rangeStart: '2026-01-01',
        rangeEnd: '2026-12-31',
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.length).toBeGreaterThanOrEqual(26);
    });
  });

  describe('POST /pay-schedules — DB verification (R14.3)', () => {
    it('creates a schedule and persists it in the database', async () => {
      const res = await post('/pay-schedules', {
        name: 'Monthly Check',
        type: 'MONTHLY',
        anchorDate: '2026-01-15',
        firstPayDay: 15,
        isDefault: false,
      });
      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.id).toBeTruthy();
      expect(body.name).toBe('Monthly Check');
      expect(body.type).toBe('MONTHLY');
      expect(body.firstPayDay).toBe(15);
      expect(body.isDefault).toBe(false);

      // Verify DB state
      const dbRecord = await prisma.paySchedule.findUnique({ where: { id: body.id } });
      expect(dbRecord).toBeTruthy();
      expect(dbRecord!.name).toBe('Monthly Check');
      expect(dbRecord!.type).toBe('MONTHLY');
      expect(dbRecord!.firstPayDay).toBe(15);
      expect(dbRecord!.isDefault).toBe(false);
    });
  });

  describe('PUT /pay-schedules/:id — update with invalidation (R14.4)', () => {
    it('updates a schedule and persists changes in the database', async () => {
      const createRes = await post('/pay-schedules', validSchedule);
      const { id } = (await createRes.json()) as any;

      const res = await put(`/pay-schedules/${id}`, {
        name: 'Updated Schedule',
        type: 'WEEKLY',
        anchorDate: '2026-04-01',
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.name).toBe('Updated Schedule');
      expect(body.type).toBe('WEEKLY');

      // Verify DB state
      const dbRecord = await prisma.paySchedule.findUnique({ where: { id } });
      expect(dbRecord).toBeTruthy();
      expect(dbRecord!.name).toBe('Updated Schedule');
      expect(dbRecord!.type).toBe('WEEKLY');
    });

    it('updates a schedule and invalidates affected scheduled transactions', async () => {
      // 1. Create prerequisite data: schedule → period → expense → scheduled transactions
      const group = await createBudgetGroup();
      const budget = await createBudget(group.id);
      const schedule = await createPaySchedule();
      const period = await createPayPeriod(schedule.id, {
        startDate: new Date(Date.UTC(2026, 5, 1)),
        endDate: new Date(Date.UTC(2026, 5, 14)),
        payDate: new Date(Date.UTC(2026, 5, 1)),
        year: 2026,
        periodNum: 1,
      });
      const expense = await createExpense(budget.id, {
        amount: 100,
        frequency: 'MONTHLY',
        dueDay: 10,
      });

      // 2. Create PENDING scheduled transactions tied to this expense
      await prisma.scheduledTransaction.create({
        data: {
          sourceType: 'EXPENSE',
          sourceId: expense.id,
          expenseId: expense.id,
          dueDate: new Date(Date.UTC(2026, 5, 10)),
          expectedAmount: 100,
          status: 'PENDING',
        },
      });

      const beforeRows = await prisma.scheduledTransaction.findMany({
        where: { sourceType: 'EXPENSE', sourceId: expense.id, status: 'PENDING' },
      });
      expect(beforeRows.length).toBe(1);

      // 3. Update the pay schedule (e.g., change type from BIWEEKLY to WEEKLY)
      const res = await put(`/pay-schedules/${schedule.id}`, {
        name: 'Changed Schedule',
        type: 'WEEKLY',
        anchorDate: '2026-06-01',
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.name).toBe('Changed Schedule');
      expect(body.type).toBe('WEEKLY');

      // 4. Verify the schedule was updated in DB
      const dbSchedule = await prisma.paySchedule.findUnique({ where: { id: schedule.id } });
      expect(dbSchedule).toBeTruthy();
      expect(dbSchedule!.name).toBe('Changed Schedule');
      expect(dbSchedule!.type).toBe('WEEKLY');
    });
  });

  describe('404 handling', () => {
    it('GET /pay-schedules/:id returns 404 for non-existent schedule', async () => {
      const res = await get('/pay-schedules/clxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });

    it('PUT /pay-schedules/:id returns 404 for non-existent schedule', async () => {
      const res = await put('/pay-schedules/clxxxxxxxxxxxxxxxxxxxxxxxxx', { name: 'Nope' });
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });

    it('DELETE /pay-schedules/:id returns 404 for non-existent schedule', async () => {
      const res = await del('/pay-schedules/clxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });

    it('POST /pay-schedules/:id/generate returns 404 for non-existent schedule', async () => {
      const res = await post('/pay-schedules/clxxxxxxxxxxxxxxxxxxxxxxxxx/generate', {
        rangeStart: '2026-01-01',
        rangeEnd: '2026-12-31',
      });
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('not found');
    });
  });
});
