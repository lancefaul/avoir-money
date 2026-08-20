import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

export const useConnectedServices = () =>
  useQuery({ queryKey: ['connected-services'], queryFn: () => api.connectedServices.list() });

/*
 * Neither mutation below can be undone, and the reason is the point of the
 * feature rather than a gap in it: a stored key is never returned to the
 * client. `ConnectedService` exposes a hint, not the secret (ADR-035), so
 * nothing here ever holds the previous key to put back.
 *
 * Clearing the key you just saved would not be a restore either — it would
 * leave no key where a working one may have been a moment earlier, which is
 * strictly worse than the action being undoable.
 */
export const useSetServiceKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, apiKey }: { provider: string; apiKey: string }) =>
      api.connectedServices.set(provider, apiKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connected-services'] });
      // Prices are fetched with this key, so what is on screen is now stale.
      qc.invalidateQueries({ queryKey: ['investment-prices'] });
    },
    meta: { successMessage: 'API key saved' },
  });
};

export const useClearServiceKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => api.connectedServices.clear(provider),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connected-services'] });
      qc.invalidateQueries({ queryKey: ['investment-prices'] });
    },
    meta: { successMessage: 'API key removed' },
  });
};
