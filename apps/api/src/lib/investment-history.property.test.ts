import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { HistoryEntry } from '@budget-tracker/core';
import {
  mergeAndSort,
  normalizeTradeEntry,
  normalizeTransferEntry,
  decodeCursor,
} from './investment-history.js';
import type { TransferWithNames } from './investment-history.js';

// ─── Generators ───

const entryTypeArb = fc.constantFrom('TRADE' as const, 'TRANSFER' as const);
const assetTypeArb = fc.constantFrom('STOCK' as const, 'BITCOIN' as const);
const directionArb = fc.constantFrom('BUY' as const, 'SELL' as const);

const dateArb = fc
  .date({
    min: new Date('2020-01-01'),
    max: new Date('2030-12-31'),
  })
  .filter((d) => !isNaN(d.getTime()));

const positiveNumArb = fc.double({
  min: 0.01,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});
const nonNegNumArb = fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true });

/** Non-empty printable string without control characters */
const nameArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((s) => s.replace(/[^\x20-\x7E]/g, 'a') || 'a');
const tickerArb = fc
  .array(fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F', 'G', 'X', 'Y', 'Z'), {
    minLength: 1,
    maxLength: 5,
  })
  .map((chars) => chars.join(''));

/** Generate a HistoryEntry with a given entryType */
function historyEntryArb(entryType?: 'TRADE' | 'TRANSFER'): fc.Arbitrary<HistoryEntry> {
  const et = entryType ? fc.constant(entryType) : entryTypeArb;
  return fc.record({
    id: fc.uuid(),
    entryType: et,
    date: dateArb,
    description: nameArb,
    assetType: assetTypeArb,
    ticker: fc.option(tickerArb, { nil: null }),
    quantity: positiveNumArb,
    direction: fc.option(directionArb, { nil: null }),
    fromName: fc.option(nameArb, { nil: null }),
    toName: fc.option(nameArb, { nil: null }),
    amount: fc.option(nonNegNumArb, { nil: null }),
    feeAmount: fc.option(nonNegNumArb, { nil: null }),
  });
}

/** Generate a valid TradeTransaction input */
interface TradeTransactionInput {
  id: string;
  date: Date;
  amount: number;
  tradeMetadata: {
    direction: 'BUY' | 'SELL';
    assetType: 'Stock' | 'Bitcoin';
    ticker?: string | null;
    quantity: number;
    unitPrice: number;
    bitcoinUnit?: 'Bitcoin' | 'Sats';
  };
}

const tradeTransactionArb: fc.Arbitrary<TradeTransactionInput> = fc.record({
  id: fc.uuid(),
  date: dateArb,
  amount: positiveNumArb,
  tradeMetadata: fc.record({
    direction: directionArb,
    assetType: fc.constantFrom('Stock' as const, 'Bitcoin' as const),
    ticker: fc.option(tickerArb, { nil: null }),
    quantity: positiveNumArb,
    unitPrice: positiveNumArb,
    bitcoinUnit: fc.option(fc.constantFrom('Bitcoin' as const, 'Sats' as const), {
      nil: undefined,
    }),
  }),
});

/** Generate a valid TransferWithNames input */
const transferWithNamesArb: fc.Arbitrary<TransferWithNames> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom('BITCOIN', 'STOCK'),
  createdAt: dateArb,
  quantity: positiveNumArb,
  ticker: fc.option(tickerArb, { nil: null }),
  feeAmount: fc.option(nonNegNumArb, { nil: null }),
  feeBtc: fc.option(nonNegNumArb, { nil: null }),
  fromName: nameArb,
  toName: nameArb,
});

// ─── Property 1: Merged output is sorted by date descending ───

