import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { captureBefore, beforeOf, capturedBefore } from '../lib/undo.js';

/**
 * Custodians, wallets and holdings all restore by PUTting the captured record
 * back — every patch field appears in its response shape, checked against
 * `rust/api/src/investments.rs`. The one worth naming: `HoldingPatch.ty` and
 * `HoldingShape.kind` are different Rust identifiers that both serialize as
 * `"type"`, so the round trip carries the asset type. Had they differed on the
 * wire, a verbatim restore would have dropped it silently.
 */
type InvestmentRecord = { id: string } & Record<string, unknown>;

export const useInvestments = () =>
  useQuery({ queryKey: ['investments'], queryFn: () => api.investments.list() });

export const useInvestmentPrices = () =>
  useQuery({ queryKey: ['investment-prices'], queryFn: () => api.investments.prices() });

export const useUpdateInvestment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api.investments.update(id, body),
    onMutate: ({ id }) => ({ before: captureBefore<InvestmentRecord>(qc, ['investments'], id) }),
    meta: {
      successMessage: 'Investment updated',
      undoneMessage: 'Investment change undone',
      canUndo: capturedBefore,
      undo: (_d: unknown, variables: unknown, context: unknown) =>
        api.investments.update((variables as { id: string }).id, beforeOf(context)),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['investments'] });
      qc.invalidateQueries({ queryKey: ['investment-history'] });
    },
  });
};
export const useBitcoinTransfer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.investments.transferBitcoin(body),
    meta: {
      successMessage: 'Bitcoin transferred',
      undoneMessage: 'Bitcoin transfer reversed',
      // A real inverse the backend already owns: `DELETE /investments/transfers/:id`
      // runs `reverseTransfer`, which undoes the quantity moves and the
      // proportional cost-basis split inside one `$transaction`. Not a
      // reconstruction — the same routine the ledger uses when a transfer's
      // transaction is deleted.
      undo: (data: unknown) => api.investments.deleteTransfer((data as { id: string }).id),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['investments'] });
      qc.invalidateQueries({ queryKey: ['investment-history'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
};
export const useStockTransfer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.investments.transferStock(body),
    meta: {
      successMessage: 'Stock transferred',
      undoneMessage: 'Stock transfer reversed',
      undo: (data: unknown) => api.investments.deleteTransfer((data as { id: string }).id),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['investments'] });
      qc.invalidateQueries({ queryKey: ['investment-history'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
};

/**
 * No undo: deleting a holding also deletes every `InvestmentSnapshot` row for
 * it — the record of what that holding was worth over time, and the data the
 * portfolio chart is drawn from. Recreating the holding restores the position
 * and not its history, so the button would report a restore that only half
 * happened. (Transfers referencing the holding are RESTRICT, so a holding with
 * transfer history cannot be deleted at all.)
 */
export const useDeleteHolding = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.investments.deleteHolding(id),
    meta: { successMessage: 'Holding deleted' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['investments'] });
      qc.invalidateQueries({ queryKey: ['investment-history'] });
    },
  });
};

// ─── Portfolio History ────────────────────────────────────────────────────────
export const usePortfolioHistory = (period: '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL' = 'ALL') =>
  useQuery({
    queryKey: ['portfolio-history', period],
    queryFn: () => api.investments.portfolioHistory(period),
  });

/**
 * No undo — but not because nothing is destroyed.
 *
 * This comment used to say "there is no prior state that was destroyed —
 * running it again produces the same result", and that was the belief which
 * made 2026-08-13 possible. The backend deletes every snapshot before it
 * rebuilds, so the operation is destructive first and idempotent only when the
 * inputs are identical. When CoinGecko rate-limited the history fetch, the
 * inputs were empty, the delete ran anyway, and a year of chart data went with
 * it — under a toast reading "Snapshots regenerated".
 *
 * The guard is now on the backend, which refuses to rebuild from a history it
 * could not fetch and returns 503 with an explicit "nothing was changed". An
 * undo here would still be meaningless — the deleted rows are not held anywhere
 * to restore from — which is exactly why the refusal has to be upstream of the
 * delete rather than a recovery after it.
 */
