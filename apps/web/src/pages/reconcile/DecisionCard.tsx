import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import {
  CurrencyInput,
  DatePicker,
  Modal,
  buttonStyles,
  inputStyles,
  toPickerDate,
  fromPickerDate,
} from '@budget-tracker/ui';
import NameAutocomplete from '../transactions/NameAutocomplete.js';
import { ItemRows, RowTable, StatusRow } from './DecisionRows.js';
import { describeStaged, type ResolutionItem, type StagedAction } from './types.js';
import * as s from './reconcile-page.css.js';

/** One thing the user can do about a decision, rendered as a button. */
export interface DecisionAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}

interface DecisionCardProps {
  item: ResolutionItem;
  /** The group's action, used when the decision has nothing more specific. */
  fallbackRecommendation: string;
  actions: DecisionAction[];
  /**
   * The "leave it" decision for this card, built by the caller.
   *
   * Not derived here: how long a dismissal lasts depends on which group the
   * decision came from, and the card does not know its group.
   */
  ignoreAction: StagedAction;
  /**
   * Whether a free-form correction is on offer.
   *
   * Off for combinations. Correcting edits ONE transaction's name, date and
   * amount, and a combination is a claim about several rows at once — there is
   * no single row the button could mean, and the one it would silently pick is
   * whichever happened to be first.
   */
  allowCorrect: boolean;
  /** What has been decided for this card, if anything. */
  staged?: StagedAction;
  onStage: (action: StagedAction) => void;
  onUnstage: () => void;
  isBusy: boolean;
}

/**
 * One decision, with every row it concerns and everything you can do about it.
 *
 * Nothing here writes. Every button records an intent that step 3 applies, so a
 * decided row stays exactly where it is instead of vanishing under the cursor.
 *
 * The rows and the status line are shared with step 3 (`DecisionRows.tsx`),
 * which shows the decided ones again as a list of pending writes.
 */
export default function DecisionCard({
  item,
  fallbackRecommendation,
  actions,
  ignoreAction,
  allowCorrect,
  staged,
  onStage,
  onUnstage,
  isBusy,
}: DecisionCardProps) {
  const app = item.apps[0];
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(app?.name ?? '');
  // The `Z` here parsed as UTC midnight, which the picker's local getters
  // rendered as the previous day — on the one screen whose whole job is
  // comparing dates against a bank statement.
  const [date, setDate] = useState<Date | null>(toPickerDate(app?.date));
  const [cents, setCents] = useState(Math.round((app?.amount ?? 0) * 100));

  return (
    <div className={s.decision}>
      <RowTable>
        <ItemRows item={item} />
        <StatusRow
          kind={staged?.kind}
          text={staged ? describeStaged(staged) : (item.recommendation ?? fallbackRecommendation)}
        >
          {staged ? (
            <button
              type="button"
              disabled={isBusy}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnTrueGhost}`}
              onClick={onUnstage}
            >
              <Undo2 size={14} aria-hidden />
              Undo
            </button>
          ) : (
            <>
              {/* Deciding that nothing is wrong is still deciding. Without it a
                  row the user has judged fine looks identical to one they have
                  not looked at yet. */}
              <button
                type="button"
                disabled={isBusy}
                className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnTrueGhost}`}
                onClick={() => onStage(ignoreAction)}
              >
                Ignore
              </button>
              {app && allowCorrect && !editing && (
                <button
                  type="button"
                  disabled={isBusy}
                  className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnSecondary}`}
                  onClick={() => setEditing(true)}
                >
                  Correct
                </button>
              )}
              {/*
               * Sorted so the primary lands rightmost — the eye finishes at the
               * right edge of a row, and the recommended action should be what
               * it finishes on.
               */}
              {[...actions]
                .sort((a, b) => Number(a.variant === 'primary') - Number(b.variant === 'primary'))
                .map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    disabled={isBusy}
                    className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${
                      action.variant === 'primary'
                        ? buttonStyles.btnPrimary
                        : action.variant === 'danger'
                          ? buttonStyles.btnDanger
                          : buttonStyles.btnSecondary
                    }`}
                    onClick={action.onClick}
                  >
                    {action.label}
                  </button>
                ))}
            </>
          )}
        </StatusRow>
      </RowTable>

      {/*
       * A modal, not a row in the table.
       *
       * Correcting is data entry, not a glance: three fields that need focus,
       * validation and a deliberate confirm. Inline it stretched the card mid-
       * list and pushed every decision below it down the page while typing.
       */}
      {app && (
        <Modal
          open={editing}
          onClose={() => setEditing(false)}
          title={`Correct “${app.name}”`}
          // Cancel is already the footer's left-hand escape and the title says
          // which row this is; an X on top of that is a third way out of a
          // three-field form.
          closeButton="none"
          // Left-aligned, primary first. The decision row's actions sit right
          // because the eye finishes a row there; a dialog is read top-down and
          // its footer starts a new line, so the thing you came to do leads.
          footer={
            <>
              <button
                type="button"
                disabled={!name.trim() || !date}
                className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
                onClick={() => {
                  onStage({
                    kind: 'edit',
                    transactionId: app.id,
                    name: name.trim(),
                    date: fromPickerDate(date),
                    amount: Math.round(cents) / 100,
                    was: { name: app.name, date: app.date, amount: app.amount },
                  });
                  setEditing(false);
                }}
              >
                Stage correction
              </button>
              <button
                type="button"
                className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </>
          }
        >
          <div className={s.editFields}>
            <div className={inputStyles.field}>
              <label className={inputStyles.fieldLabel} htmlFor={`edit-name-${item.key}`}>
                Name
              </label>
              {/*
               * The same description search the transaction form uses, so a
               * correction joins the merchant the app already knows instead of
               * forking it — which is how "aliexpress" ends up beside
               * "AliExpress" as two merchants that are one.
               */}
              <NameAutocomplete
                id={`edit-name-${item.key}`}
                className={inputStyles.input}
                value={name}
                onValueChange={setName}
              />
            </div>
            <div className={inputStyles.field}>
              <label className={inputStyles.fieldLabel} htmlFor={`edit-date-${item.key}`}>
                Date
              </label>
              <DatePicker id={`edit-date-${item.key}`} value={date} onChange={setDate} />
            </div>
            <div className={inputStyles.field}>
              <label className={inputStyles.fieldLabel} htmlFor={`edit-amount-${item.key}`}>
                Amount
              </label>
              <CurrencyInput id={`edit-amount-${item.key}`} value={cents} onChange={setCents} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
