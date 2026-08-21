import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { accountsApi } from './accounts.js';

describe('accountsApi', () => {
  const mockAccount = {
    id: 'clx1234',
    name: 'Checking',
    type: 'CHECKING',
    balance: 1500,
    openingBalance: 0,
    archived: false,
    hasRewards: false,
    parentAccountId: null,
    earnsInterest: false,
    interestRate: 0,
    interestRateType: 'APY',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('list — calls GET /api/v1/accounts', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify([mockAccount]), { status: 200 }));
    const result = await accountsApi.list();
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/accounts',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('clx1234');
  });

  it('create — calls POST /api/v1/accounts with body', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockAccount), { status: 201 }));
    const body = { name: 'Checking', type: 'CHECKING', balance: 1500 };
    const result = await accountsApi.create(body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/accounts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
    expect(result.name).toBe('Checking');
  });

  it('update — calls PUT /api/v1/accounts/:id with body', async () => {
    const updated = { ...mockAccount, name: 'Savings' };
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }));
    const body = { name: 'Savings' };
    const result = await accountsApi.update('clx1234', body);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/accounts/clx1234',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    );
    expect(result.name).toBe('Savings');
  });

  it('delete — calls DELETE /api/v1/accounts/:id', async () => {
    (fetch as Mock).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await accountsApi.delete('clx1234');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/accounts/clx1234',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('archive — calls POST /api/v1/accounts/:id/archive', async () => {
    const archived = { ...mockAccount, archived: true };
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(archived), { status: 200 }));
    const result = await accountsApi.archive('clx1234');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/accounts/clx1234/archive',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    expect(result.archived).toBe(true);
  });

  it('unarchive — calls POST /api/v1/accounts/:id/unarchive', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify(mockAccount), { status: 200 }));
    const result = await accountsApi.unarchive('clx1234');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/accounts/clx1234/unarchive',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    expect(result.archived).toBe(false);
  });

  it('transactionCount — calls GET /api/v1/accounts/:id/transaction-count', async () => {
    (fetch as Mock).mockResolvedValue(new Response(JSON.stringify({ count: 42 }), { status: 200 }));
    const result = await accountsApi.transactionCount('clx1234');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/accounts/clx1234/transaction-count',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result.count).toBe(42);
  });
});
