import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { captureBefore, beforeOf, capturedBefore } from '../lib/undo.js';

/**
 * Checked the same way as `useExpenses`: every field an income update can
 * persist is present in the list response. `Income` carries no due-rule columns
 * at all (no `isAutomatic`, `skipWeekend`, `dueDay`, `dueWeekday`,
 * `dueOrdinal`), so although the shared `UpdateRecurring` patch accepts them,
 * there is nowhere for them to land and nothing for a restore to miss.
 */
type IncomeRecord = { id: string } & Record<string, unknown>;

export const useIncome = (params?: Parameters<typeof api.income.list>[0]) =>
  useQuery({ queryKey: ['income', params], queryFn: () => api.income.list(params) });

const invalidateIncomeCaches = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['income'] });
  qc.invalidateQueries({ queryKey: ['dashboard'] });
  qc.invalidateQueries({ queryKey: ['transactions'] });
  qc.invalidateQueries({ queryKey: ['scheduled-transactions'] });
};

export const useCreateIncome = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.income.create(body),
    meta: {
      successMessage: 'Income created',
      undoneMessage: 'Income removed',
      undo: (data: unknown) => api.income.delete((data as { id: string }).id),
    },
    onSuccess: () => invalidateIncomeCaches(qc),
  });
};
export const useUpdateIncome = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api.income.update(id, body),
    onMutate: ({ id }) => ({ before: captureBefore<IncomeRecord>(qc, ['income'], id) }),
    meta: {
      successMessage: 'Income updated',
      undoneMessage: 'Income change undone',
      canUndo: capturedBefore,
      undo: (_data: unknown, variables: unknown, context: unknown) =>
        api.income.update((variables as { id: string }).id, beforeOf(context)),
    },
    onSuccess: () => invalidateIncomeCaches(qc),
  });
};
/** No undo, for the reason in `useDeleteExpense`: `Transaction.incomeId` is
 * `ON DELETE SET NULL`, so the delete detaches history a recreate cannot
 * re-adopt. Archive is the reversible retirement. */
export const useDeleteIncome = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.income.delete(id),
    meta: { successMessage: 'Income deleted' },
    onSuccess: () => invalidateIncomeCaches(qc),
  });
};
export const useArchiveIncome = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.income.archive(id),
    meta: {
      successMessage: 'Income archived',
      undoneMessage: 'Income restored',
      undo: (_data: unknown, variables: unknown) => api.income.restore(variables as string),
    },
    onSuccess: () => {
      invalidateIncomeCaches(qc);
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
};
export const useRestoreIncome = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.income.restore(id),
    meta: {
      successMessage: 'Income restored',
      undoneMessage: 'Income archived again',
      undo: (_data: unknown, variables: unknown) => api.income.archive(variables as string),
    },
    onSuccess: () => {
      invalidateIncomeCaches(qc);
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
};
