/**
 * Serialization helpers + Prisma include for category budgets, extracted from
 * routes/category-budgets.ts so both the route handlers and the list-status
 * computation (category-budget-status.ts) can share them.
 */

type DecimalLike = { toNumber(): number };

export type VersionRecord = {
  id: string;
  amount: DecimalLike;
  frequency: string;
  monthlyEquivalent: DecimalLike;
  activeMonths: number[];
  manualOverride: boolean;
  effectiveDate: Date;
  createdAt: Date;
};

export type BudgetRecord = {
  id: string;
  yearPlanId: string;
  budgetId: string;
  highWaterMark: DecimalLike;
  doneForYear: boolean;
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  budget: { name: string; group: { name: string } | null };
  versions: VersionRecord[];
  _count: { budgetExpenseLinks: number };
};

export function serializeVersion(v: VersionRecord) {
  return {
    id: v.id,
    amount: v.amount.toNumber(),
    frequency: v.frequency as 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY',
    monthlyEquivalent: v.monthlyEquivalent.toNumber(),
    activeMonths: v.activeMonths,
    manualOverride: v.manualOverride,
    effectiveDate: v.effectiveDate.toISOString(),
    createdAt: v.createdAt.toISOString(),
  };
}

export function serializeCategoryBudget(
  record: BudgetRecord,
  resolvedVersion: VersionRecord | null,
) {
  return {
    id: record.id,
    yearPlanId: record.yearPlanId,
    budgetId: record.budgetId,
    categoryName: record.budget.name,
    categoryGroup: record.budget.group?.name ?? '',
    removedAt: record.removedAt?.toISOString() ?? null,
    seasonal: resolvedVersion ? resolvedVersion.activeMonths.length > 0 : false,
    highWaterMark: record.highWaterMark.toNumber(),
    doneForYear: record.doneForYear,
    linkedExpenseCount: record._count.budgetExpenseLinks,
    version: resolvedVersion ? serializeVersion(resolvedVersion) : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export const budgetInclude = {
  budget: { include: { group: true } },
  versions: true,
  _count: { select: { budgetExpenseLinks: true } },
} as const;
