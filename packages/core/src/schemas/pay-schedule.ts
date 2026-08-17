import { z } from 'zod';
import { PayScheduleTypeSchema } from './enums.js';

// ─── Pay Schedule ───

export const PayScheduleSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  type: PayScheduleTypeSchema,
  anchorDate: z.coerce.date(),
  firstPayDay: z.number().int().min(1).max(31).nullable(),
  secondPayDay: z.number().int().min(1).max(31).nullable(),
  isDefault: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreatePayScheduleSchema = z
  .object({
    name: z.string().min(1).max(100).default('Primary'),
    type: PayScheduleTypeSchema,
    anchorDate: z.coerce.date(),
    firstPayDay: z.number().int().min(1).max(31).optional(),
    secondPayDay: z.number().int().min(1).max(31).optional(),
    isDefault: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'MONTHLY' && data.firstPayDay == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'firstPayDay is required for MONTHLY schedules',
        path: ['firstPayDay'],
      });
    }
    if (data.type === 'SEMI_MONTHLY') {
      if (data.firstPayDay == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'firstPayDay is required for SEMI_MONTHLY schedules',
          path: ['firstPayDay'],
        });
      }
      if (data.secondPayDay == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'secondPayDay is required for SEMI_MONTHLY schedules',
          path: ['secondPayDay'],
        });
      }
    }
  });

export const UpdatePayScheduleSchema = CreatePayScheduleSchema.innerType().partial();

export const GeneratePayPeriodsSchema = z.object({
  rangeStart: z.coerce.date(),
  rangeEnd: z.coerce.date(),
});

// ─── Pay Period ───

export const PayPeriodSchema = z.object({
  id: z.string(),
  scheduleId: z.string(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  payDate: z.coerce.date(),
  year: z.number().int(),
  periodNum: z.number().int().positive(),
});

export const ListPayPeriodsQuerySchema = z.object({
  scheduleId: z.string().optional(),
  year: z.coerce.number().int().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

// ─── Balance Snapshot ───

export const BalanceSnapshotSchema = z.object({
  id: z.string(),
  payPeriodId: z.string(),
  accountId: z.string(),
  openingBalance: z.number(),
  closingBalance: z.number(),
  totalIncome: z.number(),
  totalExpenses: z.number(),
  createdAt: z.coerce.date(),
});

export const CreateBalanceSnapshotSchema = z.object({
  payPeriodId: z.string(),
  accountId: z.string(),
  openingBalance: z.number(),
  closingBalance: z.number(),
  totalIncome: z.number(),
  totalExpenses: z.number(),
});

// ─── Response Schemas ───

export const PayScheduleResponseSchema = PayScheduleSchema;
export const PayScheduleListResponseSchema = z.array(PayScheduleSchema);

export const PayScheduleWithCountResponseSchema = PayScheduleSchema.extend({
  _count: z.object({ payPeriods: z.number().int() }),
});

export const PayPeriodResponseSchema = PayPeriodSchema;
export const PayPeriodListResponseSchema = z.array(PayPeriodSchema);

export const BalanceSnapshotResponseSchema = BalanceSnapshotSchema;
export const BalanceSnapshotListResponseSchema = z.array(BalanceSnapshotSchema);
