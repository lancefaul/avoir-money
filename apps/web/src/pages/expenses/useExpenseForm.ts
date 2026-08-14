import { useState, useEffect } from 'react';
import {
  useForm,
  type UseFormRegister,
  type UseFormWatch,
  type UseFormSetValue,
  type UseFormHandleSubmit,
  type FieldErrors,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateExpenseSchema } from '@budget-tracker/core';
import type { UseMutationResult } from '@tanstack/react-query';
import type { ExpenseRecord, Category, Account, FormValues } from './types.js';

// ─── Option / Return Interfaces ──────────────────────────────────────────────

export interface UseExpenseFormOptions {
  categories: Category[];
  accounts: Account[];
  debts: { id: string; name: string }[];
  create: UseMutationResult<unknown, Error, unknown, unknown>;
  update: UseMutationResult<unknown, Error, { id: string; body: unknown }, unknown>;
}

export interface UseExpenseFormReturn {
  // React Hook Form
  register: UseFormRegister<FormValues>;
  handleSubmit: UseFormHandleSubmit<FormValues>;
  watch: UseFormWatch<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  errors: FieldErrors<FormValues>;

  // Form visibility state
  showForm: boolean;
  editing: ExpenseRecord | null;

  // Watched values
  dueType: 'day' | 'weekday' | undefined;
  amountMode: 'uniform' | 'byMonth' | undefined;
  frequency: string | undefined;

  // Month amounts state
  monthAmounts: Record<string, number>;
  setMonthAmounts: React.Dispatch<React.SetStateAction<Record<string, number>>>;

  // Ongoing state
  isOngoing: boolean;
  setIsOngoing: React.Dispatch<React.SetStateAction<boolean>>;

  // Linked debt toggle state
  hasLinkedDebt: boolean;
  setHasLinkedDebt: React.Dispatch<React.SetStateAction<boolean>>;

  // Actions
  openCreate: () => void;
  openEdit: (record: ExpenseRecord) => void;
  closeForm: () => void;
  onSubmit: (values: FormValues) => void;
}

// ─── Hook Implementation ─────────────────────────────────────────────────────

export function useExpenseForm(options: UseExpenseFormOptions): UseExpenseFormReturn {
  const { create, update } = options;

  const [editing, setEditing] = useState<ExpenseRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [monthAmounts, setMonthAmounts] = useState<Record<string, number>>({});
  const [isOngoing, setIsOngoing] = useState(true);
  const [hasLinkedDebt, setHasLinkedDebt] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(CreateExpenseSchema),
    mode: 'onBlur',
  });

  const dueType = watch('dueType');
  const amountMode = watch('amountMode');
  const frequency = watch('frequency');
  const watchedAmount = watch('amount');

  // When switching from uniform to by-month, pre-fill all 12 months with the
  // current uniform amount so the user has a starting point to adjust.
  useEffect(() => {
    if (amountMode === 'byMonth' && Object.keys(monthAmounts).length === 0 && watchedAmount > 0) {
      const prefilled: Record<string, number> = {};
      for (let i = 1; i <= 12; i++) prefilled[String(i)] = watchedAmount;
      setMonthAmounts(prefilled);
    }
  }, [amountMode, monthAmounts, watchedAmount]);

  function openCreate() {
    reset({
      isAutomatic: false,
      skipWeekend: true,
      dueType: 'day',
      amountMode: 'uniform',
      linkedDebtId: '',
    });
    setMonthAmounts({});
    setIsOngoing(true);
    setHasLinkedDebt(false);
    setEditing(null);
    setShowForm(true);
  }

  function openEdit(r: ExpenseRecord) {
    setEditing(r);
    const hasDueWeekday = r.dueWeekday != null && r.dueOrdinal != null;
    const hasSchedule = r.amountSchedule && Object.keys(r.amountSchedule).length > 0;
    setValue('name', r.name);
    setValue('amount', r.amount);
    setValue('frequency', r.frequency);
    setValue('budgetId', r.budgetId);
    setValue('accountId', r.accountId ?? '');
    setValue('isAutomatic', r.isAutomatic);
    setValue('skipWeekend', r.skipWeekend ?? true);
    setValue('dueType', hasDueWeekday ? 'weekday' : 'day');
    setValue('dueDay', r.dueDay ?? undefined);
    setValue('dueWeekday', r.dueWeekday ?? undefined);
    setValue('dueOrdinal', r.dueOrdinal ?? undefined);
    setValue('amountMode', hasSchedule ? 'byMonth' : 'uniform');
    setMonthAmounts(r.amountSchedule ?? {});
    setValue('startDate', r.startDate ? new Date(r.startDate).toISOString().split('T')[0] : '');
    setValue('endDate', r.endDate ? new Date(r.endDate).toISOString().split('T')[0] : '');
    setIsOngoing(!r.endDate);
    setHasLinkedDebt(!!r.linkedDebtId);
    setValue('note', r.note ?? '');
    setValue('linkedDebtId', r.linkedDebtId ?? '');
    setValue('managementUrl', r.managementUrl ?? '');
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    reset();
  }

  function onSubmit(values: FormValues) {
    // Read amountMode and dueType from react-hook-form state directly,
    // since these are UI-only fields not in CreateExpenseSchema and get
    // stripped by the zodResolver during validation.
    const currentAmountMode = amountMode;
    const currentDueType = dueType;
    const body: Record<string, unknown> = {
      name: values.name,
      amount: Number(values.amount),
      frequency: values.frequency,
      budgetId: values.budgetId,
      accountId: values.accountId || undefined,
      isAutomatic: values.isAutomatic,
      skipWeekend: values.skipWeekend,
      startDate: values.startDate || undefined,
      endDate: isOngoing ? undefined : values.endDate || undefined,
      note: values.note || undefined,
      linkedDebtId: values.linkedDebtId || null,
      managementUrl: values.managementUrl?.trim() || undefined,
    };

    // Add amount schedule for by-month mode
    if (currentAmountMode === 'byMonth' && Object.keys(monthAmounts).length > 0) {
      body.amountSchedule = monthAmounts;
    } else {
      body.amountSchedule = undefined;
    }

    if (currentDueType === 'weekday' && values.dueWeekday != null && values.dueOrdinal != null) {
      body.dueWeekday = Number(values.dueWeekday);
      body.dueOrdinal = Number(values.dueOrdinal);
      body.dueDay = undefined;
    } else if (values.dueDay) {
      body.dueDay = Number(values.dueDay);
      body.dueWeekday = undefined;
      body.dueOrdinal = undefined;
    }

    if (editing) {
      // A recurring edit always applies going forward: the record is updated in
      // place and the API regenerates future PENDING occurrences with the new
      // values (mark-as-paid reads the source's account/amount live). Past
      // transactions are historical facts and are never rewritten from here.
      update.mutate({ id: editing.id, body }, { onSuccess: closeForm });
    } else {
      create.mutate(body, { onSuccess: closeForm });
    }
  }

  return {
    register,
    handleSubmit,
    watch,
    setValue,
    errors,
    showForm,
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
    openCreate,
    openEdit,
    closeForm,
    onSubmit,
  };
}
