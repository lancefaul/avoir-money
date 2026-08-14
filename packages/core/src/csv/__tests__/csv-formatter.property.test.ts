// Feature: import-export-enhancement, Property 2: Export structural correctness
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatTransactionsToCSV, ExportableTransaction } from '../csv-formatter.js';
import { unescapeFormulaGuard } from '../csv-escape.js';

/** Trade metadata column indices (8–15) */
const TRADE_COL_START = 8;
const TRADE_COL_END = 15;

/** Bitcoin payment metadata column indices (16–19) */
const BTC_COL_START = 16;
const BTC_COL_END = 19;

const NON_TRADE_TYPES = ['EXPENSE', 'INCOME', 'TRANSFER', 'REFUND'] as const;

/** Arbitrary: generate a safe CSV string (no commas/quotes/newlines to simplify parsing) */
const safeStringArb = fc.stringMatching(/^[A-Za-z0-9 _-]{1,20}$/);

/** Arbitrary: generate a valid ISO date string using UTC */
const isoDateArb = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 0, max: 11 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => new Date(Date.UTC(y, m, d)).toISOString().split('T')[0]);

/** Arbitrary: positive amount */
const amountArb = fc
  .double({ min: 0.01, max: 99999.99, noNaN: true, noDefaultInfinity: true })
  .map((n) => Math.round(n * 100) / 100);

/** Arbitrary: generate a unique ID */
const idArb = fc.uuid();

/** Arbitrary: trade metadata */
const tradeMetadataArb = fc.oneof(
  // Stock trade
  fc.record({
    direction: fc.constantFrom('BUY', 'SELL'),
    assetType: fc.constant('Stock'),
    ticker: safeStringArb,
    custodianName: safeStringArb,
    unitPrice: amountArb,
    quantity: amountArb,
  }),
  // Bitcoin trade
  fc.record({
    direction: fc.constantFrom('BUY', 'SELL'),
    assetType: fc.constant('Bitcoin'),
    walletName: safeStringArb,
    unitPrice: amountArb,
    quantity: amountArb,
    bitcoinUnit: fc.constantFrom('Bitcoin', 'Sats'),
  }),
);

/** Arbitrary: bitcoin payment metadata */
const bitcoinMetadataArb = fc.record({
  walletName: safeStringArb,
  quantity: amountArb,
  bitcoinUnit: fc.constantFrom('Bitcoin', 'Sats'),
  unitPrice: amountArb,
});

/** Arbitrary: a base ExportableTransaction (no children) */
function arbTransaction(
  typeArb: fc.Arbitrary<string>,
  opts?: { withBitcoin?: boolean; withTrade?: boolean },
): fc.Arbitrary<ExportableTransaction> {
  return fc.record({
    id: idArb,
    type: typeArb,
    name: safeStringArb,
    amount: amountArb,
    date: isoDateArb,
    accountName: safeStringArb,
    toAccountName: fc.option(safeStringArb, { nil: undefined }),
    categoryName: fc.option(safeStringArb, { nil: undefined }),
    note: fc.option(safeStringArb, { nil: undefined }),
    tradeMetadata: opts?.withTrade
      ? tradeMetadataArb.map((t) => t as ExportableTransaction['tradeMetadata'])
      : fc.constant(undefined),
    bitcoinMetadata: opts?.withBitcoin
      ? fc.option(bitcoinMetadataArb, { nil: undefined })
      : fc.constant(undefined),
    parentId: fc.constant(undefined),
    preTaxAmount: fc.constant(undefined),
    taxAmount: fc.constant(undefined),
    taxRate: fc.constant(undefined),
    expenseId: fc.option(idArb, { nil: undefined }),
    incomeId: fc.option(idArb, { nil: undefined }),
    payPeriodId: fc.option(idArb, { nil: undefined }),
    occurrenceDate: fc.option(isoDateArb, { nil: undefined }),
  }) as fc.Arbitrary<ExportableTransaction>;
}

/** Arbitrary: a non-TRADE transaction (may or may not have bitcoin metadata) */
const arbNonTradeTransaction: fc.Arbitrary<ExportableTransaction> = fc
  .constantFrom(...NON_TRADE_TYPES)
  .chain((type) => arbTransaction(fc.constant(type), { withBitcoin: true }));

/** Arbitrary: a TRADE transaction (always has trade metadata, never bitcoin metadata) */
const arbTradeTransaction: fc.Arbitrary<ExportableTransaction> = arbTransaction(
  fc.constant('TRADE'),
  { withTrade: true },
);

