/**
 * The reconciler's one write path, extracted from `ReconcileModal` so its
 * correctness properties can be pinned without standing up the whole modal.
 *
 * It is the ONLY place in the flow that mutates: steps 1 and 2 read, parse and
 * decide, and a reconciliation is a review — a review that changes as you scroll
 * cannot be checked. The properties this function must hold, each a real past or
 * potential bug:
 *
 *  - **Ordering.** Ledger writes (create/correct/edit/delete) land first so the
 *    re-match sees the corrected world; then `runMatch` re-derives pairings; then
 *    the hand-made pairings go on top so they are not immediately recomputed away.
 *  - **Fail stops the batch.** A failure returns early rather than pressing on. A
 *    half-applied batch leaves a residual explained by a mixture of changes that
 *    landed and changes that did not — the one state this whole feature exists to
 *    tell apart from a real discrepancy.
 *  - **Resume-skip.** There is no transaction spanning these calls; they are
 *    separate HTTP requests, and the earlier ones are already committed when a
 *    later one fails. Each decision is recorded the moment it succeeds, and one
 *    already recorded `ok` is skipped on a retry so it is not written twice.
 *  - **Ignore is still a write.** An `ignore` marks each of its rows' notes (once
 *    — a row already carrying the marker is left alone) and dismisses the key for
 *    the sitting, or the same row is asked about again on the very next match.
 *
 * The mutations are passed as plain async functions (each a hook's `mutateAsync`)
 * and the state updates as callbacks, so the logic is testable with neither
 * react-query nor a rendered component.
 */
import {
  appendIgnoredNote,
  isIgnoredNote,
  type AppliedResult,
  type StagedAction,
} from './types.js';

/** The mutation calls the apply drives — each a transaction/reconciliation
 *  hook's `mutateAsync`. Create/update bodies are `unknown` because that is what
 *  the underlying mutation hooks accept. */
export interface ApplyMutations {
  createTx: (body: unknown) => Promise<unknown>;
  updateTx: (args: { id: string; body: unknown }) => Promise<unknown>;
  deleteTx: (id: string) => Promise<unknown>;
  createMatch: (body: { statementRowId: string; transactionId: string }) => Promise<unknown>;
  runMatch: (id: string) => Promise<unknown>;
  /** Replace N rows with one parent + children, matched to a line — one atomic request. */
  runMerge: (body: {
    statementRowId: string;
    transactionIds: string[];
    name: string;
  }) => Promise<unknown>;
}

export interface ApplyCallbacks {
  /** Record one decision's outcome the moment it lands — this doubles as the
   *  resume record read on the next run. */
  onOutcome: (key: string, result: AppliedResult) => void;
  /** Mark an ignored key handled for this sitting (the period-scoped dismissal). */
  onDismiss: (key: string) => void;
  /** Called once, only on a fully clean run, with the number of decisions applied. */
  onSuccess: (count: number) => void;
}

export interface ApplyDeps extends ApplyMutations, ApplyCallbacks {
  accountId: string;
  sessionId: string | null;
}

export async function applyDecisions(
  staged: ReadonlyMap<string, StagedAction>,
  alreadyApplied: ReadonlyMap<string, AppliedResult>,
  deps: ApplyDeps,
): Promise<void> {
  const entries = [...staged.entries()].filter(([key]) => !alreadyApplied.get(key)?.ok);
  // `ignore` is a decision, not a change to the ledger's figures — but it is
  // still written (as a marker on each row's note), so it runs in its own pass
  // between the ledger writes and the re-match.
  const ledger = entries.filter(([, a]) => a.kind !== 'pair' && a.kind !== 'ignore');
  const pairs = entries.filter(
    (e): e is [string, Extract<StagedAction, { kind: 'pair' }>] => e[1].kind === 'pair',
  );

  /** Run one decision's writes and record how it went. Returns false on failure,
   *  and every caller stops on that. */
  const attempt = async (key: string, work: () => Promise<void>) => {
    try {
      await work();
      deps.onOutcome(key, { ok: true });
      return true;
    } catch (e) {
      deps.onOutcome(key, { ok: false, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  for (const [key, action] of ledger) {
    const ok = await attempt(key, async () => {
      if (action.kind === 'create') {
        await deps.createTx({
          type: action.txType,
          name: action.name,
          amount: action.amount,
          date: new Date(`${action.date}T00:00:00Z`).toISOString(),
          accountId: deps.accountId,
          ...(action.budgetId ? { budgetId: action.budgetId } : {}),
        });
      } else if (action.kind === 'correct') {
        await deps.updateTx({ id: action.transactionId, body: { amount: action.amount } });
      } else if (action.kind === 'edit') {
        await deps.updateTx({
          id: action.transactionId,
          body: {
            name: action.name,
            amount: action.amount,
            date: new Date(`${action.date}T00:00:00Z`).toISOString(),
          },
        });
      } else if (action.kind === 'delete') {
        await deps.deleteTx(action.transactionId);
      } else if (action.kind === 'merge') {
        // One atomic request: the server deletes the originals, creates the
        // parent + children, and matches it (a MANUAL match the re-match below
        // preserves). Its own match means the re-match will not re-derive it.
        await deps.runMerge({
          statementRowId: action.statementRowId,
          transactionIds: action.parts.map((p) => p.transactionId),
          name: action.name,
        });
      }
    });
    // The failure is already toasted by the mutation observer and shown on the
    // card; stopping here leaves the rest listed as not applied.
    if (!ok) return;
  }

  // Every app row in the decision is marked, not just the first: a four-row
  // combination with one marked row came back whole on the next match.
  const on = new Date().toISOString().slice(0, 10);
  for (const [key, action] of entries) {
    if (action.kind !== 'ignore') continue;
    const ok = await attempt(key, async () => {
      for (const t of action.transactions ?? []) {
        // Re-marking a row that already carries the marker would append a second
        // sentence every time the session was reviewed again.
        if (isIgnoredNote(t.note)) continue;
        await deps.updateTx({ id: t.id, body: { note: appendIgnoredNote(t.note, on) } });
      }
    });
    if (!ok) return;
    // Always, marker or not: `transactions` is empty for the groups whose verdict
    // can change, and those still must not be asked about again this sitting.
    deps.onDismiss(key);
  }

  // A correction changes what the matcher would conclude, so pairings are
  // re-derived before the hand-made ones are laid on top. Manual pairings survive.
  if (deps.sessionId) await deps.runMatch(deps.sessionId);

  for (const [key, action] of pairs) {
    const ok = await attempt(key, async () => {
      for (const { statementRowId, transactionIds } of action.pairs) {
        for (const transactionId of transactionIds) {
          await deps.createMatch({ statementRowId, transactionId });
        }
      }
    });
    if (!ok) return;
  }

  // One toast for the batch — only reached on a clean run, since every failure
  // returns early and reports itself on the card plus the observer's error toast.
  deps.onSuccess(entries.length);
}
