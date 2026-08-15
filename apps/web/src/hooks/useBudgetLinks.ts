import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { captureBefore, beforeOf, capturedBefore } from '../lib/undo.js';

/** A link as the list returns it — `expenseId` is what relinking needs back. */
type LinkRecord = { id: string; expenseId: string };

export const useBudgetLinks = (categoryBudgetId: string | undefined) =>
  useQuery({
    queryKey: ['budget-links', categoryBudgetId],
    queryFn: () => api.budgetLinks.list(categoryBudgetId!),
    enabled: !!categoryBudgetId,
  });

export const useLinkExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      categoryBudgetId,
      expenseId,
    }: {
      categoryBudgetId: string;
      expenseId: string;
    }) => api.budgetLinks.link(categoryBudgetId, expenseId),
    meta: {
      successMessage: 'Expense linked to budget',
      undoneMessage: 'Expense unlinked',
      // A clean pair: linking writes only the join row. It does NOT touch
      // `highWaterMark` — checked, because the high-water-mark policy (a budget
      // never decreases automatically) would have made unlink a lossy inverse
      // if linking had raised it.
      undo: (data: unknown, variables: unknown) =>
        api.budgetLinks.unlink(
          (variables as { categoryBudgetId: string }).categoryBudgetId,
          (data as { id: string }).id,
        ),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-links'] });
      qc.invalidateQueries({ queryKey: ['category-budgets'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['budgetItems'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
};

export const useBulkLinkExpenses = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      categoryBudgetId,
      expenseIds,
    }: {
      categoryBudgetId: string;
      expenseIds: string[];
    }) => api.budgetLinks.bulkLink(categoryBudgetId, expenseIds),
    meta: {
      successMessage: 'Expenses linked to budget',
      undoneMessage: 'Expenses unlinked',
      /*
       * Unlinks exactly the links that were MADE, which is why the response is
       * read rather than the request. A bulk link is partial by design — its
       * results array mixes created links with `{expenseId, error}` entries for
       * the ones that failed — so reversing the input would try to unlink rows
       * that never existed and fail partway, leaving a half-undone state.
       */
      undo: async (data: unknown, variables: unknown) => {
        const { categoryBudgetId } = variables as { categoryBudgetId: string };
        const made = ((data as { results?: unknown[] }).results ?? []).filter(
          (r): r is LinkRecord => typeof (r as LinkRecord)?.id === 'string',
        );
        return Promise.all(made.map((l) => api.budgetLinks.unlink(categoryBudgetId, l.id)));
      },
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-links'] });
      qc.invalidateQueries({ queryKey: ['category-budgets'] });
      qc.invalidateQueries({ queryKey: ['budgetItems'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
};

export const useUnlinkExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryBudgetId, linkId }: { categoryBudgetId: string; linkId: string }) =>
      api.budgetLinks.unlink(categoryBudgetId, linkId),
    onMutate: ({ categoryBudgetId, linkId }) => ({
      before: captureBefore<LinkRecord>(qc, ['budget-links', categoryBudgetId], linkId),
    }),
    meta: {
      successMessage: 'Expense unlinked from budget',
      undoneMessage: 'Expense relinked',
      // Needs the capture: the mutation is given the LINK id, and relinking
      // needs the EXPENSE id, which only the deleted row carried.
      canUndo: capturedBefore,
      undo: (_d: unknown, variables: unknown, context: unknown) =>
        api.budgetLinks.link(
          (variables as { categoryBudgetId: string }).categoryBudgetId,
          beforeOf<LinkRecord>(context)!.expenseId,
        ),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-links'] });
      qc.invalidateQueries({ queryKey: ['category-budgets'] });
      qc.invalidateQueries({ queryKey: ['budgetItems'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
};
