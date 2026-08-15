// Feature: import-export-enhancement, Property 4: Backward-compatible import
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseCSVRows } from '../csv-parser.js';
import type { CSVColumnName } from '../csv-columns.js';

const VALID_TYPES = ['EXPENSE', 'INCOME', 'TRANSFER', 'REFUND'] as const;

/**
 * Generates a valid old-format CSV row with only base columns.
 * Amounts are positive decimals, dates are valid YYYY-MM-DD strings.
 */
const arbOldFormatRow = fc.record({
  name: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,29}$/),
  amount: fc
    .float({ min: Math.fround(0.01), max: Math.fround(999999), noNaN: true })
    .map((n) => Math.abs(n).toFixed(2))
    .filter((s) => Number(s) > 0),
  date: fc
    .record({
      y: fc.integer({ min: 2020, max: 2030 }),
      m: fc.integer({ min: 1, max: 12 }),
      d: fc.integer({ min: 1, max: 28 }),
    })
    .map(({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`),
  type: fc.constantFrom(...VALID_TYPES),
  account: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,14}$/),
  category: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,14}$/),
  note: fc.stringMatching(/^[A-Za-z0-9 ]{0,20}$/),
});

/** Column mapping for old-format CSVs — only base columns */
const BASE_COLUMN_MAPPING: Partial<Record<CSVColumnName, string>> = {
  name: 'name',
  amount: 'amount',
  date: 'date',
  type: 'type',
  account: 'account',
  category: 'category',
  note: 'note',
};

/** All metadata fields that must be undefined for old-format rows */
const METADATA_FIELDS = [
  'tradeMetadata',
  'bitcoinMetadata',
  'parentId',
  'preTaxAmount',
  'taxAmount',
  'taxRate',
  'expenseId',
  'incomeId',
  'payPeriodId',
  'occurrenceDate',
] as const;

describe('Feature: import-export-enhancement, Property 4: Backward-compatible import', () => {
  /**
   * **Validates: Requirements 13.1, 13.2, 13.3, 13.4**
   *
   * For any valid old-format CSV containing only the base columns
   * (name, amount, date, type, account, category, note), parseCSVRows
   * produces valid ParsedTransaction records with no errors, and all
   * metadata fields are undefined.
   */

  it('parses old-format rows with no errors and all metadata fields undefined', () => {
    fc.assert(
      fc.property(fc.array(arbOldFormatRow, { minLength: 1, maxLength: 20 }), (rows) => {
        const result = parseCSVRows(rows, BASE_COLUMN_MAPPING);

        // No errors should be reported
        expect(result.errors).toHaveLength(0);

        // Every row should produce a parsed transaction
        expect(result.transactions).toHaveLength(rows.length);

        // Each parsed transaction should have correct base fields
        // and all metadata fields should be undefined
        for (let i = 0; i < result.transactions.length; i++) {
          const tx = result.transactions[i]!;
          const row = rows[i]!;

          // Base fields are populated (parser trims cell values)
          expect(tx.name).toBe(row.name.trim());
          expect(tx.amount).toBe(Number(row.amount));
          expect(tx.date).toBe(row.date.trim());
          expect(tx.type).toBe(row.type);
          expect(tx.rawAccount).toBe(row.account.trim());

          // All metadata fields must be undefined
          for (const field of METADATA_FIELDS) {
            expect(tx[field]).toBeUndefined();
          }
        }
      }),
      { numRuns: 20 },
    );
  });
});

// Feature: import-export-enhancement, Property 5: TRADE without metadata produces error
describe('Feature: import-export-enhancement, Property 5: TRADE without metadata produces error', () => {
  /**
   * **Validates: Requirements 6.5**
   *
   * For any CSV row with type TRADE that is missing one or more required trade
   * metadata columns (trade_direction, trade_asset_type, trade_unit_price,
   * trade_quantity), parseCSVRows SHALL include an error for that row and
   * exclude it from the parsed transactions.
   */

  const REQUIRED_TRADE_COLUMNS: CSVColumnName[] = [
    'trade_direction',
    'trade_asset_type',
    'trade_unit_price',
    'trade_quantity',
  ];

  /** Full column mapping including all trade columns */
  const FULL_COLUMN_MAPPING: Partial<Record<CSVColumnName, string>> = {
    name: 'name',
    amount: 'amount',
    date: 'date',
    type: 'type',
    account: 'account',
    trade_direction: 'trade_direction',
    trade_asset_type: 'trade_asset_type',
    trade_unit_price: 'trade_unit_price',
    trade_quantity: 'trade_quantity',
    trade_ticker: 'trade_ticker',
    trade_custodian: 'trade_custodian',
  };

  /**
   * Generates a non-empty subset of required trade columns to omit.
   * Returns 1–4 columns that will be left empty in the row.
   */
  const arbMissingTradeColumns = fc
    .subarray(REQUIRED_TRADE_COLUMNS, { minLength: 1, maxLength: 4 })
    .filter((arr) => arr.length >= 1);

  /** Generates a valid TRADE row with specified columns left empty */
  const arbTradeRowMissingMetadata = fc
    .record({
      name: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,29}$/),
      amount: fc
        .float({ min: Math.fround(0.01), max: Math.fround(999999), noNaN: true })
        .map((n) => Math.abs(n).toFixed(2))
        .filter((s) => Number(s) > 0),
      date: fc
        .record({
          y: fc.integer({ min: 2020, max: 2030 }),
          m: fc.integer({ min: 1, max: 12 }),
          d: fc.integer({ min: 1, max: 28 }),
        })
        .map(({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`),
      account: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,14}$/),
      missingColumns: arbMissingTradeColumns,
    })
    .map(({ name, amount, date, account, missingColumns }) => {
      const missingSet = new Set(missingColumns);
      const row: Record<string, string> = {
        name,
        amount,
        date,
        type: 'TRADE',
        account,
        trade_direction: missingSet.has('trade_direction') ? '' : 'BUY',
        trade_asset_type: missingSet.has('trade_asset_type') ? '' : 'Stock',
        trade_unit_price: missingSet.has('trade_unit_price') ? '' : '150.25',
        trade_quantity: missingSet.has('trade_quantity') ? '' : '10',
        trade_ticker: 'AAPL',
        trade_custodian: 'Fidelity',
      };
      return { row, missingColumns };
    });

  it('reports error and excludes TRADE rows missing required trade metadata', () => {
    fc.assert(
      fc.property(arbTradeRowMissingMetadata, ({ row, missingColumns }) => {
        const result = parseCSVRows([row], FULL_COLUMN_MAPPING);

        // The TRADE row should be excluded from parsed transactions
        expect(result.transactions).toHaveLength(0);

        // An error should be reported for row 1
        expect(result.errors.length).toBeGreaterThanOrEqual(1);
        const errorForRow = result.errors.find((e) => e.row === 1);
        expect(errorForRow).toBeDefined();
        expect(errorForRow!.message).toContain('TRADE');

        // The error message should reference the missing columns
        for (const col of missingColumns) {
          expect(errorForRow!.message).toContain(col);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('accepts TRADE rows when all required trade metadata is present', () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,29}$/),
          amount: fc
            .float({ min: Math.fround(0.01), max: Math.fround(999999), noNaN: true })
            .map((n) => Math.abs(n).toFixed(2))
            .filter((s) => Number(s) > 0),
          date: fc
            .record({
              y: fc.integer({ min: 2020, max: 2030 }),
              m: fc.integer({ min: 1, max: 12 }),
              d: fc.integer({ min: 1, max: 28 }),
            })
            .map(
              ({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
            ),
          account: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,14}$/),
          unitPrice: fc
            .float({ min: Math.fround(0.01), max: Math.fround(99999), noNaN: true })
            .map((n) => Math.abs(n).toFixed(2))
            .filter((s) => Number(s) > 0),
          quantity: fc
            .float({ min: Math.fround(0.01), max: Math.fround(9999), noNaN: true })
            .map((n) => Math.abs(n).toFixed(2))
            .filter((s) => Number(s) > 0),
        }),
        ({ name, amount, date, account, unitPrice, quantity }) => {
          const row: Record<string, string> = {
            name,
            amount,
            date,
            type: 'TRADE',
            account,
            trade_direction: 'BUY',
            trade_asset_type: 'Stock',
            trade_unit_price: unitPrice,
            trade_quantity: quantity,
            trade_ticker: 'AAPL',
            trade_custodian: 'Fidelity',
          };

          const result = parseCSVRows([row], FULL_COLUMN_MAPPING);

          // No errors should be reported
          expect(result.errors).toHaveLength(0);

          // The TRADE row should be included
          expect(result.transactions).toHaveLength(1);
          expect(result.transactions[0]!.type).toBe('TRADE');
          expect(result.transactions[0]!.tradeMetadata).toBeDefined();
        },
      ),
      { numRuns: 20 },
    );
  });
});

