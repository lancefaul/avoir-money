import type { z } from 'zod';
import type { IncomeSchema } from '@budget-tracker/core';

type Income = z.infer<typeof IncomeSchema>;

/** Shape of a Prisma Income row as consumed by {@link serializeIncome}. */
export interface IncomeRow {
  id: string;
  name: string;
  amount: { toNumber(): number };
  frequency: string;
  budgetId: string;
  accountId: string | null;
  amountSchedule: unknown;
  startDate: Date | null;
  endDate: Date | null;
  note: string | null;
  managementUrl: string | null;
  createdAt: Date;
  pausedUntil: Date | null;
  archivedAt: Date | null;
  updatedAt: Date;
}

/** Serialize a Prisma Income row into the API response shape. */
export function serializeIncome(r: IncomeRow): Income {
  return {
    id: r.id,
    name: r.name,
    amount: Number(r.amount),
    frequency: r.frequency as Income['frequency'],
    budgetId: r.budgetId,
    accountId: r.accountId,
    amountSchedule: r.amountSchedule as Record<string, number> | null,
    startDate: r.startDate,
    endDate: r.endDate,
    pausedUntil: r.pausedUntil,
    archivedAt: r.archivedAt,
    note: r.note,
    managementUrl: r.managementUrl,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
