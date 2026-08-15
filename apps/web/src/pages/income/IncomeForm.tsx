import {
  ButtonGroup,
  Select,
  type SelectOption,
  CurrencyInput,
  DatePicker,
  toPickerDate,
  fromPickerDate,
  Modal,
  Toggle,
  ResizableTextarea,
  SectionHeading,
  inputStyles,
  buttonStyles,
} from '@budget-tracker/ui';
import { Info } from 'lucide-react';
import { useId } from 'react';
import type { UseIncomeFormReturn } from './useIncomeForm.js';
import type { Account } from './types.js';
import { FREQUENCIES, MONTHS } from './types.js';
import { frequencyLabel } from '../../lib/utils.js';
import FieldError from '../../components/FieldError.js';
import * as dr from './income-form.css.js';

interface IncomeFormProps {
  form: UseIncomeFormReturn;
  accounts: Account[];
  isPending: boolean;
  headerSlot?: React.ReactNode;
  bare?: boolean;
}

const AMOUNT_MODE_OPTIONS_MONTHLY = [
  { value: 'uniform', label: 'Uniform' },
  { value: 'byMonth', label: 'By Month' },
];

const AMOUNT_MODE_OPTIONS_ALTERNATING = [
  { value: 'uniform', label: 'Uniform' },
  { value: 'byMonth', label: 'Alternating' },
];

