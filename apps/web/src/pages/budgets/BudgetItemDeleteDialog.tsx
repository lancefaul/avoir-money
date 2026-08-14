import { useState } from 'react';
import { Modal, RadioGroup, buttonStyles, inputStyles, Select } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import type { DeleteDialogState, DeletionMode } from './types.js';

interface Props {
  state: DeleteDialogState;
  categories: { id: string; name: string }[];
  onClose: () => void;
  onConfirm: (mode: DeletionMode, targetCategoryId?: string) => void;
  isLoading?: boolean;
}

const MODE_OPTIONS: {
  value: DeletionMode;
  label: string;
  description: string;
}[] = [
  {
    value: 'hard',
    label: 'Hard Delete',
    description: 'Permanently remove the budget, all transactions, and budget history.',
  },
  {
    value: 'soft',
    label: 'Soft Delete',
    description: 'Mark as deleted. Transactions and budget history are retained.',
  },
  {
    value: 'reassign',
    label: 'Reassign & Delete',
    description:
      'Move transactions to another budget, then delete this budget and its allocations.',
  },
];

export default function BudgetItemDeleteDialog({
  state,
  categories,
  onClose,
  onConfirm,
  isLoading = false,
}: Props) {
  const [selectedMode, setSelectedMode] = useState<DeletionMode | undefined>(undefined);
  const [targetCategoryId, setTargetCategoryId] = useState<string>('');
  const [step, setStep] = useState<'choose' | 'confirm'>('choose');
  const [prevOpen, setPrevOpen] = useState(state.open);
  const [prevCategoryId, setPrevCategoryId] = useState(state.categoryId);

  // Reset internal state when dialog opens or category changes
  if (state.open && (!prevOpen || state.categoryId !== prevCategoryId)) {
    setPrevOpen(true);
    setPrevCategoryId(state.categoryId);
    setSelectedMode(undefined);
    setTargetCategoryId('');
    setStep('choose');
  } else if (!state.open && prevOpen) {
    setPrevOpen(false);
  }

  const availableCategories = categories.filter((c) => c.id !== state.categoryId);

  const canProceed =
    selectedMode !== undefined && (selectedMode !== 'reassign' || targetCategoryId !== '');

  const handleNext = () => {
    if (!canProceed) return;
    if (selectedMode === 'hard') {
      setStep('confirm');
    } else {
      onConfirm(selectedMode!, selectedMode === 'reassign' ? targetCategoryId : undefined);
    }
  };

  const handleHardDeleteConfirm = () => {
    onConfirm('hard');
  };

  return (
    <Modal
      open={state.open}
      onClose={onClose}
      title={
        step === 'confirm'
          ? `Permanently delete "${state.categoryName}"?`
          : `Delete "${state.categoryName}"`
      }
      closeButton="none"
      footer={
        step === 'choose' ? (
          <>
            <button
              type="button"
              onClick={handleNext}
              disabled={!canProceed || isLoading}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnDanger}`}
              style={{ opacity: !canProceed || isLoading ? 0.5 : 1 }}
            >
              {isLoading ? 'Deleting…' : selectedMode === 'hard' ? 'Next' : 'Delete'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleHardDeleteConfirm}
              disabled={isLoading}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnDanger}`}
              style={{ opacity: isLoading ? 0.5 : 1 }}
            >
              {isLoading ? 'Deleting…' : 'Yes, permanently delete'}
            </button>
            <button
              type="button"
              onClick={() => setStep('choose')}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              Go Back
            </button>
          </>
        )
      }
    >
      {step === 'choose' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
          {/* Context */}
          <p
            style={{
              fontSize: vars.font.sm,
              color: vars.color.textSecondary,
              margin: 0,
            }}
          >
            {state.transactionCount > 0
              ? `This budget has ${state.transactionCount} transaction${state.transactionCount === 1 ? '' : 's'}.`
              : 'This budget has no transactions.'}
            {state.hasBudget ? ' It has an active budget allocation.' : ''}
          </p>

          {/* Mode selection */}
          <RadioGroup
            options={MODE_OPTIONS.map((opt) => ({
              value: opt.value,
              label: opt.label,
              helper: opt.description,
            }))}
            value={selectedMode}
            onChange={(v) => setSelectedMode(v as DeletionMode)}
            name="deletion-mode"
          />

          {/* Reassign target picker */}
          {selectedMode === 'reassign' && (
            <div className={inputStyles.field}>
              <label htmlFor="reassign-target" className={inputStyles.fieldLabel}>
                Move transactions to
              </label>
              <Select
                id="reassign-target"
                options={availableCategories.map((c) => ({ value: c.id, label: c.name }))}
                value={targetCategoryId}
                onChange={(v) => setTargetCategoryId(v)}
                placeholder="Select a budget…"
                searchable
              />
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            borderRadius: vars.radius.lg,
            border: `${vars.border.thin} solid ${vars.color.danger300}`,
            background: vars.color.danger50,
            padding: vars.space['3'],
          }}
        >
          <p
            style={{
              fontSize: vars.font.sm,
              fontWeight: vars.font.medium,
              color: vars.color.danger400,
              margin: 0,
            }}
          >
            This action cannot be undone.
          </p>
          <p
            style={{
              fontSize: vars.font.sm,
              color: vars.color.danger400,
              margin: 0,
              marginTop: vars.space['1'],
            }}
          >
            All transactions, budget history, and the budget itself will be permanently removed.
            There is no way to recover this data.
          </p>
        </div>
      )}
    </Modal>
  );
}
