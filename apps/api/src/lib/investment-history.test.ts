import { describe, it, expect } from 'vitest';
import {
  normalizeTradeEntry,
  normalizeTransferEntry,
  normalizePaymentEntry,
  mergeAndSort,
  decodeCursor,
} from './investment-history.js';
import type { TransferWithNames } from './investment-history.js';
import { get, createAccount, createWallet, createHolding } from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';
import type { HistoryEntry } from '@budget-tracker/core';

interface HistoryResponse {
  entries: HistoryEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ─── Unit tests: normalizePaymentEntry ───

describe('normalizePaymentEntry', () => {
  it('normalizes an EXPENSE bitcoin payment with Sats unit', () => {
    const entry = normalizePaymentEntry({
      id: 'pay-1',
      type: 'EXPENSE',
      date: new Date(Date.UTC(2026, 5, 15)),
      name: 'Coffee',
      amount: 5,
      bitcoinMetadata: {
        walletId: 'w1',
        quantity: 50000,
        bitcoinUnit: 'Sats',
        unitPrice: 100000,
      },
      walletName: 'Hardware Wallet',
    });

    expect(entry.id).toBe('pay-1');
    expect(entry.entryType).toBe('PAYMENT');
    expect(entry.assetType).toBe('BITCOIN');
    expect(entry.ticker).toBeNull();
    expect(entry.quantity).toBeCloseTo(50000 / 100_000_000, 10);
    expect(entry.direction).toBeNull();
    expect(entry.fromName).toBeNull();
    expect(entry.toName).toBeNull();
    expect(entry.amount).toBe(5);
    expect(entry.feeAmount).toBeNull();
    expect(entry.description).toBe('Spent BTC on Hardware Wallet');
  });

  it('normalizes an INCOME bitcoin payment with Payment incomeType', () => {
    const entry = normalizePaymentEntry({
      id: 'pay-2',
      type: 'INCOME',
      date: new Date(Date.UTC(2026, 5, 20)),
      name: 'Mining reward',
      amount: 100,
      bitcoinMetadata: {
        walletId: 'w2',
        quantity: 0.001,
        bitcoinUnit: 'Bitcoin',
        unitPrice: 100000,
        incomeType: 'Payment',
      },
      walletName: 'Ledger',
    });

    expect(entry.entryType).toBe('PAYMENT');
    expect(entry.quantity).toBe(0.001);
    expect(entry.description).toBe('Received BTC on Ledger');
    expect(entry.incomeType).toBe('Payment');
  });

  it('normalizes an INCOME bitcoin payment with Rewards incomeType', () => {
    const entry = normalizePaymentEntry({
      id: 'pay-3',
      type: 'INCOME',
      date: new Date(Date.UTC(2026, 5, 20)),
      name: 'Stacking rewards',
      amount: 50,
      bitcoinMetadata: {
        walletId: 'w3',
        quantity: 100000,
        bitcoinUnit: 'Sats',
        unitPrice: 100000,
        incomeType: 'Rewards',
      },
      walletName: 'Rewards Wallet',
    });

    expect(entry.description).toBe('Earned BTC rewards on Rewards Wallet');
    expect(entry.incomeType).toBe('Rewards');
  });

  it('normalizes a REFUND bitcoin payment', () => {
    const entry = normalizePaymentEntry({
      id: 'pay-4',
      type: 'REFUND',
      date: new Date(Date.UTC(2026, 5, 25)),
      name: 'Refund',
      amount: 10,
      bitcoinMetadata: {
        walletId: 'w1',
        quantity: 25000,
        bitcoinUnit: 'Sats',
        unitPrice: 100000,
      },
      walletName: 'Hardware Wallet',
    });

    expect(entry.description).toBe('Spent BTC on Hardware Wallet');
    expect(entry.incomeType).toBeNull();
  });
});

// ─── Unit tests: decodeCursor error paths ───

describe('decodeCursor', () => {
  it('throws for completely invalid base64', () => {
    expect(() => decodeCursor('not-valid-base64!!!')).toThrow('Invalid cursor');
  });

  it('throws for valid base64 but invalid JSON', () => {
    const encoded = Buffer.from('not json').toString('base64');
    expect(() => decodeCursor(encoded)).toThrow('Invalid cursor');
  });

  it('throws for valid JSON but missing required fields', () => {
    const encoded = Buffer.from(JSON.stringify({ date: '2026-01-01' })).toString('base64');
    expect(() => decodeCursor(encoded)).toThrow('Invalid cursor');
  });

  it('throws for invalid cursor source value', () => {
    const encoded = Buffer.from(
      JSON.stringify({
        date: '2026-01-01T00:00:00.000Z',
        id: 'abc',
        source: 'invalid',
      }),
    ).toString('base64');
    expect(() => decodeCursor(encoded)).toThrow('Invalid cursor');
  });

  it('decodes a valid cursor', () => {
    const payload = { date: '2026-06-15T00:00:00.000Z', id: 'test-id', source: 'trade' };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    const decoded = decodeCursor(encoded);
    expect(decoded.date).toBe('2026-06-15T00:00:00.000Z');
    expect(decoded.id).toBe('test-id');
    expect(decoded.source).toBe('trade');
  });
});

// ─── Unit tests: history entry formatting via normalization ───

describe('formatTradeDescription (via normalizeTradeEntry)', () => {
  it('formats a BUY stock trade description', () => {
    const entry = normalizeTradeEntry({
      id: 't1',
      date: new Date(Date.UTC(2026, 5, 15)),
      amount: 1500,
      tradeMetadata: {
        direction: 'BUY',
        assetType: 'Stock',
        ticker: 'AAPL',
        quantity: 10,
        unitPrice: 150,
      },
    });
    expect(entry.description).toBe('Bought AAPL');
  });

  it('formats a SELL bitcoin trade description using BTC when no ticker', () => {
    const entry = normalizeTradeEntry({
      id: 't2',
      date: new Date(Date.UTC(2026, 5, 15)),
      amount: 5000,
      tradeMetadata: {
        direction: 'SELL',
        assetType: 'Bitcoin',
        quantity: 0.05,
        unitPrice: 100000,
      },
    });
    expect(entry.description).toBe('Sold BTC');
  });
});

describe('formatTransferDescription (via normalizeTransferEntry)', () => {
  it('formats a BITCOIN transfer as "from → to"', () => {
    const entry = normalizeTransferEntry({
      id: 'tr1',
      type: 'BITCOIN',
      createdAt: new Date(Date.UTC(2026, 5, 15)),
      quantity: 0.5,
      ticker: null,
      feeAmount: null,
      feeBtc: 0.0001,
      fromName: 'Hardware Wallet',
      toName: 'Ledger',
    });
    expect(entry.description).toBe('Hardware Wallet → Ledger');
  });

  it('formats a STOCK transfer as "ticker: from → to"', () => {
    const entry = normalizeTransferEntry({
      id: 'tr2',
      type: 'STOCK',
      createdAt: new Date(Date.UTC(2026, 5, 15)),
      quantity: 50,
      ticker: 'AAPL',
      feeAmount: 10,
      feeBtc: null,
      fromName: 'Fidelity',
      toName: 'Schwab',
    });
    expect(entry.description).toBe('AAPL: Fidelity → Schwab');
  });
});

// ─── Unit tests: mergeAndSort with payments ───

describe('mergeAndSort with payments', () => {
  it('merges trades, transfers, and payments sorted by date descending', () => {
    const trade: HistoryEntry = {
      id: 'a',
      entryType: 'TRADE',
      date: new Date(Date.UTC(2026, 5, 10)),
      description: 'Buy AAPL',
      assetType: 'STOCK',
      ticker: 'AAPL',
      quantity: 10,
      direction: 'BUY',
      fromName: null,
      toName: null,
      amount: 1500,
      feeAmount: null,
    };
    const transfer: HistoryEntry = {
      id: 'b',
      entryType: 'TRANSFER',
      date: new Date(Date.UTC(2026, 5, 12)),
      description: 'Hardware Wallet → Ledger',
      assetType: 'BITCOIN',
      ticker: null,
      quantity: 0.5,
      direction: null,
      fromName: 'Hardware Wallet',
      toName: 'Ledger',
      amount: null,
      feeAmount: null,
    };
    const payment: HistoryEntry = {
      id: 'c',
      entryType: 'PAYMENT',
      date: new Date(Date.UTC(2026, 5, 11)),
      description: 'Expense 50,000 sats via Hardware Wallet',
      assetType: 'BITCOIN',
      ticker: null,
      quantity: 0.0005,
      direction: null,
      fromName: null,
      toName: null,
      amount: 5,
      feeAmount: null,
    };

    const result = mergeAndSort([trade], [transfer], 10, undefined, [payment]);
    expect(result.entries).toHaveLength(3);
    // Sorted by date descending: transfer (Jun 12), payment (Jun 11), trade (Jun 10)
    expect(result.entries[0]!.id).toBe('b');
    expect(result.entries[1]!.id).toBe('c');
    expect(result.entries[2]!.id).toBe('a');
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('falls back to date-based filtering when cursor entry is not found', () => {
    const entry1: HistoryEntry = {
      id: 'a',
      entryType: 'TRADE',
      date: new Date(Date.UTC(2026, 5, 15)),
      description: 'Buy AAPL',
      assetType: 'STOCK',
      ticker: 'AAPL',
      quantity: 10,
      direction: 'BUY',
      fromName: null,
      toName: null,
      amount: 1500,
      feeAmount: null,
    };
    const entry2: HistoryEntry = {
      id: 'b',
      entryType: 'TRADE',
      date: new Date(Date.UTC(2026, 5, 10)),
      description: 'Buy MSFT',
      assetType: 'STOCK',
      ticker: 'MSFT',
      quantity: 5,
      direction: 'BUY',
      fromName: null,
      toName: null,
      amount: 750,
      feeAmount: null,
    };
    const entry3: HistoryEntry = {
      id: 'c',
      entryType: 'TRADE',
      date: new Date(Date.UTC(2026, 5, 5)),
      description: 'Buy GOOGL',
      assetType: 'STOCK',
      ticker: 'GOOGL',
      quantity: 2,
      direction: 'BUY',
      fromName: null,
      toName: null,
      amount: 300,
      feeAmount: null,
    };

    // Create a cursor for a non-existent entry with date between entry1 and entry2
    const nonExistentCursor = Buffer.from(
      JSON.stringify({
        date: new Date(Date.UTC(2026, 5, 12)).toISOString(),
        id: 'nonexistent-id',
        source: 'trade',
      }),
    ).toString('base64');

    const result = mergeAndSort([entry1, entry2, entry3], [], 10, nonExistentCursor);

    // Should fall back to date-based filtering: entries with date < cursor date
    // Only entry2 (Jun 10) and entry3 (Jun 5) should be returned
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]!.id).toBe('b'); // Jun 10
    expect(result.entries[1]!.id).toBe('c'); // Jun 5
    expect(result.hasMore).toBe(false);
  });

  it('sorts entries with same date by id descending', () => {
    const entry1: HistoryEntry = {
      id: 'a',
      entryType: 'TRADE',
      date: new Date(Date.UTC(2026, 5, 15)),
      description: 'Buy AAPL',
      assetType: 'STOCK',
      ticker: 'AAPL',
      quantity: 10,
      direction: 'BUY',
      fromName: null,
      toName: null,
      amount: 1500,
      feeAmount: null,
    };
    const entry2: HistoryEntry = {
      id: 'c',
      entryType: 'TRADE',
      date: new Date(Date.UTC(2026, 5, 15)), // Same date as entry1
      description: 'Buy MSFT',
      assetType: 'STOCK',
      ticker: 'MSFT',
      quantity: 5,
      direction: 'BUY',
      fromName: null,
      toName: null,
      amount: 750,
      feeAmount: null,
    };
    const entry3: HistoryEntry = {
      id: 'b',
      entryType: 'TRADE',
      date: new Date(Date.UTC(2026, 5, 15)), // Same date as entry1 and entry2
      description: 'Buy GOOGL',
      assetType: 'STOCK',
      ticker: 'GOOGL',
      quantity: 2,
      direction: 'BUY',
      fromName: null,
      toName: null,
      amount: 300,
      feeAmount: null,
    };

    const result = mergeAndSort([entry1, entry2, entry3], [], 10);

    // All have same date, so should be sorted by id descending: c, b, a
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]!.id).toBe('c');
    expect(result.entries[1]!.id).toBe('b');
    expect(result.entries[2]!.id).toBe('a');
  });

