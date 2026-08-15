import { useId } from 'react';
import { Info } from 'lucide-react';
import type { UseFormWatch, UseFormSetValue, FieldErrors } from 'react-hook-form';
import {
  ButtonGroup,
  Select,
  type SelectOption,
  SectionHeading,
  inputStyles,
} from '@budget-tracker/ui';
import type { FormValues } from './transactionFormSchema.js';
import type { Account } from './types.js';
import { formatCurrency } from '../../lib/utils.js';
import * as dr from './transaction-form.css.js';

const PAYMENT_OPTIONS = [
  { value: 'account', label: 'U.S. Dollars' },
  { value: 'bitcoin', label: 'Bitcoin' },
];

interface PaymentMethodFieldsProps {
  watch: UseFormWatch<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  errors: FieldErrors<FormValues>;
  txType: string;
  editing: { expenseId?: string | null } | null;
  showPaymentToggle: boolean;
  watchPaymentMethod: FormValues['paymentMethod'];
  watchTransferType: FormValues['transferType'];
  isBitcoinPayment: boolean;
  isBtcTransfer: boolean;
  isStockTransfer: boolean;
  accountOptions: SelectOption[];
  selectedAccount: Account | undefined;
}

export default function PaymentMethodFields({
  watch,
  setValue,
  errors,
  txType,
  editing,
  showPaymentToggle,
  watchPaymentMethod,
  watchTransferType,
  isBitcoinPayment,
  isBtcTransfer,
  isStockTransfer,
  accountOptions,
  selectedAccount,
}: PaymentMethodFieldsProps) {
  const fid = useId();

  return (
    <>
      {/* Section heading */}
      {(txType === 'EXPENSE' || txType === 'REFUND' || txType === 'INCOME') && (
        <SectionHeading>Payment Information</SectionHeading>
      )}
      {txType === 'TRANSFER' && <SectionHeading>Transfer Information</SectionHeading>}
      {txType === 'TRADE' && <SectionHeading>Trade Information</SectionHeading>}

      {/* Payment Method — EXPENSE, INCOME, REFUND */}
      {showPaymentToggle && (
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-payment`} className={inputStyles.fieldLabel}>
            Currency
          </label>
          <ButtonGroup
            id={`${fid}-payment`}
            options={PAYMENT_OPTIONS}
            value={watchPaymentMethod ?? 'account'}
            onChange={(v) => setValue('paymentMethod', v as FormValues['paymentMethod'])}
            ariaLabel="Payment method"
          />
        </div>
      )}

      {/* Transfer Type — for TRANSFER type */}
      {txType === 'TRANSFER' && !editing && (
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-transfer-type`} className={inputStyles.fieldLabel}>
            Transfer Type
          </label>
          <ButtonGroup
            id={`${fid}-transfer-type`}
            options={[
              { value: 'usd', label: 'U.S. Dollar' },
              { value: 'bitcoin', label: 'Bitcoin' },
              { value: 'stock', label: 'Stock' },
            ]}
            value={watchTransferType ?? 'usd'}
            onChange={(v) => setValue('transferType', v as FormValues['transferType'])}
            ariaLabel="Transfer type"
          />
        </div>
      )}

      {/* Account — INCOME / REFUND only. EXPENSE's account lives in the funding
          list (FundingFields), which supports splitting across accounts. */}
      {!isBitcoinPayment &&
        !isBtcTransfer &&
        !isStockTransfer &&
        txType !== 'TRANSFER' &&
        txType !== 'TRADE' &&
        txType !== 'EXPENSE' && (
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-account`} className={inputStyles.fieldLabel}>
              Account <span className={inputStyles.fieldRequired}>*</span>
            </label>
            <Select
              id={`${fid}-account`}
              searchable
              options={accountOptions}
              value={watch('accountId') ?? ''}
              onChange={(v) => setValue('accountId', v)}
              placeholder="Select account…"
              error={!!errors.accountId}
            />
            {errors.accountId?.message && (
              <div className={inputStyles.fieldError}>
                <Info size={12} /> {errors.accountId.message}
              </div>
            )}
            {selectedAccount?.type === 'Gift Card' && (
              <span className={dr.helperText}>
                Gift card balance: {formatCurrency(selectedAccount.balance ?? 0)}
              </span>
            )}
          </div>
        )}
    </>
  );
}
