import { useId } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import {
  buttonStyles,
  Modal,
  inputStyles,
  Toggle,
  CurrencyInput,
  ButtonGroup,
  DatePicker,
  toPickerDate,
  fromPickerDate,
  IntegerInput,
} from '@budget-tracker/ui';
import FieldError from '../../components/FieldError.js';
import { formatServiceType } from './types.js';
import type { Reading, Service } from './types.js';

interface FormValues {
  billDate: string;
  dueDate?: string;
}

const FEE_TYPE_OPTIONS = [
  { value: 'dollar', label: 'U.S. Dollar' },
  { value: 'percent', label: 'Percentage' },
];

interface ReadingFormModalProps {
  open: boolean;
  onClose: () => void;
  editing: Reading | null;
  service: Service;
  form: UseFormReturn<FormValues>;
  onSubmit: (values: FormValues) => void;
  isMetered: boolean;
  costCents: number;
  setCostCents: (v: number) => void;
  usageValue: string;
  setUsageValue: (v: string) => void;
  showConvFee: boolean;
  setShowConvFee: (v: boolean) => void;
  feeType: string;
  setFeeType: (v: string) => void;
  convFeeValue: number;
  setConvFeeValue: (v: number) => void;
  showOtherFees: boolean;
  setShowOtherFees: (v: boolean) => void;
  otherFeesCents: number;
  setOtherFeesCents: (v: number) => void;
}

export default function ReadingFormModal({
  open,
  onClose,
  editing,
  service,
  form,
  onSubmit,
  isMetered,
  costCents,
  setCostCents,
  usageValue,
  setUsageValue,
  showConvFee,
  setShowConvFee,
  feeType,
  setFeeType,
  convFeeValue,
  setConvFeeValue,
  showOtherFees,
  setShowOtherFees,
  otherFeesCents,
  setOtherFeesCents,
}: ReadingFormModalProps) {
  const fid = useId();
  const {
    handleSubmit,
    formState: { errors },
  } = form;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        editing
          ? `Edit Reading – ${formatServiceType(service.serviceType)}`
          : `Add Reading – ${formatServiceType(service.serviceType)}`
      }
      closeButton="none"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: vars.space['2'] }}>
          <button
            type="submit"
            form="reading-form"
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            {editing ? 'Save' : 'Add'}
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
      <form id="reading-form" onSubmit={handleSubmit(onSubmit)} className={inputStyles.formStack}>
        <div className={inputStyles.formGrid2}>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-bill-date`} className={inputStyles.fieldLabel}>
              Bill Date
            </label>
            <DatePicker
              id={`${fid}-bill-date`}
              value={toPickerDate(form.watch('billDate'))}
              onChange={(d) =>
                form.setValue('billDate', fromPickerDate(d), {
                  shouldValidate: true,
                })
              }
              error={!!errors.billDate}
            />
            <FieldError error={errors.billDate} />
          </div>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-due-date`} className={inputStyles.fieldLabel}>
              Due Date
            </label>
            <DatePicker
              id={`${fid}-due-date`}
              value={toPickerDate(form.watch('dueDate'))}
              onChange={(d) => form.setValue('dueDate', fromPickerDate(d))}
            />
          </div>
        </div>

        <div className={isMetered ? inputStyles.formGrid2 : undefined}>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-cost`} className={inputStyles.fieldLabel}>
              Cost
            </label>
            <CurrencyInput id={`${fid}-cost`} value={costCents} onChange={setCostCents} />
          </div>
          {isMetered && (
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-usage`} className={inputStyles.fieldLabel}>
                Usage
              </label>
              <IntegerInput
                id={`${fid}-usage`}
                value={usageValue ? parseInt(usageValue, 10) : 0}
                onChange={(v) => setUsageValue(String(v))}
                min={0}
                placeholder="0"
              />
            </div>
          )}
        </div>

        <div className={inputStyles.field}>
          <label className={inputStyles.fieldLabel}>Convenience Fee</label>
          <Toggle
            label="This bill includes a convenience fee"
            checked={showConvFee}
            onChange={setShowConvFee}
          />
        </div>
        {showConvFee && (
          <>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-fee-type`} className={inputStyles.fieldLabel}>
                Fee Type
              </label>
              <ButtonGroup
                id={`${fid}-fee-type`}
                options={FEE_TYPE_OPTIONS}
                value={feeType}
                onChange={(v) => {
                  setFeeType(v);
                  setConvFeeValue(0);
                }}
                size="sm"
              />
            </div>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-field5`} className={inputStyles.fieldLabel}>
                {feeType === 'dollar' ? 'Fee Amount' : 'Fee %'}
              </label>
              <CurrencyInput
                id={`${fid}-field5`}
                value={convFeeValue}
                onChange={setConvFeeValue}
                prefix={feeType === 'dollar' ? '$' : ''}
                suffix={feeType === 'percent' ? '%' : ''}
              />
            </div>
          </>
        )}

        <div className={inputStyles.field}>
          <label className={inputStyles.fieldLabel}>Other Fees</label>
          <Toggle
            label="This bill includes other fees"
            checked={showOtherFees}
            onChange={setShowOtherFees}
          />
        </div>
        {showOtherFees && (
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-other-fees`} className={inputStyles.fieldLabel}>
              Other Fees
            </label>
            <CurrencyInput
              id={`${fid}-other-fees`}
              value={otherFeesCents}
              onChange={setOtherFeesCents}
            />
          </div>
        )}
      </form>
    </Modal>
  );
}
