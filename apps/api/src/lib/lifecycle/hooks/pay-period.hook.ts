import type { HookDefinition } from '../types.js';
import { prisma } from '@budget-tracker/db';
import { extendByOne } from '../../pay-periods.js';

export const payPeriodHook: HookDefinition = {
  name: 'pay-period-extension',
  events: ['created'],
  priority: 40,
  condition: (ctx) => !!ctx.tx.incomeId || !!ctx.tx.expenseId,
  async execute(ctx) {
    const db = ctx.db ?? prisma;
    let isRecurring = false;

    if (ctx.tx.incomeId) {
      const inc = await db.income.findUnique({
        where: { id: ctx.tx.incomeId },
        select: { frequency: true },
      });
      if (inc && inc.frequency !== 'ONE_TIME') isRecurring = true;
    }

    if (ctx.tx.expenseId) {
      const exp = await db.expense.findUnique({
        where: { id: ctx.tx.expenseId },
        select: { frequency: true },
      });
      if (exp && exp.frequency !== 'ONE_TIME') isRecurring = true;
    }

    if (isRecurring) {
      await extendByOne();
    }
  },
};
