import { z } from 'zod';
import { FrequencySchema } from './enums.js';

export const DebtTypeSchema = z.enum([
  'MORTGAGE',
  'AUTO_LOAN',
  'STUDENT_LOAN',
  'CREDIT_CARD',
  'PERSONAL_LOAN',
  'OTHER',
]);

export const DebtSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  type: DebtTypeSchema,
  originalBalance: z.number().nonnegative(),
  currentBalance: z.number().nonnegative(),
  apr: z.number().min(0).max(100),
  minimumPayment: z.number().nonnegative(),
  frequency: FrequencySchema,
  startDate: z.coerce.date(),
  maturityDate: z.coerce.date().nullable(),
  termMonths: z.number().int().positive().nullable(),
  linkedExpenseId: z.string().nullable(),
  linkedAccountId: z.string().nullable(),
  paidOff: z.boolean(),
  escrowEnabled: z.boolean(),
  note: z.string().nullable(),
  managementUrl: z.string().url().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  /**
   * Full monthly payment: the fixed principal+interest derived from the loan
   * terms (or minimumPayment for debts without a term) plus the current escrow
   * amount. Server-computed — this is what the debtor actually pays each period.
   */
  monthlyPayment: z.number().nonnegative(),
  /**
   * Server-computed estimated pay-off date (null when paid off or when the
   * payment can never retire the balance). Present on list responses; the
   * detail response narrows it to required via DebtWithProgressResponseSchema.
   */
  estimatedPayoffDate: z.coerce.date().nullable().optional(),
});

export const CreateDebtSchema = z.object({
  name: z.string().min(1).max(200),
  type: DebtTypeSchema,
  originalBalance: z.number().nonnegative(),
  currentBalance: z.number().nonnegative(),
  apr: z.number().min(0).max(100),
  minimumPayment: z.number().nonnegative(),
  frequency: FrequencySchema,
  startDate: z.coerce.date(),
  maturityDate: z.coerce.date().optional(),
  termMonths: z.number().int().positive().optional(),
  linkedExpenseId: z.string().optional(),
  linkedAccountId: z.string().optional(),
  escrowEnabled: z.boolean().optional(),
  note: z.string().optional(),
  managementUrl: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
});

export const UpdateDebtSchema = CreateDebtSchema.partial().extend({
  linkedExpenseId: z.string().nullish(),
  linkedAccountId: z.string().nullish(),
  maturityDate: z.coerce.date().nullish(),
  termMonths: z.number().int().positive().nullish(),
  escrowEnabled: z.boolean().optional(),
});

export const DebtPaymentSchema = z.object({
  id: z.string(),
  debtId: z.string(),
  transactionId: z.string().nullable(),
  principalAmount: z.number(),
  interestAmount: z.number(),
  date: z.coerce.date(),
  createdAt: z.coerce.date(),
});

export const DebtSummarySchema = z.object({
  totalBalance: z.number(),
  totalMinimumMonthly: z.number(),
  debtFreeDate: z.coerce.date().nullable(),
  activeCount: z.number(),
  paidOffCount: z.number(),
});

export const AmortizationEntrySchema = z.object({
  month: z.number(),
  paymentAmount: z.number(),
  principalAmount: z.number(),
  interestAmount: z.number(),
  escrowAmount: z.number().default(0),
  remainingBalance: z.number(),
});

export const AmortizationScheduleSchema = z.object({
  debtId: z.string(),
  entries: z.array(AmortizationEntrySchema),
  totalInterest: z.number(),
  totalPayments: z.number(),
  totalEscrow: z.number().default(0),
  payoffDate: z.coerce.date().nullable(),
  monthsRemaining: z.number(),
  isNegativelyAmortizing: z.boolean(),
});

export const ListDebtsQuerySchema = z.object({
  type: DebtTypeSchema.optional(),
  paidOff: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  linkedAccountId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const AmortizationQuerySchema = z.object({
  extraPayment: z.coerce.number().nonnegative().default(0),
  escrowAmount: z.coerce.number().nonnegative().default(0),
});

// ─── Escrow Schemas ───

export const EscrowRecordSchema = z.object({
  id: z.string(),
  debtId: z.string(),
  monthlyAmount: z.number().nonnegative(),
  periodStartDate: z.coerce.date(),
  periodEndDate: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ─── Response Schemas ───

export const DebtResponseSchema = DebtSchema;
export const DebtListResponseSchema = z.array(DebtSchema);
export const DebtPaymentListResponseSchema = z.array(DebtPaymentSchema);

export const DebtWithProgressResponseSchema = DebtSchema.extend({
  totalPrincipalPaid: z.number(),
  totalInterestPaid: z.number(),
  estimatedPayoffDate: z.coerce.date().nullable(),
  monthsRemaining: z.number(),
  currentEscrowRecord: EscrowRecordSchema.nullable().optional(),
});

export const CreateEscrowRecordSchema = z
  .object({
    monthlyAmount: z.number().nonnegative(),
    periodStartDate: z.coerce.date(),
    periodEndDate: z.coerce.date(),
  })
  .refine((d) => d.periodStartDate < d.periodEndDate, {
    message: 'Period start date must be before end date',
  })
  .refine(
    (d) => {
      const diffMs = d.periodEndDate.getTime() - d.periodStartDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays <= 366;
    },
    { message: 'Escrow period must not exceed 366 days' },
  );

export const UpdateEscrowRecordSchema = z
  .object({
    monthlyAmount: z.number().nonnegative().optional(),
    periodStartDate: z.coerce.date().optional(),
    periodEndDate: z.coerce.date().optional(),
  })
  .refine(
    (d) => {
      if (d.periodStartDate !== undefined && d.periodEndDate !== undefined) {
        return d.periodStartDate < d.periodEndDate;
      }
      return true;
    },
    { message: 'Period start date must be before end date' },
  )
  .refine(
    (d) => {
      if (d.periodStartDate !== undefined && d.periodEndDate !== undefined) {
        const diffMs = d.periodEndDate.getTime() - d.periodStartDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        return diffDays <= 366;
      }
      return true;
    },
    { message: 'Escrow period must not exceed 366 days' },
  );

export const EscrowRecordListResponseSchema = z.array(EscrowRecordSchema);

// ─── Extra Payment Schemas ───

export const ExtraPaymentSchema = z.object({
  amount: z.number().positive(),
  date: z.string(),
  accountId: z.string(),
  note: z.string().optional(),
});

export const ExtraPaymentResponseSchema = z.object({
  transaction: z.object({
    id: z.string(),
    date: z.string(),
    amount: z.number(),
  }),
  debtPayment: z.object({
    id: z.string(),
    principalAmount: z.number(),
    interestAmount: z.number(),
  }),
  newBalance: z.number(),
});
