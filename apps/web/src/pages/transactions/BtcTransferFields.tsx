import { useState, useId } from 'react';
import { ArrowRight } from 'lucide-react';
import type { UseFormWatch, UseFormSetValue, FieldErrors } from 'react-hook-form';
import type { FormValues } from './transactionFormSchema.js';
import type { NamedEntity } from './types.js';
import {
  Select,
  type SelectOption,
  ButtonGroup,
  BitcoinInput,
  Toggle,
  CurrencyInput,
  inputStyles,
} from '@budget-tracker/ui';
import * as dr from './transaction-form.css.js';

interface BtcTransferFieldsProps {
  watch: UseFormWatch<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  errors: FieldErrors<FormValues>;
  wallets: NamedEntity[];
}

export default function BtcTransferFields({
  watch,
  setValue,
  errors,
  wallets,
}: BtcTransferFieldsProps) {
  const fid = useId();
  const [feesPaid, setFeesPaid] = useState(() => parseFloat(watch('btcTransferFee') || '0') > 0);
  const [feeType, setFeeType] = useState<'USD' | 'BTC'>(() => {
    const unit = watch('btcTransferFeeUnit');
    return unit && unit !== 'USD' ? 'BTC' : 'USD';
  });

  const walletOptions: SelectOption[] = wallets.map((w) => ({ value: w.id, label: w.name }));

  return (
    <>
      <div className={dr.transferRow}>
        <div className={inputStyles.field} style={{ flex: 1 }}>
          <label htmlFor={`${fid}-from-wallet`} className={inputStyles.fieldLabel}>
            From Wallet
          </label>
          <Select
            id={`${fid}-from-wallet`}
            searchable
            options={walletOptions}
            value={watch('btcFromWalletId') ?? ''}
            onChange={(v) => setValue('btcFromWalletId', v)}
            placeholder="Select wallet…"
            error={!!errors.btcFromWalletId}
          />
          {errors.btcFromWalletId?.message && (
            <span className={inputStyles.fieldError}>{errors.btcFromWalletId.message}</span>
          )}
        </div>
        <div className={dr.transferArrow}>
          <ArrowRight size={16} />
        </div>
        <div className={inputStyles.field} style={{ flex: 1 }}>
          <label htmlFor={`${fid}-to-wallet`} className={inputStyles.fieldLabel}>
            To Wallet
          </label>
          <Select
            id={`${fid}-to-wallet`}
            searchable
            options={walletOptions}
            value={watch('btcToWalletId') ?? ''}
            onChange={(v) => setValue('btcToWalletId', v)}
            placeholder="Select wallet…"
            error={!!errors.btcToWalletId}
          />
          {errors.btcToWalletId?.message && (
            <span className={inputStyles.fieldError}>{errors.btcToWalletId.message}</span>
          )}
        </div>
      </div>

      <div className={inputStyles.field}>
        <label htmlFor={`${fid}-coins`} className={inputStyles.fieldLabel}>
          Coins
        </label>
        <BitcoinInput
          id={`${fid}-coins`}
          value={(() => {
            const btcTransferQtyStr = watch('btcTransferQuantity');
            const currentUnit = watch('btcTransferUnit') ?? 'Bitcoin';
            if (btcTransferQtyStr) {
              const parsed = parseFloat(btcTransferQtyStr);
              if (!isNaN(parsed)) {
                return currentUnit === 'Sats'
                  ? Math.round(parsed)
                  : Math.round(parsed * 100_000_000);
              }
            }
            return 0;
          })()}
          onChange={(sats) => {
            setValue('btcTransferQuantity', String(sats));
            setValue('btcTransferUnit', 'Sats');
          }}
        />
        {errors.btcTransferQuantity?.message && (
          <span className={inputStyles.fieldError}>{errors.btcTransferQuantity.message}</span>
        )}
      </div>

      <Toggle
        label="Fees Paid"
        checked={feesPaid}
        onChange={(checked) => {
          setFeesPaid(checked);
          if (!checked) {
            setValue('btcTransferFee', '');
            setValue('btcTransferFeeUnit', undefined);
            setValue('btcTransferPrice', '');
          }
        }}
      />

      {feesPaid && (
        <>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-fee-type`} className={inputStyles.fieldLabel}>
              Fee Type
            </label>
            <ButtonGroup
              id={`${fid}-fee-type`}
              options={[
                { value: 'USD', label: 'U.S. Dollar' },
                { value: 'BTC', label: 'Bitcoin' },
              ]}
              value={feeType}
              onChange={(v) => {
                const next = v as 'USD' | 'BTC';
                setFeeType(next);
                if (next === 'USD') {
                  setValue('btcTransferFeeUnit', 'USD');
                  setValue('btcTransferPrice', '');
                } else {
                  setValue('btcTransferFeeUnit', 'Sats');
                  setValue('btcTransferPrice', '1');
                }
              }}
              ariaLabel="Fee type"
            />
          </div>

          {feeType === 'USD' && (
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-fee-amount`} className={inputStyles.fieldLabel}>
                Fee Amount
              </label>
              <CurrencyInput
                id={`${fid}-fee-amount`}
                value={(() => {
                  const feeStr = watch('btcTransferFee');
                  if (feeStr) {
                    const parsed = parseFloat(feeStr);
                    if (!isNaN(parsed)) return Math.round(parsed * 100);
                  }
                  return 0;
                })()}
                onChange={(cents) => {
                  setValue('btcTransferFee', (cents / 100).toFixed(2));
                  setValue('btcTransferFeeUnit', 'USD');
                }}
              />
              {errors.btcTransferFee?.message && (
                <span className={inputStyles.fieldError}>{errors.btcTransferFee.message}</span>
              )}
            </div>
          )}

          {feeType === 'BTC' && (
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-fee-amount-7`} className={inputStyles.fieldLabel}>
                Fee Amount
              </label>
              <BitcoinInput
                id={`${fid}-fee-amount-7`}
                value={(() => {
                  const feeStr = watch('btcTransferFee');
                  if (feeStr) {
                    const parsed = parseFloat(feeStr);
                    if (!isNaN(parsed)) return Math.round(parsed);
                  }
                  return 0;
                })()}
                onChange={(sats) => {
                  setValue('btcTransferFee', String(sats));
                  setValue('btcTransferFeeUnit', 'Sats');
                  setValue('btcTransferPrice', '1');
                }}
              />
              {errors.btcTransferFee?.message && (
                <span className={inputStyles.fieldError}>{errors.btcTransferFee.message}</span>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
