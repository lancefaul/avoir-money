import { useEffect, useId, useRef } from 'react';
import type { UseFormRegister, UseFormWatch, UseFormSetValue, FieldErrors } from 'react-hook-form';
import type { FormValues } from './transactionFormSchema.js';
import type { NamedEntity, Account } from './types.js';
import {
  Select,
  type SelectOption,
  CurrencyInput,
  BitcoinInput,
  inputStyles,
} from '@budget-tracker/ui';

interface TradeFieldsProps {
  register: UseFormRegister<FormValues>;
  watch: UseFormWatch<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  errors: FieldErrors<FormValues>;
  watchAssetType: FormValues['assetType'];
  watchBitcoinUnit: FormValues['bitcoinUnit'];
  custodians: NamedEntity[];
  wallets: NamedEntity[];
  accounts: Account[];
  tradeError: string;
}

export default function TradeFields({
  register,
  watch,
  setValue,
  errors,
  watchAssetType,
  watchBitcoinUnit,
  custodians,
  wallets,
  accounts,
  tradeError,
}: TradeFieldsProps) {
  const fid = useId();
  const setValueRef = useRef(setValue);
  setValueRef.current = setValue;
  const custodianOptions: SelectOption[] = custodians.map((c) => ({ value: c.id, label: c.name }));
  const walletOptions: SelectOption[] = wallets.map((w) => ({ value: w.id, label: w.name }));
  const accountOptions: SelectOption[] = accounts.reduce<SelectOption[]>((acc, a) => {
    if (!a.archived) acc.push({ value: a.id, label: a.name });
    return acc;
  }, []);
  const direction = watch('tradeDirection') ?? 'BUY';

  const unitPriceStr = watch('unitPrice');
  const unitPriceCents = unitPriceStr ? Math.round(parseFloat(unitPriceStr) * 100) || 0 : 0;
  const tradeQtyStr = watch('tradeQuantity');
  const tradeQtyUnits = tradeQtyStr ? Math.round(parseFloat(tradeQtyStr) * 100000000) || 0 : 0;

  // Compute the trade total in cents for both asset types
  const tradeTotalCents = (() => {
    if (watchAssetType === 'Stock') {
      return Math.round((unitPriceCents / 100) * (tradeQtyUnits / 100000000) * 100);
    }
    // Bitcoin: quantity is stored in sats
    const qty = parseFloat(tradeQtyStr || '0');
    const price = unitPriceCents / 100;
    if (qty > 0 && price > 0) {
      const btcQty = qty / 100_000_000;
      return Math.round(btcQty * price * 100);
    }
    return 0;
  })();

  // Sync computed trade amount to the form's amount field so the button shows it
  useEffect(() => {
    const amountStr = tradeTotalCents > 0 ? (tradeTotalCents / 100).toFixed(2) : '';
    setValueRef.current('amount', amountStr);
  }, [tradeTotalCents]);

  return (
    <>
      {/* Direction + Asset Type on same row */}
      <div className={inputStyles.formGrid2}>
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-direction`} className={inputStyles.fieldLabel}>
            Direction
          </label>
          <Select
            id={`${fid}-direction`}
            options={[
              { value: 'BUY', label: 'Buy' },
              { value: 'SELL', label: 'Sell' },
            ]}
            value={watch('tradeDirection') ?? 'BUY'}
            onChange={(v) => setValue('tradeDirection', v as 'BUY' | 'SELL')}
            placeholder="Select direction…"
          />
        </div>
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-asset-type`} className={inputStyles.fieldLabel}>
            Asset Type
          </label>
          <Select
            id={`${fid}-asset-type`}
            options={[
              { value: 'Stock', label: 'Stock' },
              { value: 'Bitcoin', label: 'Bitcoin' },
            ]}
            value={watchAssetType ?? 'Stock'}
            onChange={(v) => setValue('assetType', v as 'Stock' | 'Bitcoin')}
            placeholder="Select asset type…"
          />
        </div>
      </div>

      {/* Stock-specific fields */}
      {watchAssetType === 'Stock' && (
        <>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-custodian`} className={inputStyles.fieldLabel}>
              Custodian
            </label>
            <Select
              id={`${fid}-custodian`}
              searchable
              options={custodianOptions}
              value={watch('custodianId') ?? ''}
              onChange={(v) => setValue('custodianId', v)}
              placeholder="Select custodian…"
              error={!!errors.custodianId}
            />
            {errors.custodianId?.message && (
              <span className={inputStyles.fieldError}>{errors.custodianId.message}</span>
            )}
          </div>

          <div className={inputStyles.formGrid3}>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-ticker`} className={inputStyles.fieldLabel}>
                Ticker
              </label>
              <div className={inputStyles.inputWrap}>
                <input
                  id={`${fid}-ticker`}
                  {...register('ticker')}
                  placeholder="e.g. AAPL"
                  className={`${inputStyles.input} ${errors.ticker ? inputStyles.inputError : ''}`}
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
              {errors.ticker?.message && (
                <span className={inputStyles.fieldError}>{errors.ticker.message}</span>
              )}
            </div>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-unit-price`} className={inputStyles.fieldLabel}>
                Unit Price
              </label>
              <CurrencyInput
                id={`${fid}-unit-price`}
                value={unitPriceCents}
                onChange={(cents) => setValue('unitPrice', (cents / 100).toFixed(2))}
                placeholder="0.00"
              />
              {errors.unitPrice?.message && (
                <span className={inputStyles.fieldError}>{errors.unitPrice.message}</span>
              )}
            </div>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-shares`} className={inputStyles.fieldLabel}>
                Shares
              </label>
              <CurrencyInput
                id={`${fid}-shares`}
                value={tradeQtyUnits}
                onChange={(units) => setValue('tradeQuantity', (units / 100000000).toFixed(8))}
                placeholder="0"
                prefix=""
                decimals={8}
              />
              {errors.tradeQuantity?.message && (
                <span className={inputStyles.fieldError}>{errors.tradeQuantity.message}</span>
              )}
            </div>
          </div>

          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-amount-calculated`} className={inputStyles.fieldLabel}>
              Amount (calculated)
            </label>
            <CurrencyInput
              id={`${fid}-amount-calculated`}
              value={tradeTotalCents}
              placeholder="0.00"
              readOnly
            />
          </div>
        </>
      )}

      {/* Bitcoin-specific fields */}
      {watchAssetType === 'Bitcoin' && (
        <>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-wallet`} className={inputStyles.fieldLabel}>
              Wallet
            </label>
            <Select
              id={`${fid}-wallet`}
              searchable
              options={walletOptions}
              value={watch('walletId') ?? ''}
              onChange={(v) => setValue('walletId', v)}
              placeholder="Select wallet…"
              error={!!errors.walletId}
            />
            {errors.walletId?.message && (
              <span className={inputStyles.fieldError}>{errors.walletId.message}</span>
            )}
          </div>

          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-unit-price-8`} className={inputStyles.fieldLabel}>
              Unit Price ($)
            </label>
            <CurrencyInput
              id={`${fid}-unit-price-8`}
              value={unitPriceCents}
              onChange={(cents) => setValue('unitPrice', (cents / 100).toFixed(2))}
              placeholder="0.00"
            />
            {errors.unitPrice?.message && (
              <span className={inputStyles.fieldError}>{errors.unitPrice.message}</span>
            )}
          </div>

          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-coins`} className={inputStyles.fieldLabel}>
              Coins
            </label>
            <BitcoinInput
              id={`${fid}-coins`}
              value={(() => {
                const tradeQtyStr = watch('tradeQuantity');
                const currentUnit = watchBitcoinUnit ?? 'Bitcoin';
                if (tradeQtyStr) {
                  const parsed = parseFloat(tradeQtyStr);
                  if (!isNaN(parsed)) {
                    return currentUnit === 'Sats'
                      ? Math.round(parsed)
                      : Math.round(parsed * 100_000_000);
                  }
                }
                return 0;
              })()}
              onChange={(sats) => {
                setValue('tradeQuantity', String(sats));
                setValue('bitcoinUnit', 'Sats');
              }}
            />
            {errors.tradeQuantity?.message && (
              <span className={inputStyles.fieldError}>{errors.tradeQuantity.message}</span>
            )}
          </div>

          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-amount-calculated-10`} className={inputStyles.fieldLabel}>
              Amount (calculated)
            </label>
            <CurrencyInput
              id={`${fid}-amount-calculated-10`}
              value={tradeTotalCents}
              placeholder="0.00"
              readOnly
            />
          </div>
        </>
      )}

      {/* Funding/Deposit Account */}
      <div className={inputStyles.field}>
        <label htmlFor={`${fid}-field11`} className={inputStyles.fieldLabel}>
          {direction === 'BUY' ? 'Funding Account' : 'Deposit Account'}
        </label>
        <Select
          id={`${fid}-field11`}
          searchable
          options={accountOptions}
          value={watch('accountId') ?? ''}
          onChange={(v) => setValue('accountId', v)}
          placeholder="Select account…"
          error={!!errors.accountId}
        />
        {errors.accountId?.message && (
          <span className={inputStyles.fieldError}>{errors.accountId.message}</span>
        )}
      </div>

      {tradeError && <span className={inputStyles.fieldError}>{tradeError}</span>}
    </>
  );
}
