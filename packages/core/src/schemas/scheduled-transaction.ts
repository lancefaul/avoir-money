import { z } from 'zod';

export const ScheduleStatusEnum = z.enum(['PENDING', 'PAID', 'PARTIAL', 'SKIPPED', 'SNOOZED']);

export const ScheduleSourceTypeEnum = z.enum(['EXPENSE', 'INCOME']);

export const ScheduledTransactionSchema = z.object({
  id: z.string(),
  sourceType: ScheduleSourceTypeEnum,
  sourceId: z.string(),
  dueDate: z.coerce.date(),
  expectedAmount: z.number(),
  actualAmount: z.number().nullable(),
  status: ScheduleStatusEnum,
  transactionId: z.string().nullable(),
  snoozedUntil: z.coerce.date().nullable(),
  note: z.string().nullable(),
  expenseId: z.string().nullable(),
  incomeId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const MarkScheduledPaidRequestSchema = z.object({
  amount: z.number().positive().optional(),
  date: z.coerce.date().optional(),
  accountId: z.string().optional(),
});

export const SnoozeScheduledRequestSchema = z.object({
  days: z.number().int().min(1),
});

export const ScheduledTransactionsQuerySchema = z.object({
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  sourceType: ScheduleSourceTypeEnum.optional(),
  sourceId: z.string().optional(),
});
