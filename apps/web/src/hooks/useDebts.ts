import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  DebtSchema,
  AmortizationScheduleSchema,
  EscrowRecordSchema,
} from '@budget-tracker/core';
import { api } from '../lib/api.js';
import { captureBefore, beforeOf, capturedBefore } from '../lib/undo.js';

// ─── Zod-inferred types ─────────────────────────────────────────────────────
// `DebtRecord` below is what undo captures. Every `DebtPatch` field appears in
// `DebtShape` (all 15, checked against `rust/api/src/debts.rs`), so an update
// restores by PUTting the captured record back.
export type DebtRecord = z.infer<typeof DebtSchema>;
export type AmortizationSchedule = z.infer<typeof AmortizationScheduleSchema>;
export type EscrowRecord = z.infer<typeof EscrowRecordSchema>;

export const useDebts = (params?: Parameters<typeof api.debts.list>[0]) =>
  useQuery({ queryKey: ['debts', params], queryFn: () => api.debts.list(params) });

export const useDebtSummary = () =>
  useQuery({ queryKey: ['debts', 'summary'], queryFn: () => api.debts.summary() });

export const useDebtAmortization = (id: string, extraPayment = 0) =>
  useQuery({
    queryKey: ['debts', id, 'amortization', extraPayment],
    queryFn: () => api.debts.amortization(id, extraPayment),
    enabled: !!id,
  });

export const useCreateDebt = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.debts.create(body),
    meta: {
      successMessage: 'Debt created',
      undoneMessage: 'Debt removed',
      // Safe only because it is immediate: the delete cascades DebtPayment and
      // EscrowRecord, and a debt created seconds ago has neither.
      undo: (data: unknown) => api.debts.delete((data as { id: string }).id),
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['debts'] }),
  });
};

export const useUpdateDebt = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api.debts.update(id, body),
    onMutate: ({ id }) => ({ before: captureBefore<DebtRecord>(qc, ['debts'], id) }),
    meta: {
      successMessage: 'Debt updated',
      undoneMessage: 'Debt change undone',
      canUndo: capturedBefore,
      undo: (_d: unknown, variables: unknown, context: unknown) =>
        api.debts.update((variables as { id: string }).id, beforeOf(context)),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['debts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
};

/**
 * No undo: `DebtPayment` and `EscrowRecord` both CASCADE from `Debt`, so the
 * delete destroys the entire payment and escrow history. Recreating the debt
 * restores the terms and none of the record of what has been paid against it.
 */
export const useDeleteDebt = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.debts.delete(id),
    meta: { successMessage: 'Debt deleted' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['debts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
};

// ─── Escrow Hooks ────────────────────────────────────────────────────────────

export const useEscrowHistory = (debtId: string | undefined) =>
  useQuery({
    queryKey: ['escrow', debtId],
    queryFn: () => api.debts.listEscrow(debtId!),
    enabled: !!debtId,
  });

export const useCreateEscrowRecord = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      debtId,
      body,
    }: {
      debtId: string;
      body: { monthlyAmount: number; periodStartDate: string; periodEndDate: string };
    }) => api.debts.createEscrow(debtId, body),
    /*
     * The ids that existed BEFORE the write, because this endpoint is an upsert
     * (ADR-032): re-saving a period updates the existing row and returns its
     * ORIGINAL id rather than a new one. So a returned id that was already in
     * the list means an existing record was overwritten, and deleting it would
     * destroy data that predated the action instead of undoing anything.
     */
    onMutate: ({ debtId }) => ({
      existing: (qc.getQueryData<{ id: string }[]>(['escrow', debtId]) ?? []).map((r) => r.id),
    }),
    meta: {
      successMessage: 'Escrow record created',
      undoneMessage: 'Escrow record removed',
      canUndo: (data: unknown, _v: unknown, context: unknown) => {
        const existing = (context as { existing?: string[] } | undefined)?.existing;
        return Array.isArray(existing) && !existing.includes((data as { id: string }).id);
      },
      undo: (data: unknown, variables: unknown) =>
        api.debts.deleteEscrow(
          (variables as { debtId: string }).debtId,
          (data as { id: string }).id,
        ),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['escrow'] });
      qc.invalidateQueries({ queryKey: ['debts'] });
    },
  });
};

// ─── Extra Payment Hook ──────────────────────────────────────────────────────

export const useExtraPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      debtId,
      body,
    }: {
      debtId: string;
      body: { amount: number; date: string; accountId: string; note?: string };
    }) => api.debts.extraPayment(debtId, body),
    meta: {
      successMessage: 'Extra payment recorded',
      undoneMessage: 'Extra payment reversed',
      // A true inverse via the ledger gate: the response carries the id of the
      // transaction it wrote, and deleting that runs `debt-payment.hook`'s
      // reversal — which restores the debt balance and removes the DebtPayment
      // row — alongside the ordinary balance unwind.
      undo: (data: unknown) =>
        api.transactions.delete((data as { transactionId: string }).transactionId),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['debts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
};
