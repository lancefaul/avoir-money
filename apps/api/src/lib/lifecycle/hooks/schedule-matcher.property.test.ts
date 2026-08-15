/**
 * Property-Based Tests for Schedule Matcher Lifecycle Hook
 *
 * Tests Properties 7, 8, 9, and 10 from the design document.
 * DB-backed tests create fixtures (Account, Expense/Income, ScheduledTransaction),
 * then call the hook's execute function directly.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { scheduleMatcherHook } from './schedule-matcher.hook.js';
import { makeDate } from '../../dates.js';
import {
  createGroup,
  createCategory,
  createAccount,
  createExpense,
  createIncome,
} from '../../../test/helpers.js';
import type { TransactionRecord } from '../types.js';

// ─── Helpers ───

async function freshCategory() {
  const group = await createGroup();
  return (await createCategory(group.id)).id;
}

function buildTxRecord(
  overrides: Partial<TransactionRecord> & { id: string; date: Date; amount: number },
): TransactionRecord {
  return {
    type: 'EXPENSE',
    name: 'Test Tx',
    createdAt: new Date(),
    accountId: null,
    toAccountId: null,
    expenseId: null,
    incomeId: null,
    budgetId: null,
    ...overrides,
  };
}

// ─── Generators ───

/** Use integer cents to avoid floating-point precision issues with Prisma Decimal */
const amountArb = fc.integer({ min: 1, max: 1000000 }).map((c) => c / 100);
const dayOffsetArb = fc.integer({ min: -5, max: 5 }); // within ±5 day window
const dueDayArb = fc.integer({ min: 6, max: 22 }); // safe range to avoid month boundary issues

// ─── Property 7: Matcher Links Within Window With Correct Status ───
// Feature: transaction-schedule, Property 7: Matcher Links Within Window With Correct Status

