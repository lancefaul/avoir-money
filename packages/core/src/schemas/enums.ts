import { z } from 'zod';

export const FrequencySchema = z.enum([
  'ONE_TIME',
  'WEEKLY',
  'BIWEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
  'ANNUAL',
]);

export const AccountTypeSchema = z.string().min(1).max(50);

export const BudgetGroupSchema = z.string().min(1).max(50);

export const BudgetGroupModelSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50),
  color: z.string(),
  createdAt: z.coerce.date(),
});

export const CreateBudgetGroupSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().default('#94a3b8'),
});

export const UpdateBudgetGroupSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().optional(),
});

// ─── Response Schemas ───

export const BudgetGroupResponseSchema = BudgetGroupModelSchema;
export const BudgetGroupListResponseSchema = z.array(BudgetGroupModelSchema);

// ─── Backward-compatible aliases (deprecated) ───

/** @deprecated Use BudgetGroupSchema */
export const CategoryGroupSchema = BudgetGroupSchema;
/** @deprecated Use BudgetGroupModelSchema */
export const CategoryGroupModelSchema = BudgetGroupModelSchema;
/** @deprecated Use CreateBudgetGroupSchema */
export const CreateCategoryGroupSchema = CreateBudgetGroupSchema;
/** @deprecated Use UpdateBudgetGroupSchema */
export const UpdateCategoryGroupSchema = UpdateBudgetGroupSchema;
/** @deprecated Use BudgetGroupResponseSchema */
export const CategoryGroupResponseSchema = BudgetGroupResponseSchema;
/** @deprecated Use BudgetGroupListResponseSchema */
export const CategoryGroupListResponseSchema = BudgetGroupListResponseSchema;

export const PayScheduleTypeSchema = z.enum(['WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY']);

export const InvestmentTypeSchema = z.enum(['STOCK', 'BITCOIN']);

export const CustodyTypeSchema = z.enum(['CUSTODIAL', 'NON_CUSTODIAL']);
export const StorageTypeSchema = z.enum(['HOT', 'COLD']);

export const GoalTypeSchema = z.enum([
  'SAVINGS',
  'DEBT_PAYOFF',
  'INVESTMENT',
  'SPENDING_LIMIT',
  'CUSTOM',
]);
