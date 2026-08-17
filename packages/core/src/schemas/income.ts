import { z } from 'zod';
import { FrequencySchema } from './enums.js';

export const IncomeSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  amount: z.number().positive(),
  frequency: FrequencySchema,
  budgetId: z.string(),
  accountId: z.string().nullable(),
  amountSchedule: z.record(z.string(), z.number()).nullable(),
  startDate: z.coerce.date().nullable(),
  endDate: z.coerce.date().nullable(),
  pausedUntil: z.coerce.date().nullable(),
  archivedAt: z.coerce.date().nullable(),
  note: z.string().nullable(),
  managementUrl: z.string().url().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateIncomeSchema = z.object({
  name: z.string().min(1).max(200),
  amount: z.number().positive(),
  frequency: FrequencySchema,
  budgetId: z.string(),
  accountId: z.string().optional(),
  amountSchedule: z.record(z.string(), z.number()).nullable().optional(),
  startDate: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.date().optional()),
  endDate: z.preprocess(
    (v) => (v === '' ? undefined : v === null ? null : v),
    z.union([z.null(), z.coerce.date()]).optional(),
  ),
  pausedUntil: z.coerce.date().nullable().optional(),
  note: z.string().optional(),
  managementUrl: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
});

export const UpdateIncomeSchema = CreateIncomeSchema.partial();

export const ListIncomeQuerySchema = z.object({
  frequency: FrequencySchema.optional(),
  budgetId: z.string().optional(),
  archived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

// ─── Response Schemas ───

export const IncomeResponseSchema = IncomeSchema;
export const IncomeListResponseSchema = z.array(IncomeSchema);
