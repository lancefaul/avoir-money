import { useId } from 'react';
import type { UseFormWatch, UseFormSetValue, FieldErrors } from 'react-hook-form';
import type { FormValues } from './transactionFormSchema.js';
import type { NamedEntity } from './types.js';
import {
  Select,
  type SelectOption,
  CurrencyInput,
  ButtonGroup,
  BitcoinInput,
  inputStyles,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

interface BitcoinPaymentFieldsProps {
  watch: UseFormWatch<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  errors: FieldErrors<FormValues>;
  wallets: NamedEntity[];
  watchBtcUnit: FormValues['btcUnit'];
  watchBtcEntryMode: FormValues['btcEntryMode'];
  watchBtcUnitPrice: string | undefined;
  btcUsdEquivalent: number | null;
  txType: FormValues['type'];
}

/** Read-only style applied over CurrencyInput to indicate a calculated value. */
const readOnlyWrapStyle: React.CSSProperties = {
  pointerEvents: 'none',
  opacity: 0.7,
};

export default function BitcoinPaymentFields({
  watch,
  setValue,
  errors,
  wallets,
  watchBtcUnit,
  watchBtcEntryMode,
  watchBtcUnitPrice,
  btcUsdEquivalent,
  txType,
}: BitcoinPaymentFieldsProps) {
  const fid = useId();
  const walletOptions: SelectOption[] = wallets.map((w) => ({ value: w.id, label: w.name }));
  const btcUsdAmountStr = watch('btcUsdAmount');
  const btcUsdCents = btcUsdAmountStr ? Math.round(parseFloat(btcUsdAmountStr) * 100) || 0 : 0;
  const btcUnitPriceCents = watchBtcUnitPrice
    ? Math.round(parseFloat(watchBtcUnitPrice) * 100) || 0
    : 0;

  // Calculated values in cents for read-only CurrencyInput fields
  const btcUsdEquivalentCents = btcUsdEquivalent !== null ? Math.round(btcUsdEquivalent * 100) : 0;

  return (
    <div className={inputStyles.formStack} style={{ gap: vars.space['3'] }}>
      {/* Entry Mode + Income Type (side by side for INCOME, full-width otherwise) */}
      {txType === 'INCOME' ? (
        <div className={inputStyles.formGrid2}>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-entry-mode`} className={inputStyles.fieldLabel}>
              Entry Mode
            </label>
            <ButtonGroup
              id={`${fid}-entry-mode`}
              options={[
                { value: 'unitPrice', label: 'Unit Price' },
                { value: 'usdEquivalent', label: 'U.S. Dollar' },
              ]}
              value={watchBtcEntryMode ?? 'unitPrice'}
              onChange={(v) => setValue('btcEntryMode', v as 'unitPrice' | 'usdEquivalent')}
              ariaLabel="Entry mode"
            />
          </div>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-income-type`} className={inputStyles.fieldLabel}>
              Income Type
            </label>
            <ButtonGroup
              id={`${fid}-income-type`}
              options={[
                { value: 'Payment', label: 'Payment' },
                { value: 'Rewards', label: 'Rewards' },
              ]}
              value={watch('btcIncomeType') ?? 'Payment'}
              onChange={(v) => setValue('btcIncomeType', v as 'Payment' | 'Rewards')}
              ariaLabel="Bitcoin income type"
            />
          </div>
        </div>
      ) : (
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-entry-mode-2`} className={inputStyles.fieldLabel}>
            Entry Mode
          </label>
          <ButtonGroup
            id={`${fid}-entry-mode-2`}
            options={[
              { value: 'unitPrice', label: 'Unit Price' },
              { value: 'usdEquivalent', label: 'U.S. Dollar' },
            ]}
            value={watchBtcEntryMode ?? 'unitPrice'}
            onChange={(v) => setValue('btcEntryMode', v as 'unitPrice' | 'usdEquivalent')}
            ariaLabel="Entry mode"
          />
        </div>
      )}

      {/* Wallet */}
      <div className={inputStyles.field}>
        <label htmlFor={`${fid}-wallet`} className={inputStyles.fieldLabel}>
          Wallet
        </label>
        <Select
          id={`${fid}-wallet`}
          searchable
          options={walletOptions}
          value={watch('btcWalletId') ?? ''}
          onChange={(v) => setValue('btcWalletId', v)}
          placeholder="Select wallet…"
          error={!!errors.btcWalletId}
        />
        {errors.btcWalletId?.message && (
          <span className={inputStyles.fieldError}>{errors.btcWalletId.message}</span>
        )}
      </div>

      {/* Coins */}
      <div className={inputStyles.field}>
        <label htmlFor={`${fid}-coins`} className={inputStyles.fieldLabel}>
          Coins
        </label>
        <BitcoinInput
          id={`${fid}-coins`}
          value={(() => {
            const btcQtyStr = watch('btcQuantity');
            const currentUnit = watchBtcUnit ?? 'Bitcoin';
            if (btcQtyStr) {
              const parsed = parseFloat(btcQtyStr);
              if (!isNaN(parsed)) {
                return currentUnit === 'Sats'
                  ? Math.round(parsed)
                  : Math.round(parsed * 100_000_000);
              }
            }
            return 0;
          })()}
          onChange={(sats) => {
            setValue('btcQuantity', String(sats));
            setValue('btcUnit', 'Sats');
          }}
        />
        {errors.btcQuantity?.message && (
          <span className={inputStyles.fieldError}>{errors.btcQuantity.message}</span>
        )}
      </div>

      {/* Price / Amount fields — vary by entry mode */}
      {watchBtcEntryMode === 'unitPrice' ? (
        <>
          {/* Unit Price — editable */}
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-unit-price`} className={inputStyles.fieldLabel}>
              Unit Price
            </label>
            <CurrencyInput
              id={`${fid}-unit-price`}
              value={btcUnitPriceCents}
              onChange={(cents) => setValue('btcUnitPrice', (cents / 100).toFixed(2))}
              placeholder="0.00"
            />
            {errors.btcUnitPrice?.message && (
              <span className={inputStyles.fieldError}>{errors.btcUnitPrice.message}</span>
            )}
          </div>

          {/* Amount — calculated, read-only */}
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-amount`} className={inputStyles.fieldLabel}>
              Amount
            </label>
            <div style={readOnlyWrapStyle} aria-disabled="true">
              <CurrencyInput
                id={`${fid}-amount`}
                value={btcUsdEquivalentCents}
                placeholder="0.00"
              />
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Amount — editable */}
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-amount-7`} className={inputStyles.fieldLabel}>
              Amount
            </label>
            <CurrencyInput
              id={`${fid}-amount-7`}
              value={btcUsdCents}
              onChange={(cents) => setValue('btcUsdAmount', (cents / 100).toFixed(2))}
              placeholder="0.00"
            />
            {errors.btcUsdAmount?.message && (
              <span className={inputStyles.fieldError}>{errors.btcUsdAmount.message}</span>
            )}
          </div>

          {/* Unit Price — calculated, read-only */}
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-unit-price-8`} className={inputStyles.fieldLabel}>
              Unit Price
            </label>
            <div style={readOnlyWrapStyle} aria-disabled="true">
              <CurrencyInput
                id={`${fid}-unit-price-8`}
                value={btcUnitPriceCents}
                placeholder="0.00"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
