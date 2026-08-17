import { describe, it, expect } from 'vitest';
import { get, post, put, del } from '../test/helpers.js';

describe('Goals API', () => {
  describe('CRUD', () => {
    it('creates a goal', async () => {
      const res = await post('/goals', {
        name: 'Emergency Fund',
        type: 'SAVINGS',
        targetAmount: 10000,
      });
      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.name).toBe('Emergency Fund');
      expect(body.targetAmount).toBe(10000);
      expect(body.currentAmount).toBe(0);
    });

    it('lists goals', async () => {
      await post('/goals', { name: 'A', type: 'SAVINGS', targetAmount: 1000 });
      await post('/goals', { name: 'B', type: 'DEBT_PAYOFF', targetAmount: 5000 });
      const res = await get('/goals');
      expect(((await res.json()) as any).length).toBe(2);
    });

    it('updates a goal', async () => {
      const create = await post('/goals', { name: 'Old', type: 'SAVINGS', targetAmount: 1000 });
      const { id } = (await create.json()) as any;
      const res = await put(`/goals/${id}`, { currentAmount: 500 });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).currentAmount).toBe(500);
    });

    it('deletes a goal', async () => {
      const create = await post('/goals', { name: 'Del', type: 'SAVINGS', targetAmount: 1000 });
      const { id } = (await create.json()) as any;
      expect((await del(`/goals/${id}`)).status).toBe(204);
    });
  });
});
