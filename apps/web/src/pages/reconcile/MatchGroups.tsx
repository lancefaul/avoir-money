import { useState } from 'react';
import { Badge, buttonStyles } from '@budget-tracker/ui';
import { formatCount } from '../../lib/utils.js';
import EmptyState from '../../components/EmptyState.js';
import DecisionCard, { type DecisionAction } from './DecisionCard.js';
import ClusterHints from './ClusterHints.js';
import ReentryHints from './ReentryHints.js';
import {
  GROUP_META,
  ignoreActionFor,
  mergeEligible,
  primaryApp,
  primaryStatement,
  type DifferenceGroup,
} from './types.js';
import type { ClusterHint, ReentryHint, ResolutionItem, StagedAction } from './types.js';
import * as s from './reconcile-page.css.js';

type ResolvableGroup = Exclude<DifferenceGroup, 'matched'>;

/**
 * Record a decision. Nothing here writes — step 3 applies.
 *
 * One action per decision: staging a second replaces the first, and `onUnstage`
 * takes it back. Keyed by the decision so a card always knows its own state.
 */
export interface ResolutionHandlers {
  onStage: (itemKey: string, action: StagedAction) => void;
  onUnstage: (itemKey: string) => void;
}

export interface MatchGroupsProps extends ResolutionHandlers {
  /** What has already been decided, by decision key. */
  staged: Map<string, StagedAction>;
  amountDiffers: ResolutionItem[];
  combinations: ResolutionItem[];
  onStatementNotInApp: ResolutionItem[];
  inAppNotOnStatement: ResolutionItem[];
  pendingInApp: ResolutionItem[];
  cancelledOnStatement: ResolutionItem[];
  /**
   * Same-merchant leftovers that do not reconcile — advisory, never a decision.
   * Not part of `sections`: these carry no action and stage nothing, and their
   * member rows still appear in the sections below. See `ClusterHints`.
   */
  clusters: ClusterHint[];
  /**
   * Periods that look entered twice — advisory for the same reasons as
   * `clusters`, and shown alongside them. See `ReentryHints`.
   */
  reentries: ReentryHint[];
  matchedCount: number;
  isBusy: boolean;
}

/**
 * Step 2, as a list of decisions.
 *
 * The unit is the decision, not the row: each card holds every row it concerns,
 * says what was found and what to do, and carries the buttons to do it. They
 * are ordered by how much they need the user — disagreeing amounts first, then
 * rows that may belong together, then each side's genuinely unexplained rows,
 * and last the two informational kinds (unposted, reversed) that need no action.
 *
 * The informational ones sit at the bottom rather than interleaved: at the end
 * of a period unposted charges are often the largest group, and mixing them in
 * hides the two or three decisions that actually matter.
 */
/** Newest first — recency is the only reason a row is in the pending group. */
function sortedByDateDesc(items: ResolutionItem[]): ResolutionItem[] {
  return [...items].sort((a, b) => {
    const da = a.apps[0]?.date ?? a.statements[0]?.date ?? '';
    const db = b.apps[0]?.date ?? b.statements[0]?.date ?? '';
    return db.localeCompare(da);
  });
}

/**
 * Decisions rendered per section before the rest are held back.
 *
 * Every card is its own table with tooltips and buttons, so the DOM cost is
 * real: a session that had a whole statement's worth of unmatched rows tried to
 * render a thousand of them at once and took the page down with it. That state
 * is usually a symptom — a statement imported against the wrong account, or a
 * period that does not cover its rows — but the list must survive it either
 * way. Nothing is hidden; the count in the heading is always the true total.
 */
const PAGE_SIZE = 50;

