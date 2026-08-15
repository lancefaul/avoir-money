import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Badge, Select, inputStyles } from '@budget-tracker/ui';
import { api } from '../../lib/api.js';
import { formatCount } from '../../lib/utils.js';
import EmptyState from '../../components/EmptyState.js';
import NameAutocomplete from '../transactions/NameAutocomplete.js';
import { ActionRow, ItemRows, RowTable } from './DecisionRows.js';
import {
  describeStaged,
  type AppliedResult,
  type ResolutionItem,
  type StagedAction,
} from './types.js';
import * as s from './reconcile-page.css.js';

interface ReviewStepProps {
  staged: Map<string, StagedAction>;
  /** The decision each staged action came from, so it renders as it did in step 2. */
  items: Map<string, ResolutionItem>;
  /**
   * What happened to each decision, once Apply has run. Empty before then.
   *
   * Its presence flips this screen from a plan into a report: the same rows,
   * regrouped by outcome, because after the writes have landed "did it work"
   * is the only question left and "was it a create or a delete" is not.
   */
  applied: Map<string, AppliedResult>;
  /** Amend a pending create — the only staged action with details to settle. */
  onEdit: (itemKey: string, action: StagedAction) => void;
}

/**
 * The operations, each under its own heading.
 *
 * `correct` and `edit` share one: both change a transaction that already exists,
 * and the distinction between them (which fields moved) is an implementation
 * detail of how the decision was made, not something the user is reviewing.
 *
 * Ordered by consequence — new records, then changed ones, then a regrouping
 * that writes no ledger data, then destruction, then the rows nothing happens
 * to. Deletions sit late and deliberately visible; "Ignore" last because it is
 * the only section where reading it changes nothing.
 */
const SECTIONS: { title: string; kinds: StagedAction['kind'][] }[] = [
  { title: 'Create', kinds: ['create'] },
  { title: 'Merge', kinds: ['merge'] },
  { title: 'Correct', kinds: ['correct', 'edit'] },
  { title: 'Combine', kinds: ['pair'] },
  { title: 'Delete', kinds: ['delete'] },
  { title: 'Ignore', kinds: ['ignore'] },
];

/** What a merge will discard for one of its rows — named, not generic (Req 5.4). */
function mergeWarningText(p: { recurringLink: boolean; scheduledMatch: boolean }): string {
  if (p.scheduledMatch && p.recurringLink)
    return 'linked to a recurring bill; its paid scheduled item will revert to unpaid';
  if (p.scheduledMatch) return 'its paid scheduled item will revert to unpaid';
  return "linked to a recurring bill — this occurrence's record will be removed";
}

/**
 * Everything about to happen, before any of it happens.
 *
 * Steps 1 and 2 read, parse and decide; this is where the writes are gathered
 * and shown as one list. A reconciliation is a review, and a review whose
 * subject changes while you scroll cannot be checked — so nothing above this
 * point touches the ledger.
 *
 * One row per operation, in the transaction log's own chrome. The heading says
 * what is happening to everything under it, so the row does not have to; it
 * carries the operation as its badge and shows the values that will be written.
 *
 * There is no per-row Remove. Undoing a decision is what step 2's Undo is for,
 * and Back is one click away; a second, subtly different way to unstage in the
 * screen whose whole job is confirming would be one more thing to get wrong.
 *
 * Names and budgets are settled here rather than on each card. Both questions
 * want the same answers across a batch ("all of these Etsy lines are Shopping")
 * and asking them per card means answering them over and over in the middle of
 * scanning. Gathered here they are one pass.
 */
