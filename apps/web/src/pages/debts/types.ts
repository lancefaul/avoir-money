import type { z } from 'zod';
import type { CreateDebtSchema } from '@budget-tracker/core';

export type FormValues = z.infer<typeof CreateDebtSchema>;

export interface Account {
  id: string;
  name: string;
}
export interface Expense {
  id: string;
  name: string;
}

export const DEBT_TYPES = [
  { value: 'MORTGAGE', label: 'Mortgage' },
  { value: 'AUTO_LOAN', label: 'Auto Loan' },
  { value: 'STUDENT_LOAN', label: 'Student Loan' },
  { value: 'CREDIT_CARD', label: 'Credit Card' },
  { value: 'PERSONAL_LOAN', label: 'Personal Loan' },
  { value: 'OTHER', label: 'Other' },
] as const;

export const DEBT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  DEBT_TYPES.map((t) => [t.value, t.label]),
);

export const FREQUENCIES = [
  'WEEKLY',
  'BIWEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
  'ANNUAL',
] as const;

export const FREQUENCY_LABELS: Record<
  string,
  { period: string; extra: string; remaining: string }
> = {
  WEEKLY: { period: 'Week', extra: 'Extra Weekly Payment', remaining: 'Weeks Remaining' },
  BIWEEKLY: { period: 'Period', extra: 'Extra Biweekly Payment', remaining: 'Periods Remaining' },
  SEMI_MONTHLY: {
    period: 'Period',
    extra: 'Extra Semi-Monthly Payment',
    remaining: 'Periods Remaining',
  },
  MONTHLY: { period: 'Month', extra: 'Extra Monthly Payment', remaining: 'Months Remaining' },
  QUARTERLY: {
    period: 'Quarter',
    extra: 'Extra Quarterly Payment',
    remaining: 'Quarters Remaining',
  },
  BIANNUAL: {
    period: 'Half-Year',
    extra: 'Extra Biannual Payment',
    remaining: 'Half-Years Remaining',
  },
  ANNUAL: { period: 'Year', extra: 'Extra Annual Payment', remaining: 'Years Remaining' },
};

export function typeBadgeColor(type: string): string {
  switch (type) {
    case 'MORTGAGE':
      return 'bg-purple-100 text-purple-700';
    case 'AUTO_LOAN':
      return 'bg-blue-100 text-blue-700';
    case 'STUDENT_LOAN':
      return 'bg-amber-100 text-amber-700';
    case 'CREDIT_CARD':
      return 'bg-red-100 text-red-700';
    case 'PERSONAL_LOAN':
      return 'bg-green-100 text-green-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}
