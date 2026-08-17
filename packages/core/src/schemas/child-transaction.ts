import { z } from 'zod';

// ─── Tax Computation Types ───

export interface TaxInput {
  preTaxAmount: number;
  taxAmount?: number;
  taxRate?: number;
}

export interface LineTotal {
  preTaxAmount: number;
  taxAmount: number;
  lineTotal: number;
}

// ─── Tax Computation ───

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeLineTotal(input: TaxInput): LineTotal {
  const { preTaxAmount, taxAmount, taxRate } = input;

  if (taxAmount !== undefined && taxRate !== undefined) {
    throw new Error('Provide either taxAmount or taxRate, not both');
  }

  if (taxAmount !== undefined) {
    return {
      preTaxAmount: round2(preTaxAmount),
      taxAmount: round2(taxAmount),
      lineTotal: round2(preTaxAmount + taxAmount),
    };
  }

  if (taxRate !== undefined) {
    const computed = round2((preTaxAmount * taxRate) / 100);
    return {
      preTaxAmount: round2(preTaxAmount),
      taxAmount: computed,
      lineTotal: round2(preTaxAmount + computed),
    };
  }

  return {
    preTaxAmount: round2(preTaxAmount),
    taxAmount: 0,
    lineTotal: round2(preTaxAmount),
  };
}

// ─── Zod Schemas ───

const taxMutualExclusion = (
  data: { taxAmount?: number; taxRate?: number },
  ctx: z.RefinementCtx,
) => {
  if (data.taxAmount !== undefined && data.taxRate !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide either taxAmount or taxRate, not both',
      path: ['taxAmount'],
    });
  }
};

export const CreateChildTransactionSchema = z
  .object({
    budgetId: z.string().min(1),
    preTaxAmount: z.number().positive().max(999999999),
    taxAmount: z.number().nonnegative().optional(),
    taxRate: z.number().nonnegative().max(100).optional(),
    note: z.string().max(500).optional(),
  })
  .superRefine(taxMutualExclusion);

export const UpdateChildTransactionSchema = z
  .object({
    budgetId: z.string().min(1),
    preTaxAmount: z.number().positive().max(999999999),
    taxAmount: z.number().nonnegative().optional(),
    taxRate: z.number().nonnegative().max(100).optional(),
    note: z.string().max(500).optional(),
  })
  .partial()
  .superRefine(taxMutualExclusion);

export const ChildTransactionSchema = z.object({
  id: z.string(),
  parentId: z.string(),
  budgetId: z.string(),
  preTaxAmount: z.number(),
  taxAmount: z.number(),
  taxRate: z.number().nullable(),
  lineTotal: z.number(),
  note: z.string().nullable(),
  createdAt: z.coerce.date(),
});

export const ChildrenResponseSchema = z.object({
  children: z.array(ChildTransactionSchema),
  remainingAmount: z.number(),
  parentAmount: z.number(),
});

// ─── Inferred Types ───

export type CreateChildTransaction = z.infer<typeof CreateChildTransactionSchema>;
export type UpdateChildTransaction = z.infer<typeof UpdateChildTransactionSchema>;
export type ChildTransaction = z.infer<typeof ChildTransactionSchema>;
export type ChildrenResponse = z.infer<typeof ChildrenResponseSchema>;
