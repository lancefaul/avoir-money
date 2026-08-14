import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { captureBefore, beforeOf, capturedBefore } from '../lib/undo.js';

/**
 * `UpdateBody` (employer, premium, deductibleLimit, oopmLimit, metadata) and
 * `OverridesBody` (deductibleOverride, oopmOverride) are both fully covered by
 * `PolicyShape`, so each restores by PUTting the captured record back.
 */
type PolicyRecord = { id: string } & Record<string, unknown>;

// ─── Queries ─────────────────────────────────────────────────────────────────
export const usePolicyYears = () =>
  useQuery({ queryKey: ['healthcare-years'], queryFn: () => api.healthcare.years() });

export const usePolicies = (year: number | undefined) =>
  useQuery({
    queryKey: ['healthcare-policies', year],
    queryFn: () => api.healthcare.policies(year!),
    enabled: year !== undefined,
  });

export const usePolicyTransactions = (policyId: string | undefined) =>
  useQuery({
    queryKey: ['healthcare-transactions', policyId],
    queryFn: () => api.healthcare.transactions(policyId!),
    enabled: policyId !== undefined,
  });

export const useHealthcareSummary = (year: number | undefined) =>
  useQuery({
    queryKey: ['healthcare-summary', year],
    queryFn: () => api.healthcare.summary(year!),
    enabled: year !== undefined,
    retry: false,
  });

// ─── Mutations ───────────────────────────────────────────────────────────────
/**
 * No undo: the API exposes no delete for a policy — the routes are
 * GET/POST/PUT/PATCH plus end-coverage and close. A policy accumulates the
 * transactions counted against its deductible, so removal is not a frontend
 * decision to invent.
 */
export const useCreatePolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.healthcare.createPolicy(body),
    meta: { successMessage: 'Policy created' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['healthcare-policies'] });
      qc.invalidateQueries({ queryKey: ['healthcare-years'] });
    },
  });
};

export const useUpdatePolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      api.healthcare.updatePolicy(id, body),
    onMutate: ({ id }) => ({
      before: captureBefore<PolicyRecord>(qc, ['healthcare-policies'], id),
    }),
    meta: {
      successMessage: 'Policy updated',
      undoneMessage: 'Policy change undone',
      canUndo: capturedBefore,
      undo: (_d: unknown, variables: unknown, context: unknown) =>
        api.healthcare.updatePolicy((variables as { id: string }).id, beforeOf(context)),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['healthcare-policies'] });
      qc.invalidateQueries({ queryKey: ['healthcare-years'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};

export const useUpdateOverrides = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      api.healthcare.updateOverrides(id, body),
    onMutate: ({ id }) => ({
      before: captureBefore<PolicyRecord>(qc, ['healthcare-policies'], id),
    }),
    meta: {
      successMessage: 'Override updated',
      undoneMessage: 'Override change undone',
      canUndo: capturedBefore,
      // Both override fields are nullable, and the captured record carries them
      // as explicit nulls when unset — so clearing an override is restored as
      // faithfully as setting one.
      undo: (_d: unknown, variables: unknown, context: unknown) =>
        api.healthcare.updateOverrides((variables as { id: string }).id, {
          deductibleOverride: beforeOf<PolicyRecord>(context)?.deductibleOverride ?? null,
          oopmOverride: beforeOf<PolicyRecord>(context)?.oopmOverride ?? null,
        }),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['healthcare-policies'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['category-budgets'] });
    },
  });
};

/*
 * No undo on either lifecycle step below. `end-coverage` and `close` are
 * one-way: there is no un-end or un-close route, and writing `endedOn`/
 * `closedOn` back to null from the client would skip whatever each step did on
 * the way through.
 */
export const useEndCoverage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.healthcare.endCoverage(id),
    meta: { successMessage: 'Coverage ended' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['healthcare-policies'] });
    },
  });
};

export const useClosePolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.healthcare.closePolicy(id),
    meta: { successMessage: 'Policy closed' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['healthcare-policies'] });
    },
  });
};
