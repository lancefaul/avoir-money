import { useState, useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  CurrencyInput,
  DatePicker,
  inputStyles,
  buttonStyles,
  toPickerDate,
  fromPickerDate,
} from '@budget-tracker/ui';
import { api } from '../../lib/api.js';
import { localToday } from '../../lib/utils.js';
import * as dr from '../transactions/transaction-form.css.js';

interface EarnRewardsModalProps {
  open: boolean;
  onClose: () => void;
  /** The card's nested Rewards account. */
  rewardsAccountId: string;
}

/**
 * Records rewards earned on a card as an INCOME row on its nested Rewards
 * account (rewards-as-child-account). The account's balance is the running sum
 * of these credits minus redemptions, so no bespoke rewards-balance write is
 * needed — the ledger maintains it.
 */
export default function EarnRewardsModal({
  open,
  onClose,
  rewardsAccountId,
}: EarnRewardsModalProps) {
  const fid = useId();
  const qc = useQueryClient();
  const [amountCents, setAmountCents] = useState(0);
  const [date, setDate] = useState(() => localToday());

  const earn = useMutation({
    mutationFn: (body: unknown) => api.transactions.create(body),
    meta: {
      successMessage: 'Rewards earned added',
      undoneMessage: 'Rewards entry removed',
      // Both modals write an ordinary transaction, so the inverse is the
      // ledger gate's own delete — which unwinds the rewards ledger entry
      // through the same hook that created it.
      undo: (data: unknown) => api.transactions.delete((data as { id: string }).id),
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      resetForm();
      onClose();
    },
  });

  function resetForm() {
    setAmountCents(0);
    setDate(localToday());
  }

  function handleSubmit() {
    if (amountCents <= 0 || !rewardsAccountId) return;
    earn.mutate({
      type: 'INCOME',
      name: 'Rewards earned',
      amount: amountCents / 100,
      date,
      accountId: rewardsAccountId,
    });
  }

  function handleCancel() {
    resetForm();
    onClose();
  }

  const dateObj = toPickerDate(date);

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title="Add Rewards Earned"
      closeButton="none"
      footer={
        <div className={dr.transferRow}>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={amountCents <= 0 || earn.isPending}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            {earn.isPending ? 'Saving…' : 'Save'}
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
            Amount earned
          </label>
          <CurrencyInput id={`${fid}-amount`} value={amountCents} onChange={setAmountCents} />
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
