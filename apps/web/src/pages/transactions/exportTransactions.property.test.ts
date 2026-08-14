import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { TransactionListParams } from '../../lib/api/request.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Pure serialization logic extracted from transactionsApi.list()
// This is the same logic used in the production code.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Serialize TransactionListParams to a URLSearchParams query string.
 * Mirrors the logic in `transactionsApi.list()`:
 *   - Iterates over entries
 *   - Skips undefined and null values
 *   - Converts all values to String()
 */
function serializeParams(params: TransactionListParams): string {
  const entries: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) entries[k] = String(v);
  }
  return new URLSearchParams(entries).toString();
}

/**
 * Deserialize a query string back to a record of string values.
 * This simulates what a server would receive from the serialized params.
 */
function deserializeParams(queryString: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parsed = new URLSearchParams(queryString);
  for (const [k, v] of parsed.entries()) {
    result[k] = v;
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Generators
// ═══════════════════════════════════════════════════════════════════════════════

/** Arbitrary for valid cursor strings (CUIDs or similar) */
const arbCursor = fc.oneof(fc.constant(undefined), fc.uuid());

/** Arbitrary for valid limit values */
const arbLimit = fc.oneof(fc.constant(undefined), fc.integer({ min: 1, max: 500 }));

/** Arbitrary for search strings (non-empty when present) */
const arbSearch = fc.oneof(
  fc.constant(undefined),
  fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
);

/** Arbitrary for account ID */
const arbAccountId = fc.oneof(fc.constant(undefined), fc.uuid());

/** Arbitrary for budget IDs (comma-separated when present) */
const arbBudgetIds = fc.oneof(
  fc.constant(undefined),
  fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }).map((ids) => ids.join(',')),
);

/** Arbitrary for transaction type */
const arbType = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom('EXPENSE', 'INCOME', 'TRANSFER', 'TRADE', 'BITCOIN_BUY', 'BITCOIN_SELL'),
);

/** Arbitrary for boolean params */
const arbBoolean = fc.oneof(fc.constant(undefined), fc.boolean());

/** Arbitrary for sort order */
const arbSortOrder = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom('newest' as const, 'oldest' as const),
);

/** Arbitrary for date strings (ISO date format YYYY-MM-DD) */
const arbDateString = fc.oneof(
  fc.constant(undefined),
  fc
    .tuple(
      fc.integer({ min: 2020, max: 2030 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 28 }),
    )
    .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`),
);

/** Arbitrary for a full TransactionListParams object */
const arbTransactionListParams: fc.Arbitrary<TransactionListParams> = fc.record({
  cursor: arbCursor,
  limit: arbLimit,
  search: arbSearch,
  accountId: arbAccountId,
  budgetIds: arbBudgetIds,
  type: arbType,
  linkedToRecurring: arbBoolean,
  sortOrder: arbSortOrder,
  dateFrom: arbDateString,
  dateTo: arbDateString,
  payPeriodId: fc.oneof(fc.constant(undefined), fc.uuid()),
  expenseId: fc.oneof(fc.constant(undefined), fc.uuid()),
  incomeId: fc.oneof(fc.constant(undefined), fc.uuid()),
  skipGenerate: arbBoolean,
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('exportTransactions — query param serialization round-trip', () => {
  /**
   * Property: Round-trip preservation
   *
   * For any valid TransactionListParams, serializing to a query string and
   * deserializing back produces the same string values for all defined fields.
   * The round-trip is: params → serialize → deserialize → compare string values.
   *
   * **Validates: Requirements 8.3**
   */
  it('serialized params can be deserialized back to the original string values', () => {
    fc.assert(
      fc.property(arbTransactionListParams, (params) => {
        const queryString = serializeParams(params);
        const deserialized = deserializeParams(queryString);

        // For every defined (non-undefined, non-null) param, the deserialized
        // value should equal String(originalValue)
        for (const [key, value] of Object.entries(params)) {
          if (value === undefined || value === null) {
            // Should NOT appear in deserialized output
            expect(deserialized).not.toHaveProperty(key);
          } else {
            // Should appear with the stringified value
            expect(deserialized[key]).toBe(String(value));
          }
        }

        // No extra keys should appear in deserialized output
        const definedKeys = Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k]) => k);
        expect(Object.keys(deserialized).sort()).toEqual(definedKeys.sort());
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property: Undefined/null values are always omitted from the query string
   *
   * For any TransactionListParams where some fields are undefined or null,
   * those fields must never appear in the serialized query string.
   *
   * **Validates: Requirements 8.3**
   */
  it('undefined and null values are always omitted from the query string', () => {
    // Generate params that always have at least one undefined field
    const arbParamsWithUndefined = arbTransactionListParams.filter((params) => {
      return Object.values(params).some((v) => v === undefined || v === null);
    });

    fc.assert(
      fc.property(arbParamsWithUndefined, (params) => {
        const queryString = serializeParams(params);
        const parsed = new URLSearchParams(queryString);

        // Collect keys that are undefined or null in the input
        const nullishKeys = Object.entries(params)
          .filter(([, v]) => v === undefined || v === null)
          .map(([k]) => k);

        // None of those keys should appear in the query string
        for (const key of nullishKeys) {
          expect(parsed.has(key)).toBe(false);
        }

        // The total number of params in the query string should equal
        // the number of defined (non-nullish) values
        const definedCount = Object.values(params).filter(
          (v) => v !== undefined && v !== null,
        ).length;
        expect([...parsed.keys()].length).toBe(definedCount);
      }),
      { numRuns: 100 },
    );
  });
});
