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
import { z } from 'zod';
import { CreateIncomeSchema } from '@budget-tracker/core';
import type { UseMutationResult } from '@tanstack/react-query';
import type { IncomeRecord, Category, FormValues } from './types.js';

// ─── Option / Return Interfaces ──────────────────────────────────────────────

export interface UseIncomeFormOptions {
  categories: Category[];
  create: UseMutationResult<unknown, Error, unknown, unknown>;
  update: UseMutationResult<unknown, Error, { id: string; body: unknown }, unknown>;
}

export interface UseIncomeFormReturn {
  // React Hook Form
  register: UseFormRegister<FormValues>;
  handleSubmit: UseFormHandleSubmit<FormValues>;
  watch: UseFormWatch<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  errors: FieldErrors<FormValues>;

  // Form visibility state
  showForm: boolean;
  editing: IncomeRecord | null;

  // Watched values
  amountMode: 'uniform' | 'byMonth' | undefined;
  frequency: string | undefined;

  // Month amounts state
  monthAmounts: Record<string, number>;
  setMonthAmounts: React.Dispatch<React.SetStateAction<Record<string, number>>>;

  // Ongoing state
  isOngoing: boolean;
  setIsOngoing: React.Dispatch<React.SetStateAction<boolean>>;

  // Actions
  openCreate: () => void;
  openEdit: (record: IncomeRecord) => void;
  closeForm: () => void;
  onSubmit: (values: FormValues) => void;
}

// ─── Zod schema for the form ─────────────────────────────────────────────────

const IncomeFormSchema = CreateIncomeSchema.omit({ budgetId: true }).extend({
  amountMode: z.enum(['uniform', 'byMonth']),
});

// ─── Hook Implementation ─────────────────────────────────────────────────────

export function useIncomeForm(options: UseIncomeFormOptions): UseIncomeFormReturn {
  const { categories, create, update } = options;

  const [editing, setEditing] = useState<IncomeRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [monthAmounts, setMonthAmounts] = useState<Record<string, number>>({});
  const [isOngoing, setIsOngoing] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(IncomeFormSchema),
    mode: 'onBlur',
  });

  const amountMode = watch('amountMode');
  const frequency = watch('frequency');
  const watchedAmount = watch('amount');

  // When switching from uniform to by-month, pre-fill all 12 months with the
  // current uniform amount so the user has a starting point to adjust.
  useEffect(() => {
    if (
      amountMode === 'byMonth' &&
      frequency === 'MONTHLY' &&
      Object.keys(monthAmounts).length === 0 &&
      watchedAmount > 0
    ) {
      const prefilled: Record<string, number> = {};
      for (let i = 1; i <= 12; i++) prefilled[String(i)] = watchedAmount;
      setMonthAmounts(prefilled);
    }
  }, [amountMode, frequency, monthAmounts, watchedAmount]);

  function openCreate() {
    reset({ amountMode: 'uniform' });
    setMonthAmounts({});
    setIsOngoing(true);
    setEditing(null);
    setShowForm(true);
  }

  function openEdit(r: IncomeRecord) {
    setEditing(r);
    const hasSchedule = r.amountSchedule && Object.keys(r.amountSchedule).length > 0;
    setValue('name', r.name);
    setValue('amount', r.amount);
    setValue('frequency', r.frequency);
    setValue('accountId', r.accountId ?? '');
    setValue('amountMode', hasSchedule ? 'byMonth' : 'uniform');
    setMonthAmounts(r.amountSchedule ?? {});
    setValue('startDate', r.startDate ? new Date(r.startDate).toISOString().split('T')[0] : '');
    setValue('endDate', r.endDate ? new Date(r.endDate).toISOString().split('T')[0] : '');
    setIsOngoing(!r.endDate);
    setValue('note', r.note ?? '');
    setValue('managementUrl', r.managementUrl ?? '');
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    reset();
  }

  function onSubmit(values: FormValues) {
    // Read amountMode from react-hook-form state directly,
    // since it's a UI-only field not in CreateIncomeSchema and gets
    // stripped by the zodResolver during validation.
    const currentAmountMode = amountMode;

    const incomeBudgetId = categories.find((c) => c.name === 'Income')?.id ?? categories[0]?.id;

    const body: Record<string, unknown> = {
      name: values.name,
      amount: Number(values.amount),
      frequency: values.frequency,
      budgetId: incomeBudgetId,
      accountId: values.accountId || undefined,
      startDate: values.startDate || undefined,
      endDate: isOngoing ? undefined : values.endDate || undefined,
      note: values.note || undefined,
      managementUrl: values.managementUrl?.trim() || undefined,
    };

    // Add amount schedule for by-month / alternating mode
    if (currentAmountMode === 'byMonth' && Object.keys(monthAmounts).length > 0) {
      body.amountSchedule = monthAmounts;
    } else {
      body.amountSchedule = null;
    }

    if (editing) {
      // A recurring edit always applies going forward: the record is updated in
      // place and the API regenerates future PENDING occurrences with the new
      // values. Past transactions are historical facts and are never rewritten
      // from here.
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
    amountMode,
    frequency,
    monthAmounts,
    setMonthAmounts,
    isOngoing,
    setIsOngoing,
    openCreate,
    openEdit,
    closeForm,
    onSubmit,
  };
}
