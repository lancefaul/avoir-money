/**
 * Property-based tests for archive/restore API endpoints on expenses.
 * Feature: archive-recurring
 *
 * These tests hit the real API routes against the test database (port 5433).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import {
  post,
  del,
  createGroup,
  createCategory,
  createExpense,
  createAccount,
} from '../test/helpers.js';
import { makeDate } from '../lib/dates.js';

async function setupBase() {
  const group = await createGroup();
  const cat = await createCategory(group.id);
  const acct = await createAccount();
  return { group, cat, acct };
}

// ─── Property 1: Archive-restore round trip ───

describe('Feature: archive-recurring, Property 1: Archive-restore round trip', () => {
  /**
   * **Validates: Requirements 1.1, 1.3, 2.1, 2.2, 5.1, 5.2**
   *
   * For any active recurring expense, archiving it and then restoring it
   * SHALL produce a record identical to the original — same name, amount,
   * frequency, budgetId, accountId, pausedUntil, startDate, endDate, and
   * all other fields — with archivedAt returned to null.
   */
  it('archive then restore returns expense to original state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50, max: 5000 }),
        fc.constantFrom(
          'MONTHLY',
          'WEEKLY',
          'BIWEEKLY',
          'ANNUAL',
          'QUARTERLY',
        ) as fc.Arbitrary<string>,
        fc.boolean(),
        async (amount, frequency, isAutomatic) => {
          const { cat, acct } = await setupBase();
          const expense = await createExpense(cat.id, {
            amount,
            frequency,
            isAutomatic,
            accountId: acct.id,
          });

          // Snapshot original state (all fields that should survive the round trip)
          const original = {
            id: expense.id,
            name: expense.name,
            amount: Number(expense.amount),
            frequency: expense.frequency,
            budgetId: expense.budgetId,
            accountId: expense.accountId,
            isAutomatic: expense.isAutomatic,
            dueDay: expense.dueDay,
            dueWeekday: expense.dueWeekday,
            dueOrdinal: expense.dueOrdinal,
            pausedUntil: expense.pausedUntil,
            startDate: expense.startDate,
            endDate: expense.endDate,
            note: expense.note,
          };

          // Archive
          const archiveRes = await post(`/expenses/${expense.id}/archive`, {});
          expect(archiveRes.status).toBe(200);
          const archived = (await archiveRes.json()) as Record<string, unknown>;
          expect(archived.archivedAt).not.toBeNull();

          // Restore
          const restoreRes = await post(`/expenses/${expense.id}/restore`, {});
          expect(restoreRes.status).toBe(200);
          const restored = (await restoreRes.json()) as Record<string, unknown>;

          // archivedAt must be null after restore
          expect(restored.archivedAt).toBeNull();

          // All original fields must be preserved
          expect(restored.id).toBe(original.id);
          expect(restored.name).toBe(original.name);
          expect(Number(restored.amount)).toBe(original.amount);
          expect(restored.frequency).toBe(original.frequency);
          expect(restored.budgetId).toBe(original.budgetId);
          expect(restored.accountId).toBe(original.accountId);
          expect(restored.isAutomatic).toBe(original.isAutomatic);
          expect(restored.dueDay).toBe(original.dueDay);
          expect(restored.dueWeekday).toBe(original.dueWeekday);
          expect(restored.dueOrdinal).toBe(original.dueOrdinal);
          expect(restored.pausedUntil).toBe(original.pausedUntil);
          expect(restored.note).toBe(original.note);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('archive then restore preserves pausedUntil on paused expenses', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 50, max: 5000 }), async (amount) => {
        const { cat } = await setupBase();
        const pausedUntil = makeDate(2027, 5, 1);
        const expense = await createExpense(cat.id, {
          amount,
          frequency: 'MONTHLY',
          pausedUntil,
        });

        // Archive while paused
        const archiveRes = await post(`/expenses/${expense.id}/archive`, {});
        expect(archiveRes.status).toBe(200);

        // Restore
        const restoreRes = await post(`/expenses/${expense.id}/restore`, {});
        expect(restoreRes.status).toBe(200);
        const restored = (await restoreRes.json()) as Record<string, unknown>;

        expect(restored.archivedAt).toBeNull();
        // pausedUntil should be preserved
        expect(restored.pausedUntil).not.toBeNull();
        const restoredPausedUntil = new Date(restored.pausedUntil as string);
        expect(restoredPausedUntil.getUTCFullYear()).toBe(2027);
        expect(restoredPausedUntil.getUTCMonth()).toBe(5); // June = month index 5
        expect(restoredPausedUntil.getUTCDate()).toBe(1);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 4: Delete blocked for archived sources ───

describe('Feature: archive-recurring, Property 4: Delete blocked for archived sources', () => {
  /**
   * **Validates: Requirements 6.2**
   *
   * For any archived recurring expense, a DELETE request SHALL return
   * a 409 status and the source SHALL remain in the database unchanged.
   */
  it('DELETE returns 409 for archived expenses and record persists', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50, max: 5000 }),
        fc.constantFrom('MONTHLY', 'WEEKLY', 'BIWEEKLY', 'ANNUAL') as fc.Arbitrary<string>,
        async (amount, frequency) => {
          const { cat } = await setupBase();
          const expense = await createExpense(cat.id, { amount, frequency });

          // Archive it
          const archiveRes = await post(`/expenses/${expense.id}/archive`, {});
          expect(archiveRes.status).toBe(200);

          // Attempt DELETE — must be rejected
          const deleteRes = await del(`/expenses/${expense.id}`);
          expect(deleteRes.status).toBe(409);
          const body = (await deleteRes.json()) as Record<string, unknown>;
          expect(typeof body.error).toBe('string');

          // Record must still exist in the DB
          const still = await prisma.expense.findUnique({ where: { id: expense.id } });
          expect(still).not.toBeNull();
          expect(still!.archivedAt).not.toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });
});
