import { describe, it, expect } from 'vitest';
import { post, put, createGroup, createCategory } from '../test/helpers.js';

describe('Expenses API — ongoing (no endDate)', () => {
  async function setup() {
    const group = await createGroup();
    const cat = await createCategory(group.id);
    return { cat };
  }

  it('creates an ongoing expense with no endDate', async () => {
    const { cat } = await setup();
    const res = await post('/expenses', {
      name: 'Ongoing Rent',
      amount: 1200,
      frequency: 'MONTHLY',
      budgetId: cat.id,
      isAutomatic: false,
    });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.endDate).toBeNull();
  });

  it('creates an ongoing expense with explicit null endDate', async () => {
    const { cat } = await setup();
    const res = await post('/expenses', {
      name: 'Ongoing Insurance',
      amount: 300,
      frequency: 'MONTHLY',
      budgetId: cat.id,
      isAutomatic: true,
      endDate: null,
    });
    expect(res.status).toBe(201);
    const body2: any = await res.json();
    expect(body2.endDate).toBeNull();
  });

  it('creates an expense with a specific endDate', async () => {
    const { cat } = await setup();
    const res = await post('/expenses', {
      name: 'Temp Subscription',
      amount: 15,
      frequency: 'MONTHLY',
      budgetId: cat.id,
      endDate: '2027-12-31',
    });
    expect(res.status).toBe(201);
    const body3: any = await res.json();
    expect(body3.endDate).not.toBeNull();
  });

  it('updates an expense to remove endDate (make ongoing)', async () => {
    const { cat } = await setup();
    const createRes = await post('/expenses', {
      name: 'Limited Sub',
      amount: 20,
      frequency: 'MONTHLY',
      budgetId: cat.id,
      endDate: '2027-06-30',
    });
    const { id } = (await createRes.json()) as any;

    const updateRes = await put(`/expenses/${id}`, { endDate: null });
    expect(updateRes.status).toBe(200);
    const updated: any = await updateRes.json();
    expect(updated.endDate).toBeNull();
  });

  it('updates an expense to set an endDate (stop ongoing)', async () => {
    const { cat } = await setup();
    const createRes = await post('/expenses', {
      name: 'Ongoing Gym',
      amount: 50,
      frequency: 'MONTHLY',
      budgetId: cat.id,
    });
    const { id } = (await createRes.json()) as any;

    const updateRes = await put(`/expenses/${id}`, { endDate: '2028-01-01' });
    expect(updateRes.status).toBe(200);
    const updated2: any = await updateRes.json();
    expect(updated2.endDate).not.toBeNull();
  });
});
