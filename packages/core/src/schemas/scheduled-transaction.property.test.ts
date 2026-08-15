import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  ScheduledTransactionSchema,
  ScheduleStatusEnum,
  ScheduleSourceTypeEnum,
} from './scheduled-transaction.js';

/**
 * Feature: transaction-schedule, Property 1: Schema Round-Trip
 * Validates: Requirements 1.1, 8.1, 8.5
 *
 * For any valid ScheduledTransaction object, serializing it to JSON via
 * JSON.stringify and then parsing the result with ScheduledTransactionSchema.parse
 * shall produce an object with equivalent field values.
 */

/** Generate a finite double that is never -0 (JSON.stringify(-0) === "0") */
const safeDouble = (opts: { min: number; max: number }) =>
  fc
    .double({ ...opts, noNaN: true, noDefaultInfinity: true })
    .map((n) => (Object.is(n, -0) ? 0 : n));

/** Generate a valid Date from a bounded integer timestamp */
const validDate = () =>
  fc.integer({ min: 946684800000, max: 4102444800000 }).map((ts) => new Date(ts));

function arbitraryScheduledTransaction() {
  const statuses = ScheduleStatusEnum.options;
  const sourceTypes = ScheduleSourceTypeEnum.options;

  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 30 }),
    sourceType: fc.constantFrom(...sourceTypes),
    sourceId: fc.string({ minLength: 1, maxLength: 30 }),
    dueDate: validDate(),
    expectedAmount: safeDouble({ min: -1_000_000, max: 1_000_000 }),
    actualAmount: fc.option(safeDouble({ min: -1_000_000, max: 1_000_000 }), { nil: null }),
    status: fc.constantFrom(...statuses),
    transactionId: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
    snoozedUntil: fc.option(validDate(), { nil: null }),
    note: fc.option(fc.string({ minLength: 0, maxLength: 100 }), { nil: null }),
    expenseId: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
    incomeId: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
    createdAt: validDate(),
    updatedAt: validDate(),
  });
}

describe('Property 1: Schema Round-Trip', () => {
  it('serializing a valid ScheduledTransaction to JSON then parsing with ScheduledTransactionSchema produces an equivalent object', () => {
    fc.assert(
      fc.property(arbitraryScheduledTransaction(), (original) => {
        const json = JSON.stringify(original);
        const parsed = ScheduledTransactionSchema.parse(JSON.parse(json));

        expect(parsed.id).toBe(original.id);
        expect(parsed.sourceType).toBe(original.sourceType);
        expect(parsed.sourceId).toBe(original.sourceId);
        expect(parsed.dueDate.getTime()).toBe(original.dueDate.getTime());
        expect(parsed.expectedAmount).toBe(original.expectedAmount);
        expect(parsed.actualAmount).toBe(original.actualAmount);
        expect(parsed.status).toBe(original.status);
        expect(parsed.transactionId).toBe(original.transactionId);
        if (original.snoozedUntil === null) {
          expect(parsed.snoozedUntil).toBeNull();
        } else {
          expect(parsed.snoozedUntil!.getTime()).toBe(original.snoozedUntil.getTime());
        }
        expect(parsed.note).toBe(original.note);
        expect(parsed.expenseId).toBe(original.expenseId);
        expect(parsed.incomeId).toBe(original.incomeId);
        expect(parsed.createdAt.getTime()).toBe(original.createdAt.getTime());
        expect(parsed.updatedAt.getTime()).toBe(original.updatedAt.getTime());
      }),
      { numRuns: 20 },
    );
  });
});
