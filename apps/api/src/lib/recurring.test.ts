/**
 * Integration tests for syncUtilityTransactionAmounts.
 *
 * Requirements: 13.1, 13.2, 13.3
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import {
  createAccount,
  createBudgetGroup,
  createBudget,
  createExpense,
  createTransaction,
} from '../test/helpers.js';
import { syncUtilityTransactionAmounts, computeUtilityTotalBill } from './recurring.js';

/**
 * Helper: create a UtilityProvider → UtilityService → UtilityReading chain
 * linked to an expense, plus a matching transaction in the reading's month.
 */
async function seedUtilityChain(opts: {
  expenseId: string;
  accountId: string;
  readingCost: number;
  convenienceFee?: number;
  convenienceFeeType?: string;
  otherFees?: number;
  billDate: Date;
  dueDate?: Date;
  transactionAmount: number;
  transactionDate: Date;
}) {
  const provider = await prisma.utilityProvider.create({
    data: { name: `PROV_${Date.now()}_${Math.random()}` },
  });

  const service = await prisma.utilityService.create({
    data: {
      providerId: provider.id,
      serviceType: 'ELECTRIC',
      metering: 'METERED',
      expenseId: opts.expenseId,
    },
  });

  const reading = await prisma.utilityReading.create({
    data: {
      serviceId: service.id,
      billDate: opts.billDate,
      dueDate: opts.dueDate ?? null,
      cost: opts.readingCost,
      convenienceFee: opts.convenienceFee ?? null,
      convenienceFeeType: opts.convenienceFeeType ?? null,
      otherFees: opts.otherFees ?? null,
    },
  });

  const tx = await createTransaction(opts.accountId, {
    expenseId: opts.expenseId,
    amount: opts.transactionAmount,
    date: opts.transactionDate,
  });

  return { provider, service, reading, tx };
}

describe('syncUtilityTransactionAmounts', () => {
  it('updates transaction amounts to computed utility total bill', async () => {
    // Seed: account → budget group → budget → expense → utility chain
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const account = await createAccount();
    const expense = await createExpense(budget.id);

    // Reading: cost=80, convenienceFee=5 (dollar), otherFees=3 → total = 80 + 5 + 3 = 88
    // Transaction starts at amount=100 (mismatched)
    const billDate = new Date(Date.UTC(2026, 5, 1)); // June 1
    const txDate = new Date(Date.UTC(2026, 5, 15)); // June 15 (same month)

    await seedUtilityChain({
      expenseId: expense.id,
      accountId: account.id,
      readingCost: 80,
      convenienceFee: 5,
      convenienceFeeType: 'dollar',
      otherFees: 3,
      billDate,
      transactionAmount: 100,
      transactionDate: txDate,
    });

    const updated = await syncUtilityTransactionAmounts();
    expect(updated).toBe(1);

    // Verify the transaction amount was updated to the computed total bill
    const txs = await prisma.transaction.findMany({
      where: { expenseId: expense.id },
    });
    expect(txs).toHaveLength(1);
    expect(Number(txs[0]!.amount)).toBe(88);
  });

  it('handles percent convenience fee correctly', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const account = await createAccount();
    const expense = await createExpense(budget.id);

    // Reading: cost=100, convenienceFee=10 (percent), otherFees=5
    // total = 100 + (100 * 10 / 100) + 5 = 100 + 10 + 5 = 115
    const billDate = new Date(Date.UTC(2026, 5, 1));
    const txDate = new Date(Date.UTC(2026, 5, 15));

    await seedUtilityChain({
      expenseId: expense.id,
      accountId: account.id,
      readingCost: 100,
      convenienceFee: 10,
      convenienceFeeType: 'percent',
      otherFees: 5,
      billDate,
      transactionAmount: 50,
      transactionDate: txDate,
    });

    const updated = await syncUtilityTransactionAmounts();
    expect(updated).toBe(1);

    const txs = await prisma.transaction.findMany({
      where: { expenseId: expense.id },
    });
    expect(Number(txs[0]!.amount)).toBe(115);
  });

  it('returns 0 and performs no updates when no utility links exist', async () => {
    // No utility services with expenseId set — nothing to sync
    const updated = await syncUtilityTransactionAmounts();
    expect(updated).toBe(0);
  });

  it('skips transaction when amount already matches reading cost', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const account = await createAccount();
    const expense = await createExpense(budget.id);

    // Reading: cost=75, no fees → total = 75
    // Transaction already at 75 — should be skipped
    const billDate = new Date(Date.UTC(2026, 5, 1));
    const txDate = new Date(Date.UTC(2026, 5, 15));

    const { tx } = await seedUtilityChain({
      expenseId: expense.id,
      accountId: account.id,
      readingCost: 75,
      transactionAmount: 75,
      transactionDate: txDate,
      billDate,
    });

    const updated = await syncUtilityTransactionAmounts();
    expect(updated).toBe(0);

    // Verify the transaction was not modified
    const freshTx = await prisma.transaction.findUnique({ where: { id: tx.id } });
    expect(Number(freshTx!.amount)).toBe(75);
  });

  it('uses dueDate for month matching when available', async () => {
    const group = await createBudgetGroup();
    const budget = await createBudget(group.id);
    const account = await createAccount();
    const expense = await createExpense(budget.id);

    // billDate is in May, but dueDate is in June — should match June transaction
    const billDate = new Date(Date.UTC(2026, 4, 25)); // May 25
    const dueDate = new Date(Date.UTC(2026, 5, 10)); // June 10
    const txDate = new Date(Date.UTC(2026, 5, 15)); // June 15

    await seedUtilityChain({
      expenseId: expense.id,
      accountId: account.id,
      readingCost: 60,
      billDate,
      dueDate,
      transactionAmount: 100,
      transactionDate: txDate,
    });

    const updated = await syncUtilityTransactionAmounts();
    expect(updated).toBe(1);

    const txs = await prisma.transaction.findMany({
      where: { expenseId: expense.id },
    });
    expect(Number(txs[0]!.amount)).toBe(60);
  });
});

describe('computeUtilityTotalBill with Decimal-like objects', () => {
  it('handles Decimal-like cost, convenienceFee, and otherFees via toNumber()', () => {
    const reading = {
      cost: { toNumber: () => 80 },
      convenienceFee: { toNumber: () => 5 },
      convenienceFeeType: 'dollar',
      otherFees: { toNumber: () => 3 },
    };
    // total = 80 + 5 + 3 = 88
    expect(computeUtilityTotalBill(reading)).toBe(88);
  });

  it('handles Decimal-like cost with percent fee type', () => {
    const reading = {
      cost: { toNumber: () => 100 },
      convenienceFee: { toNumber: () => 10 },
      convenienceFeeType: 'percent',
      otherFees: { toNumber: () => 5 },
    };
    // total = 100 + (100 * 10 / 100) + 5 = 115
    expect(computeUtilityTotalBill(reading)).toBe(115);
  });

  it('handles Decimal-like cost with null fees', () => {
    const reading = {
      cost: { toNumber: () => 50 },
      convenienceFee: null,
      convenienceFeeType: null,
      otherFees: null,
    };
    // total = 50 + 0 + 0 = 50
    expect(computeUtilityTotalBill(reading)).toBe(50);
  });
});
