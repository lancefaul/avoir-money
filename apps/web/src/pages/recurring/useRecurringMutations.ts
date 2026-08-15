import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';

interface UseRecurringMutationsArgs {
  /** Close the pause dialog after a successful pause. */
  onPauseSuccess: () => void;
  /** Close the resume dialog after a successful resume. */
  onResumeSuccess: () => void;
}

/**
 * Pause/resume mutations for the Recurring page, extracted verbatim from
 * Recurring.tsx. Cache invalidation stays identical.
 */
export function useRecurringMutations({
  onPauseSuccess,
  onResumeSuccess,
}: UseRecurringMutationsArgs) {
  const qc = useQueryClient();

  const pauseExpenseMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { duration?: number; unit?: string; indefinite?: boolean };
    }) => api.expenses.pause(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      onPauseSuccess();
    },
  });

  const resumeExpenseMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { immediately?: boolean; resumeDate?: string };
    }) => api.expenses.resume(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      onResumeSuccess();
    },
  });

  const pauseIncomeMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { duration?: number; unit?: string; indefinite?: boolean };
    }) => api.income.pause(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['income'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      onPauseSuccess();
    },
  });

  const resumeIncomeMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { immediately?: boolean; resumeDate?: string };
    }) => api.income.resume(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['income'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      onResumeSuccess();
    },
  });

  return {
    pauseExpenseMut,
    resumeExpenseMut,
    pauseIncomeMut,
    resumeIncomeMut,
  };
}