  it('filters by id when cursor date matches entry date in fallback mode', () => {
    const entry1: HistoryEntry = {
      id: 'entry-a',
      entryType: 'TRADE',
      date: new Date(Date.UTC(2026, 5, 15)),
      description: 'Buy AAPL',
      assetType: 'STOCK',
      ticker: 'AAPL',
      quantity: 10,
      direction: 'BUY',
      fromName: null,
      toName: null,
      amount: 1500,
      feeAmount: null,
    };
    const entry2: HistoryEntry = {
      id: 'entry-c',
      entryType: 'TRADE',
      date: new Date(Date.UTC(2026, 5, 15)), // Same date as cursor
      description: 'Buy MSFT',
      assetType: 'STOCK',
      ticker: 'MSFT',
      quantity: 5,
      direction: 'BUY',
      fromName: null,
      toName: null,
      amount: 750,
      feeAmount: null,
    };
    const entry3: HistoryEntry = {
      id: 'entry-e',
      entryType: 'TRADE',
      date: new Date(Date.UTC(2026, 5, 15)), // Same date as cursor
      description: 'Buy GOOGL',
      assetType: 'STOCK',
      ticker: 'GOOGL',
      quantity: 2,
      direction: 'BUY',
      fromName: null,
      toName: null,
      amount: 300,
      feeAmount: null,
    };

    // Create a cursor for a non-existent entry with same date as entries but ID between them
    const nonExistentCursor = Buffer.from(
      JSON.stringify({
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        id: 'entry-d', // ID between entry-c and entry-e
        source: 'trade',
      }),
    ).toString('base64');

    const result = mergeAndSort([entry1, entry2, entry3], [], 10, nonExistentCursor);

    // Should fall back to date-based filtering with ID comparison
    // Only entries with same date AND id < 'entry-d' should be returned: entry-a, entry-c
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]!.id).toBe('entry-c');
    expect(result.entries[1]!.id).toBe('entry-a');
  });

  it('uses cursor index when cursor entry is found in the list', () => {
    const entry1: HistoryEntry = {
      id: 'a',
      entryType: 'TRADE',
      date: new Date(Date.UTC(2026, 5, 15)),
      description: 'Buy AAPL',
      assetType: 'STOCK',
      ticker: 'AAPL',
      quantity: 10,
      direction: 'BUY',
      fromName: null,
      toName: null,
      amount: 1500,
      feeAmount: null,
    };
    const entry2: HistoryEntry = {
      id: 'b',
      entryType: 'TRADE',
      date: new Date(Date.UTC(2026, 5, 10)),
      description: 'Buy MSFT',
      assetType: 'STOCK',
      ticker: 'MSFT',
      quantity: 5,
      direction: 'BUY',
      fromName: null,
      toName: null,
      amount: 750,
      feeAmount: null,
    };
    const entry3: HistoryEntry = {
      id: 'c',
      entryType: 'TRADE',
      date: new Date(Date.UTC(2026, 5, 5)),
      description: 'Buy GOOGL',
      assetType: 'STOCK',
      ticker: 'GOOGL',
      quantity: 2,
      direction: 'BUY',
      fromName: null,
      toName: null,
      amount: 300,
      feeAmount: null,
    };

    // Create a cursor for entry2 which exists in the list
    const existingCursor = Buffer.from(
      JSON.stringify({
        date: new Date(Date.UTC(2026, 5, 10)).toISOString(),
        id: 'b',
        source: 'trade',
      }),
    ).toString('base64');

    const result = mergeAndSort([entry1, entry2, entry3], [], 10, existingCursor);

    // Should skip entries up to and including entry2, returning only entry3
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.id).toBe('c');
  });
});

