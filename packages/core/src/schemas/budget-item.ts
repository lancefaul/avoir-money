import { z } from 'zod';

export const BudgetItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  groupId: z.string(),
  groupName: z.string().optional(),
  groupColor: z.string().optional(),
  icon: z.string().nullable(),
  isCustom: z.boolean(),
  isSystem: z.boolean(),
  createdAt: z.coerce.date(),
});

export const CreateBudgetItemSchema = z.object({
  name: z.string().min(1).max(100),
  groupId: z.string(),
  icon: z.string().optional(),
});

export const UpdateBudgetItemSchema = CreateBudgetItemSchema.partial();

export const ListBudgetItemsQuerySchema = z.object({
  groupId: z.string().optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
});

// ─── Response Schemas ───

export const BudgetItemResponseSchema = BudgetItemSchema;
export const BudgetItemListResponseSchema = z.array(BudgetItemSchema);

// ─── Deletion Response Schemas ───

export const BudgetItemDeleteResponseSchema = z.object({
  deleted: z.boolean(),
  transactionsDeleted: z.number().optional(),
  budgetsDeleted: z.number().optional(),
});

export const BudgetItemSoftDeleteResponseSchema = z.object({
  softDeleted: z.boolean(),
});

export const BudgetItemReassignResponseSchema = z.object({
  reassigned: z.number(),
  budgetsDeleted: z.number(),
  deleted: z.boolean(),
});

// ─── Backward-compatible aliases (deprecated) ───

/** @deprecated Use BudgetItemSchema */
export const CategorySchema = BudgetItemSchema;
/** @deprecated Use CreateBudgetItemSchema */
export const CreateCategorySchema = CreateBudgetItemSchema;
/** @deprecated Use UpdateBudgetItemSchema */
export const UpdateCategorySchema = UpdateBudgetItemSchema;
/** @deprecated Use ListBudgetItemsQuerySchema */
export const ListCategoriesQuerySchema = ListBudgetItemsQuerySchema;
/** @deprecated Use BudgetItemResponseSchema */
export const CategoryResponseSchema = BudgetItemResponseSchema;
/** @deprecated Use BudgetItemListResponseSchema */
export const CategoryListResponseSchema = BudgetItemListResponseSchema;
/** @deprecated Use BudgetItemDeleteResponseSchema */
export const CategoryDeleteResponseSchema = BudgetItemDeleteResponseSchema;
/** @deprecated Use BudgetItemSoftDeleteResponseSchema */
export const CategorySoftDeleteResponseSchema = BudgetItemSoftDeleteResponseSchema;
/** @deprecated Use BudgetItemReassignResponseSchema */
export const CategoryReassignResponseSchema = BudgetItemReassignResponseSchema;
