import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreatePurchaseInput, UpdatePurchasePaymentsInput } from '@budget-tracker/core';
import { api } from '../lib/api.js';
import { invalidateTransactionCaches } from '../lib/cache-invalidation.js';

/**
 * Options shared by the transaction write hooks.
 *
 * `silent` suppresses the per-call success toast. A toast per mutation is right
 * when the user pressed a button for that one change; it is wrong when one
 * press applies a batch — a reconciliation applying twenty decisions produced
 * twenty toasts, which buries the page and says nothing the batch's own summary
 * does not say better. The global observer already honours `meta.silent`.
 */
export interface MutationToastOptions {
  silent?: boolean;
}

const toastMeta = (message: string, options?: MutationToastOptions) =>
  options?.silent ? { silent: true } : { successMessage: message };

/**
 * Undo, on the master ledger, is offered for CREATES only — and the asymmetry
 * is deliberate rather than unfinished.
 *
 * A create's inverse is `ledgerDelete`, which is not a reconstruction: it is
 * the routine the gate already runs to reverse a create, so balances, the
 * balance chain, holdings, debt payments and schedule links all unwind through
 * the same hooks that applied them (ADR-013/014).
 *
 * Nothing else here gets one:
 *
 * - **update** — `UpdateTx` accepts `occurrenceDate`, and `TxShape` does not
 *   return it. A restore built from the captured record would put back nine
 *   fields out of ten and leave `occurrenceDate` at whatever the edit set,
 *   because an absent field means "no change". That is a partial restore
 *   reported as a complete one, on the ledger, and it would break the
 *   anticipation matching ADR-001 uses it for. Adding `occurrenceDate` to
 *   `TxShape` is what would make this safe.
 * - **delete** — recreating mints a new id, so child allocations, the purchase
 *   group, reconciliation matches, the debt payment and the scheduled row that
 *   pointed at the old one are all left pointing at nothing.
 * - **re-split payments** — the inverse needs the previous legs, which the
 *   response does not carry, and a wrong split moves several account balances
 *   at once.
 */

export function useCreateTransaction(options?: MutationToastOptions) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.transactions.create(body),
    meta: {
      ...toastMeta('Transaction created', options),
      undoneMessage: 'Transaction removed',
      undo: (data: unknown) => api.transactions.delete((data as { id: string }).id),
    },
    onSuccess: () => invalidateTransactionCaches(qc),
  });
}

/**
 * Create a purchase — one account (the ordinary path) or split across several
 * (a purchase group, payment-split ADR-030). A split moves several account
 * balances at once, so it invalidates the same caches an ordinary write does.
 */
export function useCreatePurchase(options?: MutationToastOptions) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePurchaseInput) => api.purchases.create(body),
    meta: {
      ...toastMeta('Transaction created', options),
      undoneMessage: 'Transaction removed',
      /*
       * Two shapes, because a purchase is only promoted to a group when it is
       * actually split (ADR-030) — `purchaseGroupId` is null for the ordinary
       * one-account case, which is why the field is present-and-null rather
       * than omitted. Deleting the group removes the Anchor and every leg;
       * without one there is a single transaction to remove.
       */
      undo: async (data: unknown) => {
        const r = data as { purchaseGroupId?: string | null; transactionIds?: string[] };
        if (r.purchaseGroupId) return api.purchases.delete(r.purchaseGroupId);
        return Promise.all((r.transactionIds ?? []).map((id) => api.transactions.delete(id)));
      },
    },
    onSuccess: () => invalidateTransactionCaches(qc),
  });
}

/** Re-split a purchase group: replace its payment legs (Anchor + budget untouched). */
export function useUpdatePurchasePayments(options?: MutationToastOptions) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, body }: { groupId: string; body: UpdatePurchasePaymentsInput }) =>
      api.purchases.updatePayments(groupId, body),
    meta: toastMeta('Payment split updated', options),
    onSuccess: () => invalidateTransactionCaches(qc),
  });
}

/** Delete a whole purchase group (Anchor + every leg), reversing each balance. */
export function useDeletePurchase(options?: MutationToastOptions) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.purchases.delete(groupId),
    meta: toastMeta('Transaction deleted', options),
    onSuccess: () => invalidateTransactionCaches(qc),
  });
}

export function useUpdateTransaction(options?: MutationToastOptions) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api.transactions.update(id, body),
    meta: toastMeta('Transaction updated', options),
    onSuccess: () => invalidateTransactionCaches(qc),
  });
}

export function useDeleteTransaction(options?: MutationToastOptions) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.transactions.delete(id),
    meta: toastMeta('Transaction deleted', options),
    onSuccess: () => invalidateTransactionCaches(qc),
  });
}

export function useLinkTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { expenseId?: string; incomeId?: string } }) =>
      api.transactions.link(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUnlinkTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.transactions.unlink(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
