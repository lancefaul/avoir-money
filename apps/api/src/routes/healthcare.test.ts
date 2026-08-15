import { describe, it, expect } from 'vitest';
import {
  get,
  post,
  put,
  patch,
  createAccount,
  createBudgetGroup,
  createTransaction,
} from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';

describe('Healthcare API', () => {
  const validPolicy = {
    type: 'MEDICAL' as const,
    year: 2026,
    employer: 'Acme',
    premium: 5000,
    deductibleLimit: 4000,
    oopmLimit: 7000,
    metadata: { insurer: 'Aetna', policyId: 'POL-001', groupNumber: 'GRP-001' },
  };

  // ─── POST /policies (create) ───

  it('creates a healthcare policy', async () => {
    const res = await post('/healthcare/policies', validPolicy);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.year).toBe(2026);
    expect(body.employer).toBe('Acme');
    expect(body.type).toBe('MEDICAL');
  });

  it('allows multiple active policies of same type (no auto-freeze)', async () => {
    const first = await post('/healthcare/policies', validPolicy);
    const firstBody = (await first.json()) as any;

    const second = await post('/healthcare/policies', { ...validPolicy, employer: 'Globex' });
    expect(second.status).toBe(201);

    // First policy should still be ACTIVE
    const refetch = await get(`/healthcare/policies/${firstBody.id}`);
    const refetchBody = (await refetch.json()) as any;
    expect(refetchBody.status).toBe('ACTIVE');
  });

  // ─── GET /policies ───

  it('lists healthcare policies by year', async () => {
    await post('/healthcare/policies', validPolicy);
    await post('/healthcare/policies', { ...validPolicy, year: 2025 });
    const res = await get('/healthcare/policies?year=2026');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.every((p: any) => p.year === 2026)).toBe(true);
  });

  it('gets policy by id', async () => {
    const createRes = await post('/healthcare/policies', validPolicy);
    const created = (await createRes.json()) as any;
    const res = await get(`/healthcare/policies/${created.id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).employer).toBe('Acme');
  });

  it('returns 404 for missing policy', async () => {
    expect((await get('/healthcare/policies/nonexistent-id')).status).toBe(404);
  });

  // ─── GET /years ───

  it('lists distinct years with policies', async () => {
    await post('/healthcare/policies', validPolicy);
    await post('/healthcare/policies', { ...validPolicy, year: 2025 });
    const res = await get('/healthcare/years');
    expect(res.status).toBe(200);
    const years = (await res.json()) as number[];
    expect(years).toContain(2026);
    expect(years).toContain(2025);
  });

  // ─── PUT /policies/:id (update — Requirement 8.6) ───

  describe('PUT /policies/:id', () => {
    it('updates policy with new deductible tracking data and returns 200', async () => {
      const createRes = await post('/healthcare/policies', validPolicy);
      const created = (await createRes.json()) as any;

      const res = await put(`/healthcare/policies/${created.id}`, {
        employer: 'Globex',
        premium: 6000,
        deductibleLimit: 5000,
        oopmLimit: 9000,
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as any;
      expect(body.employer).toBe('Globex');
      expect(body.premium).toBe(6000);
      expect(body.balance.deductibleLimit).toBe(5000);
      expect(body.balance.oopmLimit).toBe(9000);

      // Verify DB state
      const dbRecord = await prisma.insurancePolicy.findUnique({ where: { id: created.id } });
      expect(dbRecord).toBeTruthy();
      expect(dbRecord!.employer).toBe('Globex');
      expect(dbRecord!.premium.toNumber()).toBe(6000);
      expect(dbRecord!.deductibleLimit!.toNumber()).toBe(5000);
      expect(dbRecord!.oopmLimit!.toNumber()).toBe(9000);
    });

    it('returns 404 for nonexistent policy', async () => {
      const res = await put('/healthcare/policies/nonexistent-id', { employer: 'X' });
      expect(res.status).toBe(404);
    });

    it('returns 403 when modifying a closed policy', async () => {
      // Create policy, end coverage, then close it
      const first = await post('/healthcare/policies', validPolicy);
      const firstBody = (await first.json()) as any;
      await post(`/healthcare/policies/${firstBody.id}/end-coverage`, {});
      await post(`/healthcare/policies/${firstBody.id}/close`, {});

      // Try to update the closed policy
      const res = await put(`/healthcare/policies/${firstBody.id}`, {
        employer: 'NewEmployer',
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.error).toContain('closed');
    });

    it('allows updating an ended policy', async () => {
      const first = await post('/healthcare/policies', validPolicy);
      const firstBody = (await first.json()) as any;
      await post(`/healthcare/policies/${firstBody.id}/end-coverage`, {});

      // Updating employer on ended policy should work
      const res = await put(`/healthcare/policies/${firstBody.id}`, {
        employer: 'NewEmployer',
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).employer).toBe('NewEmployer');
    });

    it('returns 400 when OOPM limit is less than deductible limit', async () => {
      const createRes = await post('/healthcare/policies', validPolicy);
      const created = (await createRes.json()) as any;

      const res = await put(`/healthcare/policies/${created.id}`, {
        deductibleLimit: 8000,
        oopmLimit: 3000,
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toContain('OOPM');
    });

    it('updates metadata on a policy', async () => {
      const createRes = await post('/healthcare/policies', validPolicy);
      const created = (await createRes.json()) as any;

      const res = await put(`/healthcare/policies/${created.id}`, {
        metadata: { insurer: 'UnitedHealth', policyId: 'POL-002' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.metadata.insurer).toBe('UnitedHealth');
    });
  });

  // ─── PATCH /policies/:id/overrides ───

  describe('PATCH /policies/:id/overrides', () => {
    it('toggles deductible override and returns updated policy', async () => {
      const createRes = await post('/healthcare/policies', validPolicy);
      const created = (await createRes.json()) as any;

      const res = await patch(`/healthcare/policies/${created.id}/overrides`, {
        deductibleOverride: true,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.deductibleOverride).toBe(true);
    });

    it('returns 404 for nonexistent policy', async () => {
      const res = await patch('/healthcare/policies/nonexistent-id/overrides', {
        deductibleOverride: true,
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── GET /policies/:id/transactions (healthcare claims — Requirement 8.7) ───

  describe('GET /policies/:id/transactions', () => {
    it('returns healthcare transactions for a policy with matching budget expenses', async () => {
      // 1. Create a MEDICAL policy (this auto-creates a per-policy budget)
      const createRes = await post('/healthcare/policies', validPolicy);
      const policy = (await createRes.json()) as any;

      // 2. Create an account and a transaction linked to the per-policy budget
      const account = await createAccount();
      await createTransaction(account.id, {
        type: 'EXPENSE',
        budgetId: policy.budgetId,
        amount: 250,
        date: new Date(Date.UTC(2026, 3, 15)),
        name: 'Doctor visit copay',
      });

      // 3. Fetch transactions for the policy
      const res = await get(`/healthcare/policies/${policy.id}/transactions`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any[];
      expect(body.length).toBe(1);
      expect(body[0].name).toBe('Doctor visit copay');
      expect(body[0].amount).toBe(250);
    });

    it('returns empty array when no transactions exist', async () => {
      const createRes = await post('/healthcare/policies', {
        ...validPolicy,
        type: 'DENTAL',
      });
      const policy = (await createRes.json()) as any;

      const res = await get(`/healthcare/policies/${policy.id}/transactions`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it('returns 404 for nonexistent policy', async () => {
      const res = await get('/healthcare/policies/nonexistent-id/transactions');
      expect(res.status).toBe(404);
    });

    it('only returns transactions within the policy year', async () => {
      const createRes = await post('/healthcare/policies', validPolicy);
      const policy = (await createRes.json()) as any;

      const account = await createAccount();

      // Transaction in 2026 (policy year) — should be included
      await createTransaction(account.id, {
        type: 'EXPENSE',
        budgetId: policy.budgetId,
        amount: 100,
        date: new Date(Date.UTC(2026, 6, 1)),
        name: 'In-year claim',
      });

      // Transaction in 2025 (outside policy year) — should be excluded
      await createTransaction(account.id, {
        type: 'EXPENSE',
        budgetId: policy.budgetId,
        amount: 200,
        date: new Date(Date.UTC(2025, 6, 1)),
        name: 'Out-of-year claim',
      });

      const res = await get(`/healthcare/policies/${policy.id}/transactions`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any[];
      expect(body.length).toBe(1);
      expect(body[0].name).toBe('In-year claim');
    });

    it('deductible progress reflects transaction spending', async () => {
      // Create policy first (this creates its own budget)
      const createRes = await post('/healthcare/policies', validPolicy);
      const policy = (await createRes.json()) as any;

      const account = await createAccount();
      await createTransaction(account.id, {
        type: 'EXPENSE',
        budgetId: policy.budgetId,
        amount: 1500,
        date: new Date(Date.UTC(2026, 1, 10)),
        name: 'Surgery copay',
      });
      await createTransaction(account.id, {
        type: 'EXPENSE',
        budgetId: policy.budgetId,
        amount: 500,
        date: new Date(Date.UTC(2026, 2, 5)),
        name: 'Lab work',
      });

      // Re-fetch policy to get updated balance
      const getRes = await get(`/healthcare/policies/${policy.id}`);
      const refreshed = (await getRes.json()) as any;

      // The policy balance should reflect the sum of healthcare transactions
      expect(refreshed.balance.deductibleRaw).toBe(2000);
      // Capped at deductible limit of 4000
      expect(refreshed.balance.deductibleSpent).toBe(2000);
      expect(refreshed.balance.oopmRaw).toBe(2000);
      expect(refreshed.balance.oopmSpent).toBe(2000);
    });
  });
});
