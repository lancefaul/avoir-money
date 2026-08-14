import type { z } from 'zod';
import type { ExpenseSchema } from '@budget-tracker/core';

type Expense = z.infer<typeof ExpenseSchema>;

/** Shape of a Prisma Expense row as consumed by {@link serializeExpense}. */
export interface ExpenseRow {
  id: string;
  name: string;
  amount: { toNumber(): number };
  frequency: string;
  budgetId: string;
  accountId: string | null;
  isAutomatic: boolean;
  skipWeekend: boolean;
  dueDay: number | null;
  dueWeekday: number | null;
  dueOrdinal: number | null;
  amountSchedule: unknown;
  startDate: Date | null;
  endDate: Date | null;
  note: string | null;
  managementUrl: string | null;
  createdAt: Date;
  pausedUntil: Date | null;
  archivedAt: Date | null;
  updatedAt: Date;
  _count?: { budgetExpenseLinks: number };
  budgetExpenseLink?: { id: string } | null;
}

/** Serialize a Prisma Expense row into the API response shape. */
export function serializeExpense(r: ExpenseRow, linkedDebtId: string | null = null): Expense {
  return {
    id: r.id,
    name: r.name,
    amount: Number(r.amount),
    frequency: r.frequency as Expense['frequency'],
    budgetId: r.budgetId,
    accountId: r.accountId,
    isAutomatic: r.isAutomatic,
    skipWeekend: r.skipWeekend,
    dueDay: r.dueDay,
    dueWeekday: r.dueWeekday,
    dueOrdinal: r.dueOrdinal,
    amountSchedule: r.amountSchedule as Record<string, number> | null,
    startDate: r.startDate,
    endDate: r.endDate,
    pausedUntil: r.pausedUntil,
    archivedAt: r.archivedAt,
    note: r.note,
    managementUrl: r.managementUrl,
    linkedDebtId,
    isLinkedToBudget: !!r.budgetExpenseLink || (r._count?.budgetExpenseLinks ?? 0) > 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
