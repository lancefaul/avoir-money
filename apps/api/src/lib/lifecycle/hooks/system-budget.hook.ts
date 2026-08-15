import type { HookDefinition } from '../types.js';
import type { DbClient } from '../db-client.js';
import { prisma } from '@budget-tracker/db';

/**
 * Maps transaction types to their system budget names.
 * When a transaction is created or its type changes on update,
 * the hook auto-assigns the matching system budget.
 */
const TYPE_TO_SYSTEM_BUDGET: Record<string, string> = {
  INCOME: 'Income',
  TRADE: 'Trade',
  TRANSFER: 'Transfer',
};

async function getSystemBudgetId(db: DbClient, budgetName: string): Promise<string | null> {
  // Always query fresh — prefer system budgets, fall back to any budget with the matching name
  const budget = await db.budget.findFirst({
    where: { name: budgetName },
    orderBy: [{ isSystem: 'desc' }, { createdAt: 'desc' }],
    select: { id: true },
  });
  return budget?.id ?? null;
}

export const systemBudgetHook: HookDefinition = {
  name: 'system-budget',
  events: ['created', 'updated'],
  priority: 5,
  condition: (ctx) => {
    const targetBudget = TYPE_TO_SYSTEM_BUDGET[ctx.tx.type];
    if (!targetBudget) return false;
    // On create (or when event is not set): always assign
    if (!ctx.event || ctx.event === 'created') return true;
    // On update: only if type changed
    if (ctx.event === 'updated' && ctx.oldTx) {
      return ctx.tx.type !== ctx.oldTx.type;
    }
    return false;
  },
  async execute(ctx) {
    const db = ctx.db ?? prisma;
    const budgetName = TYPE_TO_SYSTEM_BUDGET[ctx.tx.type];
    if (!budgetName) return;

    const budgetId = await getSystemBudgetId(db, budgetName);
    if (!budgetId) return;

    await db.transaction.update({
      where: { id: ctx.tx.id },
      data: { budgetId },
    });
    (ctx.tx as { budgetId: string | null }).budgetId = budgetId;
  },
};
