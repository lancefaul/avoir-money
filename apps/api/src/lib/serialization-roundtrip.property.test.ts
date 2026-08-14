// Feature: v1-hardening, Property 1: Serialization Round-Trip Preservation
/**
 * Property-based tests for serialization round-trips:
 * 1. serializeTransaction() → TransactionSchema round-trip
 * 2. CSV export → import parser round-trip
 * 3. Sign convention config encode → decode round-trip
 *
 * **Validates: Requirements 2.3**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  TransactionSchema,
  SignConventionConfigSchema,
  formatTransactionsToCSV,
  parseCSVRows,
  CSV_COLUMNS,
  type CSVColumnName,
} from '@budget-tracker/core';
import { serializeTransaction } from './transaction-serialization.js';
import { normalizeAmount, type SignConventionConfig } from '@budget-tracker/core';

// ─── Shared Generators ───

const cuidArb = fc.stringMatching(/^c[a-z0-9]{24}$/);
const nameArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 _-]{0,19}$/);
const txTypeArb = fc.constantFrom('EXPENSE', 'INCOME', 'TRANSFER', 'REFUND', 'TRADE');

/** Positive amount with 2 decimal places (mimics Prisma Decimal) */
const amountArb = fc
  .double({ min: 0.01, max: 99999.99, noNaN: true, noDefaultInfinity: true })
  .map((n) => Math.round(n * 100) / 100);

/** UTC date in a reasonable range */
const dateArb = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 0, max: 11 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => new Date(Date.UTC(y, m, d)));

const nullableCuidArb = fc.option(cuidArb, { nil: null });

// ─────────────────────────────────────────────────────────────────────────────
// 1. serializeTransaction() → TransactionSchema round-trip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a Prisma-like transaction record that serializeTransaction() accepts.
 * The record uses `{ toNumber(): number }` wrappers for Decimal fields, matching
 * the Prisma Decimal type shape.
 */
function arbPrismaRecord() {
  return fc
    .record({
      id: cuidArb,
      type: txTypeArb,
      name: nameArb,
      amount: amountArb,
      date: dateArb,
      payPeriodId: nullableCuidArb,
      expenseId: nullableCuidArb,
      incomeId: nullableCuidArb,
      accountId: nullableCuidArb,
      toAccountId: nullableCuidArb,
      budgetId: nullableCuidArb,
      note: fc.option(nameArb, { nil: null }),
      parentId: fc.option(cuidArb, { nil: null }),
      childCount: fc.integer({ min: 0, max: 10 }),
      createdAt: dateArb,
    })
    .map((r) => {
      // Mimic Prisma Decimal: valueOf() for Number() coercion, toNumber() for explicit calls
      const decimal = { toNumber: () => r.amount, valueOf: () => r.amount };
      const netAmountDecimal = { toNumber: () => r.amount, valueOf: () => r.amount };
      return {
        ...r,
        amount: decimal,
        netAmount: netAmountDecimal,
        tradeMetadata: null,
        bitcoinMetadata: null,
        _count: { children: r.childCount },
      };
    });
}

