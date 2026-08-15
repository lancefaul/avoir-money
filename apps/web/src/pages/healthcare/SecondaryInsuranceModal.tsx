import { useState } from 'react';
import { Modal, DatePicker, buttonStyles, inputStyles, vars } from '@budget-tracker/ui';
import { modalBodyFlush } from '../../components/settings-modal.css.js';

interface SecondaryInsuranceModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (date: string) => void;
  label: string;
}

function localToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function SecondaryInsuranceModal({
  open,
  onClose,
  onConfirm,
  label,
}: SecondaryInsuranceModalProps) {
  const [prevOpen, setPrevOpen] = useState(open);
  const [date, setDate] = useState<Date | null>(localToday);

  // Reset state when modal opens
  if (open && !prevOpen) {
    setPrevOpen(true);
    setDate(localToday());
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Secondary Insurance – ${label}`}
      closeButton="none"
      bodyClassName={modalBodyFlush}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: vars.space['2'] }}>
          <button
            type="button"
            onClick={() => {
              if (date) onConfirm(formatDateStr(date));
            }}
            disabled={!date}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            Confirm
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
      <div className={inputStyles.field}>
        <p
          style={{
            fontSize: vars.font.base,
            color: vars.color.textPrimary,
            margin: 0,
            marginBottom: vars.space['3'],
          }}
        >
          What date did secondary insurance cover this balance?
        </p>
        <label className={inputStyles.fieldLabel} htmlFor="secondary-insurance-date">
          Coverage Date
        </label>
        <DatePicker id="secondary-insurance-date" value={date} onChange={(d) => setDate(d)} />
      </div>
    </Modal>
  );
}
