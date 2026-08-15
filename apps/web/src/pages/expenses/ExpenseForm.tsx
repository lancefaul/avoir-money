import {
  ButtonGroup,
  Select,
  type SelectOption,
  CurrencyInput,
  Modal,
  Toggle,
  ResizableTextarea,
  SectionHeading,
  inputStyles,
  buttonStyles,
} from '@budget-tracker/ui';
import { Info } from 'lucide-react';
import { useId } from 'react';
import type { UseExpenseFormReturn } from './useExpenseForm.js';
import type { Category, Account } from './types.js';
import { MONTHS, FREQUENCIES } from './types.js';
import { frequencyLabel } from '../../lib/utils.js';
import FieldError from '../../components/FieldError.js';
import ExpenseScheduleFields from './ExpenseScheduleFields.js';
import * as dr from './expense-form.css.js';

interface DebtOption {
  id: string;
  name: string;
}

interface ExpenseFormProps {
  form: UseExpenseFormReturn;
  categories: Category[];
  accounts: Account[];
  debts: DebtOption[];
  isPending: boolean;
  headerSlot?: React.ReactNode;
  bare?: boolean;
}

const AMOUNT_MODE_OPTIONS = [
  { value: 'uniform', label: 'Uniform' },
  { value: 'byMonth', label: 'By Month' },
];

export default function ExpenseForm({
  form,
  categories,
  accounts,
  debts,
  isPending,
  headerSlot,
  bare = false,
}: ExpenseFormProps) {
  const fid = useId();

  if (!bare && !form.showForm) return null;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    errors,
    editing,
    dueType,
    amountMode,
    frequency,
    monthAmounts,
    setMonthAmounts,
    isOngoing,
    setIsOngoing,
    hasLinkedDebt,
    setHasLinkedDebt,
    closeForm,
    onSubmit,
  } = form;

  const title = editing ? 'Edit Expense' : 'Add Expense';

  // Select options
  const categoryOptions: SelectOption[] = categories.map((c) => ({
    value: c.id,
    label: `${c.icon ?? ''} ${c.name}`.trim(),
  }));
  const accountOptions: SelectOption[] = [
    { value: '', label: 'None' },
    ...accounts.map((a) => ({ value: a.id, label: a.name })),
  ];
  const debtOptions: SelectOption[] = [
    { value: '', label: 'None' },
    ...debts.map((d) => ({ value: d.id, label: d.name })),
  ];
  const frequencyOptions: SelectOption[] = FREQUENCIES.map((f) => ({
    value: f,
    label: frequencyLabel(f),
  }));

  // Amount conversion: form stores number, CurrencyInput wants cents (integer)
  const amountVal = watch('amount');
  const amountCents = amountVal ? Math.round(Number(amountVal) * 100) || 0 : 0;

  const footerContent = (
    <>
      <button
        type="submit"
        form="expense-drawer-form"
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
    <form id="expense-drawer-form" onSubmit={handleSubmit(onSubmit)}>
      <div className={inputStyles.formStack}>
        {headerSlot}
        {/* ── EXPENSE INFORMATION ── */}
        <SectionHeading>Expense Information</SectionHeading>

        {/* Name */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-name`} className={inputStyles.fieldLabel}>
            Name <span className={inputStyles.fieldRequired}>*</span>
          </label>
          <input
            {...register('name')}
            id={`${fid}-name`}
            className={`${inputStyles.input} ${errors.name ? inputStyles.inputError : ''}`}
            placeholder="e.g. Netflix, Rent"
          />
          {errors.name?.message && (
            <div className={inputStyles.fieldError}>
              <Info size={12} /> {errors.name.message}
            </div>
          )}
        </div>

        {/* Frequency */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-freq`} className={inputStyles.fieldLabel}>
            Frequency <span className={inputStyles.fieldRequired}>*</span>
          </label>
          <Select
            id={`${fid}-freq`}
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
          {frequency === 'MONTHLY' && (
            <ButtonGroup
              options={AMOUNT_MODE_OPTIONS}
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
          ) : (
            <>
              <CurrencyInput
                id={`${fid}-amount`}
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

        {/* Budget */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-budget`} className={inputStyles.fieldLabel}>
            Budget <span className={inputStyles.fieldRequired}>*</span>
          </label>
          <Select
            id={`${fid}-budget`}
            searchable
            options={categoryOptions}
            value={watch('budgetId') ?? ''}
            onChange={(v) => setValue('budgetId', v)}
            placeholder="Select budget…"
            error={!!errors.budgetId}
          />
          <FieldError error={errors.budgetId} />
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

        {/* Linked Debt */}
        <div className={inputStyles.field}>
          <label className={inputStyles.fieldLabel}>Linked Debt</label>
          <Toggle
            checked={hasLinkedDebt}
            onChange={(checked) => {
              setHasLinkedDebt(checked);
              if (!checked) setValue('linkedDebtId', '');
            }}
            label="Link this expense to a debt"
          />
          {hasLinkedDebt && (
            <>
              <Select
                options={debtOptions}
                value={watch('linkedDebtId') ?? ''}
                onChange={(v) => setValue('linkedDebtId', v)}
                placeholder="Select debt…"
              />
              <FieldError error={errors.linkedDebtId} />
            </>
          )}
        </div>

        {/* ── SCHEDULE ── */}
        <SectionHeading>Schedule</SectionHeading>

        <ExpenseScheduleFields
          fid={fid}
          watch={watch}
          setValue={setValue}
          errors={errors}
          dueType={dueType}
          isOngoing={isOngoing}
          setIsOngoing={setIsOngoing}
        />

        {/* ── EXTRA INFORMATION ── */}
        <SectionHeading>Extra Information</SectionHeading>

        {/* Management URL */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-url`} className={inputStyles.fieldLabel}>
            Management URL
          </label>
          <input
            {...register('managementUrl')}
            id={`${fid}-url`}
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
          <ResizableTextarea {...register('note')} id={`${fid}-note`} rows={2} />
        </div>

        {/* Auto-pay */}
        <div className={inputStyles.field}>
          <label className={inputStyles.fieldLabel}>Auto-pay</label>
          <Toggle
            checked={watch('isAutomatic') ?? false}
            onChange={(checked) => setValue('isAutomatic', checked)}
            label="This expense is paid automatically"
          />
        </div>

        {/* Skip weekends */}
        {frequency && frequency !== 'ONE_TIME' && (
          <Toggle
            checked={watch('skipWeekend') ?? true}
            onChange={(checked) => setValue('skipWeekend', checked)}
            label="Skip weekends (shift to Monday)"
          />
        )}
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
