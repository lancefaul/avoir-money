import { z } from 'zod';
import { GoalTypeSchema } from './enums.js';

export const BudgetGoalSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  type: GoalTypeSchema,
  targetAmount: z.number().positive(),
  currentAmount: z.number().nonnegative(),
  budgetId: z.string().nullable(),
  deadline: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateBudgetGoalSchema = z.object({
  name: z.string().min(1).max(200),
  type: GoalTypeSchema,
  targetAmount: z.number().positive(),
  currentAmount: z.number().nonnegative().default(0),
  budgetId: z.string().optional(),
  deadline: z.coerce.date().optional(),
});

export const UpdateBudgetGoalSchema = CreateBudgetGoalSchema.partial();

// ─── Response Schemas ───

export const BudgetGoalResponseSchema = BudgetGoalSchema;
export const BudgetGoalListResponseSchema = z.array(BudgetGoalSchema);
