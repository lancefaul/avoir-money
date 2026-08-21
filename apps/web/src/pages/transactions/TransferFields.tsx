import { useId } from 'react';
import { ArrowRight } from 'lucide-react';
import type { UseFormWatch, UseFormSetValue, FieldErrors } from 'react-hook-form';
import type { FormValues } from './transactionFormSchema.js';
import type { Account, NamedEntity, Category, StockHolding } from './types.js';
import { Select, type SelectOption, inputStyles } from '@budget-tracker/ui';
import * as dr from './transaction-form.css.js';
import BtcTransferFields from './BtcTransferFields.js';
import StockTransferFields from './StockTransferFields.js';

interface TransferFieldsProps {
  watch: UseFormWatch<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  errors: FieldErrors<FormValues>;
  accounts: Account[];
  wallets: NamedEntity[];
  custodians: NamedEntity[];
  categories: Category[];
  stockHoldings: StockHolding[];
  selectedStockHolding: StockHolding | undefined;
  watchTransferType: FormValues['transferType'];
  watchBtcTransferFeeUnit: FormValues['btcTransferFeeUnit'];
  isUsdTransfer: boolean;
  isBtcTransfer: boolean;
  isStockTransfer: boolean;
  tradeError: string;
}

export default function TransferFields({
  watch,
  setValue,
  errors,
  accounts,
  wallets,
  custodians,
  categories,
  stockHoldings,
  selectedStockHolding,
  watchTransferType,
  watchBtcTransferFeeUnit: _watchBtcTransferFeeUnit,
  isUsdTransfer,
  isBtcTransfer,
  isStockTransfer,
  tradeError,
}: TransferFieldsProps) {
  const fid = useId();

  const accountOptions: SelectOption[] = accounts.reduce<SelectOption[]>((acc, a) => {
    if (!a.archived) acc.push({ value: a.id, label: a.name });
    return acc;
  }, []);

  return (
    <>
      {isUsdTransfer && (
        <div className={dr.transferRow}>
          <div className={inputStyles.field} style={{ flex: 1 }}>
            <label htmlFor={`${fid}-from-account`} className={inputStyles.fieldLabel}>
              From Account
            </label>
            <Select
              id={`${fid}-from-account`}
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
          <div className={dr.transferArrow}>
            <ArrowRight size={16} />
          </div>
          <div className={inputStyles.field} style={{ flex: 1 }}>
            <label htmlFor={`${fid}-to-account`} className={inputStyles.fieldLabel}>
              To Account
            </label>
            <Select
              id={`${fid}-to-account`}
              searchable
              options={accountOptions}
              value={watch('toAccountId') ?? ''}
              onChange={(v) => setValue('toAccountId', v)}
              placeholder="Select account…"
              error={!!errors.toAccountId}
            />
            {errors.toAccountId?.message && (
              <span className={inputStyles.fieldError}>{errors.toAccountId.message}</span>
            )}
          </div>
        </div>
      )}

      {isBtcTransfer && (
        <BtcTransferFields watch={watch} setValue={setValue} errors={errors} wallets={wallets} />
      )}

      {isStockTransfer && (
        <StockTransferFields
          watch={watch}
          setValue={setValue}
          errors={errors}
          accounts={accounts}
          custodians={custodians}
          categories={categories}
          stockHoldings={stockHoldings}
          selectedStockHolding={selectedStockHolding}
        />
      )}

      {watchTransferType !== 'usd' && tradeError && (
        <span className={inputStyles.fieldError}>{tradeError}</span>
      )}
    </>
  );
}
