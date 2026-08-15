/**
 * Hook side-effects roll back with the enclosing `$transaction`.
 *
 * reconcile-merge task 1.2 threads the caller's transaction client through every
 * lifecycle hook. The invariant property test proves the *balance* survives a
 * rolled-back batch, but the balance hook was already transaction-aware. These
 * tests prove the part that was NOT: a hook that writes to another table
 * (schedule-matcher → ScheduledTransaction, debt-payment → Debt/DebtPayment) must
 * also join the transaction, so a failure undoes its side-effect too. Each of
 * these fails against the pre-threading code, where the hook wrote through the
 * module-level `prisma` and its write escaped the rollback.
 */
import { describe, it, expect } from 'vitest';
import {
  createAccount,
  createBudgetGroup,
  createBudget,
  createExpense,
  createDebt,
} from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';
import { ledgerCreate } from '../lib/lifecycle/index.js';

describe('lifecycle hook side-effects roll back with the transaction', () => {
  it('schedule-matcher: a rolled-back merge leaves the scheduled row PENDING', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const expense = await createExpense(budget.id);
    const account = await createAccount();

    const scheduled = await prisma.scheduledTransaction.create({
      data: {
        sourceType: 'EXPENSE',
        sourceId: expense.id,
        dueDate: new Date(Date.UTC(2026, 5, 15)),
        expectedAmount: 100,
        status: 'PENDING',
        expenseId: expense.id,
      },
    });

    await expect(
      prisma.$transaction(async (txc) => {
        // Inside the transaction the schedule-matcher hook marks the row PAID.
        await ledgerCreate(
          {
            type: 'EXPENSE',
            name: 'Rent Payment',
            amount: 100,
            date: new Date(Date.UTC(2026, 5, 14)), // within the ±5-day window
            accountId: account.id,
            expenseId: expense.id,
          },
          txc,
        );
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    // The match was undone with the transaction — the scheduled row is untouched.
    const after = await prisma.scheduledTransaction.findUniqueOrThrow({
      where: { id: scheduled.id },
    });
    expect(after.status).toBe('PENDING');
    expect(after.transactionId).toBeNull();
    expect(after.actualAmount).toBeNull();
  });

  it('debt-payment: a rolled-back payment leaves the debt balance and payment history untouched', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const expense = await createExpense(budget.id);
    const account = await createAccount();
    const debt = await createDebt({ linkedExpenseId: expense.id, currentBalance: 200000 });

    await expect(
      prisma.$transaction(async (txc) => {
        // Inside the transaction the debt-payment hook records a DebtPayment and
        // decrements Debt.currentBalance.
        await ledgerCreate(
          {
            type: 'EXPENSE',
            name: 'Mortgage Payment',
            amount: 1500,
            date: new Date(Date.UTC(2026, 5, 1)),
            accountId: account.id,
            expenseId: expense.id,
          },
          txc,
        );
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    // Neither the balance change nor the DebtPayment row survived.
    const afterDebt = await prisma.debt.findUniqueOrThrow({ where: { id: debt.id } });
    expect(Number(afterDebt.currentBalance)).toBe(200000);
    const payments = await prisma.debtPayment.count({ where: { debtId: debt.id } });
    expect(payments).toBe(0);
  });
});
