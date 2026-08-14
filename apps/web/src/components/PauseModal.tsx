import { useState, useCallback, useId } from 'react';
import { Modal, Select, Toggle, IntegerInput, buttonStyles, inputStyles } from '@budget-tracker/ui';
import type { SelectOption } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

const PERIOD_OPTIONS: SelectOption[] = [
  { value: 'days', label: 'Days' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'months', label: 'Months' },
  { value: 'years', label: 'Years' },
];

interface PauseModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (body: { duration?: number; unit?: string; indefinite?: boolean }) => void;
}

export default function PauseModal({ open, onClose, onConfirm }: PauseModalProps) {
  const fid = useId();
  const [prevOpen, setPrevOpen] = useState(open);
  const [duration, setDuration] = useState(1);
  const [unit, setUnit] = useState('months');
  const [indefinite, setIndefinite] = useState(false);

  // Reset state when modal opens (inline state adjustment — no useEffect)
  if (open && !prevOpen) {
    setPrevOpen(true);
    setDuration(1);
    setUnit('months');
    setIndefinite(false);
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  const handleConfirm = useCallback(() => {
    if (indefinite) {
      onConfirm({ indefinite: true });
    } else {
      onConfirm({ duration: Math.max(1, duration), unit });
    }
  }, [indefinite, duration, unit, onConfirm]);

  const baseMd = `${buttonStyles.btnBase} ${buttonStyles.btnMd}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pause Recurring Expense"
      closeButton="none"
      footer={
        <>
          <button
            type="button"
            className={`${baseMd} ${buttonStyles.btnPrimary}`}
            onClick={handleConfirm}
          >
            Pause
          </button>
          <button
            type="button"
            className={`${baseMd} ${buttonStyles.btnSecondary}`}
            onClick={onClose}
          >
            Cancel
          </button>
        </>
      }
    >
      <div className={inputStyles.formStack}>
        {/* Duration + Period side by side */}
        <div style={{ display: 'flex', gap: vars.space['3'], alignItems: 'flex-end' }}>
          <div className={inputStyles.field} style={{ flex: 1 }}>
            <label htmlFor={`${fid}-duration`} className={inputStyles.fieldLabel}>
              Duration
            </label>
            <IntegerInput
              id={`${fid}-duration`}
              value={duration}
              onChange={setDuration}
              min={1}
              max={999}
              disabled={indefinite}
              placeholder="1"
            />
          </div>
          <div className={inputStyles.field} style={{ flex: 1 }}>
            <label htmlFor={`${fid}-period`} className={inputStyles.fieldLabel}>
              Period
            </label>
            <Select
              id={`${fid}-period`}
              options={PERIOD_OPTIONS}
              value={unit}
              onChange={setUnit}
              disabled={indefinite}
            />
          </div>
        </div>

        {/* Indefinite toggle */}
        <Toggle checked={indefinite} onChange={setIndefinite} label="Until I restart" />
      </div>
    </Modal>
  );
}
