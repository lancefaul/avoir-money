/**
 * Extra-payment logic for the debts route, extracted from routes/debts.ts.
 * The customer-facing transaction is created through the ledger gate
 * (`ledgerCreate`); the DebtPayment + balance update run in one prisma transaction.
 */
import { prisma } from '@budget-tracker/db';
import { splitPayment } from '@budget-tracker/core';
import type { Frequency } from '@budget-tracker/core';
import { ledgerCreate } from './lifecycle/ledger.js';

export interface ExtraPaymentInput {
  amount: number;
  date: string;
  accountId?: string;
  note?: string;
}

export type ExtraPaymentOutcome =
  | { ok: false; error: string; status: 400 | 404 }
  | {
      ok: true;
      result: {
        transaction: { id: string; date: string; amount: number };
        debtPayment: { id: string; principalAmount: number; interestAmount: number };
        newBalance: number;
      };
    };

/**
 * Record an extra payment against a debt: create the ledger transaction, split it
 * into principal/interest, persist the DebtPayment and update the debt balance.
 */
export async function applyExtraPayment(
  id: string,
  body: ExtraPaymentInput,
): Promise<ExtraPaymentOutcome> {
  // 1. Validate debt exists and isn't paid off
  const debt = await prisma.debt.findUnique({ where: { id } });
  if (!debt) return { ok: false, error: 'Debt not found', status: 404 };
  if (debt.paidOff) return { ok: false, error: 'Debt is already paid off', status: 400 };

  // 2. Determine accountId: body > debt.linkedAccountId > null
  const accountId = body.accountId ?? debt.linkedAccountId ?? null;

  // 3. Determine budgetId: linked expense's budget, or Uncategorized
  let budgetId: string | null = null;
  if (debt.linkedExpenseId) {
    const linkedExpense = await prisma.expense.findUnique({
      where: { id: debt.linkedExpenseId },
      select: { budgetId: true },
    });
    budgetId = linkedExpense?.budgetId ?? null;
  }
  if (!budgetId) {
    const uncatBudget = await prisma.budget.findFirst({
      where: { name: 'Uncategorized', isSystem: true },
      select: { id: true },
    });
    budgetId = uncatBudget?.id ?? null;
  }

  // 4. Create transaction via ledgerCreate (fires balance, pay period, etc.)
  const paymentDate = new Date(body.date);
  const tx = await ledgerCreate({
    type: 'EXPENSE',
    name: `${debt.name} Extra Payment`,
    amount: body.amount,
    date: paymentDate,
    accountId,
    budgetId,
    note: body.note ?? null,
    imported: false,
  });

  // 5. Split payment into principal/interest
  const currentBalance = Number(debt.currentBalance);
  const apr = Number(debt.apr);
  const { principal, interest } = splitPayment(
    currentBalance,
    apr,
    body.amount,
    debt.frequency as Frequency,
  );
  const newBalance = Math.max(0, currentBalance - principal);

  // 6. Create DebtPayment + update debt balance atomically
  const [debtPayment] = await prisma.$transaction([
    prisma.debtPayment.create({
      data: {
        debtId: id,
        transactionId: tx.id,
        principalAmount: principal,
        interestAmount: interest,
        date: paymentDate,
      },
    }),
    prisma.debt.update({
      where: { id },
      data: {
        currentBalance: newBalance,
        ...(newBalance <= 0 ? { paidOff: true } : {}),
      },
    }),
  ]);

  return {
    ok: true,
    result: {
      transaction: {
        id: tx.id,
        date: paymentDate.toISOString(),
        amount: body.amount,
      },
      debtPayment: {
        id: debtPayment.id,
        principalAmount: principal,
        interestAmount: interest,
      },
      newBalance,
    },
  };
}
