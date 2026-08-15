export interface CategoryWithBudget {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  groupColor: string;
  icon: string | null;
  budgetId: string | null;
  monthlyEquivalent: number;
  nativeAmount: number;
  budgetFrequency: string;
  activeMonths: number[];
  actualSpending: number;
  remaining: number;
  status: 'under' | 'near' | 'over' | null;
  isVersionChanged: boolean;
  seasonal: boolean;
  versionId: string | null;
  linkedExpenseCount: number;
  manualOverride: boolean;
}

export interface CategoryBudgetGroup {
  groupName: string;
  groupColor: string;
  rows: CategoryWithBudget[];
  subtotalBudgeted: number;
  subtotalActual: number;
  subtotalRemaining: number;
}

export type DeletionMode = 'hard' | 'soft' | 'reassign';

export interface DeleteDialogState {
  open: boolean;
  categoryId: string;
  categoryName: string;
  step: 'choose' | 'confirm';
  mode: DeletionMode | null;
  targetCategoryId: string | null;
  transactionCount: number;
  hasBudget: boolean;
}

export type DisplayFrequency =
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'SEMI_MONTHLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'BIANNUAL'
  | 'ANNUAL';

export type ViewMode = 'PAY_PERIOD' | 'MONTHLY' | 'ANNUAL';
