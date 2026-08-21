import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Modal, StepIndicator, buttonStyles, fromPickerDate } from '@budget-tracker/ui';
import { appTxDirection } from '@budget-tracker/core';
import { formatLongDate } from '../../lib/utils.js';
import * as ds from '../dashboard.css.js';
import {
  useAbandonReconciliation,
  useCloseReconciliation,
  useCreateAdjustment,
  useCreateMatch,
  useMergeTransactions,
  useCorrectOpeningBalance,
  useCreateReconciliation,
  useDeleteMatch,
  useImportStatement,
  useReconciliation,
  useUpdateReconciliation,
  useReconciliations,
  useRunMatch,
} from '../../hooks/useReconciliation.js';
import {
  useCreateTransaction,
  useDeleteTransaction,
  useUpdateTransaction,
} from '../../hooks/useTransactionMutations.js';
import ResidualHeader from './ResidualHeader.js';
import SetupStep from './SetupStep.js';
import MatchGroups from './MatchGroups.js';
import ReviewStep from './ReviewStep.js';
import CloseSessionModal from './CloseSessionModal.js';
import { useToastStore } from '../../store/toast.js';
import { useReconcileGroups } from './useReconcileGroups.js';
import { applyDecisions } from './applyDecisions.js';
import { type AppliedResult, type ResolutionItem, type StagedAction, type Step } from './types.js';
import * as s from './reconcile-page.css.js';

const STEPS = [
  { label: 'Setup', description: 'Statement and ending balance' },
  { label: 'Reconcile', description: 'Resolve the differences' },
  { label: 'Finish', description: 'Close the period' },
];

interface ReconcileModalProps {
  open: boolean;
  onClose: () => void;
  accountId: string;
  accountName: string;
}

/**
 * Reconcile a bank statement against the ledger.
 *
 * A full-screen modal launched from an account rather than a standalone page:
 * reconciliation is always *of an account*, so the account is a prop and there
 * is no picker. Orchestrator only — wiring, layout, and step state. The residual
 * arithmetic lives on the server, the grouping in `useReconcileGroups`, and each
 * step in its own component.
 */
