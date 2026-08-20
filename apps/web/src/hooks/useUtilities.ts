import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { captureBefore, beforeOf, capturedBefore } from '../lib/undo.js';

/**
 * Records as their lists return them.
 *
 * Every patch here is covered by its response shape, checked against
 * `rust/api/src/utilities.rs`: `ServicePatch` is {serviceType, metering} and
 * `ServiceShape` carries both; `ReadingPatch`'s ten fields all appear in
 * `ReadingShape`. So an update restores by PUTting the captured record back.
 */
type UtilityRecord = { id: string } & Record<string, unknown>;
type ServiceRecord = { id: string; expenseId?: string | null } & Record<string, unknown>;

// ─── Cache invalidation helpers ──────────────────────────────────────────────

/** Query keys affected when readings change (amounts flow into scheduled transactions) */
const READING_RELATED_KEYS = [
  'utilities',
  'scheduled-transactions',
  'transactions',
  'dashboard',
] as const;

function invalidateReadingCaches(qc: ReturnType<typeof useQueryClient>): void {
  for (const key of READING_RELATED_KEYS) {
    if (key === 'dashboard') {
      qc.removeQueries({ queryKey: [key] });
    } else {
      qc.invalidateQueries({ queryKey: [key] });
    }
  }
}

/** Query keys affected when expense links change on services */
const LINK_RELATED_KEYS = [
  'utility-services',
  'scheduled-transactions',
  'transactions',
  'dashboard',
] as const;

function invalidateLinkCaches(qc: ReturnType<typeof useQueryClient>): void {
  for (const key of LINK_RELATED_KEYS) {
    if (key === 'dashboard') {
      qc.removeQueries({ queryKey: [key] });
    } else {
      qc.invalidateQueries({ queryKey: [key] });
    }
  }
}

// ─── Provider hooks ──────────────────────────────────────────────────────────

export const useProviders = () =>
  useQuery({ queryKey: ['utility-providers'], queryFn: () => api.utilities.listProviders() });

export const useCreateProvider = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string }) => api.utilities.createProvider(body),
    meta: {
      successMessage: 'Provider created',
      undoneMessage: 'Provider removed',
      undo: (data: unknown) => api.utilities.deleteProvider((data as { id: string }).id),
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['utility-providers'] }),
  });
};

export const useUpdateProvider = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name: string } }) =>
      api.utilities.updateProvider(id, body),
    onMutate: ({ id }) => ({
      before: captureBefore<UtilityRecord>(qc, ['utility-providers'], id),
    }),
    meta: {
      successMessage: 'Provider updated',
      undoneMessage: 'Provider change undone',
      canUndo: capturedBefore,
      undo: (_d: unknown, variables: unknown, context: unknown) =>
        api.utilities.updateProvider(
          (variables as { id: string }).id,
          beforeOf(context) as { name: string },
        ),
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['utility-providers'] }),
  });
};

export const useDeleteProvider = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.utilities.deleteProvider(id),
    onMutate: (id: string) => ({
      before: captureBefore<UtilityRecord>(qc, ['utility-providers'], id),
    }),
    meta: {
      successMessage: 'Provider deleted',
      undoneMessage: 'Provider restored',
      canUndo: capturedBefore,
      // The new id is unobservable: `UtilityService.providerId` is ON DELETE
      // RESTRICT and the handler refuses with 409 while any service remains,
      // so the only provider that can be deleted is one nothing points at.
      undo: (_d: unknown, _v: unknown, context: unknown) =>
        api.utilities.createProvider(beforeOf(context) as { name: string }),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['utility-providers'] });
      qc.invalidateQueries({ queryKey: ['utility-services'] });
      qc.invalidateQueries({ queryKey: ['utilities'] });
    },
  });
};

// ─── Service hooks ───────────────────────────────────────────────────────────

export const useServices = (providerId: string | undefined) =>
  useQuery({
    queryKey: ['utility-services', providerId],
    queryFn: () => api.utilities.listServices(providerId!),
    enabled: !!providerId,
  });

export const useCreateService = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      providerId,
      body,
    }: {
      providerId: string;
      body: { serviceType: string; metering: string };
    }) => api.utilities.createService(providerId, body),
    meta: {
      successMessage: 'Service created',
      undoneMessage: 'Service removed',
      undo: (data: unknown) => api.utilities.deleteService((data as { id: string }).id),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['utility-services'] });
      qc.invalidateQueries({ queryKey: ['utilities'] });
    },
  });
};

