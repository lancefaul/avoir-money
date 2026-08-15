import { useState, useId } from 'react';
import { ArrowRight } from 'lucide-react';
import type { UseFormWatch, UseFormSetValue, FieldErrors } from 'react-hook-form';
import type { FormValues } from './transactionFormSchema.js';
import type { Account, NamedEntity, Category, StockHolding } from './types.js';
import { Select, type SelectOption, Toggle, CurrencyInput, inputStyles } from '@budget-tracker/ui';
import * as dr from './transaction-form.css.js';

interface StockTransferFieldsProps {
  watch: UseFormWatch<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  errors: FieldErrors<FormValues>;
  accounts: Account[];
  custodians: NamedEntity[];
  categories: Category[];
  stockHoldings: StockHolding[];
  selectedStockHolding: StockHolding | undefined;
}

export default function StockTransferFields({
  watch,
  setValue,
  errors,
  accounts,
  custodians,
  categories,
  stockHoldings,
  selectedStockHolding,
}: StockTransferFieldsProps) {
  const fid = useId();
  const [stockFeesPaid, setStockFeesPaid] = useState(
    () => parseFloat(watch('stockFeeAmount') || '0') > 0,
  );

  // Stock transfer: deduplicated asset list + smart custodian resolution
  const [selectedAssetKey, setSelectedAssetKey] = useState<string>(() => {
    const holdingId = watch('stockHoldingId');
    if (holdingId) {
      const h = stockHoldings.find((sh) => sh.id === holdingId);
      if (h) return `${h.name}||${h.ticker ?? ''}`;
    }
    return '';
  });

  // Build deduplicated asset options (unique by name+ticker)
  const assetMap = new Map<string, { name: string; ticker: string | null }>();
  for (const h of stockHoldings) {
    const key = `${h.name}||${h.ticker ?? ''}`;
    if (!assetMap.has(key)) assetMap.set(key, { name: h.name, ticker: h.ticker });
  }
  const assetOptions: SelectOption[] = Array.from(assetMap.entries()).map(([key, a]) => ({
    value: key,
    label: a.ticker ? `${a.name} (${a.ticker})` : a.name,
  }));

  // Holdings matching the selected asset
  const matchingHoldings = selectedAssetKey
    ? stockHoldings.filter((h) => `${h.name}||${h.ticker ?? ''}` === selectedAssetKey)
    : [];
  const hasMultipleCustodians = matchingHoldings.length > 1;
  const singleHolding = matchingHoldings.length === 1 ? matchingHoldings[0]! : null;

  // From custodian options (only custodians that hold this asset)
  const fromCustodianOptions: SelectOption[] = matchingHoldings.reduce<SelectOption[]>((acc, h) => {
    if (h.custodianId && h.custodianName)
      acc.push({ value: h.custodianId, label: h.custodianName });
    return acc;
  }, []);

  const selectedStockFromCustodian = selectedStockHolding?.custodianId ?? null;
  const accountOptions: SelectOption[] = accounts.reduce<SelectOption[]>((acc, a) => {
    if (!a.archived) acc.push({ value: a.id, label: a.name });
    return acc;
  }, []);
  const custodianOptions: SelectOption[] = custodians.reduce<SelectOption[]>((acc, c) => {
    if (c.id !== selectedStockFromCustodian) acc.push({ value: c.id, label: c.name });
    return acc;
  }, []);
  const categoryOptions: SelectOption[] = categories.map((c) => ({
    value: c.id,
    label: `${c.icon ?? ''} ${c.name}`.trim(),
  }));

  return (
    <>
      <div className={inputStyles.field}>
        <label htmlFor={`${fid}-asset`} className={inputStyles.fieldLabel}>
          Asset
        </label>
        <Select
          id={`${fid}-asset`}
          searchable
          options={assetOptions}
          value={selectedAssetKey}
          onChange={(v) => {
            setSelectedAssetKey(v);
            const holdings = stockHoldings.filter((h) => `${h.name}||${h.ticker ?? ''}` === v);
            if (holdings.length === 1) {
              setValue('stockHoldingId', holdings[0]!.id);
            } else {
              setValue('stockHoldingId', '');
            }
          }}
          placeholder="Select asset…"
          error={!!errors.stockHoldingId}
        />
        {errors.stockHoldingId?.message && (
          <span className={inputStyles.fieldError}>{errors.stockHoldingId.message}</span>
        )}
      </div>

      {selectedAssetKey && (
        <div className={dr.transferRow}>
          <div className={inputStyles.field} style={{ flex: 1 }}>
            <label htmlFor={`${fid}-from-custodian`} className={inputStyles.fieldLabel}>
              From Custodian
            </label>
            {hasMultipleCustodians ? (
              <Select
                id={`${fid}-from-custodian`}
                searchable
                options={fromCustodianOptions}
                value={selectedStockFromCustodian ?? ''}
                onChange={(v) => {
                  const holding = matchingHoldings.find((h) => h.custodianId === v);
                  if (holding) setValue('stockHoldingId', holding.id);
                }}
                placeholder="Select custodian…"
              />
            ) : (
              <Select
                options={fromCustodianOptions}
                value={singleHolding?.custodianId ?? ''}
                placeholder="–"
                disabled
              />
            )}
          </div>
          <div className={dr.transferArrow}>
            <ArrowRight size={16} />
          </div>
          <div className={inputStyles.field} style={{ flex: 1 }}>
            <label htmlFor={`${fid}-to-custodian`} className={inputStyles.fieldLabel}>
              To Custodian
            </label>
            <Select
              id={`${fid}-to-custodian`}
              searchable
              options={custodianOptions}
              value={watch('stockToCustodianId') ?? ''}
              onChange={(v) => setValue('stockToCustodianId', v)}
              placeholder="Select custodian…"
              error={!!errors.stockToCustodianId}
            />
            {errors.stockToCustodianId?.message && (
              <span className={inputStyles.fieldError}>{errors.stockToCustodianId.message}</span>
            )}
          </div>
        </div>
      )}

      <Toggle
        label="Fees Paid"
        checked={stockFeesPaid}
        onChange={(checked) => {
          setStockFeesPaid(checked);
          if (!checked) {
            setValue('stockFeeAmount', '');
            setValue('stockFeeAccountId', '');
            setValue('stockFeeBudgetId', '');
          }
        }}
      />

      {stockFeesPaid && (
        <>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-fee-amount-11`} className={inputStyles.fieldLabel}>
              Fee Amount
            </label>
            <CurrencyInput
              id={`${fid}-fee-amount-11`}
              value={(() => {
                const feeStr = watch('stockFeeAmount');
                if (feeStr) {
                  const parsed = parseFloat(feeStr);
                  if (!isNaN(parsed)) return Math.round(parsed * 100);
                }
                return 0;
              })()}
              onChange={(cents) => setValue('stockFeeAmount', (cents / 100).toFixed(2))}
            />
          </div>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-fee-account`} className={inputStyles.fieldLabel}>
              Fee Account
            </label>
            <Select
              id={`${fid}-fee-account`}
              searchable
              options={accountOptions}
              value={watch('stockFeeAccountId') ?? ''}
              onChange={(v) => setValue('stockFeeAccountId', v)}
              placeholder="Select account…"
              error={!!errors.stockFeeAccountId}
            />
            {errors.stockFeeAccountId?.message && (
              <span className={inputStyles.fieldError}>{errors.stockFeeAccountId.message}</span>
            )}
          </div>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-fee-budget`} className={inputStyles.fieldLabel}>
              Fee Budget
            </label>
            <Select
              id={`${fid}-fee-budget`}
              searchable
              options={categoryOptions}
              value={watch('stockFeeBudgetId') ?? ''}
              onChange={(v) => setValue('stockFeeBudgetId', v)}
              placeholder="Select budget…"
              error={!!errors.stockFeeBudgetId}
            />
            {errors.stockFeeBudgetId?.message && (
              <span className={inputStyles.fieldError}>{errors.stockFeeBudgetId.message}</span>
            )}
          </div>
        </>
      )}
    </>
  );
}
