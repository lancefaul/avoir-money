import { useEffect, useState } from 'react';
import { Modal, buttonStyles, inputStyles, SectionHeading } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { useEscrowHistory, useCreateEscrowRecord, type DebtRecord } from '../../hooks/useApi.js';
import { formatCurrency } from '../../lib/utils.js';
import EscrowFields from './EscrowFields.js';

interface EscrowUpdateModalProps {
  debt: DebtRecord;
  onClose: () => void;
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0] ?? '';
}

/** New period end = start + 1 year - 1 day (keeps the span within 366 days). */
function defaultPeriodEnd(start: Date): Date {
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  end.setUTCDate(end.getUTCDate() - 1);
  return end;
}

function daysBetween(startStr: string, endStr: string): number {
  const start = new Date(startStr);
  const end = new Date(endStr);
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
}

export default function EscrowUpdateModal({ debt, onClose }: EscrowUpdateModalProps) {
  const { data } = useEscrowHistory(debt.id);
  const create = useCreateEscrowRecord();

  const [amount, setAmount] = useState(0);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [populated, setPopulated] = useState(false);

  // Pre-fill from the most recent record once escrow history is available. The
  // new period continues where the last one ended (start = prior period end),
  // which also dismisses the "period ended" reminder.
  useEffect(() => {
    if (populated || !data || data.length === 0) return;
    const mostRecent = data[0]!;
    const newStart = new Date(mostRecent.periodEndDate);
    setAmount(mostRecent.monthlyAmount);
    setStartDate(toDateStr(newStart));
    setEndDate(toDateStr(defaultPeriodEnd(newStart)));
    setPopulated(true);
  }, [data, populated]);

  const span = startDate && endDate ? daysBetween(startDate, endDate) : 0;
  const valid = amount > 0 && !!startDate && !!endDate && span > 0 && span <= 366;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    create.mutate(
      {
        debtId: debt.id,
        body: { monthlyAmount: amount, periodStartDate: startDate, periodEndDate: endDate },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${debt.name} – Update Escrow`}
      variant="drawer"
      closeButton="none"
      footer={
        <div style={{ display: 'flex', gap: vars.space['2'] }}>
          <button
            type="submit"
            form="escrow-update-form"
            disabled={create.isPending || !valid}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            {amount > 0 ? `Save · ${formatCurrency(amount)}/mo` : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
          >
            Cancel
          </button>
        </div>
      }
    >
      <form id="escrow-update-form" onSubmit={handleSubmit}>
        <div className={inputStyles.formStack}>
          <SectionHeading>New Escrow Period</SectionHeading>
          <EscrowFields
            errors={{}}
            escrowAmount={amount}
            onEscrowAmountChange={setAmount}
            periodStartDate={startDate}
            onPeriodStartDateChange={setStartDate}
            periodEndDate={endDate}
            onPeriodEndDateChange={setEndDate}
          />
        </div>
      </form>
    </Modal>
  );
}
