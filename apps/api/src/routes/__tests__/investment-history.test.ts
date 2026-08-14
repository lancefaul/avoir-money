/**
 * Integration tests for GET /investments/history endpoint.
 * Tests the full request cycle against the test database.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { get } from '../../test/helpers.js';

// ─── Helpers ───

let counter = 0;
function uid(prefix = '') {
  return `${prefix}${++counter}_${Date.now()}`;
}

/** Create an Account (required FK for Transaction). */
async function createAccount() {
  return prisma.account.create({ data: { name: uid('ACCT_'), type: 'Checking' } });
}

/** Create a trade Transaction with tradeMetadata. */
async function createTrade(
  accountId: string,
  overrides: {
    date?: Date;
    amount?: number;
    direction?: 'BUY' | 'SELL';
    assetType?: 'Stock' | 'Bitcoin';
    ticker?: string | null;
    quantity?: number;
    unitPrice?: number;
  } = {},
) {
  const {
    date = new Date('2025-06-01T00:00:00.000Z'),
    amount = 1000,
    direction = 'BUY',
    assetType = 'Stock',
    ticker = 'AAPL',
    quantity = 10,
    unitPrice = 100,
  } = overrides;

  return prisma.transaction.create({
    data: {
      type: 'TRADE',
      name: `${direction} ${quantity} ${ticker ?? 'BTC'}`,
      amount,
      date,
      accountId,
      tradeDetail: { create: { direction, assetType, ticker, quantity, unitPrice } },
    },
  });
}

/** Create a Wallet. */
async function createWallet(name?: string) {
  return prisma.wallet.create({ data: { name: name ?? uid('WALLET_') } });
}

/** Create an InvestmentHolding linked to a wallet. */
async function createHolding(
  walletId: string,
  overrides: {
    type?: 'BITCOIN' | 'STOCK';
    ticker?: string | null;
  } = {},
) {
  const { type = 'BITCOIN', ticker = null } = overrides;
  return prisma.investmentHolding.create({
    data: {
      name: uid('HOLD_'),
      type,
      ticker,
      quantity: 1,
      walletId,
    },
  });
}

/** Create an InvestmentTransfer between two holdings. */
async function createTransfer(
  fromHoldingId: string,
  toHoldingId: string,
  overrides: {
    type?: string;
    quantity?: number;
    ticker?: string | null;
    feeAmount?: number | null;
    feeBtc?: number | null;
    createdAt?: Date;
  } = {},
) {
  const {
    type = 'BITCOIN',
    quantity = 0.5,
    ticker = null,
    feeAmount = null,
    feeBtc = null,
    createdAt = new Date('2025-06-02T00:00:00.000Z'),
  } = overrides;

  return prisma.investmentTransfer.create({
    data: {
      type,
      fromHoldingId,
      toHoldingId,
      quantity,
      ticker,
      feeAmount,
      feeBtc,
      createdAt,
    },
  });
}

// ─── Tests ───