describe('serializeTransaction() → TransactionSchema round-trip', () => {
  it('serialized output parses successfully through TransactionSchema', () => {
    fc.assert(
      fc.property(arbPrismaRecord(), (record) => {
        const serialized = serializeTransaction(record);
        const result = TransactionSchema.safeParse(serialized);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('preserves all field values through serialize → parse', () => {
    fc.assert(
      fc.property(arbPrismaRecord(), (record) => {
        const serialized = serializeTransaction(record);
        const parsed = TransactionSchema.parse(serialized);

        expect(parsed.id).toBe(record.id);
        expect(parsed.type).toBe(record.type);
        expect(parsed.name).toBe(record.name);
        expect(parsed.amount).toBe(record.amount.toNumber());
        expect(parsed.netAmount).toBe(record.netAmount.toNumber());
        expect(parsed.date.getTime()).toBe(record.date.getTime());
        expect(parsed.payPeriodId).toBe(record.payPeriodId);
        expect(parsed.expenseId).toBe(record.expenseId);
        expect(parsed.incomeId).toBe(record.incomeId);
        expect(parsed.accountId).toBe(record.accountId);
        expect(parsed.toAccountId).toBe(record.toAccountId);
        // serializeTransaction maps budgetId directly
        expect(parsed.budgetId).toBe(record.budgetId);
        expect(parsed.note).toBe(record.note);
        expect(parsed.parentId).toBe(record.parentId);
        expect(parsed.childCount).toBe(record._count.children);
        expect(parsed.createdAt.getTime()).toBe(record.createdAt.getTime());
      }),
      { numRuns: 100 },
    );
  });

  it('JSON round-trip preserves equivalence (serialize → JSON → parse)', () => {
    fc.assert(
      fc.property(arbPrismaRecord(), (record) => {
        const serialized = serializeTransaction(record);
        const json = JSON.stringify(serialized);
        const parsed = TransactionSchema.parse(JSON.parse(json));

        expect(parsed.id).toBe(record.id);
        expect(parsed.type).toBe(record.type);
        expect(parsed.amount).toBe(record.amount.toNumber());
        expect(parsed.budgetId).toBe(record.budgetId);
        expect(parsed.childCount).toBe(record._count.children);
      }),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. CSV export → import parser round-trip
// ─────────────────────────────────────────────────────────────────────────────

/** Identity column mapping: each canonical column name maps to itself */
const IDENTITY_MAPPING: Partial<Record<CSVColumnName, string>> = Object.fromEntries(
  CSV_COLUMNS.map((col) => [col, col]),
) as Partial<Record<CSVColumnName, string>>;

/** Safe string for CSV fields (no commas, quotes, newlines) */
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

/** Parse CSV string into row objects keyed by column name */
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

/** Generate a simple exportable transaction (non-TRADE, no children) */
function arbSimpleExportable() {
  return fc
    .record({
      id: fc.uuid(),
      type: fc.constantFrom('EXPENSE', 'INCOME', 'TRANSFER', 'REFUND'),
      name: safeStr,
      amount: amountArb,
      date: isoDateArb,
      accountName: safeStr,
      categoryName: fc.option(safeStr, { nil: undefined }),
      note: fc.option(safeStr, { nil: undefined }),
    })
    .map((r) => ({
      ...r,
      toAccountName: r.type === 'TRANSFER' ? 'TransferAcct' : undefined,
      tradeMetadata: undefined,
      bitcoinMetadata: undefined,
      parentId: undefined,
      preTaxAmount: undefined,
      taxAmount: undefined,
      taxRate: undefined,
      expenseId: undefined,
      incomeId: undefined,
      payPeriodId: undefined,
      occurrenceDate: undefined,
      children: undefined,
    }));
}

describe('CSV export → import parser round-trip', () => {
  it('base fields survive format → parse without data loss', () => {
    fc.assert(
      fc.property(
        fc.array(arbSimpleExportable(), { minLength: 1, maxLength: 5 }),
        (transactions) => {
          const csv = formatTransactionsToCSV(transactions);
          const rowObjects = csvToRowObjects(csv);
          const result = parseCSVRows(rowObjects, IDENTITY_MAPPING);

          expect(result.transactions.length).toBe(transactions.length);

          for (let i = 0; i < transactions.length; i++) {
            const orig = transactions[i]!;
            const parsed = result.transactions[i]!;

            expect(parsed.type).toBe(orig.type);
            expect(parsed.name).toBe(orig.name);
            expect(parsed.amount).toBeCloseTo(orig.amount, 5);
            expect(parsed.date).toBe(orig.date);
            expect(parsed.rawAccount).toBe(orig.accountName);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Sign convention config encode → decode round-trip
// ─────────────────────────────────────────────────────────────────────────────

/** Generator for valid SignConventionConfig objects */
const validConfigArb = fc.record({
  expense: fc.record({
    positiveMeaning: fc.constantFrom('money_out' as const, 'money_in' as const),
    negativeMeaning: fc.constantFrom('refund' as const, 'ignore' as const),
  }),
  income: fc.record({
    positiveMeaning: fc.constantFrom('money_in' as const, 'money_out' as const),
    negativeMeaning: fc.constantFrom('flip_sign' as const, 'ignore' as const),
  }),
  transfer: fc.record({
    positiveMeaning: fc.constantFrom('withdrawal' as const, 'deposit' as const),
  }),
  trade: fc.record({
    positiveMeaning: fc.constantFrom('buy' as const, 'sell' as const),
  }),
  refund: fc.record({
    positiveMeaning: fc.constant('money_in' as const),
  }),
});

describe('Sign convention config encode → decode round-trip', () => {
  it('JSON.stringify → JSON.parse → schema parse produces equivalent config', () => {
    fc.assert(
      fc.property(validConfigArb, (config) => {
        const encoded = JSON.stringify(config);
        const decoded = JSON.parse(encoded);
        const validated = SignConventionConfigSchema.parse(decoded);
        expect(validated).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });

  it('normalizeAmount produces consistent results for the same inputs', () => {
    const nonZeroAmountArb = fc.oneof(
      fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true }).map((v) => -v),
    );
    const typeArb = fc.constantFrom(
      'EXPENSE' as const,
      'INCOME' as const,
      'TRANSFER' as const,
      'TRADE' as const,
      'REFUND' as const,
    );

    fc.assert(
      fc.property(nonZeroAmountArb, typeArb, validConfigArb, (raw, type, config) => {
        // Encode: normalize the amount
        const result1 = normalizeAmount(raw, type, config);
        // Decode: normalize again with the same inputs → same result (idempotent input)
        const result2 = normalizeAmount(raw, type, config);
        expect(result1).toEqual(result2);

        // If not excluded, the absolute value is preserved
        if (!('excluded' in result1)) {
          expect(Math.abs(result1.amount)).toBeCloseTo(Math.abs(raw), 5);
        }
      }),
      { numRuns: 100 },
    );
  });
});
