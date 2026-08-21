import type { HookDefinition } from '../types.js';
import type { DbClient } from '../db-client.js';
import { prisma } from '@budget-tracker/db';
import { splitPayment } from '@budget-tracker/core';

export const debtPaymentHook: HookDefinition = {
  name: 'debt-payment',
  events: ['created', 'deleted'],
  priority: 30,
  condition: (ctx) => !!ctx.tx.expenseId,
  async execute(ctx) {
    // Use the caller's transaction client when present so these writes join the
    // enclosing $transaction (e.g. a reconcile merge) and roll back with it. The
    // two writes below run sequentially rather than as a batch `$transaction`,
    // because a transaction client cannot open a nested one — inside an outer
    // transaction they are already atomic with it, and standalone they match the
    // best-effort posture of the other hooks (balance, snapshot).
    const db: DbClient = ctx.db ?? prisma;
    const amount = typeof ctx.tx.amount === 'number' ? ctx.tx.amount : ctx.tx.amount.toNumber();

    if (ctx.event === 'created') {
      const linkedDebt = await db.debt.findFirst({
        where: { linkedExpenseId: ctx.tx.expenseId!, paidOff: false },
      });
      if (!linkedDebt) return;

      const balance = Number(linkedDebt.currentBalance);
      const { principal, interest } = splitPayment(balance, Number(linkedDebt.apr), amount);
      const newBalance = Math.max(0, Math.round((balance - principal) * 100) / 100);

      await db.debtPayment.create({
        data: {
          debtId: linkedDebt.id,
          transactionId: ctx.tx.id,
          principalAmount: principal,
          interestAmount: interest,
          date: ctx.tx.date,
        },
      });
      await db.debt.update({
        where: { id: linkedDebt.id },
        data: {
          currentBalance: newBalance,
          ...(newBalance <= 0 ? { paidOff: true } : {}),
        },
      });
    } else if (ctx.event === 'deleted') {
      // Use pre-fetched payment from route (transactionId is nullified by onDelete: SetNull)
      type DebtPaymentWithDebt = {
        id: string;
        debtId: string;
        principalAmount: number | { toNumber(): number };
        debt: { currentBalance: number | { toNumber(): number } };
      };
      const debtPayment =
        (ctx._debtPayment as DebtPaymentWithDebt | undefined) ??
        (await db.debtPayment.findFirst({
          where: { transactionId: ctx.tx.id },
          include: { debt: true },
        }));
      if (!debtPayment) return;

      await db.debt.update({
        where: { id: debtPayment.debtId },
        data: {
          currentBalance:
            Math.round(
              (Number(debtPayment.debt.currentBalance) + Number(debtPayment.principalAmount)) * 100,
            ) / 100,
          paidOff: false,
        },
      });
      await db.debtPayment.delete({ where: { id: debtPayment.id } });
    }
  },
};