describe('GET /investments/history', () => {
  it('returns empty array when no data exists', async () => {
    const res = await get('/investments/history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: unknown[];
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(body.entries).toEqual([]);
    expect(body.nextCursor).toBeNull();
    expect(body.hasMore).toBe(false);
  });

  it('returns trades and transfers merged by date descending', async () => {
    const account = await createAccount();
    const walletA = await createWallet('WalletA');
    const walletB = await createWallet('WalletB');
    const holdingA = await createHolding(walletA.id);
    const holdingB = await createHolding(walletB.id);

    // Trade on June 1
    await createTrade(account.id, { date: new Date('2025-06-01T00:00:00.000Z') });
    // Transfer on June 3
    await createTransfer(holdingA.id, holdingB.id, {
      createdAt: new Date('2025-06-03T00:00:00.000Z'),
    });
    // Trade on June 5
    await createTrade(account.id, { date: new Date('2025-06-05T00:00:00.000Z') });

    const res = await get('/investments/history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ entryType: string; date: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };

    expect(body.entries).toHaveLength(3);
    // Verify descending date order
    const dates = body.entries.map((e) => new Date(e.date).getTime());
    for (let i = 0; i < dates.length - 1; i++) {
      expect(dates[i]!).toBeGreaterThanOrEqual(dates[i + 1]!);
    }
    // First entry should be the June 5 trade, second the June 3 transfer
    expect(body.entries[0]!.entryType).toBe('TRADE');
    expect(body.entries[1]!.entryType).toBe('TRANSFER');
    expect(body.entries[2]!.entryType).toBe('TRADE');
  });

  it('?type=TRADE returns only trade entries', async () => {
    const account = await createAccount();
    const walletA = await createWallet();
    const walletB = await createWallet();
    const holdingA = await createHolding(walletA.id);
    const holdingB = await createHolding(walletB.id);

    await createTrade(account.id);
    await createTransfer(holdingA.id, holdingB.id);

    const res = await get('/investments/history?type=TRADE');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ entryType: string }> };

    expect(body.entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of body.entries) {
      expect(entry.entryType).toBe('TRADE');
    }
  });

  it('?type=TRANSFER returns only transfer entries', async () => {
    const account = await createAccount();
    const walletA = await createWallet();
    const walletB = await createWallet();
    const holdingA = await createHolding(walletA.id);
    const holdingB = await createHolding(walletB.id);

    await createTrade(account.id);
    await createTransfer(holdingA.id, holdingB.id);

    const res = await get('/investments/history?type=TRANSFER');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ entryType: string }> };

    expect(body.entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of body.entries) {
      expect(entry.entryType).toBe('TRANSFER');
    }
  });

  it('?limit=N returns at most N entries', async () => {
    const account = await createAccount();

    // Create 5 trades with distinct dates
    for (let i = 0; i < 5; i++) {
      await createTrade(account.id, {
        date: new Date(`2025-06-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`),
      });
    }

    const res = await get('/investments/history?limit=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: unknown[];
      hasMore: boolean;
      nextCursor: string | null;
    };

    expect(body.entries).toHaveLength(3);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).not.toBeNull();
  });

  it('cursor-based pagination returns correct pages', async () => {
    const account = await createAccount();

    // Create 5 trades with distinct dates
    for (let i = 0; i < 5; i++) {
      await createTrade(account.id, {
        date: new Date(`2025-06-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`),
      });
    }

    // Page 1: limit=2
    const res1 = await get('/investments/history?limit=2');
    expect(res1.status).toBe(200);
    const page1 = (await res1.json()) as {
      entries: Array<{ id: string; date: string }>;
      nextCursor: string;
      hasMore: boolean;
    };
    expect(page1.entries).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    // Page 2: use cursor from page 1
    const res2 = await get(`/investments/history?limit=2&cursor=${page1.nextCursor}`);
    expect(res2.status).toBe(200);
    const page2 = (await res2.json()) as {
      entries: Array<{ id: string; date: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(page2.entries).toHaveLength(2);
    expect(page2.hasMore).toBe(true);

    // Page 3: last page
    const res3 = await get(`/investments/history?limit=2&cursor=${page2.nextCursor}`);
    expect(res3.status).toBe(200);
    const page3 = (await res3.json()) as {
      entries: Array<{ id: string; date: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(page3.entries).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeNull();

    // All IDs should be unique across pages
    const allIds = [...page1.entries, ...page2.entries, ...page3.entries].map((e) => e.id);
    expect(new Set(allIds).size).toBe(5);

    // All dates should be in descending order across pages
    const allDates = [...page1.entries, ...page2.entries, ...page3.entries].map((e) =>
      new Date(e.date).getTime(),
    );
    for (let i = 0; i < allDates.length - 1; i++) {
      expect(allDates[i]!).toBeGreaterThanOrEqual(allDates[i + 1]!);
    }
  });

  it('invalid cursor returns 400', async () => {
    const res = await get('/investments/history?cursor=not-valid-base64');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/cursor/i);
  });
});
