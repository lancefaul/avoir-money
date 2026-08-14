// Feature: import-export-enhancement, Property 1: Round-trip integrity
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatTransactionsToCSV, type ExportableTransaction } from '../csv-formatter.js';
import { parseCSVRows } from '../csv-parser.js';
import { CSV_COLUMNS, type CSVColumnName } from '../csv-columns.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an identity column mapping: each canonical column name maps to itself */
const IDENTITY_MAPPING: Partial<Record<CSVColumnName, string>> = Object.fromEntries(
  CSV_COLUMNS.map((col) => [col, col]),
) as Partial<Record<CSVColumnName, string>>;

/**
 * Parse a CSV string into an array of row objects keyed by column name.
 * Handles quoted fields for robustness.
 */
function csvToRowObjects(csv: string): Record<string, string>[] {
  const lines = csv.split('\n').filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]!);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = cells[j] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

/** Parse a single CSV line, handling quoted fields */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Safe string: no commas, quotes, newlines, or leading/trailing spaces (parser trims) */
const safeStr = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,19}$/);

/** ISO date string (YYYY-MM-DD) using UTC constructors */
const isoDateArb = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 0, max: 11 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => {
    const dt = new Date(Date.UTC(y, m, d));
    return dt.toISOString().split('T')[0]!;
  });

/** Fixed 2-decimal positive amount that survives toString → Number round-trip */
const amountArb = fc
  .double({ min: 0.01, max: 99999.99, noNaN: true, noDefaultInfinity: true })
  .map((n) => Math.round(n * 100) / 100);

const idArb = fc.uuid();

/** Stock trade metadata */
const stockTradeArb = fc.record({
  direction: fc.constantFrom('BUY', 'SELL'),
  assetType: fc.constant('Stock' as const),
  ticker: safeStr,
  custodianName: safeStr,
  unitPrice: amountArb,
  quantity: amountArb,
});

/** Bitcoin trade metadata */
const btcTradeArb = fc.record({
  direction: fc.constantFrom('BUY', 'SELL'),
  assetType: fc.constant('Bitcoin' as const),
  walletName: safeStr,
  unitPrice: amountArb,
  quantity: amountArb,
  bitcoinUnit: fc.constantFrom('Bitcoin', 'Sats'),
});

/** Trade metadata: Stock or Bitcoin variant */
const tradeMetadataArb = fc.oneof(stockTradeArb, btcTradeArb);

/** Bitcoin payment metadata (for non-TRADE types) */
const bitcoinMetadataArb = fc.record({
  walletName: safeStr,
  quantity: amountArb,
  bitcoinUnit: fc.constantFrom('Bitcoin', 'Sats'),
  unitPrice: amountArb,
});

/** Optional linkage fields */
const linkageArb = fc.record({
  expenseId: fc.option(idArb, { nil: undefined }),
  incomeId: fc.option(idArb, { nil: undefined }),
  payPeriodId: fc.option(idArb, { nil: undefined }),
  occurrenceDate: fc.option(isoDateArb, { nil: undefined }),
});

/**
 * Generate a child ExportableTransaction for a given parentId.
 * Children have tax fields and no nested children.
 */
function arbChild(parentId: string): fc.Arbitrary<ExportableTransaction> {
  return fc
    .record({
      id: idArb,
      name: safeStr,
      amount: amountArb,
      date: isoDateArb,
      accountName: safeStr,
      categoryName: fc.option(safeStr, { nil: undefined }),
      note: fc.option(safeStr, { nil: undefined }),
      preTaxAmount: fc.option(amountArb, { nil: undefined }),
      taxAmount: fc.option(amountArb, { nil: undefined }),
      taxRate: fc.option(amountArb, { nil: undefined }),
    })
    .map((fields) => ({
      ...fields,
      type: 'EXPENSE',
      parentId,
      toAccountName: undefined,
      tradeMetadata: undefined,
      bitcoinMetadata: undefined,
      expenseId: undefined,
      incomeId: undefined,
      payPeriodId: undefined,
      occurrenceDate: undefined,
      children: undefined,
    }));
}

/**
 * Core generator: produces a single ExportableTransaction covering all 5 types.
 * - TRADE always has tradeMetadata, never bitcoinMetadata
 * - Non-TRADE may optionally have bitcoinMetadata
 * - Any type may have children (split transactions)
 * - Any type may have linkage fields
 */
