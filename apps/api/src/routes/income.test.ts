import { describe, it, expect } from 'vitest';
import { get, post, put, del, createGroup, createCategory } from '../test/helpers.js';

describe('Income API', () => {
  async function setup() {
    const group = await createGroup();
    const cat = await createCategory(group.id, 'Paycheck');
    return cat;
  }

  describe('CRUD', () => {
    it('creates income', async () => {
      const cat = await setup();
      const res = await post('/income', {
        name: 'Paycheck',
        amount: 5000,
        frequency: 'BIWEEKLY',
        budgetId: cat.id,
      });
      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.name).toBe('Paycheck');
      expect(body.amount).toBe(5000);
      expect(body.frequency).toBe('BIWEEKLY');
    });

    it('lists income', async () => {
      const cat = await setup();
      await post('/income', { name: 'A', amount: 100, frequency: 'MONTHLY', budgetId: cat.id });
      await post('/income', { name: 'B', amount: 200, frequency: 'ANNUAL', budgetId: cat.id });
      const res = await get('/income');
      expect(((await res.json()) as any).length).toBe(2);
    });

    it('gets by id', async () => {
      const cat = await setup();
      const create = await post('/income', {
        name: 'Test',
        amount: 100,
        frequency: 'MONTHLY',
        budgetId: cat.id,
      });
      const { id } = (await create.json()) as any;
      const res = await get(`/income/${id}`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).name).toBe('Test');
    });

    it('updates income', async () => {
      const cat = await setup();
      const create = await post('/income', {
        name: 'Old',
        amount: 100,
        frequency: 'MONTHLY',
        budgetId: cat.id,
      });
      const { id } = (await create.json()) as any;
      const res = await put(`/income/${id}`, { name: 'Updated', amount: 200 });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.name).toBe('Updated');
      expect(body.amount).toBe(200);
    });

    it('deletes income', async () => {
      const cat = await setup();
      const create = await post('/income', {
        name: 'Del',
        amount: 100,
        frequency: 'MONTHLY',
        budgetId: cat.id,
      });
      const { id } = (await create.json()) as any;
      const res = await del(`/income/${id}`);
      expect(res.status).toBe(204);
      expect((await get(`/income/${id}`)).status).toBe(404);
    });
  });

  describe('filtering', () => {
    it('filters by frequency', async () => {
      const cat = await setup();
      await post('/income', { name: 'A', amount: 100, frequency: 'MONTHLY', budgetId: cat.id });
      await post('/income', { name: 'B', amount: 200, frequency: 'ANNUAL', budgetId: cat.id });
      const res = await get('/income?frequency=MONTHLY');
      const body: any = await res.json();
      expect(body.length).toBe(1);
      expect(body[0].name).toBe('A');
    });
  });

  describe('error handling', () => {
    it('returns 404 for missing id', async () => {
      expect((await get('/income/nonexistent')).status).toBe(404);
    });
    it('returns 404 on update missing id', async () => {
      expect((await put('/income/nonexistent', { name: 'X' })).status).toBe(404);
    });
    it('returns 404 on delete missing id', async () => {
      expect((await del('/income/nonexistent')).status).toBe(404);
    });
  });
});