export default function ReviewStep({ staged, items, applied, onEdit }: ReviewStepProps) {
  const { data: budgets } = useQuery({
    queryKey: ['budgetItems'],
    queryFn: () => api.budgetItems.list(),
  });

  const entries = [...staged.entries()];
  if (entries.length === 0) {
    return (
      <EmptyState message="No changes staged. Go back and decide what to do with the differences." />
    );
  }

  type BudgetOption = { id: string; name: string; icon?: string | null };
  const budgetList = (budgets ?? []) as BudgetOption[];
  const budgetOptions = budgetList.map((b) => ({
    value: b.id,
    label: `${b.icon ?? ''} ${b.name}`.trim(),
  }));

  /**
   * The real Uncategorized budget, shown as the default rather than a
   * placeholder reading "Uncategorized".
   *
   * It is a system budget with its own icon (ADR-017), and the server assigns
   * it anyway when no budget is chosen. Rendering it as a bare placeholder made
   * it the one budget in the app that appeared without its emoji, and looked
   * like an empty field rather than the answer it already is.
   */
  const uncategorizedId = budgetList.find((b) => b.name === 'Uncategorized')?.id ?? '';

  /**
   * The name and budget a create still needs.
   *
   * Only creates have them: every other operation acts on a transaction that
   * already carries both, and re-asking would invite changing them by accident
   * while confirming something else.
   */
  const createFields = (key: string, action: Extract<StagedAction, { kind: 'create' }>) => (
    <tr>
      <td colSpan={4} className={s.reviewFieldsCell}>
        <div className={s.reviewFields}>
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel} htmlFor={`name-${key}`}>
              Name
            </label>
            {/*
             * The same description search the transaction form uses, so a
             * created transaction joins the merchant the app already knows
             * instead of forking it — which is how "aliexpress" ends up beside
             * "AliExpress" as two merchants that are one. It also stays typable,
             * which a dropdown of existing names was not: the bank's wording is
             * often a merchant the app has never seen.
             */}
            <NameAutocomplete
              id={`name-${key}`}
              className={inputStyles.input}
              value={action.name}
              onValueChange={(v) => onEdit(key, { ...action, name: v })}
            />
          </div>
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel} htmlFor={`budget-${key}`}>
              Budget
            </label>
            <Select
              id={`budget-${key}`}
              searchable
              options={budgetOptions}
              value={action.budgetId ?? uncategorizedId}
              onChange={(v) => onEdit(key, { ...action, budgetId: v || null })}
            />
          </div>
        </div>
      </td>
    </tr>
  );

  /**
   * A merge settles only its name (the parent's budget is Uncategorized and each
   * child keeps its own), plus the disclosure of what it will discard — named per
   * row, shown here as the last thing before Apply.
   */
  const mergeFields = (key: string, action: Extract<StagedAction, { kind: 'merge' }>) => {
    const warnings = action.parts.filter((p) => p.recurringLink || p.scheduledMatch);
    return (
      <tr>
        <td colSpan={4} className={s.reviewFieldsCell}>
          <div className={s.reviewFields}>
            <div className={inputStyles.field}>
              <label className={inputStyles.fieldLabel} htmlFor={`merge-name-${key}`}>
                Merged name
              </label>
              <NameAutocomplete
                id={`merge-name-${key}`}
                className={inputStyles.input}
                value={action.name}
                onValueChange={(v) => onEdit(key, { ...action, name: v })}
              />
            </div>
          </div>
          {warnings.length > 0 && (
            <ul className={s.mergeWarnings}>
              {warnings.map((p) => (
                <li key={p.transactionId} className={s.mergeWarning}>
                  <AlertTriangle size={14} aria-hidden />
                  <span>
                    <strong>{p.name}</strong> — {mergeWarningText(p)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </td>
      </tr>
    );
  };

  /**
   * Before Apply: grouped by what will happen. After: by what did.
   *
   * The regrouping is the whole reason Apply stays on this screen. Sending the
   * user back to the difference list the moment the writes landed removed the
   * only page that could tell them which ones landed.
   */
  const sections =
    applied.size > 0
      ? [
          { title: 'Applied', entries: entries.filter(([k]) => applied.get(k)?.ok) },
          { title: 'Failed', entries: entries.filter(([k]) => applied.get(k)?.ok === false) },
          { title: 'Not applied', entries: entries.filter(([k]) => !applied.has(k)) },
        ]
      : SECTIONS.map(({ title, kinds }) => ({
          title,
          entries: entries.filter(([, a]) => kinds.includes(a.kind)),
        }));

  return (
    <div className={s.groups}>
      {sections.map(({ title, entries: inSection }) => {
        if (inSection.length === 0) return null;

        return (
          <div key={title} className={s.group}>
            {/* Headed like step 2's sections — same title weight, same count
                badge. This is the same list at a later stage, not a new
                screen. No help text: the title is the whole explanation. */}
            <div className={s.groupHeader}>
              <div className={s.groupHeadLine}>
                <span className={s.groupTitle}>{title}</span>
                <Badge variant="neutral" size="sm">
                  {formatCount(inSection.length)}
                </Badge>
              </div>
            </div>
            {inSection.map(([key, action]) => {
              const result = applied.get(key);
              return (
                <div key={key} className={s.decision}>
                  <RowTable>
                    {renderRows(action, items.get(key), result)}
                    {/* The fields close once the write has landed: changing a
                        name here would edit nothing but the screen. */}
                    {action.kind === 'create' && !result?.ok && createFields(key, action)}
                    {action.kind === 'merge' && !result?.ok && mergeFields(key, action)}
                  </RowTable>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A staged operation, as rows.
 *
 * Everything but a combine is one row, built from the action itself so it shows
 * the values about to be written rather than the ones being replaced.
 *
 * A combine is the exception, and keeps both sides with their bank/app badges:
 * the question it asks is *which rows go with which*, so the side is the
 * substance of it. Collapsed to one row there would be nothing left to check.
 */
function renderRows(
  action: StagedAction,
  item?: ResolutionItem,
  result?: AppliedResult,
): ReactNode {
  // Once a decision has been written, how it turned out outranks what it was.
  const status = result ? (result.ok ? 'done' : 'failed') : action.kind;
  const outcome = result
    ? result.ok
      ? `${describeStaged(action)} — done`
      : `${describeStaged(action)} — failed: ${result.error ?? 'unknown error'}`
    : undefined;

  // Reuses step 2's wording rather than restating it, so the sentence a user
  // read when deciding is the sentence they see when confirming.
  const tooltip = outcome ?? describeStaged(action);

  if (action.kind === 'pair' || action.kind === 'merge') {
    // Both sides while it is still a proposal — the question is which rows go
    // together. A merge shows the same breakdown (the bank line and the rows it
    // will replace); its name field and disclosure render just below. Once
    // written both collapse to a single outcome row.
    return item && !result ? (
      <ItemRows item={item} />
    ) : (
      <ActionRow kind={status} tooltip={tooltip} label={action.label} credit={false} />
    );
  }

  const app = item?.apps[0];
  const stmt = item?.statements[0];

  switch (action.kind) {
    case 'create':
      return (
        <ActionRow
          kind={status}
          tooltip={tooltip}
          label={action.name}
          date={action.date}
          amount={action.amount}
          credit={action.txType === 'INCOME'}
        />
      );
    case 'correct':
      return (
        <ActionRow
          kind={status}
          tooltip={tooltip}
          label={action.label}
          date={app?.date}
          // The bank's figure — what this writes — not `action.was`.
          amount={action.amount}
          credit={app?.direction === 'credit'}
        />
      );
    case 'edit':
      return (
        <ActionRow
          kind={status}
          tooltip={tooltip}
          label={action.name}
          date={action.date}
          amount={action.amount}
          credit={app?.direction === 'credit'}
        />
      );
    case 'delete':
      return (
        <ActionRow
          kind={status}
          tooltip={tooltip}
          label={action.label}
          date={app?.date}
          amount={app?.amount}
          credit={app?.direction === 'credit'}
        />
      );
    case 'ignore':
      // Either side can be ignored — a statement line the app never recorded
      // has no app row to describe it.
      return (
        <ActionRow
          kind={status}
          tooltip={tooltip}
          label={action.label}
          date={app?.date ?? stmt?.date}
          amount={app?.amount ?? stmt?.amount}
          credit={(app?.direction ?? stmt?.direction) === 'credit'}
        />
      );
  }
}