// ─── Integration tests: GET /investments/history ───

describe('GET /investments/history — data shape and cursor pagination', () => {
  it('returns correct data shape for trade entries', async () => {
    const account = await createAccount();
    await prisma.transaction.create({
      data: {
        type: 'TRADE',
        name: 'Buy AAPL',
        amount: 1500,
        date: new Date(Date.UTC(2026, 5, 15)),
        accountId: account.id,
        tradeDetail: {
          create: {
            direction: 'BUY',
            assetType: 'Stock',
            ticker: 'AAPL',
            quantity: 10,
            unitPrice: 150,
          },
        },
      },
    });

    const res = await get('/investments/history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as HistoryResponse;

    expect(body.entries).toHaveLength(1);
    const entry = body.entries[0]!;
    expect(entry.entryType).toBe('TRADE');
    expect(entry.assetType).toBe('STOCK');
    expect(entry.ticker).toBe('AAPL');
    expect(entry.direction).toBe('BUY');
    expect(entry.description).toMatch(/^Bought AAPL on ACCT_/);
    expect(entry.quantity).toBe(10);
    expect(entry.amount).toBe(1500);
    expect(entry.fromName).toBeNull();
    expect(entry.toName).toBeNull();
    expect(entry.custodianName).toBe(account.name);
    expect(entry.feeAmount).toBeNull();
  });

  it('returns correct data shape for transfer entries with resolved names', async () => {
    const w1 = await createWallet({ name: 'Source Wallet' });
    const w2 = await createWallet({ name: 'Dest Wallet' });
    const h1 = await createHolding({
      name: 'BTC S',
      type: 'BITCOIN',
      quantity: 1,
      walletId: w1.id,
    });
    const h2 = await createHolding({
      name: 'BTC D',
      type: 'BITCOIN',
      quantity: 0,
      walletId: w2.id,
    });

    await prisma.investmentTransfer.create({
      data: {
        type: 'BITCOIN',
        fromHoldingId: h1.id,
        toHoldingId: h2.id,
        quantity: 0.25,
        ticker: null,
        feeBtc: 0.0001,
        createdAt: new Date(Date.UTC(2026, 5, 15)),
      },
    });

    const res = await get('/investments/history?type=TRANSFER');
    expect(res.status).toBe(200);
    const body = (await res.json()) as HistoryResponse;

    expect(body.entries).toHaveLength(1);
    const entry = body.entries[0]!;
    expect(entry.entryType).toBe('TRANSFER');
    expect(entry.assetType).toBe('BITCOIN');
    expect(entry.fromName).toBe('Source Wallet');
    expect(entry.toName).toBe('Dest Wallet');
    expect(entry.description).toBe('Source Wallet → Dest Wallet');
    expect(entry.quantity).toBe(0.25);
    expect(entry.feeAmount).toBeCloseTo(0.0001, 8);
    expect(entry.direction).toBeNull();
    expect(entry.amount).toBeNull();
    // Transfers carry fromName/toName instead of a single custodian
    expect(entry.custodianName).toBeNull();
  });

  it('returns correct data shape for bitcoin payment entries', async () => {
    const wallet = await createWallet({ name: 'Pay Wallet' });
    await createHolding({ name: 'BTC', type: 'BITCOIN', quantity: 1, walletId: wallet.id });

    await prisma.transaction.create({
      data: {
        type: 'EXPENSE',
        name: 'Coffee',
        amount: 5,
        date: new Date(Date.UTC(2026, 5, 15)),
        accountId: null,
        bitcoinPaymentDetail: {
          create: { walletId: wallet.id, quantity: 50000, bitcoinUnit: 'Sats', unitPrice: 100000 },
        },
      },
    });

    const res = await get('/investments/history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as HistoryResponse;

    const paymentEntries = body.entries.filter((e) => e.entryType === 'PAYMENT');
    expect(paymentEntries).toHaveLength(1);
    const entry = paymentEntries[0]!;
    expect(entry.assetType).toBe('BITCOIN');
    expect(entry.description).toBe('Spent BTC on Pay Wallet');
    expect(entry.amount).toBe(5);
    expect(entry.quantity).toBeCloseTo(50000 / 100_000_000, 10);
    expect(entry.custodianName).toBe('Pay Wallet');
  });

  it('returns 400 for invalid cursor', async () => {
    const res = await get('/investments/history?cursor=not-a-valid-cursor');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid cursor');
  });

  it('cursor-based pagination walks through all entries without overlap', async () => {
    const account = await createAccount();
    // Create 5 trades with distinct dates
    for (let i = 1; i <= 5; i++) {
      await prisma.transaction.create({
        data: {
          type: 'TRADE',
          name: `Trade ${i}`,
          amount: i * 1000,
          date: new Date(Date.UTC(2026, 5, i)),
          accountId: account.id,
          tradeDetail: {
            create: {
              direction: 'BUY',
              assetType: 'Stock',
              ticker: 'AAPL',
              quantity: i * 10,
              unitPrice: 100,
            },
          },
        },
      });
    }

    // Page 1: limit=2
    const res1 = await get('/investments/history?limit=2');
    expect(res1.status).toBe(200);
    const page1 = (await res1.json()) as HistoryResponse;
    expect(page1.entries).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeTruthy();

    // Page 2: use cursor from page 1
    const res2 = await get(`/investments/history?limit=2&cursor=${page1.nextCursor}`);
    expect(res2.status).toBe(200);
    const page2 = (await res2.json()) as HistoryResponse;
    expect(page2.entries).toHaveLength(2);
    expect(page2.hasMore).toBe(true);

    // Page 3: last page
    const res3 = await get(`/investments/history?limit=2&cursor=${page2.nextCursor}`);
    expect(res3.status).toBe(200);
    const page3 = (await res3.json()) as HistoryResponse;
    expect(page3.entries).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeNull();

    // Verify no overlap: all IDs should be unique
    const allIds = [
      ...page1.entries.map((e) => e.id),
      ...page2.entries.map((e) => e.id),
      ...page3.entries.map((e) => e.id),
    ];
    expect(new Set(allIds).size).toBe(5);

    // Verify date ordering: each page's entries are in descending date order
    const allEntries = [...page1.entries, ...page2.entries, ...page3.entries];
    for (let i = 0; i < allEntries.length - 1; i++) {
      const current = new Date(allEntries[i]!.date).getTime();
      const next = new Date(allEntries[i + 1]!.date).getTime();
      expect(current).toBeGreaterThanOrEqual(next);
    }
  });
});

// ─── Integration tests: Snapshot retrieval via GET / ───

describe('GET /investments — holdings with latest snapshot', () => {
  it('returns holdings with their latest snapshot attached', async () => {
    const wallet = await createWallet({ name: 'Snap Wallet' });
    const holding = await createHolding({
      name: 'Bitcoin',
      type: 'BITCOIN',
      quantity: 1.5,
      costBasis: 75000,
      walletId: wallet.id,
    });

    // Create two snapshots — the latest one should be returned
    await prisma.investmentSnapshot.create({
      data: {
        holdingId: holding.id,
        date: new Date(Date.UTC(2026, 4, 1)),
        quantity: 1.5,
        value: 90000,
      },
    });
    await prisma.investmentSnapshot.create({
      data: {
        holdingId: holding.id,
        date: new Date(Date.UTC(2026, 5, 1)),
        quantity: 1.5,
        value: 97500,
      },
    });

    const res = await get('/investments');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;

    const found = body.find((h) => h.id === holding.id);
    expect(found).toBeTruthy();
    expect(found!.name).toBe('Bitcoin');
    expect(found!.quantity).toBe(1.5);
    expect(found!.walletName).toBe('Snap Wallet');

    // Latest snapshot should be the June one
    const snapshot = found!.latestSnapshot as Record<string, unknown> | null;
    expect(snapshot).toBeTruthy();
    expect(snapshot!.value).toBe(97500);
    expect(snapshot!.quantity).toBe(1.5);
    expect(snapshot!.holdingId).toBe(holding.id);
  });

  it('returns null latestSnapshot when holding has no snapshots', async () => {
    const wallet = await createWallet({ name: 'No Snap Wallet' });
    const holding = await createHolding({
      name: 'Bitcoin',
      type: 'BITCOIN',
      quantity: 0.5,
      walletId: wallet.id,
    });

    const res = await get('/investments');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;

    const found = body.find((h) => h.id === holding.id);
    expect(found).toBeTruthy();
    expect(found!.latestSnapshot).toBeNull();
  });
});
