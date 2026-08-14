import { useEffect, useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { computeAmortizedPayment } from '@budget-tracker/core';
import type { DebtRecord } from '../../hooks/useDebts.js';
import {
  useCreateDebt,
  useUpdateDebt,
  useCreateEscrowRecord,
  useEscrowHistory,
} from '../../hooks/useApi.js';
import FieldError from '../../components/FieldError.js';
import EscrowFields from './EscrowFields.js';
import type { Account, Expense } from './types.js';
import {
  Modal,
  Select,
  Toggle,
  CurrencyInput,
  DatePicker,
  ResizableTextarea,
  SectionHeading,
  inputStyles,
  buttonStyles,
} from '@budget-tracker/ui';
import type { SelectOption } from '@budget-tracker/ui';
import {
  DebtFormSchema,
  type DebtFormValues,
  TYPE_OPTIONS,
  FREQUENCY_OPTIONS,
  parseDate,
  formatDateStr,
} from './debtFormSchema.js';

interface DebtFormProps {
  editing: DebtRecord | null;
  accounts: Account[];
  expenses: Expense[];
  onClose: () => void;
}

export default function DebtForm({ editing, accounts, expenses, onClose }: DebtFormProps) {
  const fid = useId();
  const create = useCreateDebt();
  const update = useUpdateDebt();
  const createEscrow = useCreateEscrowRecord();

  const shouldFetchEscrow = editing?.type === 'MORTGAGE' && editing?.escrowEnabled;
  const { data: escrowData } = useEscrowHistory(shouldFetchEscrow ? editing?.id : undefined);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<DebtFormValues>({
    resolver: zodResolver(DebtFormSchema),
    mode: 'onBlur',
  });

  const watchedType = watch('type');
  const watchedEscrow = watch('escrowEnabled');
  const watchedFrequency = watch('frequency');
  const watchedOriginalBalance = watch('originalBalance');
  const watchedCurrentBalance = watch('currentBalance');
  const watchedMinimumPayment = watch('minimumPayment');
  const isMortgage = watchedType === 'MORTGAGE';

  useEffect(() => {
    if (editing) {
      reset({
        name: editing.name,
        type: editing.type,
        originalBalance: editing.originalBalance,
        currentBalance: editing.currentBalance,
        apr: editing.apr,
        minimumPayment: editing.minimumPayment,
        frequency: editing.frequency,
        startDate: editing.startDate ? new Date(editing.startDate).toISOString().split('T')[0] : '',
        maturityDate: editing.maturityDate
          ? new Date(editing.maturityDate).toISOString().split('T')[0]
          : undefined,
        linkedAccountId: editing.linkedAccountId ?? undefined,
        linkedExpenseId: editing.linkedExpenseId ?? undefined,
        note: editing.note ?? undefined,
        managementUrl: editing.managementUrl ?? '',
        escrowEnabled: editing.type === 'MORTGAGE' ? (editing.escrowEnabled ?? false) : undefined,
      });
    } else {
      reset({
        name: '',
        type: 'MORTGAGE',
        frequency: 'MONTHLY',
        originalBalance: 0,
        currentBalance: 0,
        apr: 0,
        minimumPayment: 0,
        startDate: new Date().toISOString().split('T')[0],
        escrowEnabled: false,
      });
    }
  }, [editing, reset]);

  useEffect(() => {
    if (escrowData && escrowData.length > 0 && editing?.escrowEnabled) {
      const latest = escrowData[0]!;
      setValue('escrowMonthlyAmount', latest.monthlyAmount);
      setValue(
        'escrowPeriodStartDate',
        new Date(latest.periodStartDate).toISOString().split('T')[0] ?? '',
      );
      setValue(
        'escrowPeriodEndDate',
        new Date(latest.periodEndDate).toISOString().split('T')[0] ?? '',
      );
    }
  }, [escrowData, editing, setValue]);

  function onSubmit(values: DebtFormValues) {
    // Calculate termMonths from dates if both are provided
    let termMonths: number | undefined;
    if (values.startDate && values.maturityDate) {
      const start = new Date(values.startDate);
      const end = new Date(values.maturityDate);
      termMonths = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
    }

    // Mortgages don't collect a minimum payment — the fixed P&I is derived from
    // the loan terms. Store that derived value so minimumPayment stays meaningful
    // (it also serves as the fallback if the term is ever removed).
    const minimumPayment =
      values.type === 'MORTGAGE'
        ? (computeAmortizedPayment(
            Number(values.originalBalance),
            Number(values.apr),
            termMonths ?? 0,
            values.frequency,
          ) ?? Number(values.minimumPayment))
        : Number(values.minimumPayment);

    const body: Record<string, unknown> = {
      name: values.name,
      type: values.type,
      originalBalance: Number(values.originalBalance),
      currentBalance: Number(values.currentBalance),
      apr: Number(values.apr),
      minimumPayment,
      frequency: values.frequency,
      startDate: values.startDate || undefined,
      maturityDate: values.maturityDate || undefined,
      termMonths: termMonths || undefined,
      linkedAccountId: values.linkedAccountId || undefined,
      linkedExpenseId: values.linkedExpenseId || undefined,
      note: values.note || undefined,
      managementUrl: values.managementUrl?.trim() || undefined,
    };

    if (values.type === 'MORTGAGE') {
      body.escrowEnabled = !!values.escrowEnabled;
    }

    const escrowBody =
      values.escrowEnabled && values.type === 'MORTGAGE'
        ? {
            monthlyAmount: values.escrowMonthlyAmount!,
            periodStartDate: values.escrowPeriodStartDate!,
            periodEndDate: values.escrowPeriodEndDate!,
          }
        : null;

    if (editing) {
      update.mutate(
        { id: editing.id, body },
        {
          onSuccess: (updatedDebt: { id: string }) => {
            if (escrowBody) {
              createEscrow.mutate(
                { debtId: updatedDebt.id ?? editing.id, body: escrowBody },
                { onSuccess: onClose },
              );
            } else {
              onClose();
            }
          },
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: (newDebt: { id: string } | null | undefined) => {
          if (escrowBody && newDebt?.id) {
            createEscrow.mutate({ debtId: newDebt.id, body: escrowBody }, { onSuccess: onClose });
          } else {
            onClose();
          }
        },
      });
    }
  }

  const accountOptions: SelectOption[] = [
    { value: '', label: 'None' },
    ...accounts.map((a) => ({ value: a.id, label: a.name })),
  ];

  const expenseOptions: SelectOption[] = [
    { value: '', label: 'None' },
    ...expenses.map((e) => ({ value: e.id, label: e.name })),
  ];

  const footerContent = (
    <>
      <button
        type="submit"
        form="debt-drawer-form"
        disabled={create.isPending || update.isPending || createEscrow.isPending}
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
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Edit Debt' : 'Add Debt'}
      variant="drawer"
      closeButton="none"
      footer={footerContent}
    >
      <form id="debt-drawer-form" onSubmit={handleSubmit(onSubmit)}>
        <div className={inputStyles.formStack}>
          {/* ── DEBT INFORMATION ── */}
          <SectionHeading>Debt Information</SectionHeading>

          {/* Name */}
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-name`} className={inputStyles.fieldLabel}>
              Name <span className={inputStyles.fieldRequired}>*</span>
            </label>
            <input
              id={`${fid}-name`}
              {...register('name')}
              className={`${inputStyles.input} ${errors.name ? inputStyles.inputError : ''}`}
            />
            <FieldError error={errors.name} />
          </div>

          {/* Type */}
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-type`} className={inputStyles.fieldLabel}>
              Type
            </label>
            <Select
              id={`${fid}-type`}
              options={TYPE_OPTIONS}
              value={watchedType}
              onChange={(v) =>
                setValue('type', v as DebtFormValues['type'], { shouldValidate: true })
              }
              placeholder="Select type"
            />
            <FieldError error={errors.type} />
          </div>

          {/* ── LOAN TERMS ── */}
          <SectionHeading>Loan Terms</SectionHeading>

          {/* Origination Date / Maturity Date */}
          <div className={inputStyles.formGrid2}>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-start-date`} className={inputStyles.fieldLabel}>
                Origination Date
              </label>
              <DatePicker
                id={`${fid}-start-date`}
                value={parseDate(watch('startDate'))}
                onChange={(d) =>
                  setValue('startDate', d ? formatDateStr(d) : '', {
                    shouldValidate: true,
                  })
                }
                error={!!errors.startDate}
              />
              <FieldError error={errors.startDate} />
            </div>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-maturity-date`} className={inputStyles.fieldLabel}>
                Maturity Date
              </label>
              <DatePicker
                id={`${fid}-maturity-date`}
                value={parseDate(watch('maturityDate'))}
                onChange={(d) =>
                  setValue('maturityDate', d ? formatDateStr(d) : undefined, {
                    shouldValidate: true,
                  })
                }
                error={!!errors.maturityDate}
              />
              <FieldError error={errors.maturityDate} />
            </div>
          </div>

          {/* Original Balance / Current Balance */}
          <div className={inputStyles.formGrid2}>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-original-balance`} className={inputStyles.fieldLabel}>
                Original Balance
              </label>
              <CurrencyInput
                id={`${fid}-original-balance`}
                value={Math.round((watchedOriginalBalance ?? 0) * 100)}
                onChange={(cents) =>
                  setValue('originalBalance', cents / 100, { shouldValidate: true })
                }
              />
              <FieldError error={errors.originalBalance} />
            </div>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-current-balance`} className={inputStyles.fieldLabel}>
                Current Balance
              </label>
              <CurrencyInput
                id={`${fid}-current-balance`}
                value={Math.round((watchedCurrentBalance ?? 0) * 100)}
                onChange={(cents) =>
                  setValue('currentBalance', cents / 100, { shouldValidate: true })
                }
              />
              <FieldError error={errors.currentBalance} />
            </div>
          </div>

          {/* APR */}
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-apr`} className={inputStyles.fieldLabel}>
              APR
            </label>
            <CurrencyInput
              id={`${fid}-apr`}
              value={Math.round((watch('apr') ?? 0) * 100)}
              onChange={(cents) => setValue('apr', cents / 100, { shouldValidate: true })}
              prefix=""
              suffix="%"
            />
            <FieldError error={errors.apr} />
          </div>

          {/* ── PAYMENT INFORMATION ── */}
          <SectionHeading>Payment Information</SectionHeading>

          {/* Minimum Payment / Frequency — mortgages derive P&I from loan terms,
              so the minimum payment field is hidden and Frequency spans the row. */}
          <div className={isMortgage ? undefined : inputStyles.formGrid2}>
            {!isMortgage && (
              <div className={inputStyles.field}>
                <label htmlFor={`${fid}-minimum-payment`} className={inputStyles.fieldLabel}>
                  Minimum Payment
                </label>
                <CurrencyInput
                  id={`${fid}-minimum-payment`}
                  value={Math.round((watchedMinimumPayment ?? 0) * 100)}
                  onChange={(cents) =>
                    setValue('minimumPayment', cents / 100, { shouldValidate: true })
                  }
                />
                <FieldError error={errors.minimumPayment} />
              </div>
            )}
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-frequency`} className={inputStyles.fieldLabel}>
                Frequency
              </label>
              <Select
                id={`${fid}-frequency`}
                options={FREQUENCY_OPTIONS}
                value={watchedFrequency}
                onChange={(v) =>
                  setValue('frequency', v as DebtFormValues['frequency'], { shouldValidate: true })
                }
                placeholder="Select frequency"
              />
              <FieldError error={errors.frequency} />
            </div>
          </div>

          {/* Linked Account / Linked Expense */}
          <div className={inputStyles.formGrid2}>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-linked-account`} className={inputStyles.fieldLabel}>
                Linked Account
              </label>
              <Select
                id={`${fid}-linked-account`}
                options={accountOptions}
                value={watch('linkedAccountId') ?? ''}
                onChange={(v) =>
                  setValue('linkedAccountId', v || undefined, { shouldValidate: true })
                }
                placeholder="None"
              />
            </div>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-linked-expense`} className={inputStyles.fieldLabel}>
                Linked Expense
              </label>
              <Select
                id={`${fid}-linked-expense`}
                options={expenseOptions}
                value={watch('linkedExpenseId') ?? ''}
                onChange={(v) =>
                  setValue('linkedExpenseId', v || undefined, { shouldValidate: true })
                }
                placeholder="None"
              />
            </div>
          </div>

          {/* Escrow toggle — only for MORTGAGE type */}
          {isMortgage && (
            <>
              <div className={inputStyles.field}>
                <label className={inputStyles.fieldLabel}>Escrow</label>
                <Toggle
                  checked={!!watchedEscrow}
                  onChange={(v) => setValue('escrowEnabled', v, { shouldValidate: true })}
                  label="Enable escrow for this debt"
                />
              </div>
              {watchedEscrow && (
                <EscrowFields
                  errors={errors}
                  escrowAmount={watch('escrowMonthlyAmount') ?? 0}
                  onEscrowAmountChange={(v) =>
                    setValue('escrowMonthlyAmount', v, { shouldValidate: true })
                  }
                  periodStartDate={watch('escrowPeriodStartDate')}
                  onPeriodStartDateChange={(v) =>
                    setValue('escrowPeriodStartDate', v, { shouldValidate: true })
                  }
                  periodEndDate={watch('escrowPeriodEndDate')}
                  onPeriodEndDateChange={(v) =>
                    setValue('escrowPeriodEndDate', v, { shouldValidate: true })
                  }
                />
              )}
            </>
          )}

          {/* ── ADDITIONAL INFORMATION ── */}
          <SectionHeading>Additional Information</SectionHeading>

          {/* Management URL */}
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-management-url`} className={inputStyles.fieldLabel}>
              Management URL
            </label>
            <input
              id={`${fid}-management-url`}
              {...register('managementUrl')}
              placeholder="example.com/manage"
              className={inputStyles.input}
            />
          </div>

          {/* Note */}
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-note`} className={inputStyles.fieldLabel}>
              Note
            </label>
            <ResizableTextarea
              id={`${fid}-note`}
              {...register('note')}
              rows={3}
              placeholder="Optional notes…"
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
