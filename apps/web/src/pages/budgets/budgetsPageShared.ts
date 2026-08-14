import type { SelectOption } from '@budget-tracker/ui';
import type { DeleteDialogState } from './types.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

/* Local types + constants for the Budgets page orchestrator, extracted from
   Budgets.tsx. Page-folder pattern: these are only used within pages/budgets. */

export interface CatGroup {
  id: string;
  name: string;
  color: string;
}

export interface Category {
  id: string;
  name: string;
  groupId: string;
  groupName?: string;
  groupColor?: string;
  icon: string | null;
  isCustom: boolean;
  isSystem: boolean;
}

export interface GroupFormValues {
  name: string;
  color: string;
}

export const INITIAL_DELETE_STATE: DeleteDialogState = {
  open: false,
  categoryId: '',
  categoryName: '',
  step: 'choose',
  mode: null,
  targetCategoryId: null,
  transactionCount: 0,
  hasBudget: false,
};

export const VIEW_MODE_OPTIONS: SelectOption[] = [
  { value: 'PAY_PERIOD', label: 'Pay Period' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'ANNUAL', label: 'Annual' },
];

export type SortOption = 'spent-desc' | 'spent-asc' | 'name-asc' | 'name-desc';

export const SORT_OPTIONS: SelectOption[] = [
  { value: 'spent-desc', label: 'Most Spent %' },
  { value: 'spent-asc', label: 'Least Spent %' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
];

/**
 * Below this width the header's Add Group / Add Budget buttons collapse to
 * icon-only buttons (tooltip carries the label).
 */
export const ICON_ACTIONS_BREAKPOINT = below.sm;

/** Parse an ISO date string (or Date) into a local-time Date (avoids UTC shift). */
export function parseLocalDate(iso: string | Date): Date {
  const s = typeof iso === 'string' ? iso : iso.toISOString();
  const parts = s.split('T')[0]!.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}