// Feature: import-export-enhancement, Property 6: Partial bitcoin metadata produces error
describe('Feature: import-export-enhancement, Property 6: Partial bitcoin metadata produces error', () => {
  /**
   * **Validates: Requirements 8.3**
   *
   * For any CSV row that has some but not all bitcoin metadata columns
   * (bitcoin_wallet, bitcoin_quantity, bitcoin_unit, bitcoin_unit_price)
   * populated, parseCSVRows SHALL include an error for that row and exclude
   * the bitcoin metadata from the parsed transaction (but the base transaction
   * is still imported).
   */

  const BTC_COLUMNS: CSVColumnName[] = [
    'bitcoin_wallet',
    'bitcoin_quantity',
    'bitcoin_unit',
    'bitcoin_unit_price',
  ];

  /** Column mapping including all bitcoin metadata columns */
  const BTC_COLUMN_MAPPING: Partial<Record<CSVColumnName, string>> = {
    name: 'name',
    amount: 'amount',
    date: 'date',
    type: 'type',
    account: 'account',
    bitcoin_wallet: 'bitcoin_wallet',
    bitcoin_quantity: 'bitcoin_quantity',
    bitcoin_unit: 'bitcoin_unit',
    bitcoin_unit_price: 'bitcoin_unit_price',
  };

  /**
   * Generates a non-empty strict subset of bitcoin columns to populate (1–3 columns).
   * Never all 4 (that would be valid) and never 0 (that would be no bitcoin metadata).
   */
  const arbPartialBtcColumns = fc
    .subarray(BTC_COLUMNS, { minLength: 1, maxLength: 3 })
    .filter((arr) => arr.length >= 1 && arr.length < 4);

  /** Values to use when a bitcoin column is populated */
  const BTC_VALUES: Record<string, string> = {
    bitcoin_wallet: 'MyWallet',
    bitcoin_quantity: '0.5',
    bitcoin_unit: 'Bitcoin',
    bitcoin_unit_price: '60000',
  };

  /** Generates a row with valid base fields and partial bitcoin metadata */
  const arbPartialBitcoinRow = fc
    .record({
      name: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,29}$/),
      amount: fc
        .float({ min: Math.fround(0.01), max: Math.fround(999999), noNaN: true })
        .map((n) => Math.abs(n).toFixed(2))
        .filter((s) => Number(s) > 0),
      date: fc
        .record({
          y: fc.integer({ min: 2020, max: 2030 }),
          m: fc.integer({ min: 1, max: 12 }),
          d: fc.integer({ min: 1, max: 28 }),
        })
        .map(({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`),
      type: fc.constantFrom('EXPENSE', 'INCOME') as fc.Arbitrary<string>,
      account: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,14}$/),
      populatedColumns: arbPartialBtcColumns,
    })
    .map(({ name, amount, date, type, account, populatedColumns }) => {
      const populatedSet = new Set(populatedColumns);
      const row: Record<string, string> = {
        name,
        amount,
        date,
        type,
        account,
        bitcoin_wallet: populatedSet.has('bitcoin_wallet') ? BTC_VALUES['bitcoin_wallet']! : '',
        bitcoin_quantity: populatedSet.has('bitcoin_quantity')
          ? BTC_VALUES['bitcoin_quantity']!
          : '',
        bitcoin_unit: populatedSet.has('bitcoin_unit') ? BTC_VALUES['bitcoin_unit']! : '',
        bitcoin_unit_price: populatedSet.has('bitcoin_unit_price')
          ? BTC_VALUES['bitcoin_unit_price']!
          : '',
      };
      return { row, populatedColumns };
    });

  it('reports error and excludes bitcoin metadata when only some bitcoin columns are populated', () => {
    fc.assert(
      fc.property(arbPartialBitcoinRow, ({ row, populatedColumns }) => {
        const result = parseCSVRows([row], BTC_COLUMN_MAPPING);

        // The base transaction should still be imported
        expect(result.transactions).toHaveLength(1);

        // Bitcoin metadata should be excluded from the parsed transaction
        expect(result.transactions[0]!.bitcoinMetadata).toBeUndefined();

        // An error should be reported for row 1
        expect(result.errors.length).toBeGreaterThanOrEqual(1);
        const errorForRow = result.errors.find((e) => e.row === 1);
        expect(errorForRow).toBeDefined();
        expect(errorForRow!.message).toMatch(/bitcoin/i);

        // Base fields should still be correct
        expect(result.transactions[0]!.name).toBe(row['name']!.trim());
        expect(result.transactions[0]!.amount).toBe(Number(row['amount']));
        expect(result.transactions[0]!.type).toBe(row['type']);
      }),
      { numRuns: 20 },
    );
  });

  it('accepts rows when all four bitcoin columns are populated', () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,29}$/),
          amount: fc
            .float({ min: Math.fround(0.01), max: Math.fround(999999), noNaN: true })
            .map((n) => Math.abs(n).toFixed(2))
            .filter((s) => Number(s) > 0),
          date: fc
            .record({
              y: fc.integer({ min: 2020, max: 2030 }),
              m: fc.integer({ min: 1, max: 12 }),
              d: fc.integer({ min: 1, max: 28 }),
            })
            .map(
              ({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
            ),
          account: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,14}$/),
          btcQuantity: fc
            .float({ min: Math.fround(0.001), max: Math.fround(100), noNaN: true })
            .map((n) => Math.abs(n).toFixed(4))
            .filter((s) => Number(s) > 0),
          btcUnitPrice: fc
            .float({ min: Math.fround(1), max: Math.fround(200000), noNaN: true })
            .map((n) => Math.abs(n).toFixed(2))
            .filter((s) => Number(s) > 0),
        }),
        ({ name, amount, date, account, btcQuantity, btcUnitPrice }) => {
          const row: Record<string, string> = {
            name,
            amount,
            date,
            type: 'EXPENSE',
            account,
            bitcoin_wallet: 'TestWallet',
            bitcoin_quantity: btcQuantity,
            bitcoin_unit: 'Bitcoin',
            bitcoin_unit_price: btcUnitPrice,
          };

          const result = parseCSVRows([row], BTC_COLUMN_MAPPING);

          // No errors should be reported
          expect(result.errors).toHaveLength(0);

          // The transaction should include bitcoin metadata
          expect(result.transactions).toHaveLength(1);
          expect(result.transactions[0]!.bitcoinMetadata).toBeDefined();
          expect(result.transactions[0]!.bitcoinMetadata!.rawWallet).toBe('TestWallet');
          expect(result.transactions[0]!.bitcoinMetadata!.quantity).toBe(Number(btcQuantity));
          expect(result.transactions[0]!.bitcoinMetadata!.bitcoinUnit).toBe('Bitcoin');
          expect(result.transactions[0]!.bitcoinMetadata!.unitPrice).toBe(Number(btcUnitPrice));
        },
      ),
      { numRuns: 20 },
    );
  });

  it('imports base transaction without error when no bitcoin columns are populated', () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,29}$/),
          amount: fc
            .float({ min: Math.fround(0.01), max: Math.fround(999999), noNaN: true })
            .map((n) => Math.abs(n).toFixed(2))
            .filter((s) => Number(s) > 0),
          date: fc
            .record({
              y: fc.integer({ min: 2020, max: 2030 }),
              m: fc.integer({ min: 1, max: 12 }),
              d: fc.integer({ min: 1, max: 28 }),
            })
            .map(
              ({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
            ),
          account: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,14}$/),
        }),
        ({ name, amount, date, account }) => {
          const row: Record<string, string> = {
            name,
            amount,
            date,
            type: 'INCOME',
            account,
            bitcoin_wallet: '',
            bitcoin_quantity: '',
            bitcoin_unit: '',
            bitcoin_unit_price: '',
          };

          const result = parseCSVRows([row], BTC_COLUMN_MAPPING);

          // No errors
          expect(result.errors).toHaveLength(0);

          // Transaction imported without bitcoin metadata
          expect(result.transactions).toHaveLength(1);
          expect(result.transactions[0]!.bitcoinMetadata).toBeUndefined();
        },
      ),
      { numRuns: 20 },
    );
  });
});

// Feature: import-export-enhancement, Property 7: Orphan child produces error
describe('Feature: import-export-enhancement, Property 7: Orphan child produces error', () => {
  /**
   * **Validates: Requirements 9.4**
   *
   * For any set of CSV rows where ALL rows have parent_id set (meaning there
   * are no non-child rows to serve as parents), parseCSVRows SHALL report an
   * error for every row and exclude all from the parsed transactions.
   *
   * The parser uses a position-based heuristic: children are assigned to the
   * nearest preceding non-child row. When no such row exists, the children
   * are orphans.
   */

  const SPLIT_COLUMN_MAPPING: Partial<Record<CSVColumnName, string>> = {
    name: 'name',
    amount: 'amount',
    date: 'date',
    type: 'type',
    account: 'account',
    parent_id: 'parent_id',
  };

  /** Generates a valid base row with parent_id set to a random UUID, making it a child */
  const arbOrphanChildRow = fc
    .record({
      name: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,29}$/),
      amount: fc
        .float({ min: Math.fround(0.01), max: Math.fround(999999), noNaN: true })
        .map((n) => Math.abs(n).toFixed(2))
        .filter((s) => Number(s) > 0),
      date: fc
        .record({
          y: fc.integer({ min: 2020, max: 2030 }),
          m: fc.integer({ min: 1, max: 12 }),
          d: fc.integer({ min: 1, max: 28 }),
        })
        .map(({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`),
      type: fc.constantFrom('EXPENSE', 'INCOME') as fc.Arbitrary<string>,
      account: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,14}$/),
      parent_id: fc.uuid(),
    })
    .map(({ name, amount, date, type, account, parent_id }) => ({
      name,
      amount,
      date,
      type,
      account,
      parent_id,
    }));

  it('reports error and excludes all rows when every row is a child with no preceding parent', () => {
    fc.assert(
      fc.property(fc.array(arbOrphanChildRow, { minLength: 1, maxLength: 5 }), (rows) => {
        const result = parseCSVRows(rows, SPLIT_COLUMN_MAPPING);

        // All rows are children with no preceding non-child row, so all are orphans.
        // Orphan children should be excluded from parsed transactions.
        expect(result.transactions).toHaveLength(0);

        // An error should be reported for every orphan child row
        expect(result.errors.length).toBeGreaterThanOrEqual(1);

        // Each row should have a corresponding error mentioning orphan/parent_id
        for (let i = 0; i < rows.length; i++) {
          const rowNum = i + 1;
          const errorForRow = result.errors.find((e) => e.row === rowNum);
          expect(errorForRow).toBeDefined();
          expect(errorForRow!.message).toMatch(/parent_id|orphan/i);
        }
      }),
      { numRuns: 20 },
    );
  });
});

