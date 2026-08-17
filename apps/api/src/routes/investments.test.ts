import { describe, it, expect } from 'vitest';
import {
  get,
  post,
  put,
  del,
  createAccount,
  createWallet,
  createCustodian,
  createHolding,
} from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';

describe('Holdings API', () => {
  describe('POST / - create holding', () => {
    it('creates a stock holding with valid custodianId', async () => {
      const custodian = await prisma.custodian.create({ data: { name: 'Fidelity' } });
      const res = await post('/investments', {
        name: 'Apple Inc',
        ticker: 'AAPL',
        type: 'STOCK',
        quantity: 10,
        costBasis: 1500,
        custodianId: custodian.id,
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.name).toBe('Apple Inc');
      expect(body.custodianId).toBe(custodian.id);
      expect(body.custodianName).toBe('Fidelity');
      expect(body.walletId).toBeNull();
    });

    it('creates a bitcoin holding with valid walletId', async () => {
      const wallet = await prisma.wallet.create({ data: { name: 'Hardware Wallet' } });
      const res = await post('/investments', {
        name: 'Bitcoin',
        type: 'BITCOIN',
        quantity: 0.5,
        walletId: wallet.id,
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.name).toBe('Bitcoin');
      expect(body.walletId).toBe(wallet.id);
      expect(body.walletName).toBe('Hardware Wallet');
      expect(body.custodianId).toBeNull();
    });

    it('returns 400 for non-existent custodianId', async () => {
      const res = await post('/investments', {
        name: 'Apple Inc',
        ticker: 'AAPL',
        type: 'STOCK',
        quantity: 10,
        custodianId: 'nonexistent-id',
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Custodian not found');
    });

    it('returns 400 for non-existent walletId', async () => {
      const res = await post('/investments', {
        name: 'Bitcoin',
        type: 'BITCOIN',
        quantity: 1,
        walletId: 'nonexistent-id',
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Wallet not found');
    });
  });

  describe('PUT /:id - update holding', () => {
    it('updates a holding and returns custodian/wallet in response', async () => {
      const custodian = await prisma.custodian.create({ data: { name: 'Schwab' } });
      const createRes = await post('/investments', {
        name: 'MSFT',
        ticker: 'MSFT',
        type: 'STOCK',
        quantity: 5,
        custodianId: custodian.id,
      });
      const { id } = (await createRes.json()) as { id: string };
      const res = await put(`/investments/${id}`, { name: 'Microsoft Corp', quantity: 10 });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.name).toBe('Microsoft Corp');
      expect(body.quantity).toBe(10);
      expect(body.custodianId).toBe(custodian.id);
      expect(body.custodianName).toBe('Schwab');
    });

    it('updates custodianId to a different valid custodian', async () => {
      const c1 = await prisma.custodian.create({ data: { name: 'Fidelity' } });
      const c2 = await prisma.custodian.create({ data: { name: 'Vanguard' } });
      const createRes = await post('/investments', {
        name: 'AAPL',
        type: 'STOCK',
        quantity: 1,
        custodianId: c1.id,
      });
      const { id } = (await createRes.json()) as { id: string };
      const res = await put(`/investments/${id}`, { custodianId: c2.id });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.custodianId).toBe(c2.id);
      expect(body.custodianName).toBe('Vanguard');
    });

    it('returns 400 for non-existent custodianId on update', async () => {
      const custodian = await prisma.custodian.create({ data: { name: 'Fidelity' } });
      const createRes = await post('/investments', {
        name: 'AAPL',
        type: 'STOCK',
        quantity: 1,
        custodianId: custodian.id,
      });
      const { id } = (await createRes.json()) as { id: string };
      const res = await put(`/investments/${id}`, { custodianId: 'nonexistent-id' });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Custodian not found');
    });

    it('returns 400 for non-existent walletId on update', async () => {
      const wallet = await prisma.wallet.create({ data: { name: 'Hardware Wallet' } });
      const createRes = await post('/investments', {
        name: 'BTC',
        type: 'BITCOIN',
        quantity: 1,
        walletId: wallet.id,
      });
      const { id } = (await createRes.json()) as { id: string };
      const res = await put(`/investments/${id}`, { walletId: 'nonexistent-id' });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Wallet not found');
    });

    it('returns 404 for non-existent holding', async () => {
      const res = await put('/investments/nonexistent-id', { name: 'Updated' });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Investment holding not found');
    });
  });
});

describe('Custodians API', () => {
  describe('CRUD', () => {
    it('creates a custodian', async () => {
      const res = await post('/investments/custodians', { name: 'Fidelity' });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; name: string };
      expect(body.name).toBe('Fidelity');
      expect(body.id).toBeDefined();
    });

    it('lists custodians', async () => {
      await post('/investments/custodians', { name: 'Fidelity' });
      await post('/investments/custodians', { name: 'Schwab' });
      const res = await get('/investments/custodians');
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body.length).toBe(2);
    });

    it('updates a custodian', async () => {
      const create = await post('/investments/custodians', { name: 'Old Name' });
      const { id } = (await create.json()) as { id: string };
      const res = await put(`/investments/custodians/${id}`, { name: 'New Name' });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { name: string }).name).toBe('New Name');
    });

    it('deletes a custodian', async () => {
      const create = await post('/investments/custodians', { name: 'ToDelete' });
      const { id } = (await create.json()) as { id: string };
      const res = await del(`/investments/custodians/${id}`);
      expect(res.status).toBe(204);
    });

    it('rejects duplicate custodian name', async () => {
      await post('/investments/custodians', { name: 'Fidelity' });
      const res = await post('/investments/custodians', { name: 'Fidelity' });
      expect(res.status).toBe(409);
    });
  });

  describe('deletion protection', () => {
    it('prevents deleting a custodian referenced by a trade', async () => {
      const custodian = await prisma.custodian.create({ data: { name: 'Referenced' } });
      const account = await createAccount();
      await prisma.transaction.create({
        data: {
          type: 'TRADE',
          name: 'Buy AAPL',
          amount: 1000,
          date: new Date(),
          accountId: account.id,
          tradeDetail: {
            create: {
              direction: 'BUY',
              assetType: 'Stock',
              ticker: 'AAPL',
              unitPrice: 100,
              quantity: 10,
              custodianId: custodian.id,
            },
          },
        },
      });
      const res = await del(`/investments/custodians/${custodian.id}`);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toContain(
        'referenced by existing trades',
      );
    });

    it('prevents deleting a custodian referenced by a holding', async () => {
      const custodian = await prisma.custodian.create({ data: { name: 'HasHoldings' } });
      await prisma.investmentHolding.create({
        data: {
          name: 'AAPL',
          type: 'STOCK',
          quantity: 10,
          custodianId: custodian.id,
        },
      });
      const res = await del(`/investments/custodians/${custodian.id}`);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toContain(
        'referenced by active holdings',
      );
    });
  });
});