export const useUpdateService = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { metering: string } }) =>
      api.utilities.updateService(id, body),
    onMutate: ({ id }) => ({ before: captureBefore<ServiceRecord>(qc, ['utility-services'], id) }),
    meta: {
      successMessage: 'Service updated',
      undoneMessage: 'Service change undone',
      canUndo: capturedBefore,
      undo: (_d: unknown, variables: unknown, context: unknown) =>
        api.utilities.updateService(
          (variables as { id: string }).id,
          beforeOf(context) as { metering: string },
        ),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['utility-services'] });
      qc.invalidateQueries({ queryKey: ['utilities'] });
    },
  });
};

export const useDeleteService = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.utilities.deleteService(id),
    onMutate: (id: string) => ({
      before: captureBefore<ServiceRecord>(qc, ['utility-services'], id),
    }),
    meta: {
      successMessage: 'Service deleted',
      undoneMessage: 'Service restored',
      canUndo: capturedBefore,
      /*
       * Same argument as the provider: `UtilityReading.serviceId` is RESTRICT
       * and the handler refuses while any reading exists — "readings are the
       * billing history; deleting the service that produced them would orphan
       * the record of what was actually charged". So only a service with no
       * history can be deleted, and nothing observes the new id.
       *
       * The expense link is restored explicitly, because it lives on the
       * service row and `createService` does not take it.
       */
      undo: async (_d: unknown, _v: unknown, context: unknown) => {
        const before = beforeOf<ServiceRecord>(context)!;
        const made = await api.utilities.createService(before.providerId as string, {
          serviceType: before.serviceType as string,
          metering: before.metering as string,
        });
        if (before.expenseId) await api.utilities.linkService(made.id, before.expenseId);
        return made;
      },
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['utility-services'] });
      qc.invalidateQueries({ queryKey: ['utilities'] });
    },
  });
};

// ─── Service expense linking hooks ───────────────────────────────────────────

export const useLinkService = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expenseId }: { id: string; expenseId: string }) =>
      api.utilities.linkService(id, expenseId),
    meta: {
      successMessage: 'Service linked to expense',
      undoneMessage: 'Service unlinked',
      undo: (_d: unknown, variables: unknown) =>
        api.utilities.unlinkService((variables as { id: string }).id),
    },
    onSuccess: () => invalidateLinkCaches(qc),
  });
};

export const useUnlinkService = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.utilities.unlinkService(id),
    onMutate: (id: string) => ({
      before: captureBefore<ServiceRecord>(qc, ['utility-services'], id),
    }),
    meta: {
      successMessage: 'Service unlinked from expense',
      undoneMessage: 'Service relinked',
      // Needs the capture: unlink is given only the service id, and relinking
      // needs the expense id the row was carrying.
      canUndo: (_d: unknown, _v: unknown, c: unknown) => !!beforeOf<ServiceRecord>(c)?.expenseId,
      undo: (_d: unknown, variables: unknown, context: unknown) =>
        api.utilities.linkService(
          variables as string,
          beforeOf<ServiceRecord>(context)!.expenseId!,
        ),
    },
    onSuccess: () => invalidateLinkCaches(qc),
  });
};

// ─── Reading hooks ───────────────────────────────────────────────────────────

export const useUtilities = (params?: Parameters<typeof api.utilities.listReadings>[0]) =>
  useQuery({ queryKey: ['utilities', params], queryFn: () => api.utilities.listReadings(params) });

export const useCreateUtility = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.utilities.createReading(body),
    meta: {
      successMessage: 'Reading created',
      undoneMessage: 'Reading removed',
      undo: (data: unknown) => api.utilities.deleteReading((data as { id: string }).id),
    },
    onSuccess: () => invalidateReadingCaches(qc),
  });
};

export const useUpdateUtility = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      api.utilities.updateReading(id, body),
    onMutate: ({ id }) => ({ before: captureBefore<UtilityRecord>(qc, ['utilities'], id) }),
    meta: {
      successMessage: 'Reading updated',
      undoneMessage: 'Reading change undone',
      canUndo: capturedBefore,
      undo: (_d: unknown, variables: unknown, context: unknown) =>
        api.utilities.updateReading((variables as { id: string }).id, beforeOf(context)),
    },
    onSuccess: () => invalidateReadingCaches(qc),
  });
};

export const useDeleteUtility = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.utilities.deleteReading(id),
    onMutate: (id: string) => ({ before: captureBefore<UtilityRecord>(qc, ['utilities'], id) }),
    meta: {
      successMessage: 'Reading deleted',
      undoneMessage: 'Reading restored',
      canUndo: capturedBefore,
      // Nothing in the schema references `UtilityReading`, so recreating it is
      // a complete restore despite the new id. Re-deriving the linked expense's
      // expected amount happens on the way in, as it does for any new reading.
      undo: (_d: unknown, _v: unknown, context: unknown) =>
        api.utilities.createReading(beforeOf(context)),
    },
    onSuccess: () => invalidateReadingCaches(qc),
  });
};
