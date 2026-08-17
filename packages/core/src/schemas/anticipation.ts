import { z } from 'zod';

/**
 * Legacy AnticipationSchema — retained for backward compatibility in the
 * PaginatedTransactionsResponseSchema. The transactions route maps
 * ScheduledTransaction rows to this shape so the frontend can consume them
 * without a breaking API change.
 */
export const AnticipationSchema = z.object({
  id: z.string(),
  sourceType: z.enum(['expense', 'income']),
  sourceId: z.string(),
  name: z.string(),
  amount: z.number(),
  occurrenceDate: z.coerce.date(),
  /**
   * `SNOOZED` only appears when the caller asked for it (`showSnoozed`). It is
   * carried rather than flattened into the others so the row can be shown as
   * silenced and offered an un-snooze, instead of reappearing as ordinary work.
   */
  status: z.enum(['DUE', 'OVERDUE', 'UPCOMING', 'SNOOZED']),
  budgetId: z.string(),
  accountId: z.string().nullable(),
  isAutomatic: z.boolean(),
  frequency: z.string(),
});

export const MarkAsPaidRequestSchema = z.object({
  date: z.coerce.date().optional(),
  amount: z.number().optional(),
  accountId: z.string().optional(),
});

export const SnoozeRequestSchema = z.object({
  days: z.number().int().min(1).max(7),
});

export const LinkRequestSchema = z.object({
  expenseId: z.string().optional(),
  incomeId: z.string().optional(),
});