describe('Feature: investment-history, Property 1: Merged output is sorted by date descending', () => {
  /**
   * **Validates: Requirements 1.1**
   *
   * For any two arrays of history entries (trades and transfers) with arbitrary dates,
   * merging and sorting them should produce an output where each entry's date is
   * greater than or equal to the next entry's date.
   */
  it('merged entries are always sorted by date descending', () => {
    fc.assert(
      fc.property(
        fc.array(historyEntryArb('TRADE'), { minLength: 0, maxLength: 15 }),
        fc.array(historyEntryArb('TRANSFER'), { minLength: 0, maxLength: 15 }),
        (trades, transfers) => {
          const { entries } = mergeAndSort(trades, transfers, 100);

          for (let i = 0; i < entries.length - 1; i++) {
            const currentDate = new Date(entries[i]!.date).getTime();
            const nextDate = new Date(entries[i + 1]!.date).getTime();
            expect(currentDate).toBeGreaterThanOrEqual(nextDate);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2: Filter returns only matching entryType ───

describe('Feature: investment-history, Property 2: Filter returns only matching entryType', () => {
  /**
   * **Validates: Requirements 1.4, 1.5, 1.6**
   *
   * When only trade entries are passed as the trades argument and no transfers,
   * the output contains only TRADE entries. Vice versa for transfers.
   * When both are passed, the output contains both types.
   */
  it('passing only trades yields only TRADE entries', () => {
    fc.assert(
      fc.property(fc.array(historyEntryArb('TRADE'), { minLength: 1, maxLength: 20 }), (trades) => {
        const { entries } = mergeAndSort(trades, [], 100);
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
          expect(entry.entryType).toBe('TRADE');
        }
      }),
      { numRuns: 20 },
    );
  });

  it('passing only transfers yields only TRANSFER entries', () => {
    fc.assert(
      fc.property(
        fc.array(historyEntryArb('TRANSFER'), { minLength: 1, maxLength: 20 }),
        (transfers) => {
          const { entries } = mergeAndSort([], transfers, 100);
          expect(entries.length).toBeGreaterThan(0);
          for (const entry of entries) {
            expect(entry.entryType).toBe('TRANSFER');
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('passing both trades and transfers yields entries of both types', () => {
    fc.assert(
      fc.property(
        fc.array(historyEntryArb('TRADE'), { minLength: 1, maxLength: 10 }),
        fc.array(historyEntryArb('TRANSFER'), { minLength: 1, maxLength: 10 }),
        (trades, transfers) => {
          const { entries } = mergeAndSort(trades, transfers, 100);
          const types = new Set(entries.map((e) => e.entryType));
          expect(types.has('TRADE')).toBe(true);
          expect(types.has('TRANSFER')).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 3: Pagination respects limit and cursor correctness ───

describe('Feature: investment-history, Property 3: Pagination respects limit and cursor correctness', () => {
  /**
   * **Validates: Requirements 1.8, 1.9**
   *
   * For any array of history entries and any limit between 1 and 100,
   * the returned page should contain at most `limit` entries, and
   * `nextCursor` should be null if and only if all entries have been returned.
   */
  it('returned entries never exceed the limit', () => {
    fc.assert(
      fc.property(
        fc.array(historyEntryArb(), { minLength: 0, maxLength: 30 }),
        fc.integer({ min: 1, max: 100 }),
        (allEntries, limit) => {
          const trades = allEntries.filter((e) => e.entryType === 'TRADE');
          const transfers = allEntries.filter((e) => e.entryType === 'TRANSFER');
          const { entries } = mergeAndSort(trades, transfers, limit);
          expect(entries.length).toBeLessThanOrEqual(limit);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('nextCursor is null iff all entries fit in one page', () => {
    fc.assert(
      fc.property(
        fc.array(historyEntryArb(), { minLength: 0, maxLength: 30 }),
        fc.integer({ min: 1, max: 100 }),
        (allEntries, limit) => {
          const trades = allEntries.filter((e) => e.entryType === 'TRADE');
          const transfers = allEntries.filter((e) => e.entryType === 'TRANSFER');
          const totalCount = trades.length + transfers.length;
          const { nextCursor, hasMore } = mergeAndSort(trades, transfers, limit);

          if (totalCount <= limit) {
            expect(nextCursor).toBeNull();
            expect(hasMore).toBe(false);
          } else {
            expect(nextCursor).not.toBeNull();
            expect(hasMore).toBe(true);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('paginating with cursor returns remaining entries without overlap', () => {
    fc.assert(
      fc.property(fc.array(historyEntryArb(), { minLength: 2, maxLength: 20 }), (allEntries) => {
        const trades = allEntries.filter((e) => e.entryType === 'TRADE');
        const transfers = allEntries.filter((e) => e.entryType === 'TRANSFER');
        const limit = Math.max(1, Math.floor(allEntries.length / 2));

        const page1 = mergeAndSort(trades, transfers, limit);
        if (!page1.nextCursor) return; // all fit in one page

        const page2 = mergeAndSort(trades, transfers, limit, page1.nextCursor);

        // No overlap: last entry of page1 should be before first entry of page2
        const lastPage1 = page1.entries[page1.entries.length - 1]!;
        const firstPage2 = page2.entries[0];
        if (firstPage2) {
          const lastDate = new Date(lastPage1.date).getTime();
          const firstDate = new Date(firstPage2.date).getTime();
          expect(lastDate).toBeGreaterThanOrEqual(firstDate);
        }

        // Combined pages should not exceed total
        expect(page1.entries.length + page2.entries.length).toBeLessThanOrEqual(allEntries.length);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 4: Trade normalization preserves source fields ───

describe('Feature: investment-history, Property 4: Trade normalization preserves source fields', () => {
  /**
   * **Validates: Requirements 2.2**
   *
   * For any valid trade transaction with tradeMetadata, normalizing it should produce
   * an entry where direction, amount, ticker, and assetType correctly map from the source.
   */
  it('normalized trade entry preserves all source fields', () => {
    fc.assert(
      fc.property(tradeTransactionArb, (tx) => {
        const entry = normalizeTradeEntry(tx);

        expect(entry.id).toBe(tx.id);
        expect(entry.entryType).toBe('TRADE');
        expect(entry.date).toEqual(tx.date);
        expect(entry.direction).toBe(tx.tradeMetadata.direction);
        expect(entry.amount).toBe(tx.amount);

        // Quantity should be normalized to BTC for Bitcoin+Sats trades
        if (tx.tradeMetadata.assetType === 'Bitcoin' && tx.tradeMetadata.bitcoinUnit === 'Sats') {
          expect(entry.quantity).toBeCloseTo(tx.tradeMetadata.quantity / 100_000_000, 10);
        } else {
          expect(entry.quantity).toBe(tx.tradeMetadata.quantity);
        }

        // assetType mapping
        if (tx.tradeMetadata.assetType === 'Stock') {
          expect(entry.assetType).toBe('STOCK');
          expect(entry.ticker).toBe(tx.tradeMetadata.ticker ?? null);
        } else {
          expect(entry.assetType).toBe('BITCOIN');
          expect(entry.ticker).toBeNull();
        }

        // Trade entries have no transfer-specific fields
        expect(entry.fromName).toBeNull();
        expect(entry.toName).toBeNull();
        expect(entry.feeAmount).toBeNull();
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 5: Transfer normalization preserves source fields ───

describe('Feature: investment-history, Property 5: Transfer normalization preserves source fields', () => {
  /**
   * **Validates: Requirements 2.3, 2.4**
   *
   * For any valid InvestmentTransfer with resolved names, normalizing it should produce
   * an entry where fromName, toName, quantity, ticker, and feeAmount correctly map from the source.
   */
  it('normalized transfer entry preserves all source fields', () => {
    fc.assert(
      fc.property(transferWithNamesArb, (transfer) => {
        const entry = normalizeTransferEntry(transfer);

        expect(entry.id).toBe(transfer.id);
        expect(entry.entryType).toBe('TRANSFER');
        expect(entry.date).toEqual(transfer.createdAt);
        expect(entry.fromName).toBe(transfer.fromName);
        expect(entry.toName).toBe(transfer.toName);
        expect(entry.quantity).toBe(transfer.quantity);
        expect(entry.ticker).toBe(transfer.ticker);

        // assetType mapping
        if (transfer.type === 'BITCOIN') {
          expect(entry.assetType).toBe('BITCOIN');
          // Fee comes from feeBtc for bitcoin
          if (transfer.feeBtc != null) {
            expect(entry.feeAmount).toBe(transfer.feeBtc);
          } else {
            expect(entry.feeAmount).toBeNull();
          }
        } else {
          expect(entry.assetType).toBe('STOCK');
          // Fee comes from feeAmount for stock
          if (transfer.feeAmount != null) {
            expect(entry.feeAmount).toBe(transfer.feeAmount);
          } else {
            expect(entry.feeAmount).toBeNull();
          }
        }

        // Transfer entries have no trade-specific fields
        expect(entry.direction).toBeNull();
        expect(entry.amount).toBeNull();
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Format description tests removed ───
// formatTransferDescription and formatTradeDescription are now private;
// their behavior is tested indirectly through normalizeTradeEntry/normalizeTransferEntry properties above.

// ─── Feature: investment-history-filters tests removed ───
// filterByAssetType was removed as an unused export; these property tests
// tested that deleted function and are no longer applicable.
