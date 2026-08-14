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

describe('Expenses API', () => {
  async function setup() {
    const group = await createGroup();
    const cat = await createCategory(group.id, 'Housing');
    const acct = await createAccount();
    return { cat, acct };
  }

  describe('CRUD', () => {
    it('creates expense', async () => {
      const { cat, acct } = await setup();
      const res = await post('/expenses', {
        name: 'Mortgage',
        amount: 1099,
        frequency: 'MONTHLY',
        budgetId: cat.id,
        accountId: acct.id,
        isAutomatic: true,
        dueDay: 1,
      });
      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.name).toBe('Mortgage');
      expect(body.isAutomatic).toBe(true);
      expect(body.dueDay).toBe(1);
    });

    it('lists expenses', async () => {
      const { cat } = await setup();
      await post('/expenses', { name: 'A', amount: 100, frequency: 'MONTHLY', budgetId: cat.id });
      await post('/expenses', { name: 'B', amount: 200, frequency: 'WEEKLY', budgetId: cat.id });
      const res = await get('/expenses');
      expect(((await res.json()) as any).length).toBe(2);
    });

    it('updates expense', async () => {
      const { cat } = await setup();
      const create = await post('/expenses', {
        name: 'Old',
        amount: 100,
        frequency: 'MONTHLY',
        budgetId: cat.id,
      });
      const { id } = (await create.json()) as any;
      const res = await put(`/expenses/${id}`, { amount: 999 });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).amount).toBe(999);
    });

    it('deletes expense', async () => {
      const { cat } = await setup();
      const create = await post('/expenses', {
        name: 'Del',
        amount: 50,
        frequency: 'MONTHLY',
        budgetId: cat.id,
      });
      const { id } = (await create.json()) as any;
      expect((await del(`/expenses/${id}`)).status).toBe(204);
      expect((await get(`/expenses/${id}`)).status).toBe(404);
    });
  });

  describe('filtering', () => {
    it('filters by account', async () => {
      const { cat, acct } = await setup();
      await post('/expenses', {
        name: 'With Acct',
        amount: 100,
        frequency: 'MONTHLY',
        budgetId: cat.id,
        accountId: acct.id,
      });
      await post('/expenses', {
        name: 'No Acct',
        amount: 200,
        frequency: 'MONTHLY',
        budgetId: cat.id,
      });
      const res = await get(`/expenses?accountId=${acct.id}`);
      const body: any = await res.json();
      expect(body.length).toBe(1);
      expect(body[0].name).toBe('With Acct');
    });
  });
});
