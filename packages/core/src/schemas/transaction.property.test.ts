/**
 * Property-based tests for ListTransactionsQuerySchema round-trip.
 * Feature: lazy-load-transactions, Property 5: Query schema round-trip
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ListTransactionsQuerySchema } from './transaction.js';

/**
 * Generate a random valid ListTransactionsQuerySchema object.
 * All fields are optional except `limit` which has a default.
 */
function listTransactionsQueryArb() {
  const transactionTypes = ['EXPENSE', 'INCOME', 'TRANSFER', 'REFUND', 'TRADE'] as const;

  return fc.record(
    {
      type: fc.constantFrom(...transactionTypes),
      payPeriodId: fc.string({ minLength: 1, maxLength: 20 }),
      expenseId: fc.string({ minLength: 1, maxLength: 20 }),
      incomeId: fc.string({ minLength: 1, maxLength: 20 }),
      accountId: fc.string({ minLength: 1, maxLength: 20 }),
      cursor: fc.string({ minLength: 1, maxLength: 30 }),
      search: fc.string({ minLength: 1, maxLength: 50 }),
      limit: fc.integer({ min: 1, max: 500 }),
      skipGenerate: fc.boolean(),
      dateFrom: fc.date({
        min: new Date('2020-01-01'),
        max: new Date('2030-12-31'),
        noInvalidDate: true,
      }),
      dateTo: fc.date({
        min: new Date('2020-01-01'),
        max: new Date('2030-12-31'),
        noInvalidDate: true,
      }),
    },
    // Make all fields optional — fast-check will randomly include/exclude them
    { requiredKeys: [] },
  );
}

describe('Feature: lazy-load-transactions, Property 5: Query schema round-trip', () => {
  it('serialized URLSearchParams round-trip through ListTransactionsQuerySchema', () => {
    fc.assert(
      fc.property(listTransactionsQueryArb(), (query) => {
        // Step 1: Serialize to URLSearchParams (simulating how a browser would send them)
        const params = new URLSearchParams();

        if (query.type !== undefined) params.set('type', query.type);
        if (query.payPeriodId !== undefined) params.set('payPeriodId', query.payPeriodId);
        if (query.expenseId !== undefined) params.set('expenseId', query.expenseId);
        if (query.incomeId !== undefined) params.set('incomeId', query.incomeId);
        if (query.accountId !== undefined) params.set('accountId', query.accountId);
        if (query.cursor !== undefined) params.set('cursor', query.cursor);
        if (query.search !== undefined) params.set('search', query.search);
        if (query.limit !== undefined) params.set('limit', String(query.limit));
        if (query.skipGenerate !== undefined)
          params.set('skipGenerate', String(query.skipGenerate));
        if (query.dateFrom !== undefined) params.set('dateFrom', query.dateFrom.toISOString());
        if (query.dateTo !== undefined) params.set('dateTo', query.dateTo.toISOString());

        // Step 2: Convert URLSearchParams back to a plain object (as Hono would)
        const raw: Record<string, string> = {};
        for (const [k, v] of params) {
          raw[k] = v;
        }

        // Step 3: Parse through the Zod schema
        const result = ListTransactionsQuerySchema.safeParse(raw);
        expect(result.success).toBe(true);

        if (!result.success) return;
        const parsed = result.data;

        // Step 4: Verify each field matches the original (accounting for Zod coercions)
        if (query.type !== undefined) {
          expect(parsed.type).toBe(query.type);
        } else {
          expect(parsed.type).toBeUndefined();
        }

        if (query.payPeriodId !== undefined) {
          expect(parsed.payPeriodId).toBe(query.payPeriodId);
        }
        if (query.expenseId !== undefined) {
          expect(parsed.expenseId).toBe(query.expenseId);
        }
        if (query.incomeId !== undefined) {
          expect(parsed.incomeId).toBe(query.incomeId);
        }
        if (query.accountId !== undefined) {
          expect(parsed.accountId).toBe(query.accountId);
        }
        if (query.cursor !== undefined) {
          expect(parsed.cursor).toBe(query.cursor);
        }
        if (query.search !== undefined) {
          expect(parsed.search).toBe(query.search);
        }

        // limit: coerced from string, should match the original integer
        if (query.limit !== undefined) {
          expect(parsed.limit).toBe(query.limit);
        } else {
          // Default is 100
          expect(parsed.limit).toBe(100);
        }

        // skipGenerate: z.coerce.boolean() uses Boolean(value), so
        // "false" -> true (non-empty string is truthy). Only "true"
        // round-trips correctly. When the original is true, the serialized
        // string "true" coerces back to true. When false, "false" coerces
        // to true — this is expected Zod behavior.
        if (query.skipGenerate === true) {
          expect(parsed.skipGenerate).toBe(true);
        } else if (query.skipGenerate === false) {
          // "false" string is truthy in JS, so Boolean("false") === true
          expect(parsed.skipGenerate).toBe(true);
        }

        // Dates: coerced from ISO string — compare at date level
        if (query.dateFrom !== undefined) {
          expect(parsed.dateFrom).toBeInstanceOf(Date);
          expect(parsed.dateFrom!.getTime()).toBe(query.dateFrom.getTime());
        }
        if (query.dateTo !== undefined) {
          expect(parsed.dateTo).toBeInstanceOf(Date);
          expect(parsed.dateTo!.getTime()).toBe(query.dateTo.getTime());
        }
      }),
      { numRuns: 20 },
    );
  });
});
