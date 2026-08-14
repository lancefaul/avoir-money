export interface ExpenseRecord {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  budgetId: string;
  accountId: string | null;
  isAutomatic: boolean;
  skipWeekend: boolean;
  dueDay: number | null;
  dueWeekday: number | null;
  dueOrdinal: number | null;
  amountSchedule: Record<string, number> | null;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  pausedUntil: string | null;
  linkedDebtId: string | null;
  archivedAt: string | null;
  managementUrl: string | null;
}

export interface Category {
  id: string;
  name: string;
  group?: string;
  groupColor?: string;
  icon: string | null;
}

export interface Account {
  id: string;
  name: string;
}

export interface FormValues {
  name: string;
  amount: number;
  frequency: string;
  budgetId: string;
  accountId?: string;
  isAutomatic: boolean;
  skipWeekend?: boolean;
  dueType: 'day' | 'weekday';
  dueDay?: number;
  dueWeekday?: number;
  dueOrdinal?: number;
  amountMode: 'uniform' | 'byMonth';
  startDate?: string;
  endDate?: string;
  note?: string;
  linkedDebtId?: string;
  managementUrl?: string;
}

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

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const ORDINALS = [
  { value: 0, label: 'Every' },
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' },
  { value: -1, label: 'Last' },
];

export const FREQUENCIES = [
  'WEEKLY',
  'BIWEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
  'ANNUAL',
];