describe('Feature: transaction-schedule, Property 7: Matcher Links Within Window With Correct Status', () => {
  /**
   * Validates: Requirements 3.1, 3.2, 3.3, 3.4
   *
   * PENDING row within ±5 days gets linked, status set to PAID or PARTIAL
   * based on amount comparison, closest dueDate selected when multiple matches.
   */
  it('links PENDING row within window and sets correct status', async () => {
    await fc.assert(
      fc.asyncProperty(
        amountArb,
        amountArb,
        dueDayArb,
        dayOffsetArb,
        fc.boolean(),
        async (expectedAmount, txAmount, dueDay, dayOffset, isExpense) => {
          const catId = await freshCategory();
          const account = await createAccount();

          const source = isExpense
            ? await createExpense(catId, { amount: expectedAmount, frequency: 'MONTHLY', dueDay })
            : await createIncome(catId, {
                amount: expectedAmount,
                frequency: 'MONTHLY',
                startDate: makeDate(2026, 0, 1),
              });

          const sourceType = isExpense ? 'EXPENSE' : 'INCOME';
          const sourceId = source.id;
          const dueDate = makeDate(2026, 3, dueDay);
          const txDate = new Date(dueDate.getTime() + dayOffset * 86_400_000);

          // Create a PENDING ScheduledTransaction
          const scheduled = await prisma.scheduledTransaction.create({
            data: {
              sourceType,
              sourceId,
              dueDate,
              expectedAmount,
              status: 'PENDING',
              expenseId: isExpense ? sourceId : null,
              incomeId: isExpense ? null : sourceId,
            },
          });

          // Create a real Transaction in the DB
          const tx = await prisma.transaction.create({
            data: {
              type: isExpense ? 'EXPENSE' : 'INCOME',
              name: 'PBT Tx',
              amount: txAmount,
              date: txDate,
              accountId: account.id,
              expenseId: isExpense ? sourceId : null,
              incomeId: isExpense ? null : sourceId,
              budgetId: catId,
            },
          });

          // Execute the hook
          const txRecord = buildTxRecord({
            id: tx.id,
            date: txDate,
            amount: txAmount,
            accountId: account.id,
            expenseId: isExpense ? sourceId : null,
            incomeId: isExpense ? null : sourceId,
            budgetId: catId,
          });

          await scheduleMatcherHook.execute({ event: 'created', tx: txRecord });

          // Verify
          const updated = await prisma.scheduledTransaction.findUnique({
            where: { id: scheduled.id },
          });

          expect(updated).not.toBeNull();
          expect(updated!.transactionId).toBe(tx.id);
          expect(Number(updated!.actualAmount)).toBeCloseTo(txAmount, 2);

          if (txAmount >= expectedAmount) {
            expect(updated!.status).toBe('PAID');
          } else {
            expect(updated!.status).toBe('PARTIAL');
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('picks closest dueDate when multiple PENDING rows match', async () => {
    await fc.assert(
      fc.asyncProperty(
        amountArb,
        amountArb,
        fc.integer({ min: 10, max: 18 }),
        async (expectedAmount, txAmount, baseDueDay) => {
          const catId = await freshCategory();
          const account = await createAccount();
          const expense = await createExpense(catId, {
            amount: expectedAmount,
            frequency: 'MONTHLY',
            dueDay: baseDueDay,
          });

          const sourceType = 'EXPENSE';
          const sourceId = expense.id;

          // Create two PENDING rows: one closer, one farther
          const closerDueDate = makeDate(2026, 5, baseDueDay);
          const fartherDueDate = makeDate(2026, 5, baseDueDay + 3);
          const txDate = makeDate(2026, 5, baseDueDay + 1); // 1 day from closer, 2 from farther

          const closer = await prisma.scheduledTransaction.create({
            data: {
              sourceType,
              sourceId,
              dueDate: closerDueDate,
              expectedAmount,
              status: 'PENDING',
              expenseId: sourceId,
            },
          });

          await prisma.scheduledTransaction.create({
            data: {
              sourceType,
              sourceId,
              dueDate: fartherDueDate,
              expectedAmount,
              status: 'PENDING',
              expenseId: sourceId,
            },
          });

          const tx = await prisma.transaction.create({
            data: {
              type: 'EXPENSE',
              name: 'PBT Tx',
              amount: txAmount,
              date: txDate,
              accountId: account.id,
              expenseId: sourceId,
              budgetId: catId,
            },
          });

          const txRecord = buildTxRecord({
            id: tx.id,
            date: txDate,
            amount: txAmount,
            accountId: account.id,
            expenseId: sourceId,
            budgetId: catId,
          });

          await scheduleMatcherHook.execute({ event: 'created', tx: txRecord });

          const updatedCloser = await prisma.scheduledTransaction.findUnique({
            where: { id: closer.id },
          });
          expect(updatedCloser!.transactionId).toBe(tx.id);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 8: Matcher Ignores Transactions Outside Window ───
// Feature: transaction-schedule, Property 8: Matcher Ignores Transactions Outside Window

describe('Feature: transaction-schedule, Property 8: Matcher Ignores Transactions Outside Window', () => {
  /**
   * Validates: Requirements 3.5
   *
   * No ScheduledTransaction modified when tx date is >5 days from all PENDING dueDates.
   */
  it('does not modify any ScheduledTransaction when outside ±5 day window', async () => {
    await fc.assert(
      fc.asyncProperty(
        amountArb,
        amountArb,
        dueDayArb,
        fc.integer({ min: 6, max: 20 }), // offset > 5 days
        fc.boolean(), // positive or negative offset
        async (expectedAmount, txAmount, dueDay, extraOffset, positive) => {
          const catId = await freshCategory();
          const account = await createAccount();
          const expense = await createExpense(catId, {
            amount: expectedAmount,
            frequency: 'MONTHLY',
            dueDay,
          });

          const sourceType = 'EXPENSE';
          const sourceId = expense.id;
          const dueDate = makeDate(2026, 3, dueDay);
          const offset = positive ? extraOffset : -extraOffset;
          const txDate = new Date(dueDate.getTime() + offset * 86_400_000);

          const scheduled = await prisma.scheduledTransaction.create({
            data: {
              sourceType,
              sourceId,
              dueDate,
              expectedAmount,
              status: 'PENDING',
              expenseId: sourceId,
            },
          });

          const tx = await prisma.transaction.create({
            data: {
              type: 'EXPENSE',
              name: 'PBT Tx',
              amount: txAmount,
              date: txDate,
              accountId: account.id,
              expenseId: sourceId,
              budgetId: catId,
            },
          });

          const txRecord = buildTxRecord({
            id: tx.id,
            date: txDate,
            amount: txAmount,
            accountId: account.id,
            expenseId: sourceId,
            budgetId: catId,
          });

          await scheduleMatcherHook.execute({ event: 'created', tx: txRecord });

          const unchanged = await prisma.scheduledTransaction.findUnique({
            where: { id: scheduled.id },
          });
          expect(unchanged!.status).toBe('PENDING');
          expect(unchanged!.transactionId).toBeNull();
          expect(unchanged!.actualAmount).toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 9: Delete Resets Linked Schedule Row ───
// Feature: transaction-schedule, Property 9: Delete Resets Linked Schedule Row

describe('Feature: transaction-schedule, Property 9: Delete Resets Linked Schedule Row', () => {
  /**
   * Validates: Requirements 3.6
   *
   * Deleting a linked transaction resets ScheduledTransaction to PENDING
   * with null transactionId and actualAmount.
   */
  it('resets linked ScheduledTransaction to PENDING on delete', async () => {
    await fc.assert(
      fc.asyncProperty(
        amountArb,
        amountArb,
        dueDayArb,
        fc.constantFrom('PAID' as const, 'PARTIAL' as const),
        async (expectedAmount, txAmount, dueDay, linkedStatus) => {
          const catId = await freshCategory();
          const account = await createAccount();
          const expense = await createExpense(catId, {
            amount: expectedAmount,
            frequency: 'MONTHLY',
            dueDay,
          });

          const sourceId = expense.id;
          const dueDate = makeDate(2026, 3, dueDay);

          // Create a transaction
          const tx = await prisma.transaction.create({
            data: {
              type: 'EXPENSE',
              name: 'PBT Tx',
              amount: txAmount,
              date: dueDate,
              accountId: account.id,
              expenseId: sourceId,
              budgetId: catId,
            },
          });

          // Create a linked ScheduledTransaction (PAID or PARTIAL)
          const scheduled = await prisma.scheduledTransaction.create({
            data: {
              sourceType: 'EXPENSE',
              sourceId,
              dueDate,
              expectedAmount,
              actualAmount: txAmount,
              status: linkedStatus,
              transactionId: tx.id,
              expenseId: sourceId,
            },
          });

          // Execute delete hook
          const txRecord = buildTxRecord({
            id: tx.id,
            date: dueDate,
            amount: txAmount,
            accountId: account.id,
            expenseId: sourceId,
            budgetId: catId,
          });

          await scheduleMatcherHook.execute({ event: 'deleted', tx: txRecord });

          const updated = await prisma.scheduledTransaction.findUnique({
            where: { id: scheduled.id },
          });
          expect(updated!.status).toBe('PENDING');
          expect(updated!.transactionId).toBeNull();
          expect(updated!.actualAmount).toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 10: Update Recalculates Status ───
// Feature: transaction-schedule, Property 10: Update Recalculates Status

describe('Feature: transaction-schedule, Property 10: Update Recalculates Status', () => {
  /**
   * Validates: Requirements 3.7
   *
   * Updating transaction amount recalculates PAID/PARTIAL on linked ScheduledTransaction.
   */
  it('recalculates status when transaction amount is updated', async () => {
    await fc.assert(
      fc.asyncProperty(
        amountArb,
        amountArb,
        amountArb,
        dueDayArb,
        async (expectedAmount, originalTxAmount, newTxAmount, dueDay) => {
          const catId = await freshCategory();
          const account = await createAccount();
          const expense = await createExpense(catId, {
            amount: expectedAmount,
            frequency: 'MONTHLY',
            dueDay,
          });

          const sourceId = expense.id;
          const dueDate = makeDate(2026, 3, dueDay);

          // Create a transaction with original amount
          const tx = await prisma.transaction.create({
            data: {
              type: 'EXPENSE',
              name: 'PBT Tx',
              amount: originalTxAmount,
              date: dueDate,
              accountId: account.id,
              expenseId: sourceId,
              budgetId: catId,
            },
          });

          const originalStatus = originalTxAmount >= expectedAmount ? 'PAID' : 'PARTIAL';

          // Create a linked ScheduledTransaction
          const scheduled = await prisma.scheduledTransaction.create({
            data: {
              sourceType: 'EXPENSE',
              sourceId,
              dueDate,
              expectedAmount,
              actualAmount: originalTxAmount,
              status: originalStatus,
              transactionId: tx.id,
              expenseId: sourceId,
            },
          });

          // Execute update hook with new amount
          const txRecord = buildTxRecord({
            id: tx.id,
            date: dueDate,
            amount: newTxAmount,
            accountId: account.id,
            expenseId: sourceId,
            budgetId: catId,
          });

          await scheduleMatcherHook.execute({ event: 'updated', tx: txRecord });

          const updated = await prisma.scheduledTransaction.findUnique({
            where: { id: scheduled.id },
          });
          expect(updated).not.toBeNull();
          expect(Number(updated!.actualAmount)).toBeCloseTo(newTxAmount, 2);

          if (newTxAmount >= expectedAmount) {
            expect(updated!.status).toBe('PAID');
          } else {
            expect(updated!.status).toBe('PARTIAL');
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
