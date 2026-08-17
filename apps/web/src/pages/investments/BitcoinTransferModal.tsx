import { useState, useId } from 'react';
import {
  Modal,
  Select,
  Toggle,
  BitcoinInput,
  CurrencyInput,
  ButtonGroup,
  buttonStyles,
  inputStyles,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { useWallets, useBitcoinTransfer } from '../../hooks/useApi.js';

interface Holding {
  id: string;
  name: string;
  ticker: string | null;
  type: string;
  quantity: number;
  walletId: string | null;
  walletName: string | null;
}

interface BitcoinTransferModalProps {
  holding: Holding | null;
  onClose: () => void;
}

const SATS_PER_BTC = 100_000_000;

export default function BitcoinTransferModal({ holding, onClose }: BitcoinTransferModalProps) {
  const fid = useId();
  const { data: walletsData } = useWallets();
  const transfer = useBitcoinTransfer();

  const wallets = (walletsData ?? []) as { id: string; name: string }[];

  const [prevHolding, setPrevHolding] = useState<Holding | null>(holding);
  const [toWalletId, setToWalletId] = useState('');
  const [coinsSats, setCoinsSats] = useState(0);
  const [hasFee, setHasFee] = useState(false);
  const [feeMethod, setFeeMethod] = useState<'USD' | 'BTC'>('USD');
  const [feeAmountCents, setFeeAmountCents] = useState(0);
  const [feeSats, setFeeSats] = useState(0);
  const [error, setError] = useState('');

  const open = holding !== null;

  // Reset state when holding changes (inline state adjustment — no useEffect)
  if (holding && holding !== prevHolding) {
    setPrevHolding(holding);
    setToWalletId('');
    setCoinsSats(0);
    setHasFee(false);
    setFeeMethod('USD');
    setFeeAmountCents(0);
    setFeeSats(0);
    setError('');
  } else if (!holding && prevHolding) {
    setPrevHolding(null);
  }

  if (!holding) return null;

  const destinationWallets = wallets.reduce<{ value: string; label: string }[]>((acc, w) => {
    if (w.id !== holding.walletId) acc.push({ value: w.id, label: w.name });
    return acc;
  }, []);

  function handleSubmit() {
    setError('');

    if (!toWalletId) {
      setError('Destination wallet is required');
      return;
    }
    if (coinsSats <= 0) {
      setError('Quantity must be greater than zero');
      return;
    }

    const holdingSats = Math.round(holding!.quantity * SATS_PER_BTC);
    if (coinsSats > holdingSats) {
      setError('Quantity exceeds available balance');
      return;
    }

    if (hasFee) {
      if (feeMethod === 'USD' && feeAmountCents <= 0) {
        setError('Fee amount is required');
        return;
      }
      if (feeMethod === 'BTC' && feeSats <= 0) {
        setError('Fee amount is required');
        return;
      }
    }

    const quantityBtc = coinsSats / SATS_PER_BTC;

    const payload: Record<string, unknown> = {
      fromWalletId: holding!.walletId,
      toWalletId,
      quantity: quantityBtc,
      bitcoinUnit: 'Bitcoin',
    };

    if (hasFee) {
      if (feeMethod === 'USD') {
        payload.feeAmount = feeAmountCents / 100;
        payload.feeUnit = 'USD';
      } else {
        payload.feeAmount = feeSats / SATS_PER_BTC;
        payload.feeUnit = 'Bitcoin';
      }
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
      title="Transfer Bitcoin (BTC)"
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

        {/* From Wallet (read-only) */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-from-wallet`} className={inputStyles.fieldLabel}>
            From Wallet
          </label>
          <input
            id={`${fid}-from-wallet`}
            className={inputStyles.input}
            type="text"
            value={holding.walletName ?? '–'}
            readOnly
            disabled
          />
        </div>

        {/* To Wallet */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-to-wallet`} className={inputStyles.fieldLabel}>
            To Wallet
          </label>
          <Select
            id={`${fid}-to-wallet`}
            options={destinationWallets}
            value={toWalletId}
            onChange={setToWalletId}
            placeholder="Select destination…"
          />
        </div>

        {/* Coins */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-coins`} className={inputStyles.fieldLabel}>
            Coins
          </label>
          <BitcoinInput
            id={`${fid}-coins`}
            value={coinsSats}
            onChange={(sats) => {
              const maxSats = Math.round(holding!.quantity * SATS_PER_BTC);
              setCoinsSats(Math.min(sats, maxSats));
            }}
          />
        </div>

        {/* Fee toggle */}
        <Toggle checked={hasFee} onChange={setHasFee} label="Fees paid?" />

        {hasFee && (
          <>
            {/* Payment Method */}
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-payment-method`} className={inputStyles.fieldLabel}>
                Payment Method
              </label>
              <ButtonGroup
                id={`${fid}-payment-method`}
                options={[
                  { value: 'USD', label: 'U.S. Dollar' },
                  { value: 'BTC', label: 'Bitcoin' },
                ]}
                value={feeMethod}
                onChange={(v) => setFeeMethod(v as 'USD' | 'BTC')}
                ariaLabel="Fee payment method"
              />
            </div>

            {/* Fee Amount */}
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-fee-amount`} className={inputStyles.fieldLabel}>
                Fee Amount
              </label>
              {feeMethod === 'USD' ? (
                <CurrencyInput
                  id={`${fid}-fee-amount`}
                  value={feeAmountCents}
                  onChange={setFeeAmountCents}
                  prefix="$"
                />
              ) : (
                <BitcoinInput value={feeSats} onChange={setFeeSats} />
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
