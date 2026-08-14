export interface IncomeRecord {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  budgetId: string;
  accountId: string | null;
  amountSchedule: Record<string, number> | null;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  pausedUntil: string | null;
  archivedAt: string | null;
  managementUrl: string | null;
}

export interface Category {
  id: string;
  name: string;
  groupName?: string;
  isSystem?: boolean;
}

export interface Account {
  id: string;
  name: string;
}

export interface FormValues {
  name: string;
  amount: number;
  frequency: string;
  accountId?: string;
  amountMode: 'uniform' | 'byMonth';
  startDate?: string;
  endDate?: string;
  note?: string;
  managementUrl?: string;
}

export const FREQUENCIES = [
  'ONE_TIME',
  'WEEKLY',
  'BIWEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
  'ANNUAL',
] as const;

export const FREQUENCY_ORDER = [
  'WEEKLY',
  'BIWEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
  'ANNUAL',
] as const;

export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