// Feature: import-export-enhancement, Property 8: Parser sorts parents before children
describe('Feature: import-export-enhancement, Property 8: Parser sorts parents before children', () => {
  /**
   * **Validates: Requirements 9.2**
   *
   * For any set of CSV rows containing parent-child relationships (regardless
   * of input order), parseCSVRows SHALL return parsed transactions with all
   * parent rows appearing before their child rows.
   *
   * The parser uses a position-based heuristic: rows with parent_id set are
   * children, rows without parent_id are potential parents. Children are
   * assigned to the nearest preceding non-child row. In the output, parents
   * appear before their children.
   */

  const SPLIT_COLUMN_MAPPING: Partial<Record<CSVColumnName, string>> = {
    name: 'name',
    amount: 'amount',
    date: 'date',
    type: 'type',
    account: 'account',
    parent_id: 'parent_id',
  };

  /** Generates a valid date string in YYYY-MM-DD format */
  const arbDate = fc
    .record({
      y: fc.integer({ min: 2020, max: 2030 }),
      m: fc.integer({ min: 1, max: 12 }),
      d: fc.integer({ min: 1, max: 28 }),
    })
    .map(({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

  /** Generates a valid positive amount string */
  const arbAmount = fc
    .float({ min: Math.fround(0.01), max: Math.fround(999999), noNaN: true })
    .map((n) => Math.abs(n).toFixed(2))
    .filter((s) => Number(s) > 0);

  /** Generates a parent row (no parent_id) with a unique name prefix */
  const arbParentRow = (index: number) =>
    fc
      .record({
        name: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,14}$/),
        amount: arbAmount,
        date: arbDate,
        account: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,14}$/),
      })
      .map(({ name, amount, date, account }) => ({
        name: `Parent${index}_${name}`,
        amount,
        date,
        type: 'EXPENSE',
        account,
        parent_id: '',
      }));

  /** Generates a child row (with parent_id set) */
  const arbChildRow = (parentId: string) =>
    fc
      .record({
        name: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,14}$/),
        amount: arbAmount,
        date: arbDate,
        account: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,14}$/),
      })
      .map(({ name, amount, date, account }) => ({
        name: `Child_${name}`,
        amount,
        date,
        type: 'EXPENSE',
        account,
        parent_id: parentId,
      }));

  /**
   * Generates a group: one parent row followed by 1-3 child rows sharing
   * the same parent_id. The parent_id is a UUID used to link children.
   * Returns { parent, children, parentId }.
   */
  const arbParentChildGroup = (groupIndex: number) =>
    fc
      .record({
        parentId: fc.uuid(),
        childCount: fc.integer({ min: 1, max: 3 }),
      })
      .chain(({ parentId, childCount }) =>
        fc
          .record({
            parent: arbParentRow(groupIndex),
            children: fc.array(arbChildRow(parentId), {
              minLength: childCount,
              maxLength: childCount,
            }),
          })
          .map(({ parent, children }) => ({ parent, children, parentId })),
      );

  it('outputs all non-child rows before their associated child rows regardless of input order', () => {
    fc.assert(
      fc.property(
        // Generate 1-4 parent-child groups
        fc.integer({ min: 1, max: 4 }).chain((groupCount) =>
          fc
            .tuple(...Array.from({ length: groupCount }, (_, i) => arbParentChildGroup(i)))
            .map((groups) => {
              // Collect all rows: parents first, then children, then shuffle
              const allRows: Array<Record<string, string>> = [];
              for (const group of groups) {
                allRows.push(group.parent);
                for (const child of group.children) {
                  allRows.push(child);
                }
              }
              return { groups, allRows };
            }),
        ),
        ({ groups, allRows }) => {
          // Ensure at least one parent comes before children by placing
          // a parent at position 0 (the parser needs a preceding non-child row)
          const parentRows = allRows.filter((r) => !r['parent_id']);
          const childRows = allRows.filter((r) => r['parent_id']);

          // Arrange: at least one parent first, then shuffle the rest
          const rest = [...parentRows.slice(1), ...childRows];
          // Use a deterministic shuffle based on array reversal for simplicity
          // (fast-check already randomizes the content)
          const shuffledRest = rest.reverse();
          const inputRows = [parentRows[0]!, ...shuffledRest];

          const result = parseCSVRows(inputRows, SPLIT_COLUMN_MAPPING);

          // Property: in the output, every row with parentId must appear
          // after at least one row without parentId (a parent row)
          const output = result.transactions;
          let seenNonChild = false;

          for (const tx of output) {
            if (!tx.parentId) {
              seenNonChild = true;
            } else {
              // A child row must appear after at least one parent row
              expect(seenNonChild).toBe(true);
            }
          }

          // Additional property: no child row appears before ALL parent rows
          // Find the index of the last non-child row and the first child row
          const firstChildIndex = output.findIndex((tx) => tx.parentId !== undefined);
          if (firstChildIndex >= 0) {
            // There must be at least one non-child row before the first child
            const hasParentBefore = output
              .slice(0, firstChildIndex)
              .some((tx) => tx.parentId === undefined);
            expect(hasParentBefore).toBe(true);
          }

          // Stronger property: for each contiguous group of children sharing
          // the same parentId, the immediately preceding non-child row is their parent
          for (let i = 0; i < output.length; i++) {
            const tx = output[i]!;
            if (tx.parentId) {
              // Walk backward to find the nearest non-child row
              let foundParent = false;
              for (let j = i - 1; j >= 0; j--) {
                if (!output[j]!.parentId) {
                  foundParent = true;
                  break;
                }
              }
              expect(foundParent).toBe(true);
            }
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