/** Arbitrary: any transaction type */
const arbAnyTransaction: fc.Arbitrary<ExportableTransaction> = fc.oneof(
  arbNonTradeTransaction,
  arbTradeTransaction,
);

/** Arbitrary: a parent transaction with 1-3 children */
const arbParentWithChildren: fc.Arbitrary<ExportableTransaction> = idArb.chain((parentId) =>
  fc
    .tuple(
      arbAnyTransaction.map((tx) => ({ ...tx, id: parentId })),
      fc.array(
        arbAnyTransaction.map((child) => ({
          ...child,
          parentId,
          preTaxAmount: child.amount * 0.9,
          taxAmount: child.amount * 0.1,
          taxRate: 10,
        })),
        { minLength: 1, maxLength: 3 },
      ),
    )
    .map(([parent, children]) => ({ ...parent, children })),
);

/**
 * Parse CSV output into rows of cells (simple split — works because we use safe
 * strings). Reverses the formatter's formula-injection guard, exactly as the
 * real importer does, so a guarded name (e.g. `-_` → `'-_`) round-trips back.
 */
function parseCSVRows(csv: string): string[][] {
  const lines = csv.split('\n');
  return lines.map((line) => line.split(',').map(unescapeFormulaGuard));
}

describe('Feature: import-export-enhancement, Property 2: Export structural correctness', () => {
  /**
   * **Validates: Requirements 2.4, 3.2, 4.4**
   *
   * Property 2a: For non-TRADE transactions, all trade metadata columns
   * (indices 8–15) must be empty.
   */
  it('trade columns are empty for non-TRADE transactions', () => {
    fc.assert(
      fc.property(
        fc.array(arbNonTradeTransaction, { minLength: 1, maxLength: 10 }),
        (transactions) => {
          const csv = formatTransactionsToCSV(transactions);
          const rows = parseCSVRows(csv);
          // Skip header row (index 0)
          const dataRows = rows.slice(1);

          for (const row of dataRows) {
            for (let i = TRADE_COL_START; i <= TRADE_COL_END; i++) {
              expect(row[i]).toBe('');
            }
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * Property 2b: For transactions without bitcoinMetadata, all bitcoin
   * payment columns (indices 16–19) must be empty.
   */
  it('bitcoin columns are empty when transaction has no bitcoinMetadata', () => {
    // Generate transactions that explicitly have no bitcoin metadata
    const arbNoBitcoin: fc.Arbitrary<ExportableTransaction> = arbAnyTransaction.map((tx) => ({
      ...tx,
      bitcoinMetadata: undefined,
    }));

    fc.assert(
      fc.property(fc.array(arbNoBitcoin, { minLength: 1, maxLength: 10 }), (transactions) => {
        const csv = formatTransactionsToCSV(transactions);
        const rows = parseCSVRows(csv);
        const dataRows = rows.slice(1);

        for (const row of dataRows) {
          for (let i = BTC_COL_START; i <= BTC_COL_END; i++) {
            expect(row[i]).toBe('');
          }
        }
      }),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 4.4**
   *
   * Property 2c: When a transaction has children, the children rows appear
   * immediately after the parent row in the CSV output.
   */
  it('children rows appear immediately after their parent row', () => {
    fc.assert(
      fc.property(
        fc.array(arbParentWithChildren, { minLength: 1, maxLength: 5 }),
        (transactions) => {
          const csv = formatTransactionsToCSV(transactions);
          const rows = parseCSVRows(csv);
          const dataRows = rows.slice(1); // skip header

          // parent_id is at column index 20
          let rowIdx = 0;
          for (const parent of transactions) {
            // Parent row
            expect(dataRows[rowIdx]).toBeDefined();
            // Parent's parent_id column (index 20) should be empty (no parentId on parent)
            expect(dataRows[rowIdx][20]).toBe('');
            // Verify it's the right parent by checking the name column (index 1)
            expect(dataRows[rowIdx][1]).toBe(parent.name);
            rowIdx++;

            // Children should follow immediately
            if (parent.children) {
              for (const child of parent.children) {
                expect(dataRows[rowIdx]).toBeDefined();
                // Child's parent_id column (index 20) should be the parent's id
                expect(dataRows[rowIdx][20]).toBe(parent.id);
                rowIdx++;
              }
            }
          }

          // Total data rows should match parents + all children
          expect(rowIdx).toBe(dataRows.length);
        },
      ),
      { numRuns: 20 },
    );
  });
});
