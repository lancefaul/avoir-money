/**
 * Undo for mutations, declared on the mutation itself.
 *
 * # Why the inverse lives on the mutation
 *
 * A mutation is the only thing that knows how to reverse itself. `useDeleteX`
 * knows the record it deleted and which endpoint recreates it; nothing central
 * can work that out. So `meta.undo` is a function the hook supplies, and the
 * global observer in `App.tsx` only wires it to the toast.
 *
 * The alternative — a central registry mapping mutation keys to inverses — was
 * rejected on the same grounds the ledger gate exists: two places describing
 * one operation, free to drift, with the drift invisible until someone clicks
 * Undo on a mutation whose shape changed months ago.
 *
 * # The before-state, which is the actual work
 *
 * A create undoes by deleting the thing it returned; a delete undoes by
 * recreating what it removed; an **update** undoes by restoring what the record
 * held first — and that is the one the mutation throws away. React Query's
 * `onMutate` runs before the request and its return value arrives as `context`,
 * so `captureBefore` reads the record out of the query cache on the way past.
 *
 * That is why undo is not "just add a button": the button was already in the
 * DS, and `addToast` already accepted `onUndo`. What was missing is that
 * nothing remembered what things used to be.
 *
 * # What has no inverse, and is not given one
 *
 * "Every action" cannot mean literally every action. Some have no inverse the
 * API exposes — closing a reconciliation keeps its evidence deliberately
 * (ADR-029), a completed backup is a file on disk, an import is hundreds of
 * rows. Those declare no `undo` and their toast has no button, which is honest.
 * A button that fails is worse than no button, because it is offered at exactly
 * the moment someone is relieved to see it.
 */

import type { QueryClient } from '@tanstack/react-query';
import { useToastStore } from '../store/toast.js';

/** What a mutation declares to make itself reversible. */
export interface UndoableMeta {
  successMessage?: string;
  silent?: boolean;
  notFoundMessage?: string;
  /**
   * Reverse this mutation. Receives what the mutation returned, what it was
   * given, and whatever `onMutate` captured.
   *
   * Throwing is the correct way to fail: `runUndo` reports it. Returning
   * quietly on failure would leave the record changed and the user told it was
   * restored, which is the one outcome worse than no undo at all.
   */
  undo?: (data: unknown, variables: unknown, context: unknown) => Promise<unknown>;
  /**
   * Whether THIS run can be reversed.
   *
   * `undo` is static — declared once on the mutation — but reversibility is
   * per-run: an update can only be undone if `onMutate` managed to read the
   * record first, and it cannot if that list was never cached. Checked before
   * the button is offered, so the gap shows up as no button rather than as a
   * button that apologises after being pressed.
   *
   * Absent means always reversible, which is right for create and delete: they
   * need nothing captured beforehand.
   */
  canUndo?: (data: unknown, variables: unknown, context: unknown) => boolean;
  /** Shown after a successful undo. Defaults to a generic line. */
  undoneMessage?: string;
}

/** What `onMutate` hands forward when it captured a record. */
export interface BeforeContext<T = unknown> {
  before?: T;
}

/** Read the record `onMutate` captured, if it managed to. */
export function beforeOf<T>(context: unknown): T | undefined {
  return (context as BeforeContext<T> | undefined)?.before;
}

/**
 * `canUndo` for any mutation whose inverse is "put the old record back".
 *
 * Pairs with an `onMutate` returning `{ before: captureBefore(...) }`.
 */
export const capturedBefore = (_data: unknown, _variables: unknown, context: unknown): boolean =>
  beforeOf(context) !== undefined;

/**
 * Read a record out of the query cache before a mutation changes it.
 *
 * Deliberately reads the CACHE rather than refetching. The cache is what the
 * user was looking at when they acted, which is the state they mean when they
 * say undo — and a refetch would race the mutation it is supposed to precede.
 *
 * Returns `undefined` when the list is not cached, and a caller that gets
 * `undefined` must not offer an undo: restoring a record you never read means
 * writing a guess over real data.
 *
 * `queryKey` is a PREFIX, because most lists are cached per filter —
 * `['expenses', { archived: 'true' }]` and `['expenses', undefined]` are
 * different cache entries and the user may have acted from either. Searching
 * the prefix finds the record whichever view they were on; an exact key would
 * silently return `undefined` for everyone browsing a filtered list, which
 * reads as "this action is not undoable" rather than as the bug it is.
 */
export function captureBefore<T extends { id: string }>(
  qc: QueryClient,
  queryKey: readonly unknown[],
  id: string,
): T | undefined {
  for (const [, value] of qc.getQueriesData<T[]>({ queryKey })) {
    if (!Array.isArray(value)) continue;
    const found = value.find((row) => row?.id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Run an inverse, then tell the truth about what happened.
 *
 * The original toast is dismissed on success, because "Budget deleted · Undo"
 * left on screen after the delete has been undone invites a second click on an
 * action that already happened.
 */
export async function runUndo(
  qc: QueryClient,
  toastId: string,
  meta: UndoableMeta,
  data: unknown,
  variables: unknown,
  context: unknown,
): Promise<void> {
  const { addToast, removeToast } = useToastStore.getState();
  try {
    await meta.undo?.(data, variables, context);
    removeToast(toastId);
    // Everything, not the keys this mutation touched: an inverse can reach
    // further than the action did — restoring a transaction moves balances,
    // schedules and budget rollups — and the observer already invalidates
    // broadly on success for the same reason.
    await qc.invalidateQueries();
    addToast('success', meta.undoneMessage ?? 'Undone');
  } catch (err) {
    // Left on screen deliberately: the original toast is still true. The
    // action happened, and the attempt to reverse it did not.
    addToast('error', 'Could not undo that.', {
      description: err instanceof Error ? err.message : String(err),
    });
  }
}
