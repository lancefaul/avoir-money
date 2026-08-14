import { describe, it, expect } from 'vitest';
import {
  normalizeTradeEntry,
  normalizeTransferEntry,
  decodeCursor,
  mergeAndSort,
  type TransferWithNames,
} from '../investment-history.js';

// ─── Cursor encoding/decoding ───

/** Inline cursor encoder for tests (mirrors the private encodeCursor) */
function testEncodeCursor(
  date: Date | string,
  id: string,
  source: 'trade' | 'transfer' | 'payment',
): string {
  const dateStr = typeof date === 'string' ? date : date.toISOString();
  return Buffer.from(JSON.stringify({ date: dateStr, id, source })).toString('base64');
}

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a trade cursor', () => {
    const date = new Date('2024-06-15T00:00:00.000Z');
    const encoded = testEncodeCursor(date, 'tx-123', 'trade');
    const decoded = decodeCursor(encoded);
    expect(decoded.date).toBe('2024-06-15T00:00:00.000Z');
    expect(decoded.id).toBe('tx-123');
    expect(decoded.source).toBe('trade');
  });

  it('round-trips a transfer cursor', () => {
    const encoded = testEncodeCursor('2024-01-01T00:00:00.000Z', 'xfer-456', 'transfer');
    const decoded = decodeCursor(encoded);
    expect(decoded.date).toBe('2024-01-01T00:00:00.000Z');
    expect(decoded.id).toBe('xfer-456');
    expect(decoded.source).toBe('transfer');
  });

  it('throws on malformed base64', () => {
    expect(() => decodeCursor('not-valid-base64!!!')).toThrow('Invalid cursor');
  });

  it('throws on valid base64 but missing fields', () => {
    const bad = Buffer.from(JSON.stringify({ date: '2024-01-01' })).toString('base64');
    expect(() => decodeCursor(bad)).toThrow('Invalid cursor');
  });

  it('throws on invalid source value', () => {
    const bad = Buffer.from(
      JSON.stringify({ date: '2024-01-01', id: 'x', source: 'other' }),
    ).toString('base64');
    expect(() => decodeCursor(bad)).toThrow('Invalid cursor');
  });
});

// ─── normalizeTradeEntry ───

describe('normalizeTradeEntry', () => {
  it('normalizes a stock trade', () => {
    const tx = {
      id: 'tx-1',
      date: new Date('2024-03-01'),
      amount: 1500,
      tradeMetadata: {
        direction: 'BUY' as const,
        assetType: 'Stock' as const,
        ticker: 'AAPL',
        quantity: 10,
        unitPrice: 150,
      },
    };
    const entry = normalizeTradeEntry(tx);
    expect(entry.id).toBe('tx-1');
    expect(entry.entryType).toBe('TRADE');
    expect(entry.assetType).toBe('STOCK');
    expect(entry.ticker).toBe('AAPL');
    expect(entry.direction).toBe('BUY');
    expect(entry.amount).toBe(1500);
    expect(entry.description).toBe('Bought AAPL');
    expect(entry.fromName).toBeNull();
    expect(entry.toName).toBeNull();
    expect(entry.feeAmount).toBeNull();
  });

  it('normalizes a bitcoin trade with null ticker', () => {
    const tx = {
      id: 'tx-2',
      date: new Date('2024-04-01'),
      amount: 30000,
      tradeMetadata: {
        direction: 'SELL' as const,
        assetType: 'Bitcoin' as const,
        quantity: 0.5,
        unitPrice: 60000,
      },
    };
    const entry = normalizeTradeEntry(tx);
    expect(entry.assetType).toBe('BITCOIN');
    expect(entry.ticker).toBeNull();
    expect(entry.direction).toBe('SELL');
    expect(entry.description).toBe('Sold BTC');
  });

  it('handles Decimal-like amount', () => {
    const tx = {
      id: 'tx-3',
      date: new Date('2024-05-01'),
      amount: { toNumber: () => 999.99 },
      tradeMetadata: {
        direction: 'BUY' as const,
        assetType: 'Stock' as const,
        ticker: 'TCKR',
        quantity: 5,
        unitPrice: 200,
      },
    };
    const entry = normalizeTradeEntry(tx);
    expect(entry.amount).toBe(999.99);
  });
});

// ─── normalizeTransferEntry ───

