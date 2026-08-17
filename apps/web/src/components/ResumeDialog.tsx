import { useState } from 'react';
import {
  Modal,
  buttonStyles,
  RadioGroup,
  DatePicker,
  toPickerDate,
  fromPickerDate,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

interface ResumeDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (body: { immediately?: boolean; resumeDate?: string }) => void;
}

const MODE_OPTIONS = [
  { value: 'immediately', label: 'Immediately' },
  { value: 'date', label: 'Pick a date' },
];

export default function ResumeDialog({ open, onClose, onConfirm }: ResumeDialogProps) {
  const [mode, setMode] = useState<'immediately' | 'date'>('immediately');
  const [resumeDate, setResumeDate] = useState('');
  const [prevOpen, setPrevOpen] = useState(open);

  // Reset state when dialog opens
  if (open && !prevOpen) {
    setPrevOpen(true);
    setMode('immediately');
    setResumeDate('');
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  const handleConfirm = () => {
    if (mode === 'immediately') {
      onConfirm({ immediately: true });
    } else {
      onConfirm({ resumeDate });
    }
  };

  const isConfirmDisabled = mode === 'date' && !resumeDate;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Resume Recurring Source"
      closeButton="none"
      footer={
        <>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            style={{ opacity: isConfirmDisabled ? 0.5 : 1 }}
          >
            Resume
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
          >
            Cancel
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
        <p
          style={{
            fontSize: vars.font.sm,
            color: vars.color.textSecondary,
            margin: 0,
          }}
        >
          Choose when to resume generating occurrences.
        </p>

        <RadioGroup
          options={MODE_OPTIONS}
          value={mode}
          onChange={(v) => setMode(v as 'immediately' | 'date')}
          name="resume-mode"
        />

        {mode === 'date' && (
          <DatePicker
            value={toPickerDate(resumeDate)}
            onChange={(d) => setResumeDate(fromPickerDate(d))}
          />
        )}
      </div>
    </Modal>
  );
}
