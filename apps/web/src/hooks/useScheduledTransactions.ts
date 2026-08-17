import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { ApiError } from '../lib/api/request.js';

const INVALIDATION_KEYS = [
  'transactions',
  'dashboard',
  'accounts',
  'scheduled-transactions',
  'income-trend',
  'pay-periods',
] as const;

function invalidateScheduleKeys(qc: ReturnType<typeof useQueryClient>) {
  for (const key of INVALIDATION_KEYS) {
    qc.invalidateQueries({ queryKey: [key] });
  }
  // Force immediate refetch of transactions to prevent stale UI
  qc.refetchQueries({ queryKey: ['transactions'] });
}

// User-facing message shown (as an info toast) when the scheduled row the
// client was holding no longer exists — the schedule was refreshed under it.
const STALE_ROW_MESSAGE = 'That item was refreshed. Please try again.';

/**
 * Self-heal when the targeted scheduled-transaction row is gone (404) or its
 * state already changed (409): refetch the schedule so the list reflects the
 * current server state and the user can retry against a fresh row.
 */
function selfHealOnStale(qc: ReturnType<typeof useQueryClient>, err: unknown) {
  if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
    invalidateScheduleKeys(qc);
  }
}

/*
 * No undo on either, because the backend exposes no inverse. The scheduled
 * routes are `pay`, `snooze` and `skip` — there is no unpay and no unsnooze.
 *
 * `pay` in particular writes a real transaction through the ledger gate and
 * links the occurrence to it, so reversing it means deleting that transaction
 * AND returning the row to PENDING. Doing that from the client would be a
 * second implementation of a lifecycle the schedule matcher already owns
 * (ADR-024), and getting it half-right leaves a PAID row pointing at a
 * transaction that no longer exists — the stale-id failure that ADR-024 was
 * written to stop.
 */
export const useMarkAsPaid = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body?: { amount?: number; date?: string; accountId?: string };
    }) => api.scheduledTransactions.markAsPaid(id, body),
    meta: { successMessage: 'Marked as paid', notFoundMessage: STALE_ROW_MESSAGE },
    onSuccess: () => invalidateScheduleKeys(qc),
    onError: (err) => selfHealOnStale(qc, err),
  });
};

export const useSnooze = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) =>
      api.scheduledTransactions.snooze(id, { days }),
    meta: { successMessage: 'Snoozed', notFoundMessage: STALE_ROW_MESSAGE },
    onSuccess: () => invalidateScheduleKeys(qc),
    onError: (err) => selfHealOnStale(qc, err),
  });
};
