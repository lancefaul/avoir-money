import { useState, useId } from 'react';
import { Modal, ButtonGroup, CurrencyInput, buttonStyles, inputStyles } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import type { UseMutationResult } from '@tanstack/react-query';

interface Snapshot {
  id: string;
  date: string;
  quantity: number;
  value: number | null;
}
interface Holding {
  id: string;
  name: string;
  ticker: string | null;
  type: string;
  quantity: number;
  costBasis: number | null;
  custodianId: string | null;
  walletId: string | null;
  custodianName: string | null;
  walletName: string | null;
  latestSnapshot: Snapshot | null;
}

interface EditCostBasisModalProps {
  holding: Holding | null;
  onClose: () => void;
  updateInvestment: UseMutationResult<unknown, Error, { id: string; body: unknown }, unknown>;
}

type EntryType = 'total' | 'perShare';

const ENTRY_OPTIONS = [
  { value: 'total', label: 'Total Cost' },
  { value: 'perShare', label: 'Cost Per Share' },
];

export default function EditCostBasisModal({
  holding,
  onClose,
  updateInvestment,
}: EditCostBasisModalProps) {
  const fid = useId();
  const [prevHolding, setPrevHolding] = useState<Holding | null>(holding);
  const [entryType, setEntryType] = useState<EntryType>('total');
  const [amountCents, setAmountCents] = useState(0);

  // Reset state when holding changes (inline state adjustment — no useEffect)
  if (holding && holding !== prevHolding) {
    setPrevHolding(holding);
    setEntryType('total');
    setAmountCents(Math.round((holding.costBasis ?? 0) * 100));
  } else if (!holding && prevHolding) {
    setPrevHolding(null);
  }

  if (!holding) return null;

  const amountDollars = amountCents / 100;
  const totalCostBasis =
    entryType === 'perShare' ? amountDollars * holding.quantity : amountDollars;

  function handleSave() {
    if (totalCostBasis < 0) return;
    updateInvestment.mutate(
      { id: holding!.id, body: { costBasis: parseFloat(totalCostBasis.toFixed(2)) } },
      { onSuccess: () => onClose() },
    );
  }

  const footer = (
    <>
      <button
        type="button"
        onClick={handleSave}
        disabled={updateInvestment.isPending}
        className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
      >
        Save
      </button>
      <button
        type="button"
        onClick={onClose}
        className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
      >
        Cancel
      </button>
    </>
  );

  return (
    <Modal
      open={!!holding}
      onClose={onClose}
      title="Edit Cost Basis"
      footer={footer}
      closeButton="none"
    >
      <p
        style={{
          marginBottom: vars.space['4'],
          fontSize: vars.font.sm,
          color: vars.color.textSecondary,
        }}
      >
        {holding.ticker || holding.name} – {holding.quantity}{' '}
        {holding.type === 'BITCOIN' ? 'BTC' : holding.quantity === 1 ? 'share' : 'shares'}
      </p>

      <div className={inputStyles.formStack}>
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-entry-type`} className={inputStyles.fieldLabel}>
            Entry Type
          </label>
          <ButtonGroup
            id={`${fid}-entry-type`}
            options={ENTRY_OPTIONS}
            value={entryType}
            onChange={(v) => {
              const newType = v as EntryType;
              if (newType === entryType) return;
              // Convert: if switching to perShare, divide by quantity; if switching to total, multiply
              if (amountCents > 0 && holding.quantity > 0) {
                const dollars = amountCents / 100;
                const converted =
                  newType === 'perShare' ? dollars / holding.quantity : dollars * holding.quantity;
                setAmountCents(Math.round(converted * 100));
              }
              setEntryType(newType);
            }}
            ariaLabel="Cost basis entry type"
          />
        </div>

        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-field1`} className={inputStyles.fieldLabel}>
            {entryType === 'perShare' ? 'Cost Per Share' : 'Total Cost Basis'}
          </label>
          <CurrencyInput
            id={`${fid}-field1`}
            value={amountCents}
            onChange={setAmountCents}
            placeholder="0.00"
          />
        </div>
      </div>
    </Modal>
  );
}
