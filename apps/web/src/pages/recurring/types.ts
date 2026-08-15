import type { ExpenseRecord } from '../expenses/types.js';
import type { IncomeRecord } from '../income/types.js';

/** Unified expense/income row shown on the Recurring page. */
export interface RecurringItem {
  id: string;
  type: 'expense' | 'income';
  name: string;
  amount: number;
  frequency: string;
  budgetId: string;
  accountId: string | null;
  pausedUntil: string | null;
  archivedAt: string | null;
  managementUrl: string | null;
  original: ExpenseRecord | IncomeRecord;
}

export const FREQUENCY_ORDER = [
  'WEEKLY',
  'BIWEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
  'ANNUAL',
] as const;