export const useRegenerateSnapshots = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.investments.regenerateSnapshots(),
    meta: { successMessage: 'Snapshots regenerated' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolio-history'] });
      // `latestSnapshot` is embedded in each holding, and regeneration replaces
      // every snapshot row — so the holdings list is stale the moment this
      // succeeds. It went uninvalidated because the chart is the visible
      // subject, but the snapshot is also `liveValue`'s fallback when a price
      // is missing, so a stale one is a wrong valuation rather than a stale
      // chart. With `staleTime: Infinity` globally, nothing else would refetch.
      qc.invalidateQueries({ queryKey: ['investments'] });
    },
  });
};

// ─── Investment History ──────────────────────────────────────────────────────
export const useInvestmentHistory = (
  type?: 'TRADE' | 'TRANSFER' | 'PAYMENT',
  assetType?: 'STOCK' | 'BITCOIN',
) =>
  useInfiniteQuery({
    queryKey: ['investment-history', { type, assetType }],
    queryFn: ({ pageParam }) =>
      api.investments.history({ type, assetType, cursor: pageParam ?? undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

// ─── Custodians ──────────────────────────────────────────────────────────────
export const useCustodians = () =>
  useQuery({ queryKey: ['custodians'], queryFn: () => api.investments.custodians.list() });

export const useCreateCustodian = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.investments.custodians.create(body),
    meta: {
      successMessage: 'Custodian created',
      undoneMessage: 'Custodian removed',
      undo: (data: unknown) => api.investments.custodians.delete((data as { id: string }).id),
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custodians'] }),
  });
};
export const useUpdateCustodian = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      api.investments.custodians.update(id, body),
    onMutate: ({ id }) => ({ before: captureBefore<InvestmentRecord>(qc, ['custodians'], id) }),
    meta: {
      successMessage: 'Custodian updated',
      undoneMessage: 'Custodian change undone',
      canUndo: capturedBefore,
      undo: (_d: unknown, variables: unknown, context: unknown) =>
        api.investments.custodians.update((variables as { id: string }).id, beforeOf(context)),
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custodians'] }),
  });
};
export const useDeleteCustodian = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.investments.custodians.delete(id),
    onMutate: (id: string) => ({ before: captureBefore<InvestmentRecord>(qc, ['custodians'], id) }),
    meta: {
      successMessage: 'Custodian deleted',
      undoneMessage: 'Custodian restored',
      canUndo: capturedBefore,
      // The handler refuses with 409 while any holding, trade or payment
      // references it (ADR-027 made those real FKs), so only an unreferenced
      // custodian can be deleted and the new id is unobservable.
      undo: (_d: unknown, _v: unknown, context: unknown) =>
        api.investments.custodians.create(beforeOf(context)),
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custodians'] }),
  });
};

// ─── Wallets ─────────────────────────────────────────────────────────────────
export const useWallets = () =>
  useQuery({ queryKey: ['wallets'], queryFn: () => api.investments.wallets.list() });

export const useCreateWallet = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.investments.wallets.create(body),
    meta: {
      successMessage: 'Wallet created',
      undoneMessage: 'Wallet removed',
      undo: (data: unknown) => api.investments.wallets.delete((data as { id: string }).id),
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wallets'] }),
  });
};
export const useUpdateWallet = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      api.investments.wallets.update(id, body),
    onMutate: ({ id }) => ({ before: captureBefore<InvestmentRecord>(qc, ['wallets'], id) }),
    meta: {
      successMessage: 'Wallet updated',
      undoneMessage: 'Wallet change undone',
      canUndo: capturedBefore,
      undo: (_d: unknown, variables: unknown, context: unknown) =>
        api.investments.wallets.update((variables as { id: string }).id, beforeOf(context)),
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wallets'] }),
  });
};
export const useDeleteWallet = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.investments.wallets.delete(id),
    onMutate: (id: string) => ({ before: captureBefore<InvestmentRecord>(qc, ['wallets'], id) }),
    meta: {
      successMessage: 'Wallet deleted',
      undoneMessage: 'Wallet restored',
      canUndo: capturedBefore,
      undo: (_d: unknown, _v: unknown, context: unknown) =>
        api.investments.wallets.create(beforeOf(context)),
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wallets'] }),
  });
};
