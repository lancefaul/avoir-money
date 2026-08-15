import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { captureBefore, beforeOf, capturedBefore } from '../lib/undo.js';

type PayScheduleRecord = { id: string } & Record<string, unknown>;

export const usePaySchedules = () =>
  useQuery({ queryKey: ['pay-schedules'], queryFn: () => api.paySchedules.list() });

/**
 * No undo: the API exposes no delete for a pay schedule. Every route is
 * GET/POST/PUT — there is nothing to call, and a schedule underpins pay-period
 * generation, so inventing a removal here is not a frontend decision.
 */
export const useCreatePaySchedule = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.paySchedules.create(body),
    meta: { successMessage: 'Pay schedule created' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pay-schedules'] });
      qc.invalidateQueries({ queryKey: ['pay-periods'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};

export const useUpdatePaySchedule = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api.paySchedules.update(id, body),
    onMutate: ({ id }) => ({ before: captureBefore<PayScheduleRecord>(qc, ['pay-schedules'], id) }),
    meta: {
      successMessage: 'Pay schedule updated',
      undoneMessage: 'Pay schedule change undone',
      canUndo: capturedBefore,
      undo: (_d: unknown, variables: unknown, context: unknown) =>
        api.paySchedules.update((variables as { id: string }).id, beforeOf(context)),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pay-schedules'] });
      qc.invalidateQueries({ queryKey: ['pay-periods'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};

/**
 * No undo: generating pay periods writes many rows and returns no manifest of
 * which ones, and pay periods are referenced by transactions once they exist.
 * Reversing it would mean guessing which periods were new — and a wrong guess
 * detaches transactions from their period.
 */
export const useGeneratePeriods = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      api.paySchedules.generate(id, body),
    meta: { successMessage: 'Pay periods generated' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pay-periods'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};