describe('Wallets API', () => {
  describe('CRUD', () => {
    it('creates a wallet', async () => {
      const res = await post('/investments/wallets', { name: 'Hardware Wallet' });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; name: string };
      expect(body.name).toBe('Hardware Wallet');
      expect(body.id).toBeDefined();
    });

    it('lists wallets', async () => {
      await post('/investments/wallets', { name: 'Hardware Wallet' });
      await post('/investments/wallets', { name: 'Rewards Wallet' });
      const res = await get('/investments/wallets');
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body.length).toBe(2);
    });

    it('updates a wallet', async () => {
      const create = await post('/investments/wallets', { name: 'Old Wallet' });
      const { id } = (await create.json()) as { id: string };
      const res = await put(`/investments/wallets/${id}`, { name: 'New Wallet' });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { name: string }).name).toBe('New Wallet');
    });

    it('deletes a wallet', async () => {
      const create = await post('/investments/wallets', { name: 'ToDelete' });
      const { id } = (await create.json()) as { id: string };
      const res = await del(`/investments/wallets/${id}`);
      expect(res.status).toBe(204);
    });

    it('rejects duplicate wallet name', async () => {
      await post('/investments/wallets', { name: 'Hardware Wallet' });
      const res = await post('/investments/wallets', { name: 'Hardware Wallet' });
      expect(res.status).toBe(409);
    });
  });

  describe('deletion protection', () => {
    it('prevents deleting a wallet referenced by a trade', async () => {
      const wallet = await prisma.wallet.create({ data: { name: 'Referenced' } });
      const account = await createAccount();
      await prisma.transaction.create({
        data: {
          type: 'TRADE',
          name: 'Buy BTC',
          amount: 5000,
          date: new Date(),
          accountId: account.id,
          tradeDetail: {
            create: {
              direction: 'BUY',
              assetType: 'Bitcoin',
              unitPrice: 65000,
              quantity: 100000,
              bitcoinUnit: 'Sats',
              walletId: wallet.id,
            },
          },
        },
      });
      const res = await del(`/investments/wallets/${wallet.id}`);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toContain(
        'referenced by existing trades',
      );
    });

    it('prevents deleting a wallet referenced by a holding', async () => {
      const wallet = await prisma.wallet.create({ data: { name: 'HasHoldings' } });
      await prisma.investmentHolding.create({
        data: {
          name: 'Bitcoin',
          type: 'BITCOIN',
          quantity: 0.5,
          walletId: wallet.id,
        },
      });
      const res = await del(`/investments/wallets/${wallet.id}`);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toContain(
        'referenced by active holdings',
      );
    });
  });
});

