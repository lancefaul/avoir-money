import { useState, useId, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  CurrencyInput,
  DatePicker,
  Select,
  inputStyles,
  buttonStyles,
  toPickerDate,
  fromPickerDate,
} from '@budget-tracker/ui';
import { api } from '../../lib/api.js';
import { useBudgetItems } from '../../hooks/useBudgetItems.js';
import { invalidateTransactionCaches } from '../../lib/cache-invalidation.js';
import { localToday, formatCurrency } from '../../lib/utils.js';
import * as dr from '../transactions/transaction-form.css.js';
import * as s from './accounts-page.css.js';

/**
 * The reasons a rewards balance goes down without being spent, and the row name
 * each one writes.
 *
 * The name is derived from the reason rather than typed, because the history is
 * the whole point of the feature: an unexplained decrease beside a redemption
 * looks like the same event, and months later there is no way to tell which was
 * which. Deriving it also keeps every row of a given kind identically named, so
 * they group and search cleanly.
 */
const REASONS = [
  { value: 'expired', label: 'Points expired', rowName: 'Rewards expired' },
  { value: 'clawback', label: 'Clawback (returned purchase)', rowName: 'Rewards clawback' },
  { value: 'correction', label: 'Correction', rowName: 'Rewards correction' },
] as const;

type ReasonValue = (typeof REASONS)[number]['value'];

interface AdjustRewardsModalProps {
  open: boolean;
  onClose: () => void;
  /** The card's nested Rewards account. */
  rewardsAccountId: string;
  /** Current rewards balance, used only to warn before going negative. */
  currentBalance: number;
}

/**
 * Records a decrease in a card's rewards that is NOT a redemption — points
 * expiring, a clawback on a returned purchase, or correcting a balance that was
 * entered wrong.
 *
 * Writes an EXPENSE row on the nested Rewards account, the mirror of the INCOME
 * row `EarnRewardsModal` writes. Because the account's balance is the running
 * sum of its rows, that is the entire mechanism — there is no rewards-balance
 * column to adjust, which is exactly the discipline that retired the old one.
 */
export default function AdjustRewardsModal({
  open,
  onClose,
  rewardsAccountId,
  currentBalance,
}: AdjustRewardsModalProps) {
  const fid = useId();
  const qc = useQueryClient();
  const [amountCents, setAmountCents] = useState(0);
  const [reason, setReason] = useState<ReasonValue>('expired');
  const [date, setDate] = useState(() => localToday());

  const { data: budgetItems } = useBudgetItems();

  /*
   * Carry the system "Payment" allocation, the same one a redemption leg takes.
   *
   * Rewards leaving an account is money movement, not household spending, so it
   * must not land in a budget. A null budget would keep it out of the rollup
   * too — the rollup only counts budgets belonging to the year plan — but it
   * renders as the red "Uncategorized" flag in the ledger, so every adjustment
   * would read as something needing attention.
   */
  const paymentBudgetId = useMemo(
    () => budgetItems?.find((b) => b.isSystem && b.name === 'Payment')?.id ?? null,
    [budgetItems],
  );

  const adjust = useMutation({
    mutationFn: (body: unknown) => api.transactions.create(body),
    meta: {
      successMessage: 'Rewards adjustment added',
      undoneMessage: 'Rewards adjustment removed',
      // Both modals write an ordinary transaction, so the inverse is the
      // ledger gate's own delete — which unwinds the rewards ledger entry
      // through the same hook that created it.
      undo: (data: unknown) => api.transactions.delete((data as { id: string }).id),
    },
    onSuccess: () => {
      /*
       * The centralized set, not a hand-picked pair. A rewards account is in
       * CASH_EXCLUDED_TYPES, so no dashboard figure moves for this row today —
       * but that is a fact about the current aggregations, not about this
       * mutation, and a hand-written key list goes stale silently the moment it
       * stops being true.
       */
      invalidateTransactionCaches(qc);
      resetForm();
      onClose();
    },
  });

  function resetForm() {
    setAmountCents(0);
    setReason('expired');
    setDate(localToday());
  }

  function handleSubmit() {
    if (amountCents <= 0 || !rewardsAccountId) return;
    const chosen = REASONS.find((r) => r.value === reason) ?? REASONS[0];
    adjust.mutate({
      type: 'EXPENSE',
      name: chosen.rowName,
      amount: amountCents / 100,
      date,
      accountId: rewardsAccountId,
      ...(paymentBudgetId ? { budgetId: paymentBudgetId } : {}),
    });
  }

  function handleCancel() {
    resetForm();
    onClose();
  }

  /*
   * A decrease larger than the tracked balance is allowed, deliberately. When
   * the app's number was already too low, refusing the entry does not make it
   * right — it just preserves the wrong figure and loses the event. The warning
   * exists so the resulting negative is a decision rather than a surprise.
   */
  const resulting = Math.round((currentBalance - amountCents / 100) * 100) / 100;
  const goesNegative = amountCents > 0 && resulting < 0;

  const dateObj = toPickerDate(date);

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title="Adjust Rewards"
      closeButton="none"
      footer={
        <div className={dr.transferRow}>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={amountCents <= 0 || adjust.isPending}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            {adjust.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
          >
            Cancel
          </button>
        </div>
      }
    >
      <div className={inputStyles.formStack}>
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-amount`} className={inputStyles.fieldLabel}>
            Amount to remove
          </label>
          <CurrencyInput id={`${fid}-amount`} value={amountCents} onChange={setAmountCents} />
          {goesNegative && (
            <div className={s.rewardsNegativeWarning} role="status">
              <span>This leaves the rewards balance negative:</span>
              <span className={s.openingConsequenceValues}>
                {formatCurrency(currentBalance)}
                <span className={s.openingConsequenceArrow}>→</span>
                {formatCurrency(resulting)}
              </span>
            </div>
          )}
        </div>
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-reason`} className={inputStyles.fieldLabel}>
            Reason
          </label>
          <Select
            id={`${fid}-reason`}
            options={REASONS.map((r) => ({ value: r.value, label: r.label }))}
            value={reason}
            onChange={(v) => setReason(v as ReasonValue)}
          />
        </div>
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-date`} className={inputStyles.fieldLabel}>
            Date
          </label>
          <DatePicker
            id={`${fid}-date`}
            value={dateObj}
            onChange={(d) => {
              if (d) setDate(fromPickerDate(d));
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
