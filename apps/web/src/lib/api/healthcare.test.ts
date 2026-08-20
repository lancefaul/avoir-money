import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { healthcareApi } from './healthcare.js';

describe('healthcareApi', () => {
  const mockBalance = {
    deductibleSpent: 500,
    deductibleRaw: 500,
    deductibleLimit: 3000,
    oopmSpent: 800,
    oopmRaw: 800,
    oopmLimit: 7000,
    deductibleOverride: false,
    oopmOverride: false,
  };

  const mockPolicy = {
    id: 'clx_policy1',
    type: 'MEDICAL',
    year: 2024,
    employer: 'Acme Corp',
    premium: 250,
    deductibleLimit: 3000,
    oopmLimit: 7000,
    status: 'ACTIVE',
    endedOn: null,
    closedOn: null,
    deductibleOverride: false,
    oopmOverride: false,
    metadata: {
      insurer: 'Blue Cross',
      policyId: 'BC-12345',
      groupNumber: 'GRP-001',
    },
    budgetId: 'bud_1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    balance: mockBalance,
  };

  const mockTransaction = {
    id: 'clx_tx1',
    date: '2024-03-15T00:00:00.000Z',
    name: 'Dr. Smith Visit',
    category: 'Office Visit',
    categoryIcon: '🏥',
    paymentMethod: 'Chase Visa',
    amount: 150,
  };

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('years — calls GET /api/v1/healthcare/years', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify([2024, 2023]), { status: 200 }));
    const result = await healthcareApi.years();
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/healthcare/years',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result).toEqual([2024, 2023]);
  });

  it('policies — calls GET /api/v1/healthcare/policies?year=2024', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify([mockPolicy]), { status: 200 }));
    const result = await healthcareApi.policies(2024);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/healthcare/policies?year=2024',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('clx_policy1');
  });

  it('getPolicy — calls GET /api/v1/healthcare/policies/:id', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockPolicy), { status: 200 }));
    const result = await healthcareApi.getPolicy('clx_policy1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/healthcare/policies/clx_policy1',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result.id).toBe('clx_policy1');
    expect(result.type).toBe('MEDICAL');
  });

  it('createPolicy — calls POST /api/v1/healthcare/policies with body', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockPolicy), { status: 201 }));
    const body = {
      type: 'MEDICAL',
      year: 2024,
      employer: 'Acme Corp',
      premium: 250,
      deductibleLimit: 3000,
      oopmLimit: 7000,
      metadata: { insurer: 'Blue Cross', policyId: 'BC-12345', groupNumber: 'GRP-001' },
    };
    const result = await healthcareApi.createPolicy(body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/healthcare/policies',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
    expect(result.employer).toBe('Acme Corp');
  });

  it('updatePolicy — calls PUT /api/v1/healthcare/policies/:id with body', async () => {
    const updated = { ...mockPolicy, premium: 300 };
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }));
    const body = { premium: 300 };
    const result = await healthcareApi.updatePolicy('clx_policy1', body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/healthcare/policies/clx_policy1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    );
    expect(result.premium).toBe(300);
  });

  it('updatePolicy — handles secondaryInsurance metadata update', async () => {
    const updatedMeta = {
      ...mockPolicy,
      metadata: { ...mockPolicy.metadata, secondaryInsuranceDate: '2024-06-01' },
    };
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(updatedMeta), { status: 200 }));
    const body = { metadata: { ...mockPolicy.metadata, secondaryInsuranceDate: '2024-06-01' } };
    const result = await healthcareApi.updatePolicy('clx_policy1', body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/healthcare/policies/clx_policy1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    );
    expect(result.metadata).toHaveProperty('secondaryInsuranceDate', '2024-06-01');
  });

  it('updateOverrides — calls PATCH /api/v1/healthcare/policies/:id/overrides', async () => {
    const overridden = { ...mockPolicy, deductibleOverride: true };
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(overridden), { status: 200 }));
    const body = { deductibleOverride: true };
    const result = await healthcareApi.updateOverrides('clx_policy1', body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/healthcare/policies/clx_policy1/overrides',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    );
    expect(result.deductibleOverride).toBe(true);
  });

  it('transactions — calls GET /api/v1/healthcare/policies/:id/transactions', async () => {
    (fetch as Mock).mockResolvedValue(
      new Response(JSON.stringify([mockTransaction]), { status: 200 }),
    );
    const result = await healthcareApi.transactions('clx_policy1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/healthcare/policies/clx_policy1/transactions',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('Dr. Smith Visit');
    expect(result[0]!.amount).toBe(150);
  });
});
