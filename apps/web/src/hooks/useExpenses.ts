import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { captureBefore, beforeOf, capturedBefore } from '../lib/undo.js';

/**
 * What an expense update can change, all of which the list response carries —
 * checked field by field against `UpdateRecurring` in `rust/api/src/recurring.rs`
 * rather than assumed. That is what makes "PUT the captured record back" a
 * complete restore rather than a partial one: no field the patch can touch is
 * missing from the record we captured.
 *
 * `pausedUntil` and `archivedAt` are deliberately absent — the update endpoint
 * cannot change them (only pause/resume and archive/restore can), so an update
 * never needs to restore them.
 */
type ExpenseRecord = { id: string } & Record<string, unknown>;

export const useExpenses = (params?: Parameters<typeof api.expenses.list>[0]) =>
  useQuery({ queryKey: ['expenses', params], queryFn: () => api.expenses.list(params) });

const invalidateExpenseCaches = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['expenses'] });
  qc.invalidateQueries({ queryKey: ['dashboard'] });
  qc.invalidateQueries({ queryKey: ['transactions'] });
  qc.invalidateQueries({ queryKey: ['scheduled-transactions'] });
  qc.invalidateQueries({ queryKey: ['category-budgets'] });
};

export const useCreateExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.expenses.create(body),
    meta: {
      successMessage: 'Expense created',
      undoneMessage: 'Expense removed',
      // Safe precisely because it runs seconds after the create: nothing has
      // had time to reference the new row, so the SET NULLs that make a
      // general delete irreversible have nothing to null out.
      undo: (data: unknown) => api.expenses.delete((data as { id: string }).id),
    },
    onSuccess: () => invalidateExpenseCaches(qc),
  });
};
export const useUpdateExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api.expenses.update(id, body),
    onMutate: ({ id }) => ({ before: captureBefore<ExpenseRecord>(qc, ['expenses'], id) }),
    meta: {
      successMessage: 'Expense updated',
      undoneMessage: 'Expense change undone',
      canUndo: capturedBefore,
      undo: (_data: unknown, variables: unknown, context: unknown) =>
        api.expenses.update((variables as { id: string }).id, beforeOf(context)),
    },
    onSuccess: () => invalidateExpenseCaches(qc),
  });
};
/**
 * No undo, and the reason is worth stating: recreating an expense mints a NEW
 * id, and both `Transaction.expenseId` and `UtilityService.expenseId` are
 * `ON DELETE SET NULL`. The delete therefore unlinks every historical
 * transaction from the recurring item it belonged to, and a recreate cannot
 * re-adopt them — it would restore the row while silently leaving the history
 * detached. Archive is the reversible way to retire an expense, and it is
 * already offered next to this.
 */
export const useDeleteExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.expenses.delete(id),
    meta: { successMessage: 'Expense deleted' },
    onSuccess: () => invalidateExpenseCaches(qc),
  });
};
export const useArchiveExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.expenses.archive(id),
    meta: {
      successMessage: 'Expense archived',
      undoneMessage: 'Expense restored',
      // A true inverse: archive and restore are the same row, so identity and
      // every reference to it survive the round trip.
      undo: (_data: unknown, variables: unknown) => api.expenses.restore(variables as string),
    },
    onSuccess: () => {
      invalidateExpenseCaches(qc);
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
};
export const useRestoreExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.expenses.restore(id),
    meta: {
      successMessage: 'Expense restored',
      undoneMessage: 'Expense archived again',
      undo: (_data: unknown, variables: unknown) => api.expenses.archive(variables as string),
    },
    onSuccess: () => {
      invalidateExpenseCaches(qc);
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
};