function arbExportableTransaction(): fc.Arbitrary<ExportableTransaction> {
  return fc.constantFrom('EXPENSE', 'INCOME', 'TRANSFER', 'REFUND', 'TRADE').chain((type) => {
    const base = fc.record({
      id: idArb,
      name: safeStr,
      amount: amountArb,
      date: isoDateArb,
      accountName: safeStr,
      toAccountName:
        type === 'TRANSFER'
          ? safeStr.map((s) => s as string | undefined)
          : fc.constant(undefined as string | undefined),
      categoryName: fc.option(safeStr, { nil: undefined }),
      note: fc.option(safeStr, { nil: undefined }),
      linkage: linkageArb,
    });

    if (type === 'TRADE') {
      return fc.tuple(base, tradeMetadataArb).chain(([b, trade]) => {
        const parentId = b.id;
        const withChildren = fc.option(
          fc.array(arbChild(parentId), { minLength: 1, maxLength: 2 }),
          { nil: undefined },
        );
        return withChildren.map((children) => ({
          id: b.id,
          type,
          name: b.name,
          amount: b.amount,
          date: b.date,
          accountName: b.accountName,
          toAccountName: b.toAccountName,
          categoryName: b.categoryName,
          note: b.note,
          tradeMetadata: trade as ExportableTransaction['tradeMetadata'],
          bitcoinMetadata: undefined,
          parentId: undefined,
          preTaxAmount: undefined,
          taxAmount: undefined,
          taxRate: undefined,
          ...b.linkage,
          children: children as ExportableTransaction[] | undefined,
        }));
      });
    }

    // Non-TRADE: optional bitcoin metadata
    return fc
      .tuple(base, fc.option(bitcoinMetadataArb, { nil: undefined }))
      .chain(([b, btcMeta]) => {
        const parentId = b.id;
        const withChildren = fc.option(
          fc.array(arbChild(parentId), { minLength: 1, maxLength: 2 }),
          { nil: undefined },
        );
        return withChildren.map((children) => ({
          id: b.id,
          type,
          name: b.name,
          amount: b.amount,
          date: b.date,
          accountName: b.accountName,
          toAccountName: b.toAccountName,
          categoryName: b.categoryName,
          note: b.note,
          tradeMetadata: undefined,
          bitcoinMetadata: btcMeta,
          parentId: undefined,
          preTaxAmount: undefined,
          taxAmount: undefined,
          taxRate: undefined,
          ...b.linkage,
          children: children as ExportableTransaction[] | undefined,
        }));
      });
  });
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/** Compare an optional numeric field: formatter uses toString(), parser uses Number() */
function expectNumEq(label: string, original: number | undefined, parsed: number | undefined) {
  if (original === undefined) {
    expect(parsed, `${label} should be undefined`).toBeUndefined();
  } else {
    expect(parsed, `${label} mismatch`).toBeCloseTo(original, 5);
  }
}

/** Compare an optional string field */
function expectStrEq(label: string, original: string | undefined, parsed: string | undefined) {
  if (original === undefined || original === '') {
    // Parser returns undefined for empty strings
    expect(parsed === undefined || parsed === '', `${label} should be empty/undefined`).toBe(true);
  } else {
    expect(parsed, `${label} mismatch`).toBe(original);
  }
}

/**
 * Flatten an ExportableTransaction[] into a flat list (parents + children in order).
 * This mirrors what the formatter does.
 */
function flattenTransactions(txs: ExportableTransaction[]): ExportableTransaction[] {
  const flat: ExportableTransaction[] = [];
  for (const tx of txs) {
    flat.push(tx);
    if (tx.children) {
      for (const child of tx.children) {
        flat.push(child);
      }
    }
  }
  return flat;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('Feature: import-export-enhancement, Property 1: Round-trip integrity', () => {
  /**
   * **Validates: Requirements 1.2, 2.1, 2.2, 2.3, 3.1, 4.1, 4.2, 4.3, 5.2,
   * 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 8.1, 9.1, 9.3, 10.1, 10.3, 12.1, 12.2, 12.3**
   *
   * For any valid transaction (of any type, with or without trade metadata,
   * bitcoin metadata, split children, tax fields, and linkage fields),
   * formatting it to CSV via formatTransactionsToCSV and then parsing the
   * resulting CSV back via parseCSVRows SHALL produce a transaction record
   * with equivalent field values.
   */
  it('round-trips all transaction types through format → parse without data loss', () => {
    fc.assert(
      fc.property(
        fc.array(arbExportableTransaction(), { minLength: 1, maxLength: 5 }),
        (transactions) => {
          // Step 1: Format to CSV
          const csv = formatTransactionsToCSV(transactions);

          // Step 2: Parse CSV back into row objects
          const rowObjects = csvToRowObjects(csv);

          // Step 3: Parse rows via the real parser
          const result = parseCSVRows(rowObjects, IDENTITY_MAPPING);

          // The parser may report orphan errors for children whose parent
          // is not the nearest preceding non-child row. For this test we
          // know the formatter emits parent then children in order, so the
          // parser's position-based heuristic should work. But we only
          // assert on successfully parsed transactions.

          // Flatten original transactions for comparison
          const origFlat = flattenTransactions(transactions);

          // The parser excludes orphan children, so parsed count may be ≤ origFlat
          // For well-formed input (parent immediately before children), they should match
          expect(result.transactions.length).toBe(origFlat.length);

          // Step 4: Assert field equivalence
          for (let i = 0; i < result.transactions.length; i++) {
            const orig = origFlat[i]!;
            const parsed = result.transactions[i]!;

            // Base fields
            expect(parsed.type, `[${i}] type`).toBe(orig.type);
            expect(parsed.name, `[${i}] name`).toBe(orig.name);
            expectNumEq(`[${i}] amount`, orig.amount, parsed.amount);
            expect(parsed.date, `[${i}] date`).toBe(orig.date);

            // Name-based fields: formatter exports as *Name, parser reads as raw*
            expect(parsed.rawAccount, `[${i}] account`).toBe(orig.accountName);
            expectStrEq(`[${i}] toAccount`, orig.toAccountName, parsed.rawToAccount);
            expectStrEq(`[${i}] category`, orig.categoryName, parsed.rawCategory);
            expectStrEq(`[${i}] note`, orig.note, parsed.note);

            // Trade metadata
            if (orig.type === 'TRADE' && orig.tradeMetadata) {
              expect(parsed.tradeMetadata, `[${i}] tradeMetadata defined`).toBeDefined();
              const ot = orig.tradeMetadata;
              const pt = parsed.tradeMetadata!;
              expect(pt.direction, `[${i}] trade direction`).toBe(ot.direction);
              expect(pt.assetType, `[${i}] trade assetType`).toBe(ot.assetType);
              expectStrEq(`[${i}] trade ticker`, ot.ticker, pt.ticker);
              expectStrEq(`[${i}] trade custodian`, ot.custodianName, pt.rawCustodian);
              expectStrEq(`[${i}] trade wallet`, ot.walletName, pt.rawWallet);
              expectNumEq(`[${i}] trade unitPrice`, ot.unitPrice, pt.unitPrice);
              expectNumEq(`[${i}] trade quantity`, ot.quantity, pt.quantity);
              expectStrEq(`[${i}] trade bitcoinUnit`, ot.bitcoinUnit, pt.bitcoinUnit);
            } else {
              expect(parsed.tradeMetadata, `[${i}] tradeMetadata undefined`).toBeUndefined();
            }

            // Bitcoin payment metadata
            if (orig.bitcoinMetadata) {
              expect(parsed.bitcoinMetadata, `[${i}] bitcoinMetadata defined`).toBeDefined();
              const ob = orig.bitcoinMetadata;
              const pb = parsed.bitcoinMetadata!;
              expect(pb.rawWallet, `[${i}] btc wallet`).toBe(ob.walletName);
              expectNumEq(`[${i}] btc quantity`, ob.quantity, pb.quantity);
              expect(pb.bitcoinUnit, `[${i}] btc unit`).toBe(ob.bitcoinUnit);
              expectNumEq(`[${i}] btc unitPrice`, ob.unitPrice, pb.unitPrice);
            } else {
              expect(parsed.bitcoinMetadata, `[${i}] bitcoinMetadata undefined`).toBeUndefined();
            }

            // Split fields
            expectStrEq(`[${i}] parentId`, orig.parentId, parsed.parentId);
            expectNumEq(`[${i}] preTaxAmount`, orig.preTaxAmount, parsed.preTaxAmount);
            expectNumEq(`[${i}] taxAmount`, orig.taxAmount, parsed.taxAmount);
            expectNumEq(`[${i}] taxRate`, orig.taxRate, parsed.taxRate);

            // Linkage fields
            expectStrEq(`[${i}] expenseId`, orig.expenseId, parsed.expenseId);
            expectStrEq(`[${i}] incomeId`, orig.incomeId, parsed.incomeId);
            expectStrEq(`[${i}] payPeriodId`, orig.payPeriodId, parsed.payPeriodId);
            expectStrEq(`[${i}] occurrenceDate`, orig.occurrenceDate, parsed.occurrenceDate);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