export default function ReconcileModal({
  open,
  onClose,
  accountId,
  accountName,
}: ReconcileModalProps) {
  const [step, setStep] = useState<Step>('setup');
  const [anchor, setAnchor] = useState(0);
  // The cutoff — the date the anchor is measured at. Defaults to local today,
  // which reconciles the account against the bank as of right now; the user
  // moves it back to reconcile a closed statement. It is the residual's split
  // point, so it is never derived from the file (that weld is the bug this fixes).
  const [cutoffDate, setCutoffDate] = useState(() => fromPickerDate(new Date()));
  const [file, setFile] = useState<File | null>(null);
  // The file the current session's rows came from, so re-analysing the same
  // file refreshes in place while a different one starts clean.
  const [analyzedFile, setAnalyzedFile] = useState<File | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  /**
   * Decisions made in step 2, held until step 3 applies them. One per decision
   * — staging a second replaces the first, so a card can never be two things.
   */
  const [staged, setStaged] = useState<Map<string, StagedAction>>(new Map());
  /**
   * What actually happened to each decision, once Apply has run.
   *
   * Separate from `staged` so the review list can stay put and report itself
   * rather than emptying as the batch progresses. Also the resume record: a
   * retry after a mid-batch failure skips whatever already succeeded, because
   * these are separate HTTP requests with no transaction spanning them.
   */
  const [applied, setApplied] = useState<Map<string, AppliedResult>>(new Map());
  /**
   * Decisions dismissed in this sitting, by key.
   *
   * The period-scoped half of ignoring, and the half that covers everything: a
   * statement line has no transaction to annotate, and a pending charge must
   * NOT be annotated — it posts next period, often for a different amount, and
   * a permanent marker would hide the statement line that proves the app's
   * figure wrong. Forgotten on reload, which is what makes it safe.
   */
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const addToast = useToastStore((st) => st.addToast);

  const { data: drafts } = useReconciliations({ status: 'DRAFT' });
  const draft = useMemo(
    () => drafts?.find((d) => d.accountId === accountId) ?? null,
    [drafts, accountId],
  );
  const sessionId = draft?.id ?? null;

  const { data: session } = useReconciliation(sessionId);

  // Seed the inputs from the draft when resuming. Without this a session that
  // already carries an anchor renders an empty field, and re-analysing would
  // write that empty value back over a good one. The cutoff is seeded the same
  // way (UTC slice — periodEnd is stored at UTC midnight), so resuming a session
  // reconciled to a past date does not silently snap it back to today.
  useEffect(() => {
    if (session) {
      setAnchor(session.statementEndingBalance);
      setCutoffDate(new Date(session.periodEnd).toISOString().slice(0, 10));
    }
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const createSession = useCreateReconciliation();
  const importStatement = useImportStatement();
  const runMatch = useRunMatch();
  const closeSession = useCloseReconciliation(sessionId ?? '');
  const createAdjustment = useCreateAdjustment(sessionId ?? '');
  const abandon = useAbandonReconciliation(sessionId ?? '');
  const updateSession = useUpdateReconciliation(sessionId ?? '');
  // Silent: Apply is one press applying a batch, so the batch reports itself
  // once at the end instead of once per write.
  const updateTx = useUpdateTransaction({ silent: true });
  const createTx = useCreateTransaction({ silent: true });
  const deleteTx = useDeleteTransaction({ silent: true });
  const createMatch = useCreateMatch(sessionId ?? '', { silent: true });
  const mergeTx = useMergeTransactions(sessionId ?? '', { silent: true });
  const deleteMatch = useDeleteMatch(sessionId ?? '');
  const correctOpening = useCorrectOpeningBalance(sessionId ?? '', accountId);

  // The server returns exactly the transactions the matcher considered, so the
  // padded load window is decided in one place rather than re-derived here.
  const appTxs = useMemo(
    () =>
      (session?.appTransactions ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        date: t.date.toISOString().slice(0, 10),
        amount: t.amount,
        offset: t.offset,
        note: t.note,
        // Carried for merge: `type` decides whether a combination is mergeable,
        // and the two flags drive the step-3 disclosure of what a merge drops.
        type: t.type,
        recurringLink: t.recurringLink,
        scheduledMatch: t.scheduledMatch,
        // Derived through the shared rule rather than restated here — a
        // transfer's direction depends on which side of it this account is on,
        // and a Cash Wallet trade's on whether it was a buy or a sell. The matcher
        // must reach the same answer.
        direction: appTxDirection({
          type: t.type,
          inbound: t.inbound,
          tradeDirection: t.tradeDirection,
        }),
      })),
    [session],
  );
  const groups = useReconcileGroups(session, appTxs, dismissedKeys);

  /**
   * Every decision, by key, so step 3 can draw a staged action as the card it
   * was decided on. A staged action records the intent, not the rows behind it
   * — and a review that cannot show those rows is asking the user to confirm
   * from memory.
   */
  const itemsByKey = useMemo(() => {
    const map = new Map<string, ResolutionItem>();
    for (const item of [
      ...groups.onStatementNotInApp,
      ...groups.amountDiffers,
      ...groups.combinations,
      ...groups.inAppNotOnStatement,
      ...groups.cancelledOnStatement,
      ...groups.pendingInApp,
    ]) {
      map.set(item.key, item);
    }
    return map;
  }, [groups]);
  const resolutionPending =
    updateTx.isPending ||
    createTx.isPending ||
    deleteTx.isPending ||
    runMatch.isPending ||
    createMatch.isPending ||
    mergeTx.isPending ||
    deleteMatch.isPending;
  /**
   * Re-deciding a key drops whatever the last Apply recorded for it.
   *
   * The outcome map doubles as the resume record — an entry marked `ok` is
   * skipped on a retry so it is not written twice. A decision the user has
   * since taken back and made differently is a different decision under the
   * same key, and skipping it would silently drop the new intent.
   */
  const forgetOutcome = (key: string) =>
    setApplied((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });

  /** Staged but not yet written — what an Apply (or a retry) would send. */
  const pendingCount = [...staged.keys()].filter((k) => !applied.get(k)?.ok).length;
  const allApplied = staged.size > 0 && pendingCount === 0;
  const statementRowCount = session?.statementRows.length ?? 0;
  const analyzing =
    createSession.isPending ||
    importStatement.isPending ||
    runMatch.isPending ||
    updateSession.isPending;

  /**
   * Everything step 1 promises, in one action: open the session, import the
   * statement, match it, and move on.
   *
   * Nothing happened when the file was chosen, so this is the first point the
   * user has asked for any of it — which is also why neither the session nor
   * the import announces itself with a toast.
   */
  async function handleAnalyze() {
    if (!file) return;
    const csv = await readFileText(file);

    let id = sessionId;

    // A different file describes a different period. Adding it to the existing
    // session would leave the old file's rows in place under a widened window,
    // so the session is replaced rather than appended to.
    if (id && analyzedFile && file !== analyzedFile) {
      await abandon.mutateAsync();
      id = null;
    }

    if (!id) {
      // periodStart is a placeholder the import overwrites with the earliest
      // posted date; it is set equal to the cutoff so periodEnd >= periodStart
      // holds even when the cutoff is a past date (reconciling a closed
      // statement). periodEnd is the cutoff and is authoritative from here on.
      const created = await createSession.mutateAsync({
        accountId,
        periodStart: cutoffDate,
        periodEnd: cutoffDate,
        statementEndingBalance: anchor,
      });
      id = created.id;
    } else if (session) {
      const anchorChanged = Math.abs(session.statementEndingBalance - anchor) > 0.005;
      // session.periodEnd is stored at UTC midnight, so its calendar day is the
      // UTC slice — NOT fromPickerDate, which reads local getters and would
      // report the previous day (and a spurious change) west of Greenwich.
      const sessionCutoff = new Date(session.periodEnd).toISOString().slice(0, 10);
      const cutoffChanged = sessionCutoff !== cutoffDate;
      if (anchorChanged || cutoffChanged) {
        await updateSession.mutateAsync({
          ...(anchorChanged ? { statementEndingBalance: anchor } : {}),
          ...(cutoffChanged ? { periodEnd: cutoffDate } : {}),
        });
      }
    }

    await importStatement.mutateAsync({ id, csv });
    await runMatch.mutateAsync(id);
    setAnalyzedFile(file);
    setStep('reconcile');
  }

  /**
   * Apply every staged decision, then re-derive the match — the only place in the
   * flow that writes. The batching (ordering, fail-stops-batch, resume-skip,
   * ignore-marks-and-dismisses) lives in `applyDecisions` so it is testable
   * without the modal; here it is wired to the real mutations and state setters.
   */
  async function handleApply() {
    await applyDecisions(staged, applied, {
      accountId,
      sessionId,
      createTx: (body) => createTx.mutateAsync(body),
      updateTx: (args) => updateTx.mutateAsync(args),
      deleteTx: (id) => deleteTx.mutateAsync(id),
      createMatch: (body) => createMatch.mutateAsync(body),
      runMatch: (id) => runMatch.mutateAsync(id),
      runMerge: (body) => mergeTx.mutateAsync(body),
      onOutcome: (key, result) => setApplied((prev) => new Map(prev).set(key, result)),
      onDismiss: (key) => setDismissedKeys((prev) => new Set(prev).add(key)),
      onSuccess: (n) => addToast('success', `Applied ${n} change${n === 1 ? '' : 's'}`),
    });
  }

  /**
   * Cancel discards the draft.
   *
   * A session is scaffolding for one sitting: its rows and pairings are
   * rebuildable from the same file in seconds. Leaving it behind means the next
   * open silently resumes a half-finished period — which is what made a stale
   * detected range reappear. Resolutions already applied are real transaction
   * edits and survive; only the scaffolding goes.
   */
  async function handleCancel() {
    if (sessionId) await abandon.mutateAsync();
    onClose();
  }

  const stepIndex = step === 'setup' ? 0 : step === 'reconcile' ? 1 : 2;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reconcile — ${accountName}`}
      variant="pinned"
      closeButton="none"
      bodyClassName={s.modalBody}
      panelClassName={s.panel}
    >
      <div className={s.modalStepBar}>
        <StepIndicator steps={STEPS} currentStep={stepIndex} ariaLabel="Reconciliation progress" />
      </div>

      <div className={s.modalScroll}>
        {step === 'setup' && (
          <SetupStep
            file={file}
            onFileChange={setFile}
            statementEndingBalance={anchor}
            onStatementEndingBalanceChange={setAnchor}
            cutoffDate={cutoffDate}
            onCutoffDateChange={setCutoffDate}
          />
        )}

        {/* Reads like the pay-period heading on Budgets — same label/date pair,
            because it answers the same question about the same kind of span. It
            sits above the balances because it says which period they describe. */}
        {step === 'reconcile' && session && statementRowCount > 0 && (
          <div>
            <p className={ds.payPeriodLabel}>Statement Period</p>
            <p className={ds.payPeriodDate}>
              {formatLongDate(session.periodStart)} &mdash; {formatLongDate(session.periodEnd)}
            </p>
          </div>
        )}

        {session && step !== 'setup' && (
          <ResidualHeader residual={session.residual} periodEnd={session.periodEnd} />
        )}

        {step === 'reconcile' && session && (
          <MatchGroups
            amountDiffers={groups.amountDiffers}
            onStatementNotInApp={groups.onStatementNotInApp}
            combinations={groups.combinations}
            inAppNotOnStatement={groups.inAppNotOnStatement}
            pendingInApp={groups.pendingInApp}
            cancelledOnStatement={groups.cancelledOnStatement}
            clusters={groups.clusters}
            reentries={groups.reentries}
            matchedCount={groups.matchedCount}
            isBusy={resolutionPending}
            staged={staged}
            onStage={(key, action) => {
              setStaged((prev) => new Map(prev).set(key, action));
              forgetOutcome(key);
            }}
            onUnstage={(key) => {
              setStaged((prev) => {
                const next = new Map(prev);
                next.delete(key);
                return next;
              });
              forgetOutcome(key);
            }}
          />
        )}

        {step === 'finish' && (
          <ReviewStep
            staged={staged}
            items={itemsByKey}
            applied={applied}
            onEdit={(key, action) => {
              // Re-deciding in review is a new intent under the same key; drop any
              // stale outcome so a retry re-applies it rather than skipping it as
              // already done — the same reason onStage/onUnstage forget it.
              setStaged((prev) => new Map(prev).set(key, action));
              forgetOutcome(key);
            }}
          />
        )}
      </div>

      {/* Pinned action bar. Fixed rather than inline so the way out of the flow
          stays reachable however long the difference list grows. */}
      <div className={s.modalFooter}>
        <div>
          {/* Back, not Abandon: returning to step 1 to swap the file or fix the
              ending balance is a normal correction, not giving up. */}
          {/* Labelled, not an icon alone. It is the only way back through the
              flow, and a bare arrow in a footer full of worded buttons reads as
              decoration rather than navigation. */}
          {step !== 'setup' && (
            <button
              type="button"
              onClick={() => setStep(step === 'finish' ? 'reconcile' : 'setup')}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              <ArrowLeft size={16} aria-hidden />
              Back
            </button>
          )}
        </div>
        <div className={s.footerRight}>
          <button
            type="button"
            onClick={handleCancel}
            disabled={abandon.isPending}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
          >
            Cancel
          </button>
          {step === 'setup' && (
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!file || analyzing}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              {analyzing ? 'Analyzing…' : 'Analyze statement'}
            </button>
          )}
          {/*
           * Step 2 offers a way forward, never a write. With decisions staged
           * it leads to the summary; with none it leads to closing, because a
           * period whose differences are all explained needs no changes.
           */}
          {step === 'reconcile' && session && (
            <button
              type="button"
              onClick={() => (staged.size > 0 ? setStep('finish') : setCloseOpen(true))}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              {staged.size > 0
                ? `Review ${staged.size} change${staged.size === 1 ? '' : 's'}`
                : session.residual.isBalanced
                  ? 'Finish'
                  : 'Review difference'}
            </button>
          )}
          {/*
           * Apply stays on this step and reports what happened. Sending the
           * user back to the difference list the instant the writes landed
           * meant the confirmation screen vanished at the exact moment it had
           * something to confirm — and, with the rows draining as the batch
           * ran, it read as the changes being lost rather than applied.
           *
           * Once everything has landed the button becomes the way out: on to
           * closing the period, with the difference list one Back away.
           */}
          {step === 'finish' &&
            (allApplied ? (
              <button
                type="button"
                onClick={() => setCloseOpen(true)}
                className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
              >
                Finish
              </button>
            ) : (
              <button
                type="button"
                onClick={handleApply}
                disabled={pendingCount === 0 || resolutionPending}
                className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
              >
                {resolutionPending
                  ? 'Applying…'
                  : `${applied.size > 0 ? 'Retry' : 'Apply'} ${pendingCount} change${
                      pendingCount === 1 ? '' : 's'
                    }`}
              </button>
            ))}
        </div>
      </div>

      {session && (
        <CloseSessionModal
          open={closeOpen}
          onClose={() => setCloseOpen(false)}
          residual={session.residual}
          isBusy={closeSession.isPending || createAdjustment.isPending || correctOpening.isPending}
          onCorrectOpening={async (newOpening) => {
            // Deliberately does NOT close the session. Correcting the opening
            // changes the residual; the user should see the new figure and
            // decide, rather than have the close ride along with the fix.
            await correctOpening.mutateAsync(newOpening);
            setCloseOpen(false);
          }}
          onFinish={async () => {
            await closeSession.mutateAsync();
            setCloseOpen(false);
            setStep('finish');
          }}
          onAdjust={async (reason) => {
            await createAdjustment.mutateAsync(reason);
            await closeSession.mutateAsync();
            setCloseOpen(false);
            setStep('finish');
          }}
        />
      )}
    </Modal>
  );
}

/** Read a chosen file as text, surfacing a read failure rather than hanging. */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}