export default function IncomeForm({
  form,
  accounts,
  isPending,
  headerSlot,
  bare = false,
}: IncomeFormProps) {
  const fid = useId();
  if (!bare && !form.showForm) return null;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    errors,
    editing,
    amountMode,
    frequency,
    monthAmounts,
    setMonthAmounts,
    isOngoing,
    setIsOngoing,
    closeForm,
    onSubmit,
  } = form;

  const title = editing ? 'Edit Income' : 'Add Income';

  // Select options
  const accountOptions: SelectOption[] = [
    { value: '', label: 'None' },
    ...accounts.map((a) => ({ value: a.id, label: a.name })),
  ];
  const frequencyOptions: SelectOption[] = FREQUENCIES.map((f) => ({
    value: f,
    label: frequencyLabel(f),
  }));

  // Determine which frequencies show the amount mode toggle
  const showAmountToggle =
    frequency === 'MONTHLY' || frequency === 'BIWEEKLY' || frequency === 'SEMI_MONTHLY';
  const amountModeOptions =
    frequency === 'MONTHLY' ? AMOUNT_MODE_OPTIONS_MONTHLY : AMOUNT_MODE_OPTIONS_ALTERNATING;

  // Form stores "YYYY-MM-DD"; the picker wants a local-midnight Date.
  const startDateObj = toPickerDate(watch('startDate'));
  const endDateObj = toPickerDate(watch('endDate'));

  // Amount conversion: form stores number, CurrencyInput wants cents (integer)
  const amountVal = watch('amount');
  const amountCents = amountVal ? Math.round(Number(amountVal) * 100) || 0 : 0;

  const footerContent = (
    <>
      <button
        type="submit"
        form="income-drawer-form"
        disabled={isPending}
        className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
      >
        {editing ? 'Save' : 'Add'}
      </button>
      <button
        type="button"
        onClick={closeForm}
        className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
      >
        Cancel
      </button>
    </>
  );

  const formContent = (
    <form id="income-drawer-form" onSubmit={handleSubmit(onSubmit)}>
      <div className={inputStyles.formStack}>
        {headerSlot}
        {/* ── INCOME INFORMATION ── */}
        <SectionHeading>Income Information</SectionHeading>

        {/* Name */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-name`} className={inputStyles.fieldLabel}>
            Name <span className={inputStyles.fieldRequired}>*</span>
          </label>
          <input
            id={`${fid}-name`}
            {...register('name')}
            className={`${inputStyles.input} ${errors.name ? inputStyles.inputError : ''}`}
            placeholder="e.g. Salary, Freelance"
          />
          {errors.name?.message && (
            <div className={inputStyles.fieldError}>
              <Info size={12} /> {errors.name.message}
            </div>
          )}
        </div>

        {/* Frequency */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-frequency`} className={inputStyles.fieldLabel}>
            Frequency <span className={inputStyles.fieldRequired}>*</span>
          </label>
          <Select
            id={`${fid}-frequency`}
            options={frequencyOptions}
            value={watch('frequency') ?? ''}
            onChange={(v) => setValue('frequency', v)}
            placeholder="Select frequency…"
            error={!!errors.frequency}
          />
          <FieldError error={errors.frequency} />
        </div>

        {/* Amount */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-amount`} className={inputStyles.fieldLabel}>
            Amount <span className={inputStyles.fieldRequired}>*</span>
          </label>
          {showAmountToggle && (
            <ButtonGroup
              id={`${fid}-amount`}
              options={amountModeOptions}
              value={amountMode ?? 'uniform'}
              onChange={(v) => setValue('amountMode', v as 'uniform' | 'byMonth')}
              size="md"
              ariaLabel="Amount mode"
            />
          )}
          {amountMode === 'byMonth' && frequency === 'MONTHLY' ? (
            <div className={dr.monthGrid}>
              {MONTHS.map((m, i) => (
                <div key={m} className={dr.monthCell}>
                  <span className={dr.monthLabel}>{m}</span>
                  <CurrencyInput
                    value={Math.round((monthAmounts[String(i + 1)] ?? 0) * 100)}
                    onChange={(cents) =>
                      setMonthAmounts((prev) => ({
                        ...prev,
                        [String(i + 1)]: cents / 100,
                      }))
                    }
                    placeholder="0.00"
                  />
                </div>
              ))}
            </div>
          ) : amountMode === 'byMonth' && frequency === 'BIWEEKLY' ? (
            <div className={inputStyles.formGrid2}>
              <div className={dr.alternatingCell}>
                <span className={dr.alternatingLabel}>Period 1</span>
                <CurrencyInput
                  value={Math.round((monthAmounts['1'] ?? 0) * 100)}
                  onChange={(cents) => setMonthAmounts((prev) => ({ ...prev, '1': cents / 100 }))}
                  placeholder="0.00"
                />
              </div>
              <div className={dr.alternatingCell}>
                <span className={dr.alternatingLabel}>Period 2</span>
                <CurrencyInput
                  value={Math.round((monthAmounts['2'] ?? 0) * 100)}
                  onChange={(cents) => setMonthAmounts((prev) => ({ ...prev, '2': cents / 100 }))}
                  placeholder="0.00"
                />
              </div>
            </div>
          ) : amountMode === 'byMonth' && frequency === 'SEMI_MONTHLY' ? (
            <div className={inputStyles.formGrid2}>
              <div className={dr.alternatingCell}>
                <span className={dr.alternatingLabel}>1st – 15th</span>
                <CurrencyInput
                  value={Math.round((monthAmounts['1'] ?? 0) * 100)}
                  onChange={(cents) => setMonthAmounts((prev) => ({ ...prev, '1': cents / 100 }))}
                  placeholder="0.00"
                />
              </div>
              <div className={dr.alternatingCell}>
                <span className={dr.alternatingLabel}>16th – End</span>
                <CurrencyInput
                  value={Math.round((monthAmounts['2'] ?? 0) * 100)}
                  onChange={(cents) => setMonthAmounts((prev) => ({ ...prev, '2': cents / 100 }))}
                  placeholder="0.00"
                />
              </div>
            </div>
          ) : (
            <>
              <CurrencyInput
                value={amountCents}
                onChange={(cents) => setValue('amount', cents / 100)}
                placeholder="0.00"
              />
              {errors.amount?.message && (
                <div className={inputStyles.fieldError}>
                  <Info size={12} /> {errors.amount.message}
                </div>
              )}
            </>
          )}
        </div>

        {/* Account */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-account`} className={inputStyles.fieldLabel}>
            Account
          </label>
          <Select
            id={`${fid}-account`}
            searchable
            options={accountOptions}
            value={watch('accountId') ?? ''}
            onChange={(v) => setValue('accountId', v)}
            placeholder="None"
          />
          <FieldError error={errors.accountId} />
        </div>

        {/* ── SCHEDULE ── */}
        <SectionHeading>Schedule</SectionHeading>

        {/* Start Date */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-start-date`} className={inputStyles.fieldLabel}>
            Start Date
          </label>
          <DatePicker
            id={`${fid}-start-date`}
            value={startDateObj}
            onChange={(d) => setValue('startDate', fromPickerDate(d))}
            error={!!errors.startDate}
          />
          <FieldError error={errors.startDate} />
        </div>

        {/* End Date */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-end-date`} className={inputStyles.fieldLabel}>
            End Date
          </label>
          <Toggle
            id={`${fid}-end-date`}
            checked={isOngoing}
            onChange={(checked) => {
              setIsOngoing(checked);
              if (checked) setValue('endDate', '');
            }}
            label="Ongoing"
          />
          {!isOngoing && (
            <>
              <DatePicker
                value={endDateObj}
                onChange={(d) => setValue('endDate', fromPickerDate(d))}
                error={!!errors.endDate}
              />
              <FieldError error={errors.endDate} />
            </>
          )}
        </div>

        {/* ── EXTRA INFORMATION ── */}
        <SectionHeading>Extra Information</SectionHeading>

        {/* Management URL */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-management-url`} className={inputStyles.fieldLabel}>
            Management URL
          </label>
          <input
            id={`${fid}-management-url`}
            {...register('managementUrl')}
            placeholder="example.com/manage"
            className={`${inputStyles.input} ${errors.managementUrl ? inputStyles.inputError : ''}`}
          />
          <FieldError error={errors.managementUrl} />
        </div>

        {/* Note */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-note`} className={inputStyles.fieldLabel}>
            Note
          </label>
          <ResizableTextarea id={`${fid}-note`} {...register('note')} rows={2} />
        </div>
      </div>
    </form>
  );

  if (bare) return formContent;

  return (
    <Modal
      open={form.showForm}
      onClose={closeForm}
      title={title}
      variant="drawer"
      closeButton="none"
      footer={footerContent}
    >
      {formContent}
    </Modal>
  );
}
