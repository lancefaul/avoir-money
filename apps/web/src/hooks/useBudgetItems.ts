import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { captureBefore, beforeOf, capturedBefore } from '../lib/undo.js';

/**
 * Groups and budget items both restore by PUTting the captured record back:
 * `GroupPatch` is {name, color} and `GroupShape` carries both; `BudgetPatch` is
 * {name, icon, groupId} and `BudgetShape` carries all three. Checked against
 * `rust/api/src/budgets.rs` rather than assumed.
 */
type ItemRecord = { id: string } & Record<string, unknown>;

export const useBudgetItems = () =>
  useQuery({ queryKey: ['budgetItems'], queryFn: () => api.budgetItems.list() });

export const useBudgetItemGroups = () =>
  useQuery({ queryKey: ['budgetItems', 'groups'], queryFn: () => api.budgetItems.groups() });

export const useCreateBudgetItemGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.budgetItems.createGroup(body),
    meta: {
      successMessage: 'Budget group created',
      undoneMessage: 'Budget group removed',
      undo: (data: unknown) => api.budgetItems.deleteGroup((data as { id: string }).id),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgetItems'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
};
export const useUpdateBudgetItemGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      api.budgetItems.updateGroup(id, body),
    onMutate: ({ id }) => ({
      before: captureBefore<ItemRecord>(qc, ['budgetItems', 'groups'], id),
    }),
    meta: {
      successMessage: 'Budget group updated',
      undoneMessage: 'Budget group change undone',
      canUndo: capturedBefore,
      undo: (_d: unknown, variables: unknown, context: unknown) =>
        api.budgetItems.updateGroup((variables as { id: string }).id, beforeOf(context)),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgetItems'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
};
export const useDeleteBudgetItemGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.budgetItems.deleteGroup(id),
    onMutate: (id: string) => ({
      before: captureBefore<ItemRecord>(qc, ['budgetItems', 'groups'], id),
    }),
    meta: {
      successMessage: 'Budget group deleted',
      undoneMessage: 'Budget group restored',
      canUndo: capturedBefore,
      /*
       * Recreating mints a NEW id, which is normally what makes a delete
       * irreversible — but not here. The delete refuses with 409 while the
       * group still holds any budget, so the only group that can ever be
       * deleted is an empty one, and nothing in the database referenced it.
       * A new id nothing can observe is not a lost reference.
       */
      undo: (_d: unknown, _v: unknown, context: unknown) =>
        api.budgetItems.createGroup(beforeOf(context)),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgetItems'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
};

export const useCreateBudgetItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.budgetItems.create(body),
    meta: {
      successMessage: 'Budget created',
      undoneMessage: 'Budget removed',
      // Hard delete is safe ONLY here: it cascades Expenses, Incomes, Goals
      // and allocations, and a budget created seconds ago has none of them.
      undo: (data: unknown) => api.budgetItems.delete((data as { id: string }).id, 'hard'),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgetItems'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
};
export const useUpdateBudgetItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api.budgetItems.update(id, body),
    onMutate: ({ id }) => ({ before: captureBefore<ItemRecord>(qc, ['budgetItems'], id) }),
    meta: {
      successMessage: 'Budget updated',
      undoneMessage: 'Budget change undone',
      canUndo: capturedBefore,
      undo: (_d: unknown, variables: unknown, context: unknown) =>
        api.budgetItems.update((variables as { id: string }).id, beforeOf(context)),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgetItems'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
};
/**
 * No undo, in EITHER mode, and this is the most consequential absence in the
 * file.
 *
 * `hard` deletes every Expense, Income and BudgetGoal pointing at the budget,
 * plus its CategoryBudget allocations, then the budget itself — the response
 * even reports the counts. Nothing short of a backup restores that.
 *
 * `soft` sets `deletedAt` and retires the allocations, which LOOKS reversible
 * — but the API exposes no restore for a budget item (only `category-budgets`
 * has one), so there is no inverse to call. Offering a button here would mean
 * inventing an endpoint at the moment someone most needs it to work.
 */
export const useDeleteBudgetItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mode = 'hard' }: { id: string; mode?: 'hard' | 'soft' }) =>
      api.budgetItems.delete(id, mode),
    meta: { successMessage: 'Budget deleted' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgetItems'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
};
/**
 * No undo: reassign moves every Expense, Income and Goal onto the target and
 * then DELETES the source budget along with its allocations. Reversing it would
 * need to recreate the source and know which of the target's rows had come from
 * it — the response says how many moved, not which.
 */
export const useReassignBudgetItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, targetBudgetId }: { id: string; targetBudgetId: string }) =>
      api.budgetItems.reassign(id, targetBudgetId),
    meta: { successMessage: 'Budget reassigned' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgetItems'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
};
