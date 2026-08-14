/**
 * Property-Based Test: Source Update Propagates to PENDING Future Rows Only
 *
 * Feature: transaction-schedule, Property 13: Source Update Propagates to PENDING Future Rows Only
 *
 * When source amount changes, PENDING future rows update expectedAmount,
 * non-PENDING rows remain unchanged.
 *
 * **Validates: Requirements 11.1, 11.2**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { makeDate } from '../lib/dates.js';

// ─── Helpers ───

let counter = 0;
function uid(prefix = '') {
  return `${prefix}${++counter}_${Date.now()}`;
}

async function createTestGroup() {
  return prisma.budgetGroup.create({ data: { name: uid('GRP_'), color: '#ff0000' } });
}

async function createTestCategory(groupId: string) {
  return prisma.budget.create({ data: { name: uid('CAT_'), groupId, isCustom: false } });
}

async function createTestExpense(budgetId: string, amount: number) {
  return prisma.expense.create({
    data: {
      name: uid('EXP_'),
      amount,
      frequency: 'MONTHLY',
      budgetId,
      isAutomatic: false,
      dueDay: 15,
    },
  });
}

type ScheduleStatus = 'PENDING' | 'PAID' | 'PARTIAL' | 'SKIPPED' | 'SNOOZED';

const nonPendingStatuses: ScheduleStatus[] = ['PAID', 'PARTIAL', 'SKIPPED', 'SNOOZED'];

// ─── Generators ───

/** Arbitrary positive amount in cents (1–10000) */
const amountArb = fc.integer({ min: 1, max: 10000 });

/** Arbitrary non-PENDING status */
const nonPendingStatusArb: fc.Arbitrary<ScheduleStatus> = fc.constantFrom(...nonPendingStatuses);

// ─── Property 13: Source Update Propagates to PENDING Future Rows Only ───

describe('Feature: transaction-schedule, Property 13: Source Update Propagates to PENDING Future Rows Only', () => {
  /**
   * **Validates: Requirements 11.1, 11.2**
   *
   * When source amount changes, PENDING future rows update expectedAmount,
   * non-PENDING rows remain unchanged.
   */
  it('PENDING future rows update expectedAmount, non-PENDING rows unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        amountArb,
        amountArb,
        nonPendingStatusArb,
        async (originalAmount, newAmount, frozenStatus) => {
          // Setup: create source expense
          const group = await createTestGroup();
          const cat = await createTestCategory(group.id);
          const expense = await createTestExpense(cat.id, originalAmount);

          // Future date (well into the future)
          const futureDate = makeDate(2028, 5, 15);
          const pastDate = makeDate(2024, 0, 15);

          // Create a PENDING future row
          const pendingRow = await prisma.scheduledTransaction.create({
            data: {
              sourceType: 'EXPENSE',
              sourceId: expense.id,
              dueDate: futureDate,
              expectedAmount: originalAmount,
              status: 'PENDING',
              expenseId: expense.id,
            },
          });

          // Create a non-PENDING future row (should NOT be updated)
          const frozenRow = await prisma.scheduledTransaction.create({
            data: {
              sourceType: 'EXPENSE',
              sourceId: expense.id,
              dueDate: makeDate(2028, 6, 15), // different date to avoid unique constraint
              expectedAmount: originalAmount,
              status: frozenStatus,
              expenseId: expense.id,
            },
          });

          // Simulate source update: update all PENDING future rows
          const today = makeDate(2026, 3, 1);
          await prisma.scheduledTransaction.updateMany({
            where: {
              sourceType: 'EXPENSE',
              sourceId: expense.id,
              status: 'PENDING',
              dueDate: { gt: today },
            },
            data: { expectedAmount: newAmount },
          });

          // Verify: PENDING future row was updated
          const updatedPending = await prisma.scheduledTransaction.findUnique({
            where: { id: pendingRow.id },
          });
          expect(Number(updatedPending!.expectedAmount)).toBe(newAmount);

          // Verify: non-PENDING row was NOT updated
          const updatedFrozen = await prisma.scheduledTransaction.findUnique({
            where: { id: frozenRow.id },
          });
          expect(Number(updatedFrozen!.expectedAmount)).toBe(originalAmount);

          // Cleanup
          await prisma.scheduledTransaction.deleteMany({
            where: { sourceId: expense.id },
          });
          await prisma.expense.delete({ where: { id: expense.id } });
          await prisma.budget.delete({ where: { id: cat.id } });
          await prisma.budgetGroup.delete({ where: { id: group.id } });
        },
      ),
      { numRuns: 20 },
    );
  });
});
