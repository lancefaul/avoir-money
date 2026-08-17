import { useState, useId } from 'react';
import {
  Modal,
  Select,
  Toggle,
  CurrencyInput,
  DecimalInput,
  buttonStyles,
  inputStyles,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import {
  useCustodians,
  useAccounts,
  useBudgetItems,
  useStockTransfer,
} from '../../hooks/useApi.js';

interface Holding {
  id: string;
  name: string;
  ticker: string | null;
  type: string;
  quantity: number;
  custodianId: string | null;
  custodianName: string | null;
}

interface StockTransferModalProps {
  holding: Holding | null;
  onClose: () => void;
}

export default function StockTransferModal({ holding, onClose }: StockTransferModalProps) {
  const fid = useId();
  const { data: custodiansData } = useCustodians();
  const { data: accountsData } = useAccounts();
  const { data: categoriesData } = useBudgetItems();
  const transfer = useStockTransfer();

  const custodians = (custodiansData ?? []) as { id: string; name: string }[];
  const accounts = (accountsData ?? []) as { id: string; name: string }[];
  const categories = (categoriesData ?? []) as { id: string; name: string; icon: string | null }[];

  const [prevHolding, setPrevHolding] = useState<Holding | null>(holding);
  const [toCustodianId, setToCustodianId] = useState('');
  const [quantityNum, setQuantityNum] = useState(0);
  const [hasFee, setHasFee] = useState(false);
  const [feeAmountCents, setFeeAmountCents] = useState(0);
  const [feeAccountId, setFeeAccountId] = useState('');
  const [feeBudgetId, setFeeCategoryId] = useState('');
  const [error, setError] = useState('');

  const open = holding !== null;

  // Reset state when holding changes (inline state adjustment — no useEffect)
  if (holding && holding !== prevHolding) {
    setPrevHolding(holding);
    setToCustodianId('');
    setQuantityNum(0);
    setHasFee(false);
    setFeeAmountCents(0);
    setFeeAccountId('');
    setFeeCategoryId('');
    setError('');
  } else if (!holding && prevHolding) {
    setPrevHolding(null);
  }

  if (!holding) return null;

  const destinationCustodians = custodians.reduce<{ value: string; label: string }[]>((acc, c) => {
    if (c.id !== holding.custodianId) acc.push({ value: c.id, label: c.name });
    return acc;
  }, []);

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));
  const categoryOptions = categories.map((c) => ({
    value: c.id,
    label: c.icon ? `${c.icon} ${c.name}` : c.name,
  }));

  function handleTransferAll() {
    setQuantityNum(holding!.quantity);
  }

  function handleSubmit() {
    setError('');

    if (!toCustodianId) {
      setError('Destination custodian is required');
      return;
    }

    const qty = quantityNum;
    if (qty <= 0) {
      setError('Quantity must be a positive number');
      return;
    }
    if (qty > holding!.quantity) {
      setError(`Quantity exceeds available shares (${holding!.quantity})`);
      return;
    }

    if (hasFee) {
      if (feeAmountCents <= 0) {
        setError('Fee amount is required');
        return;
      }
      if (!feeAccountId) {
        setError('Payment account is required');
        return;
      }
      if (!feeBudgetId) {
        setError('Budget is required');
        return;
      }
    }

    const payload: Record<string, unknown> = {
      fromCustodianId: holding!.custodianId,
      toCustodianId,
      holdingId: holding!.id,
      quantity: qty,
    };

    if (hasFee && feeAmountCents > 0) {
      payload.feeAmount = feeAmountCents / 100;
      payload.feeAccountId = feeAccountId;
      payload.feeBudgetId = feeBudgetId;
    }

    transfer.mutate(payload, {
      onSuccess: () => onClose(),
      onError: (err) => setError(err.message || 'Transfer failed'),
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Transfer Stock (${holding.ticker ?? holding.name})`}
      closeButton="none"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: vars.space['2'] }}>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={transfer.isPending}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            {transfer.isPending ? 'Transferring…' : 'Transfer'}
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
      <div className={inputStyles.formStack}>
        {error && (
          <p
            style={{
              color: vars.color.danger400,
              fontSize: vars.font.sm,
            }}
          >
            {error}
          </p>
        )}

        {/* From Custodian (read-only) */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-from-custodian`} className={inputStyles.fieldLabel}>
            From Custodian
          </label>
          <input
            id={`${fid}-from-custodian`}
            className={inputStyles.input}
            type="text"
            value={holding.custodianName ?? '–'}
            readOnly
            disabled
          />
        </div>

        {/* To Custodian */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-to-custodian`} className={inputStyles.fieldLabel}>
            To Custodian
          </label>
          <Select
            id={`${fid}-to-custodian`}
            options={destinationCustodians}
            value={toCustodianId}
            onChange={setToCustodianId}
            placeholder="Select destination…"
          />
        </div>

        {/* Quantity */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-quantity`} className={inputStyles.fieldLabel}>
            Quantity
          </label>
          <DecimalInput
            id={`${fid}-quantity`}
            value={quantityNum}
            onChange={setQuantityNum}
            precision={5}
            min={0}
            max={holding.quantity}
            placeholder={`Up to ${holding.quantity}`}
          />
          <button
            type="button"
            onClick={handleTransferAll}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnSecondary}`}
            style={{ alignSelf: 'flex-start' }}
          >
            Transfer all
          </button>
        </div>

        {/* Fee toggle */}
        <Toggle checked={hasFee} onChange={setHasFee} label="Fees paid?" />

        {hasFee && (
          <>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-fee-amount`} className={inputStyles.fieldLabel}>
                Fee Amount
              </label>
              <CurrencyInput
                id={`${fid}-fee-amount`}
                value={feeAmountCents}
                onChange={setFeeAmountCents}
                prefix="$"
              />
            </div>

            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-payment-account`} className={inputStyles.fieldLabel}>
                Payment Account
              </label>
              <Select
                id={`${fid}-payment-account`}
                options={accountOptions}
                value={feeAccountId}
                onChange={setFeeAccountId}
                placeholder="Select account…"
                searchable
              />
            </div>

            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-budget`} className={inputStyles.fieldLabel}>
                Budget
              </label>
              <Select
                id={`${fid}-budget`}
                options={categoryOptions}
                value={feeBudgetId}
                onChange={setFeeCategoryId}
                placeholder="Select budget…"
                searchable
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