describe('normalizeTransferEntry', () => {
  it('normalizes a bitcoin transfer with feeBtc', () => {
    const transfer: TransferWithNames = {
      id: 'xfer-1',
      type: 'BITCOIN',
      createdAt: new Date('2024-02-15'),
      quantity: 0.1,
      ticker: null,
      feeAmount: 5,
      feeBtc: 0.00008,
      fromName: 'Ledger',
      toName: 'Custodian A',
    };
    const entry = normalizeTransferEntry(transfer);
    expect(entry.id).toBe('xfer-1');
    expect(entry.entryType).toBe('TRANSFER');
    expect(entry.assetType).toBe('BITCOIN');
    expect(entry.feeAmount).toBe(0.00008);
    expect(entry.description).toBe('Ledger → Custodian A');
    expect(entry.direction).toBeNull();
    expect(entry.amount).toBeNull();
  });

  it('normalizes a stock transfer with feeAmount', () => {
    const transfer: TransferWithNames = {
      id: 'xfer-2',
      type: 'STOCK',
      createdAt: new Date('2024-03-20'),
      quantity: 100,
      ticker: 'AAPL',
      feeAmount: 25,
      feeBtc: null,
      fromName: 'Fidelity',
      toName: 'Schwab',
    };
    const entry = normalizeTransferEntry(transfer);
    expect(entry.assetType).toBe('STOCK');
    expect(entry.ticker).toBe('AAPL');
    expect(entry.feeAmount).toBe(25);
    expect(entry.description).toBe('AAPL: Fidelity → Schwab');
  });

  it('returns null feeAmount when both fee fields are null', () => {
    const transfer: TransferWithNames = {
      id: 'xfer-3',
      type: 'STOCK',
      createdAt: new Date('2024-04-01'),
      quantity: 50,
      ticker: 'TCKR',
      feeAmount: null,
      feeBtc: null,
      fromName: 'Vanguard',
      toName: 'Fidelity',
    };
    const entry = normalizeTransferEntry(transfer);
    expect(entry.feeAmount).toBeNull();
  });
});

// ─── mergeAndSort ───

describe('mergeAndSort', () => {
  const makeTrade = (id: string, date: string): ReturnType<typeof normalizeTradeEntry> => ({
    id,
    entryType: 'TRADE',
    date: new Date(date),
    description: `Trade ${id}`,
    assetType: 'STOCK',
    ticker: 'AAPL',
    quantity: 10,
    direction: 'BUY',
    fromName: null,
    toName: null,
    amount: 1000,
    feeAmount: null,
  });

  const makeTransfer = (id: string, date: string): ReturnType<typeof normalizeTransferEntry> => ({
    id,
    entryType: 'TRANSFER',
    date: new Date(date),
    description: `Transfer ${id}`,
    assetType: 'BITCOIN',
    ticker: null,
    quantity: 0.5,
    direction: null,
    fromName: 'WalletA',
    toName: 'WalletB',
    amount: null,
    feeAmount: null,
  });

  it('merges and sorts by date descending', () => {
    const trades = [makeTrade('t1', '2024-01-01'), makeTrade('t2', '2024-03-01')];
    const transfers = [makeTransfer('x1', '2024-02-01')];
    const result = mergeAndSort(trades, transfers, 10);
    expect(result.entries.map((e) => e.id)).toEqual(['t2', 'x1', 't1']);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('respects limit', () => {
    const trades = [
      makeTrade('t1', '2024-01-01'),
      makeTrade('t2', '2024-02-01'),
      makeTrade('t3', '2024-03-01'),
    ];
    const result = mergeAndSort(trades, [], 2);
    expect(result.entries).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).not.toBeNull();
  });

  it('applies cursor to skip past entries', () => {
    const trades = [
      makeTrade('t1', '2024-01-01'),
      makeTrade('t2', '2024-02-01'),
      makeTrade('t3', '2024-03-01'),
    ];
    // First page
    const page1 = mergeAndSort(trades, [], 2);
    expect(page1.entries.map((e) => e.id)).toEqual(['t3', 't2']);
    // Second page using cursor
    const page2 = mergeAndSort(trades, [], 2, page1.nextCursor!);
    expect(page2.entries.map((e) => e.id)).toEqual(['t1']);
    expect(page2.hasMore).toBe(false);
  });

  it('handles empty trade list with non-empty transfer list', () => {
    const transfers = [makeTransfer('x1', '2024-01-01')];
    const result = mergeAndSort([], transfers, 10);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.id).toBe('x1');
  });

  it('handles both lists empty', () => {
    const result = mergeAndSort([], [], 10);
    expect(result.entries).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});