describe('Bitcoin Transfers API', () => {
  it('POST /transfers/bitcoin with valid data — executes transfer in Prisma transaction, response 200', async () => {
    const fromWallet = await createWallet({ name: 'Source Wallet' });
    const toWallet = await createWallet({ name: 'Dest Wallet' });
    await createHolding({
      name: 'Bitcoin',
      type: 'BITCOIN',
      quantity: 2.0,
      costBasis: 100000,
      walletId: fromWallet.id,
    });

    const res = await post('/investments/transfers/bitcoin', {
      fromWalletId: fromWallet.id,
      toWalletId: toWallet.id,
      quantity: 0.5,
      bitcoinUnit: 'Bitcoin',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBeDefined();
    expect(body.fromWalletId).toBe(fromWallet.id);
    expect(body.toWalletId).toBe(toWallet.id);
    expect(body.quantity).toBe(0.5);

    // Verify DB state: source decremented, destination created/incremented
    const sourceHolding = await prisma.investmentHolding.findFirst({
      where: { walletId: fromWallet.id, type: 'BITCOIN' },
    });
    expect(Number(sourceHolding!.quantity)).toBeCloseTo(1.5, 8);

    const destHolding = await prisma.investmentHolding.findFirst({
      where: { walletId: toWallet.id, type: 'BITCOIN' },
    });
    expect(destHolding).toBeTruthy();
    expect(Number(destHolding!.quantity)).toBeCloseTo(0.5, 8);

    // Verify audit record created
    const transfer = await prisma.investmentTransfer.findUnique({
      where: { id: body.id as string },
    });
    expect(transfer).toBeTruthy();
    expect(transfer!.type).toBe('BITCOIN');
  });

  it('POST /transfers/bitcoin with insufficient source balance — returns 400', async () => {
    const fromWallet = await createWallet({ name: 'Low Balance Wallet' });
    const toWallet = await createWallet({ name: 'Dest Wallet' });
    await createHolding({
      name: 'Bitcoin',
      type: 'BITCOIN',
      quantity: 0.1,
      costBasis: 5000,
      walletId: fromWallet.id,
    });

    const res = await post('/investments/transfers/bitcoin', {
      fromWalletId: fromWallet.id,
      toWalletId: toWallet.id,
      quantity: 1.0,
      bitcoinUnit: 'Bitcoin',
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Insufficient balance');
  });
});

describe('Stock Transfers API', () => {
  it('POST /transfers/stock with valid data — executes transfer, response 200', async () => {
    const fromCustodian = await createCustodian({ name: 'Fidelity' });
    const toCustodian = await createCustodian({ name: 'Schwab' });
    const holding = await createHolding({
      name: 'AAPL',
      ticker: 'AAPL',
      type: 'STOCK',
      quantity: 100,
      costBasis: 15000,
      custodianId: fromCustodian.id,
    });

    const res = await post('/investments/transfers/stock', {
      fromCustodianId: fromCustodian.id,
      toCustodianId: toCustodian.id,
      holdingId: holding.id,
      quantity: 50,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBeDefined();
    expect(body.fromCustodianId).toBe(fromCustodian.id);
    expect(body.toCustodianId).toBe(toCustodian.id);
    expect(body.ticker).toBe('AAPL');
    expect(body.quantity).toBe(50);

    // Verify DB state: source decremented
    const sourceHolding = await prisma.investmentHolding.findUnique({
      where: { id: holding.id },
    });
    expect(Number(sourceHolding!.quantity)).toBe(50);

    // Verify destination holding created
    const destHolding = await prisma.investmentHolding.findFirst({
      where: { ticker: 'AAPL', custodianId: toCustodian.id },
    });
    expect(destHolding).toBeTruthy();
    expect(Number(destHolding!.quantity)).toBe(50);

    // Verify audit record
    const transfer = await prisma.investmentTransfer.findUnique({
      where: { id: body.id as string },
    });
    expect(transfer).toBeTruthy();
    expect(transfer!.type).toBe('STOCK');
  });
});

describe('Snapshots API', () => {
  it('POST /:id/snapshot — creates snapshot, response 201', async () => {
    const wallet = await createWallet({ name: 'Snapshot Wallet' });
    const holding = await createHolding({
      name: 'Bitcoin',
      type: 'BITCOIN',
      quantity: 1.5,
      costBasis: 75000,
      walletId: wallet.id,
    });

    const snapshotDate = new Date(Date.UTC(2026, 5, 15)).toISOString();
    const res = await post(`/investments/${holding.id}/snapshot`, {
      date: snapshotDate,
      quantity: 1.5,
      value: 97500,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBeDefined();
    expect(body.holdingId).toBe(holding.id);
    expect(body.quantity).toBe(1.5);
    expect(body.value).toBe(97500);

    // Verify DB state
    const snapshot = await prisma.investmentSnapshot.findUnique({
      where: { id: body.id as string },
    });
    expect(snapshot).toBeTruthy();
    expect(snapshot!.holdingId).toBe(holding.id);
  });

  it('POST /:id/snapshot returns 404 for non-existent holding', async () => {
    const res = await post('/investments/clxxxxxxxxxxxxxxxxxxxxxxxxx/snapshot', {
      date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
      quantity: 1.0,
      value: 50000,
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not found');
  });
});

describe('Investment History API', () => {
  it('GET /history with pagination — returns paginated response with nextCursor and hasMore', async () => {
    // Seed trade transactions for history
    const account = await createAccount();
    const tradeDate1 = new Date(Date.UTC(2026, 5, 10));
    const tradeDate2 = new Date(Date.UTC(2026, 5, 11));
    const tradeDate3 = new Date(Date.UTC(2026, 5, 12));

    // Individual creates (not createMany) so the nested tradeDetail relation can be seeded
    const trades = [
      { name: 'Buy AAPL 1', amount: 1000, date: tradeDate1, quantity: 10 },
      { name: 'Buy AAPL 2', amount: 2000, date: tradeDate2, quantity: 20 },
      { name: 'Buy AAPL 3', amount: 3000, date: tradeDate3, quantity: 30 },
    ];
    for (const t of trades) {
      await prisma.transaction.create({
        data: {
          type: 'TRADE',
          name: t.name,
          amount: t.amount,
          date: t.date,
          accountId: account.id,
          tradeDetail: {
            create: {
              direction: 'BUY',
              assetType: 'Stock',
              ticker: 'AAPL',
              unitPrice: 100,
              quantity: t.quantity,
            },
          },
        },
      });
    }

    // Request with limit=2 to trigger pagination
    const res = await get('/investments/history?limit=2');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: unknown[];
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(body.entries).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBeTruthy();

    // Fetch next page using cursor
    const res2 = await get(`/investments/history?limit=2&cursor=${body.nextCursor}`);
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as {
      entries: unknown[];
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(body2.entries).toHaveLength(1);
    expect(body2.hasMore).toBe(false);
    expect(body2.nextCursor).toBeNull();
  });
});

describe('Holdings 404 handling', () => {
  it('DELETE /investments/:id returns 404 for non-existent holding', async () => {
    const res = await del('/investments/clxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not found');
  });
});

describe('Custodians 404 handling', () => {
  it('PUT /investments/custodians/:id returns 404 for non-existent custodian', async () => {
    const res = await put('/investments/custodians/clxxxxxxxxxxxxxxxxxxxxxxxxx', { name: 'Nope' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not found');
  });

  it('DELETE /investments/custodians/:id returns 404 for non-existent custodian', async () => {
    const res = await del('/investments/custodians/clxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not found');
  });
});

describe('Wallets 404 handling', () => {
  it('PUT /investments/wallets/:id returns 404 for non-existent wallet', async () => {
    const res = await put('/investments/wallets/clxxxxxxxxxxxxxxxxxxxxxxxxx', { name: 'Nope' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not found');
  });

  it('DELETE /investments/wallets/:id returns 404 for non-existent wallet', async () => {
    const res = await del('/investments/wallets/clxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not found');
  });
});

describe('Transfers 404 handling', () => {
  it('DELETE /investments/transfers/:id returns 404 for non-existent transfer', async () => {
    const res = await del('/investments/transfers/clxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not found');
  });
});
