import { z } from 'zod';
import { FrequencySchema } from './enums.js';

export const ExpenseSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  amount: z.number().nonnegative(),
  frequency: FrequencySchema,
  budgetId: z.string(),
  accountId: z.string().nullable(),
  isAutomatic: z.boolean(),
  skipWeekend: z.boolean(),
  dueDay: z.number().int().min(1).max(31).nullable(),
  dueWeekday: z.number().int().min(0).max(6).nullable(),
  dueOrdinal: z.number().int().nullable(),
  amountSchedule: z.record(z.string(), z.number()).nullable(),
  startDate: z.coerce.date().nullable(),
  endDate: z.coerce.date().nullable(),
  pausedUntil: z.coerce.date().nullable(),
  archivedAt: z.coerce.date().nullable(),
  note: z.string().nullable(),
  managementUrl: z.string().url().nullable(),
  linkedDebtId: z.string().nullable(),
  isLinkedToBudget: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateExpenseSchema = z.object({
  name: z.string().min(1).max(200),
  amount: z.number().nonnegative(),
  frequency: FrequencySchema,
  budgetId: z.string(),
  accountId: z.string().optional(),
  isAutomatic: z.boolean().default(false),
  skipWeekend: z.boolean().default(true),
  dueDay: z.number().int().min(1).max(31).optional(),
  dueWeekday: z.number().int().min(0).max(6).optional(),
  dueOrdinal: z.number().int().min(-1).max(4).optional(),
  amountSchedule: z.record(z.string(), z.number()).optional(),
  startDate: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.date().optional()),
  endDate: z.preprocess(
    (v) => (v === '' ? undefined : v === null ? null : v),
    z.union([z.null(), z.coerce.date()]).optional(),
  ),
  pausedUntil: z.coerce.date().nullable().optional(),
  note: z.string().optional(),
  managementUrl: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  linkedDebtId: z.string().nullish(),
});

export const UpdateExpenseSchema = CreateExpenseSchema.partial();

export const ListExpensesQuerySchema = z.object({
  budgetId: z.string().optional(),
  accountId: z.string().optional(),
  frequency: FrequencySchema.optional(),
  isAutomatic: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  archived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

// ─── Response Schemas ───

export const ExpenseResponseSchema = ExpenseSchema;
export const ExpenseListResponseSchema = z.array(ExpenseSchema);
