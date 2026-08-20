import { z } from 'zod';
import type { BudgetStatusResponse } from '@budget-tracker/core';
import type { SelectOption } from '@budget-tracker/ui';

export interface EditingCategory {
  id: string;
  name: string;
  icon: string | null;
  groupId: string;
}

export interface GroupOption {
  id: string;
  name: string;
}

export interface CategoryFormProps {
  editing: EditingCategory | null;
  budgetData: BudgetStatusResponse | null;
  groups: GroupOption[];
  yearPlanId: string | null;
  onClose: () => void;
  onSave: () => void;
}

export const FREQUENCIES = [
  'WEEKLY',
  'BIWEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
  'ANNUAL',
] as const;

export const FREQUENCY_OPTIONS: SelectOption[] = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Biweekly' },
  { value: 'SEMI_MONTHLY', label: 'Semi-monthly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'BIANNUAL', label: 'Biannual' },
  { value: 'ANNUAL', label: 'Annual' },
];

export const MONTH_OPTIONS: SelectOption[] = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

export const categoryFormSchema = z
  .object({
    emoji: z.string().min(1, 'Pick an emoji'),
    name: z.string().min(1, 'Name is required').max(100),
    groupId: z.string().min(1, 'Group is required'),
    trackOnly: z.boolean().default(false),
    amount: z.preprocess(
      (v) => (typeof v === 'number' && Number.isNaN(v) ? undefined : v),
      z.number({ invalid_type_error: 'Enter a valid number' }).optional(),
    ),
    frequency: z.enum(FREQUENCIES).default('MONTHLY'),
    effectiveMonth: z.number().int().min(1).max(12),
    seasonal: z.boolean().default(false),
    activeMonths: z.array(z.number().int().min(1).max(12)).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.trackOnly && data.amount !== undefined && data.amount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount must be greater than 0',
        path: ['amount'],
      });
    }
  });

export type CategoryFormValues = z.infer<typeof categoryFormSchema>;
