import { z } from 'zod';
import { CreateDebtSchema } from '@budget-tracker/core';
import { toPickerDate, fromPickerDate, type SelectOption } from '@budget-tracker/ui';
import { frequencyLabel } from '../../lib/utils.js';
import { DEBT_TYPES, FREQUENCIES } from './types.js';

/*
 * Both of these used to hand-roll the conversion, and both were wrong in the
 * same direction: `new Date(val)` parses a stored date as UTC, which the
 * picker's local getters then render as the previous day. Start Date and
 * Maturity Date on every debt displayed one day early.
 *
 * The DS owns this conversion now — see `toPickerDate`'s note on why the
 * picker's contract is a local-midnight Date.
 */
export function parseDate(val: unknown): Date | null {
  return typeof val === 'string' ? toPickerDate(val) : null;
}

export function formatDateStr(d: Date | null): string {
  return fromPickerDate(d);
}

// Extend the base debt schema with escrow form fields
export const DebtFormSchema = CreateDebtSchema.extend({
  // The form works with ISO date strings (DatePicker values); the API's
  // z.coerce.date() coerces them back to Date on submit.
  startDate: z.string().min(1, 'Start date is required'),
  maturityDate: z.string().optional(),
  escrowEnabled: z.boolean().optional(),
  escrowMonthlyAmount: z.number().nonnegative('Must be 0 or more').optional(),
  escrowPeriodStartDate: z.string().optional(),
  escrowPeriodEndDate: z.string().optional(),
})
  .refine(
    (d) => {
      if (!d.escrowEnabled) return true;
      return (
        d.escrowMonthlyAmount !== undefined &&
        d.escrowMonthlyAmount >= 0 &&
        !!d.escrowPeriodStartDate &&
        !!d.escrowPeriodEndDate
      );
    },
    {
      message: 'All escrow fields are required when escrow is enabled',
      path: ['escrowMonthlyAmount'],
    },
  )
  .refine(
    (d) => {
      if (!d.escrowEnabled || !d.escrowPeriodStartDate || !d.escrowPeriodEndDate) return true;
      return new Date(d.escrowPeriodStartDate) < new Date(d.escrowPeriodEndDate);
    },
    { message: 'Period start date must be before end date', path: ['escrowPeriodStartDate'] },
  )
  .refine(
    (d) => {
      if (!d.escrowEnabled || !d.escrowPeriodStartDate || !d.escrowPeriodEndDate) return true;
      const diffMs =
        new Date(d.escrowPeriodEndDate).getTime() - new Date(d.escrowPeriodStartDate).getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays <= 366;
    },
    { message: 'Escrow period must not exceed 366 days', path: ['escrowPeriodEndDate'] },
  );

export type DebtFormValues = z.infer<typeof DebtFormSchema>;

export const TYPE_OPTIONS: SelectOption[] = DEBT_TYPES.map((t) => ({
  value: t.value,
  label: t.label,
}));

export const FREQUENCY_OPTIONS: SelectOption[] = FREQUENCIES.map((f) => ({
  value: f,
  label: frequencyLabel(f),
}));
