import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { classifyExpenses, type ExpenseRecord } from '../classifyExpenses.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Generators
// ═══════════════════════════════════════════════════════════════════════════════

/** Arbitrary ISO-8601 date string (YYYY-MM-DD) */
const arbDateStr: fc.Arbitrary<string> = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

/** Arbitrary nullable date — null or a date string */
const arbNullableDate: fc.Arbitrary<string | null> = fc.oneof(fc.constant(null), arbDateStr);

/** Arbitrary for a single ExpenseRecord with controlled pausedUntil/archivedAt */
const arbExpenseRecord: fc.Arbitrary<ExpenseRecord> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  amount: fc.double({ min: 0.01, max: 100_000, noNaN: true }),
  frequency: fc.constantFrom('monthly', 'weekly', 'biweekly', 'yearly'),
  budgetId: fc.uuid(),
  accountId: fc.oneof(fc.constant(null), fc.uuid()),
  isAutomatic: fc.boolean(),
  skipWeekend: fc.boolean(),
  dueDay: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 31 })),
  dueWeekday: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 6 })),
  dueOrdinal: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 5 })),
  amountSchedule: fc.constant(null),
  startDate: arbNullableDate,
  endDate: arbNullableDate,
  note: fc.oneof(fc.constant(null), fc.string({ maxLength: 100 })),
  pausedUntil: arbNullableDate,
  linkedDebtId: fc.oneof(fc.constant(null), fc.uuid()),
  archivedAt: arbNullableDate,
  managementUrl: fc.oneof(fc.constant(null), fc.string({ maxLength: 200 })),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 1: Classification correctness
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * **Validates: Requirements 2.1, 3.1, 4.1**
 *
 * For any expense record, classifyExpenses SHALL place it in the Active section
 * if and only if archivedAt === null && pausedUntil === null, in the Paused
 * section if and only if archivedAt === null && pausedUntil !== null, and in
 * the Archived section if and only if archivedAt !== null.
 */
describe('Feature: recurring-sections, Property 1: Classification correctness', () => {
  it('every expense lands in the correct section based on archivedAt and pausedUntil', () => {
    fc.assert(
      fc.property(fc.array(arbExpenseRecord, { minLength: 0, maxLength: 50 }), (expenses) => {
        const { active, paused, archived } = classifyExpenses(expenses);

        // Every active expense must have archivedAt === null AND pausedUntil === null
        for (const e of active) {
          expect(e.archivedAt).toBeNull();
          expect(e.pausedUntil).toBeNull();
        }

        // Every paused expense must have archivedAt === null AND pausedUntil !== null
        for (const e of paused) {
          expect(e.archivedAt).toBeNull();
          expect(e.pausedUntil).not.toBeNull();
        }

        // Every archived expense must have archivedAt !== null
        for (const e of archived) {
          expect(e.archivedAt).not.toBeNull();
        }

        // Reverse: every input expense appears in exactly the section predicted by its fields
        for (const e of expenses) {
          if (e.archivedAt !== null) {
            expect(archived).toContainEqual(e);
          } else if (e.pausedUntil !== null) {
            expect(paused).toContainEqual(e);
          } else {
            expect(active).toContainEqual(e);
          }
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 2: Classification is a complete partition
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * **Validates: Requirements 2.1, 3.1, 4.1, 9.1**
 *
 * For any array of expense records, the three arrays returned by classifyExpenses
 * SHALL be mutually disjoint (no expense appears in more than one section) and
 * their union SHALL equal the original array (no expense is lost).
 */
describe('Feature: recurring-sections, Property 2: Classification is a complete partition', () => {
  it('total count across sections equals input length', () => {
    fc.assert(
      fc.property(fc.array(arbExpenseRecord, { minLength: 0, maxLength: 50 }), (expenses) => {
        const { active, paused, archived } = classifyExpenses(expenses);

        expect(active.length + paused.length + archived.length).toBe(expenses.length);
      }),
      { numRuns: 20 },
    );
  });

  it('no expense ID appears in more than one section', () => {
    fc.assert(
      fc.property(fc.array(arbExpenseRecord, { minLength: 0, maxLength: 50 }), (expenses) => {
        const { active, paused, archived } = classifyExpenses(expenses);

        const activeIds = new Set(active.map((e) => e.id));
        const pausedIds = new Set(paused.map((e) => e.id));
        const archivedIds = new Set(archived.map((e) => e.id));

        // No overlap between any two sections
        for (const id of activeIds) {
          expect(pausedIds.has(id)).toBe(false);
          expect(archivedIds.has(id)).toBe(false);
        }
        for (const id of pausedIds) {
          expect(archivedIds.has(id)).toBe(false);
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 3: Determinism — same input always produces same output
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * **Validates: Requirements 8.2**
 *
 * For any array of expense records, calling classifyExpenses twice with the
 * same input SHALL produce identical output — same items in same order in each
 * bucket. The function is pure with no hidden state.
 */
describe('Feature: recurring-sections, Property 3: Determinism', () => {
  it('calling classifyExpenses twice with same input produces identical output', () => {
    fc.assert(
      fc.property(fc.array(arbExpenseRecord, { minLength: 0, maxLength: 50 }), (expenses) => {
        const result1 = classifyExpenses(expenses);
        const result2 = classifyExpenses(expenses);

        expect(result1.active).toEqual(result2.active);
        expect(result1.paused).toEqual(result2.paused);
        expect(result1.archived).toEqual(result2.archived);
      }),
      { numRuns: 20 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 4: Account filter preserves classification invariant
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * **Validates: Requirements 7.1, 7.2**
 *
 * For any array of expense records and any account ID filter value, filtering
 * the array by accountId and then classifying the result SHALL produce sections
 * where every expense in every section has the matching accountId, and the total
 * count across all sections equals the number of expenses matching the filter.
 */
describe('Feature: recurring-sections, Property 4: Account filter preserves classification invariant', () => {
  it('filtering by accountId then classifying yields only matching expenses', () => {
    const arbAccountId = fc.uuid();

    fc.assert(
      fc.property(
        fc.array(arbExpenseRecord, { minLength: 0, maxLength: 50 }),
        arbAccountId,
        (expenses, filterAccountId) => {
          // Filter by accountId, then classify
          const filtered = expenses.filter((e) => e.accountId === filterAccountId);
          const { active, paused, archived } = classifyExpenses(filtered);

          // Every expense in every section must have the matching accountId
          for (const e of active) {
            expect(e.accountId).toBe(filterAccountId);
          }
          for (const e of paused) {
            expect(e.accountId).toBe(filterAccountId);
          }
          for (const e of archived) {
            expect(e.accountId).toBe(filterAccountId);
          }

          // Total count across sections equals the number of matching expenses
          expect(active.length + paused.length + archived.length).toBe(filtered.length);
        },
      ),
      { numRuns: 20 },
    );
  });
});
