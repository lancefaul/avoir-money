import { useId } from 'react';
import type { FieldErrors } from 'react-hook-form';
import {
  inputStyles,
  CurrencyInput,
  DatePicker,
  toPickerDate,
  fromPickerDate,
} from '@budget-tracker/ui';
import FieldError from '../../components/FieldError.js';

interface EscrowFieldValues {
  escrowMonthlyAmount?: number;
  escrowPeriodStartDate?: string;
  escrowPeriodEndDate?: string;
}

interface EscrowFieldsProps {
  errors: FieldErrors<EscrowFieldValues>;
  escrowAmount: number;
  onEscrowAmountChange: (value: number) => void;
  periodStartDate: string | undefined;
  onPeriodStartDateChange: (value: string) => void;
  periodEndDate: string | undefined;
  onPeriodEndDateChange: (value: string) => void;
}

export default function EscrowFields({
  errors,
  escrowAmount,
  onEscrowAmountChange,
  periodStartDate,
  onPeriodStartDateChange,
  periodEndDate,
  onPeriodEndDateChange,
}: EscrowFieldsProps) {
  const fid = useId();
  return (
    <>
      <div className={inputStyles.field}>
        <label htmlFor={`${fid}-monthly-escrow`} className={inputStyles.fieldLabel}>
          Monthly Escrow Amount
        </label>
        <CurrencyInput
          id={`${fid}-monthly-escrow`}
          value={Math.round(escrowAmount * 100)}
          onChange={(cents) => onEscrowAmountChange(cents / 100)}
        />
        <FieldError error={errors.escrowMonthlyAmount} />
      </div>

      <div className={inputStyles.formGrid2}>
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-period-start`} className={inputStyles.fieldLabel}>
            Period Start Date
          </label>
          <DatePicker
            id={`${fid}-period-start`}
            value={toPickerDate(periodStartDate)}
            onChange={(d) => onPeriodStartDateChange(fromPickerDate(d))}
            error={!!errors.escrowPeriodStartDate}
          />
          <FieldError error={errors.escrowPeriodStartDate} />
        </div>
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-period-end`} className={inputStyles.fieldLabel}>
            Period End Date
          </label>
          <DatePicker
            id={`${fid}-period-end`}
            value={toPickerDate(periodEndDate)}
            onChange={(d) => onPeriodEndDateChange(fromPickerDate(d))}
            error={!!errors.escrowPeriodEndDate}
          />
          <FieldError error={errors.escrowPeriodEndDate} />
        </div>
      </div>
    </>
  );
}