export default function MatchGroups({
  amountDiffers,
  combinations,
  onStatementNotInApp,
  inAppNotOnStatement,
  pendingInApp,
  cancelledOnStatement,
  clusters,
  reentries,
  matchedCount,
  isBusy,
  staged,
  onStage,
  onUnstage,
}: MatchGroupsProps) {
  const [shown, setShown] = useState<Partial<Record<ResolvableGroup, number>>>({});

  const sections: { group: ResolvableGroup; items: ResolutionItem[]; actionable: boolean }[] = [
    // First, always. It is the only group describing money that actually moved
    // and was never recorded — everything else is a disagreement about a
    // transaction that exists on both sides, or timing.
    { group: 'on_statement_not_in_app', items: onStatementNotInApp, actionable: true },
    { group: 'amount_differs', items: amountDiffers, actionable: true },
    { group: 'combination', items: combinations, actionable: true },
    { group: 'in_app_not_on_statement', items: inAppNotOnStatement, actionable: true },
    { group: 'cancelled_on_statement', items: cancelledOnStatement, actionable: false },
    // Pending sits last before the matched count. At the end of a period it is
    // often the largest group and the least interesting, and it is sorted
    // newest first because recency is the whole reason a row is in it.
    { group: 'pending_in_app', items: sortedByDateDesc(pendingInApp), actionable: false },
  ];

  // A period whose only leftovers are unposted or reversed rows IS reconciled,
  // and saying "nothing to resolve" is the accurate report. Those rows stay
  // listed underneath for confirmation.
  const nothingToDo = sections.every((sec) => !sec.actionable || sec.items.length === 0);
  const nothingAtAll = sections.every((sec) => sec.items.length === 0);

  const emptyMessage =
    matchedCount > 0
      ? `All ${matchedCount} rows matched cleanly. Nothing to resolve.`
      : 'No differences found.';

  if (nothingAtAll) return <EmptyState message={emptyMessage} />;

  return (
    <div className={s.groups}>
      {/* Said plainly even when informational rows remain below, so their
          presence is never mistaken for unfinished work. */}
      {nothingToDo && <EmptyState message={emptyMessage} />}

      {/*
       * First, because it reframes rows that appear further down. A cluster is
       * context rather than a decision: resolving its members one by one
       * without seeing them together is exactly the hunting this removes, and
       * that only helps if it is read before the sections it points into.
       *
       * Its members are drawn from the two leftover sections below, so it can
       * never be the only thing on screen.
       */}
      {/*
       * Above the clusters, because it is the broadest reframing on the page:
       * it can account for an entire section at once, and reading it after
       * working through those rows individually is reading it too late.
       */}
      <ReentryHints reentries={reentries} />

      <ClusterHints clusters={clusters} />

      {sections
        .filter((sec) => sec.items.length > 0)
        .map(({ group, items }) => (
          <div key={group} className={s.group}>
            {/* A heading per section, not per card: with one title above every
                decision the same words repeated down the whole page. */}
            <div className={s.groupHeader}>
              <div className={s.groupHeadLine}>
                <span className={s.groupTitle}>{GROUP_META[group].title}</span>
                <Badge variant="neutral" size="sm">
                  {formatCount(items.length)}
                </Badge>
                {/*
                 * Whole-section dismissal, for the groups that are usually
                 * fine — unposted charges, reversals. Undecided rows only, so
                 * pressing it never overwrites a decision already made.
                 *
                 * It stages, like every other button here; nothing is written
                 * until step 3, so a mis-click costs one Undo per row rather
                 * than a batch of edits.
                 */}
                {items.some((i) => !staged.has(i.key)) && (
                  <button
                    type="button"
                    disabled={isBusy}
                    className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnTrueGhost} ${s.ignoreAll}`}
                    onClick={() => {
                      for (const item of items) {
                        if (!staged.has(item.key)) onStage(item.key, ignoreActionFor(item, group));
                      }
                    }}
                  >
                    Ignore all
                  </button>
                )}
              </div>
              {/* On its own line: beside the count it competed with the title
                  for the same glance, and it is the least urgent thing here. */}
              <span className={s.groupHint}>{GROUP_META[group].hint}</span>
            </div>
            {items.slice(0, shown[group] ?? PAGE_SIZE).map((item) => (
              <DecisionCard
                key={item.key}
                item={item}
                fallbackRecommendation={GROUP_META[group].recommendation}
                actions={actionsFor(group, item, (a) => onStage(item.key, a))}
                // Built here, not in the card: how long a dismissal lasts
                // depends on which group it came from, and only this level
                // knows that. A pending charge's dismissal must not outlive
                // the period — it posts later, often for a different amount.
                ignoreAction={ignoreActionFor(item, group)}
                // A combination is a claim about which rows belong together;
                // editing one of them is a different question, and belongs on
                // the transactions page rather than mid-reconciliation.
                allowCorrect={group !== 'combination'}
                staged={staged.get(item.key)}
                onStage={(a) => onStage(item.key, a)}
                onUnstage={() => onUnstage(item.key)}
                isBusy={isBusy}
              />
            ))}
            {items.length > (shown[group] ?? PAGE_SIZE) && (
              <button
                type="button"
                className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnSecondary}`}
                onClick={() => setShown((prev) => ({ ...prev, [group]: items.length }))}
              >
                Show the remaining {items.length - (shown[group] ?? PAGE_SIZE)}
              </button>
            )}
          </div>
        ))}

      {/*
       * Headed like every other section, minus the help text — there is
       * nothing to explain about rows that reconciled. The count is the whole
       * message, and it reads as part of the same list rather than a footnote
       * under it.
       */}
      {matchedCount > 0 && (
        <div className={s.group}>
          <div className={s.groupHeader}>
            <div className={s.groupHeadLine}>
              <span className={s.groupTitle}>Matched</span>
              <Badge variant="neutral" size="sm">
                {formatCount(matchedCount)}
              </Badge>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The buttons a decision offers.
 *
 * Deliberately few, and none of them write. Every one of these used to live
 * behind a Review dialog with a form; most needed no input at all, because the
 * answer is already on the card — the bank's amount, the bank's description,
 * the rows to combine. What each button does now is record the decision.
 *
 * A created transaction's name and budget are settled in step 3, where every
 * pending create is listed together. Choosing them here would mean a form per
 * card in a list you are trying to scan, and the same two questions answered
 * over and over instead of in one pass.
 */
function actionsFor(
  group: ResolvableGroup,
  item: ResolutionItem,
  stage: (action: StagedAction) => void,
): DecisionAction[] {
  const stmt = primaryStatement(item);
  const app = primaryApp(item);

  switch (group) {
    case 'amount_differs': {
      const out: DecisionAction[] = [];
      // With several app rows summing to the line there is no single amount to
      // correct — writing the bank's total onto one of them would invent money.
      if (stmt && app && item.apps.length === 1) {
        out.push({
          // Worded exactly as the recommendation beside it. The figure itself
          // is already on the bank row directly above, so repeating it in the
          // button only made the two lines disagree about what to call it.
          label: 'Use the statement amount',
          variant: 'primary',
          // The stored gross must still net to the bank's figure: rewards and
          // gift cards are settled before the charge reaches the card, so
          // writing the bank's number straight in would erase them.
          onClick: () =>
            stage({
              kind: 'correct',
              transactionId: app.id,
              amount: Math.round((stmt.amount + (app.offset ?? 0)) * 100) / 100,
              was: app.amount,
              label: app.name,
            }),
        });
      }
      return out;
    }

    case 'combination': {
      // Merge collapses the app rows into ONE parent matched to the single bank
      // line, so the ledger mirrors the statement. It needs exactly one statement
      // line and same-type EXPENSE/REFUND rows; anything else stays a pairing,
      // which only records that the rows explain the line and leaves the ledger
      // as it is. The server re-checks eligibility.
      const oneLine = item.statements.length === 1 ? item.statements[0] : undefined;
      if (oneLine && mergeEligible(item.apps)) {
        return [
          {
            label: 'Merge them',
            variant: 'primary',
            onClick: () =>
              stage({
                kind: 'merge',
                statementRowId: oneLine.id,
                name: oneLine.description,
                parts: item.apps.map((a) => ({
                  transactionId: a.id,
                  name: a.name,
                  amount: a.amount,
                  recurringLink: a.recurringLink ?? false,
                  scheduledMatch: a.scheduledMatch ?? false,
                })),
                label: item.title ?? 'Merge these rows',
              }),
          },
        ];
      }
      return [
        {
          label: 'Combine them',
          variant: 'primary',
          onClick: () => {
            const appIds = item.apps.map((a) => a.id);
            stage({
              kind: 'pair',
              pairs: item.statements.map((line) => ({
                statementRowId: line.id,
                transactionIds: appIds,
              })),
              label: item.title ?? 'Combine these rows',
            });
          },
        },
      ];
    }

    case 'on_statement_not_in_app':
    case 'cancelled_on_statement':
      return stmt
        ? [
            {
              label: 'Create this transaction',
              variant: group === 'on_statement_not_in_app' ? 'primary' : 'secondary',
              onClick: () =>
                stage({
                  kind: 'create',
                  statementRowId: stmt.id,
                  name: stmt.description,
                  amount: stmt.amount,
                  date: stmt.date,
                  txType: stmt.direction === 'credit' ? 'INCOME' : 'EXPENSE',
                  budgetId: null,
                }),
            },
          ]
        : [];

    case 'in_app_not_on_statement':
    case 'pending_in_app':
      // No "keep" button: keeping is what happens if you do nothing, and a
      // button that does nothing invites clicking it to make the row go away.
      return app
        ? [
            {
              label: 'Delete',
              variant: 'danger',
              onClick: () => stage({ kind: 'delete', transactionId: app.id, label: app.name }),
            },
          ]
        : [];
  }
}
