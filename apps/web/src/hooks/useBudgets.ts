import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { captureBefore, beforeOf, capturedBefore } from '../lib/undo.js';
import type {
  CreateYearPlan,
  CarryForward,
  CreateCategoryBudget,
  UpdateCategoryBudget,
  CategoryBudgetResponse,
} from '@budget-tracker/core';

/**
 * A budget as the list returns it. Unlike expenses, the editable values do NOT
 * sit at the top level — they live inside `version`, because a budget's amount
 * is versioned by month. So "PUT the captured record back" does not work here,
 * and the inverse has to rebuild the patch from `version`. Checked against
 * `UpdateCategoryBudgetSchema` rather than assumed: a blanket restore would
 * have sent a body with none of the patch's field names in it and quietly
 * changed nothing while reporting success.
 *
 * Deliberately the real response type rather than a hand-written shape. The
 * first version declared `frequency: string`, which needed an `as` cast to
 * satisfy the patch's enum — and the cast was the tell. Naming the actual type
 * makes the enum flow through, so the cast is gone and a schema change here
 * fails the build instead of being papered over.
 */
type BudgetRecord = CategoryBudgetResponse;

/**
 * Rebuild the patch that puts a budget back the way it was.
 *
 * `effectiveMonth` is deliberately omitted. The update replaces the CURRENT
 * month's version when one exists, so leaving the month unset makes the undo
 * overwrite the very version the edit just wrote — one version for this month,
 * holding the pre-edit values. Sending the old version's month instead would
 * edit that older row and leave the new one standing, so the amount would not
 * actually revert.
 */
function budgetRestorePatch(before: BudgetRecord): UpdateCategoryBudget {
  const v = before.version;
  return {
    ...(v?.amount !== undefined ? { amount: v.amount } : {}),
    ...(v?.frequency !== undefined ? { frequency: v.frequency } : {}),
    ...(v?.activeMonths !== undefined ? { activeMonths: v.activeMonths } : {}),
    ...(v?.manualOverride !== undefined ? { manualOverride: v.manualOverride } : {}),
    ...(before.doneForYear !== undefined ? { doneForYear: before.doneForYear } : {}),
  };
}

// ─── Year Plans ───

export const useYearPlans = () =>
  useQuery({ queryKey: ['year-plans'], queryFn: () => api.budgets.listPlans() });

export const useActivePlan = () => {
  const { data: plans, ...rest } = useYearPlans();
  const currentYear = new Date().getFullYear();
  const activePlan = plans?.find((p) => p.status === 'ACTIVE' && p.year === currentYear);
  const currentYearPlan = plans?.find((p) => p.year === currentYear);
  return { ...rest, data: activePlan, currentYearPlan, plans };
};

/*
 * The three year-plan mutations below declare no `undo`, each for its own
 * reason — recorded here so the absence reads as a decision rather than as work
 * nobody got to:
 *
 *   createPlan   — the API exposes no plan delete. A plan is the container for
 *                  a year's budgets and removing one is not a thing the system
 *                  can currently do at all.
 *   confirmPlan  — DRAFT → ACTIVE is a one-way lifecycle step (ADR: YearPlan
 *                  lifecycle is DRAFT → ACTIVE → ARCHIVED). There is no
 *                  un-confirm endpoint, and inventing one by writing status
 *                  backwards would skip whatever confirm did on the way.
 *   carryForward — creates many budgets in one call and returns no manifest of
 *                  what it made, so there is nothing to reverse against. An
 *                  undo would have to guess, and guessing here deletes budgets.
 */
export const useCreatePlan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateYearPlan) => api.budgets.createPlan(body),
    meta: { successMessage: 'Year plan created' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['year-plans'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['budgetItems'] });
    },
  });
};

export const useConfirmPlan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.budgets.confirmPlan(id),
    meta: { successMessage: 'Year plan confirmed' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['year-plans'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['category-budgets'] });
    },
  });
};

export const useCarryForward = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CarryForward }) =>
      api.budgets.carryForward(id, body),
    meta: { successMessage: 'Budgets carried forward' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['year-plans'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
};

// ─── Category Budgets ───

export const useBudgets = (
  yearPlanId: string | undefined,
  month?: number,
  year?: number,
  includeSeasonal?: boolean,
  periodStart?: string,
  periodEnd?: string,
  viewMode?: string,
) =>
  useQuery({
    queryKey: [
      'budgets',
      yearPlanId,
      month,
      year,
      includeSeasonal,
      periodStart,
      periodEnd,
      viewMode,
    ],
    queryFn: () =>
      api.budgets.listBudgets(
        yearPlanId!,
        month,
        year,
        includeSeasonal,
        periodStart,
        periodEnd,
        viewMode,
      ),
    enabled: !!yearPlanId,
  });

export const useCreateBudget = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCategoryBudget) => api.budgets.createBudget(body),
    meta: {
      successMessage: 'Budget created',
      undoneMessage: 'Budget removed',
      // Removal is soft here (`removedAt`), so this leaves a tombstone rather
      // than erasing the row. That is the same thing the delete button beside
      // it does, and the alternative is no undo at all.
      undo: (data: unknown) => api.budgets.deleteBudget((data as { id: string }).id),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['category-budgets'] });
    },
  });
};

export const useUpdateBudget = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCategoryBudget }) =>
      api.budgets.updateBudget(id, body),
    onMutate: ({ id }) => ({ before: captureBefore<BudgetRecord>(qc, ['budgets'], id) }),
    meta: {
      successMessage: 'Budget updated',
      undoneMessage: 'Budget change undone',
      canUndo: capturedBefore,
      undo: (_data: unknown, variables: unknown, context: unknown) =>
        api.budgets.updateBudget(
          (variables as { id: string }).id,
          budgetRestorePatch(beforeOf<BudgetRecord>(context)!),
        ),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['category-budgets'] });
    },
  });
};

export const useDeleteBudget = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.budgets.deleteBudget(id),
    meta: {
      successMessage: 'Budget deleted',
      undoneMessage: 'Budget restored',
      // The best case in the whole codebase: the delete is soft (`removedAt`)
      // and `restore` clears it on the SAME row, so identity, history and every
      // reference survive. Nothing is approximated.
      undo: (_data: unknown, variables: unknown) => api.budgets.restoreBudget(variables as string),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['category-budgets'] });
    },
  });
};
