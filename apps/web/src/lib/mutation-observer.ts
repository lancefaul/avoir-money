/**
 * The global mutation observer: every mutation's toast, and every mutation's
 * Undo button, decided in one place.
 *
 * # Why this is not inline in `App.tsx`
 *
 * It was, and that made it untestable in the only way that counts. The existing
 * `mutation-cache-toast` test builds its OWN `MutationCache` with a hand-copied
 * `onSuccess`, so it verifies a replica — it cannot notice `App.tsx` losing a
 * rule, because it never reads `App.tsx`. That is the mirror described in
 * ERRORS.md: a check derived from a copy of the implementation can only find
 * disagreements between the copies, never an omission in the original.
 *
 * Extracting the callbacks gives the test the real thing to import, so a
 * dropped `canUndo` check fails a test instead of silently offering an Undo
 * button that apologises when pressed.
 */

import { MutationCache, type QueryClient } from '@tanstack/react-query';
import { useToastStore } from '../store/toast.js';
import { ApiError } from './api/request.js';
import { runUndo, type UndoableMeta } from './undo.js';

/**
 * Build the cache. Takes a `getClient` thunk rather than a client because the
 * cache must be constructed before the `QueryClient` that owns it — and an
 * undo needs the client to invalidate with.
 */
export function createMutationCache(getClient: () => QueryClient): MutationCache {
  return new MutationCache({
    onError: (error: unknown, _variables, _context, mutation) => {
      const meta = mutation.options.meta as
        | { silent?: boolean; notFoundMessage?: string }
        | undefined;
      if (meta?.silent) return;
      // When a mutation targets a record that was regenerated out from under
      // the client (e.g. a stale scheduled-transaction id → 404), show the
      // friendly "refreshed, try again" message instead of the raw error.
      if (error instanceof ApiError && error.status === 404 && meta?.notFoundMessage) {
        useToastStore.getState().addToast('info', meta.notFoundMessage);
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      const description = error instanceof ApiError ? error.description : undefined;
      useToastStore.getState().addToast('error', msg, { description });
    },

    onSuccess: (data, variables, context, mutation) => {
      const meta = mutation.options.meta as UndoableMeta | undefined;
      if (meta?.silent) return;
      if (meta?.successMessage) {
        /*
         * The undo closes over THIS mutation's result and context rather than
         * being looked up when the button is pressed. By then the mutation has
         * finished and its context is gone — and another mutation may have run
         * since, so a lookup would reverse the wrong one.
         *
         * Two things have to be true before a button appears: the mutation
         * declared an inverse at all, and THIS run can use it. The second is
         * `canUndo` — an update is only reversible if `onMutate` managed to
         * read the record first. A mutation that fails either gets no button,
         * which is the honest signal: an Undo that fails is worse than none,
         * because it is offered exactly when someone is relieved to see it.
         */
        const undoable = meta.undo && (meta.canUndo?.(data, variables, context) ?? true);
        const id: string = useToastStore.getState().addToast('success', meta.successMessage, {
          onUndo: undoable
            ? () => void runUndo(getClient(), id, meta, data, variables, context)
            : undefined,
        });
      }
      void getClient().invalidateQueries();
    },
  });
}
