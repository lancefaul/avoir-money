import { z } from 'zod';
import { FrequencySchema } from './enums.js';

// ─── Enums ───

export const PlanStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);

export const BudgetFrequencySchema = z.enum([
  'WEEKLY',
  'BIWEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
  'ANNUAL',
  'YEARLY',
]);

// ─── Request Schemas ───

export const CreateYearPlanSchema = z.object({
  year: z.number().int().min(2000).max(2100),
});

export const CarryForwardSchema = z.object({
  sourceYear: z.number().int(),
});

const activeMonthsRefinement = (data: { activeMonths?: number[] }) => {
  if (!data.activeMonths) return true;
  return new Set(data.activeMonths).size === data.activeMonths.length;
};

const activeMonthsRefinementMessage = {
  message: 'activeMonths must not contain duplicate values',
  path: ['activeMonths'] as string[],
};

export const CreateCategoryBudgetSchema = z
  .object({
    yearPlanId: z.string(),
    budgetId: z.string(),
    amount: z.number().nonnegative(),
    frequency: BudgetFrequencySchema,
    effectiveMonth: z.number().int().min(1).max(12),
    activeMonths: z.array(z.number().int().min(1).max(12)).optional(),
  })
  .refine(activeMonthsRefinement, activeMonthsRefinementMessage);

export const UpdateCategoryBudgetSchema = z
  .object({
    amount: z.number().nonnegative().optional(),
    frequency: BudgetFrequencySchema.optional(),
    effectiveMonth: z.number().int().min(1).max(12).optional(),
    activeMonths: z.array(z.number().int().min(1).max(12)).optional(),
    manualOverride: z.boolean().optional(),
    doneForYear: z.boolean().optional(),
  })
  .refine(activeMonthsRefinement, activeMonthsRefinementMessage);

// ─── Response Schemas ───

export const YearPlanResponseSchema = z.object({
  id: z.string(),
  year: z.number(),
  status: PlanStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const BudgetVersionResponseSchema = z.object({
  id: z.string(),
  amount: z.number(),
  frequency: BudgetFrequencySchema,
  monthlyEquivalent: z.number(),
  activeMonths: z.array(z.number()),
  effectiveDate: z.string(),
  manualOverride: z.boolean(),
  createdAt: z.string(),
});

export const CategoryBudgetResponseSchema = z.object({
  id: z.string(),
  yearPlanId: z.string(),
  budgetId: z.string(),
  categoryName: z.string(),
  categoryGroup: z.string(),
  removedAt: z.string().nullable(),
  seasonal: z.boolean(),
  highWaterMark: z.number(),
  doneForYear: z.boolean(),
  linkedExpenseCount: z.number(),
  version: BudgetVersionResponseSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const BudgetStatusResponseSchema = CategoryBudgetResponseSchema.extend({
  actualSpending: z.number(),
  effectiveExpected: z.number().optional(),
  status: z.enum(['under', 'near', 'over']).nullable(),
});

export const BudgetHistoryResponseSchema = z.object({
  id: z.string(),
  categoryBudgetId: z.string(),
  versions: z.array(BudgetVersionResponseSchema),
});

// ─── Expense Linking Schemas ───

export const BudgetExpenseLinkResponseSchema = z.object({
  id: z.string(),
  categoryBudgetId: z.string(),
  expenseId: z.string(),
  expenseName: z.string(),
  expenseAmount: z.number(),
  expenseFrequency: FrequencySchema,
  monthlyEquivalent: z.number(),
  isPaused: z.boolean(),
  isArchived: z.boolean(),
  createdAt: z.string(),
});

export const LinkExpenseRequestSchema = z.object({
  expenseId: z.string(),
});

export const BulkLinkExpensesRequestSchema = z.object({
  expenseIds: z.array(z.string()).min(1),
});

// ─── Inferred Types ───

export type PlanStatus = z.infer<typeof PlanStatusSchema>;
export type BudgetFrequency = z.infer<typeof BudgetFrequencySchema>;
export type CreateYearPlan = z.infer<typeof CreateYearPlanSchema>;
export type CarryForward = z.infer<typeof CarryForwardSchema>;
export type CreateCategoryBudget = z.infer<typeof CreateCategoryBudgetSchema>;
export type UpdateCategoryBudget = z.infer<typeof UpdateCategoryBudgetSchema>;
export type YearPlanResponse = z.infer<typeof YearPlanResponseSchema>;
export type BudgetVersionResponse = z.infer<typeof BudgetVersionResponseSchema>;
export type CategoryBudgetResponse = z.infer<typeof CategoryBudgetResponseSchema>;
export type BudgetStatusResponse = z.infer<typeof BudgetStatusResponseSchema>;
export type BudgetHistoryResponse = z.infer<typeof BudgetHistoryResponseSchema>;
export type BudgetExpenseLinkResponse = z.infer<typeof BudgetExpenseLinkResponseSchema>;
export type LinkExpenseRequest = z.infer<typeof LinkExpenseRequestSchema>;
export type BulkLinkExpensesRequest = z.infer<typeof BulkLinkExpensesRequestSchema>;
