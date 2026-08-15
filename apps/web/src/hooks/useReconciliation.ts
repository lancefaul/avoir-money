import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { invalidateTransactionCaches } from '../lib/cache-invalidation.js';

/**
 * Reconciliation queries and mutations.
 *
 * Every mutation that can move money invalidates the transaction caches as well
 * as the session: an adjustment writes a real ledger entry, and a close stamps
 * `reconciledAt` on matched rows, so account balances and the ledger view both
 * go stale. Invalidating only the session would leave the rest of the app
 * showing figures the reconciliation just changed.
 */

function invalidateSession(qc: QueryClient, id: string): void {
  qc.invalidateQueries({ queryKey: ['reconciliations'] });
  qc.invalidateQueries({ queryKey: ['reconciliation', id] });
}

export function useReconciliations(params?: { accountId?: string; status?: string }) {
  return useQuery({
    queryKey: ['reconciliations', params ?? {}],
    queryFn: () => api.reconciliations.list(params),
  });
}

export function useReconciliation(id: string | null) {
  return useQuery({
    queryKey: ['reconciliation', id],
    queryFn: () => api.reconciliations.get(id!),
    enabled: Boolean(id),
  });
}

export function useCreateReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.reconciliations.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reconciliations'] });
    },
  });
}

/**
 * Persist the statement's ending balance onto the draft.
 *
 * Without this the anchor lived only in component state and reached the server
 * once, at session creation — so a balance typed after the file was chosen (the
 * normal order) never arrived, and the residual was computed against zero.
 */
export function useUpdateReconciliation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    // Accepts the anchor, the cutoff (periodEnd), or both — whatever changed.
    mutationFn: (body: { statementEndingBalance?: number; periodEnd?: string }) =>
      api.reconciliations.update(id, body),
    onSuccess: () => invalidateSession(qc, id),
  });
}

/**
 * Import and match take the session id as a mutation variable, not a hook
 * argument.
 *
 * Both run immediately after a session is created, and a hook closes over the
 * id it was rendered with — which is still empty on that first pass, producing
 * `POST /reconciliations//import`. Passing the id at call time uses the id the
 * caller actually has.
 */
export function useImportStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, csv }: { id: string; csv: string }) =>
      api.reconciliations.importStatement(id, csv),
    onSuccess: (_result, { id }) => invalidateSession(qc, id),
  });
}

export function useRunMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.reconciliations.match(id),
    onSuccess: (_result, id) => invalidateSession(qc, id),
  });
}

/**
 * `silent` for the batch apply: combining four rows creates four matches, and
 * four "Matched" toasts say less than the one summary the batch already shows.
 */
export function useCreateMatch(id: string, options?: { silent?: boolean }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { statementRowId: string; transactionId: string }) =>
      api.reconciliations.createMatch(id, body),
    meta: {
      ...(options?.silent ? { silent: true } : { successMessage: 'Matched' }),
      undoneMessage: 'Match removed',
      // A clean pair, and the only one in this file: the response carries the
      // new match's id and `deleteMatch` takes exactly that. Pairing a
      // statement row to a transaction writes nothing to the ledger, so
      // removing it again touches no balance.
      undo: (data: unknown) => api.reconciliations.deleteMatch(id, (data as { id: string }).id),
    },
    onSuccess: () => invalidateSession(qc, id),
  });
}

export function useDeleteMatch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (matchId: string) => api.reconciliations.deleteMatch(id, matchId),
    // No undo: recreating needs the statement row and transaction the match
    // joined, and those live inside the session object rather than in a list
    // `captureBefore` can read by id. Re-matching by hand is two clicks, which
    // is why this is recorded rather than worked around.
    meta: { successMessage: 'Match removed' },
    onSuccess: () => invalidateSession(qc, id),
  });
}

/**
 * Merge N rows into one parent + children in a single atomic request.
 *
 * It deletes and creates real ledger rows, so it invalidates the transaction
 * caches as well as the session. `silent` for the batch apply, whose one summary
 * already reports the outcome.
 */
export function useMergeTransactions(id: string, options?: { silent?: boolean }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { statementRowId: string; transactionIds: string[]; name: string }) =>
      api.reconciliations.merge(id, body),
    // No undo: a merge creates child allocations under a parent transaction and
    // deletes the originals through the ledger gate. Reversing it means
    // recreating those transactions with new ids, which is the same detachment
    // problem `useDeleteTransaction` documents.
    meta: options?.silent ? { silent: true } : { successMessage: 'Merged' },
    onSuccess: () => {
      invalidateSession(qc, id);
      invalidateTransactionCaches(qc);
    },
  });
}

export function useCloseReconciliation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.reconciliations.close(id),
    meta: { successMessage: 'Period reconciled' },
    onSuccess: () => {
      invalidateSession(qc, id);
      // Closing stamps reconciledAt on every matched transaction.
      invalidateTransactionCaches(qc);
    },
  });
}

export function useCreateAdjustment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => api.reconciliations.adjustment(id, reason),
    meta: { successMessage: 'Adjustment recorded' },
    onSuccess: () => {
      invalidateSession(qc, id);
      // The adjustment is a real ledger entry — balances move.
      invalidateTransactionCaches(qc);
    },
  });
}

/**
 * Correct the account's starting balance mid-reconciliation.
 *
 * Lives here rather than beside the other account mutations because of what it
 * has to invalidate: the residual is computed from `openingBalance`, so an
 * account update that did not also invalidate the session would leave the
 * reconciliation showing a difference the server no longer agrees with. The API
 * rebuilds the balance chain on this change, so every transaction's running
 * balance moves too.
 */
export function useCorrectOpeningBalance(sessionId: string, accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (openingBalance: number) => api.accounts.update(accountId, { openingBalance }),
    meta: { successMessage: 'Starting balance corrected' },
    onSuccess: () => {
      invalidateSession(qc, sessionId);
      invalidateTransactionCaches(qc);
    },
  });
}

export function useAbandonReconciliation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.reconciliations.abandon(id),
    meta: { successMessage: 'Reconciliation canceled' },
    onSuccess: () => invalidateSession(qc, id),
  });
}
