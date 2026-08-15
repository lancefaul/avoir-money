import { useCallback, useState, useId } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Info } from 'lucide-react';
import { useCreateBudgetItem, useUpdateBudgetItem } from '../../hooks/useBudgetItems.js';
import { useCreateBudget, useUpdateBudget } from '../../hooks/useBudgets.js';
import {
  useBudgetLinks,
  useBulkLinkExpenses,
  useUnlinkExpense,
} from '../../hooks/useBudgetLinks.js';
import LinkExpensesSection from './LinkExpensesSection.js';
import LinkedExpensesPanel from './LinkedExpensesPanel.js';
import {
  Modal,
  Select,
  CurrencyInput,
  Toggle,
  EmojiPicker,
  SectionHeading,
  inputStyles,
  buttonStyles,
  type SelectOption,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import {
  type CategoryFormProps,
  type CategoryFormValues,
  FREQUENCY_OPTIONS,
  MONTH_OPTIONS,
  categoryFormSchema,
} from './budgetItemFormSchema.js';
import { useLinkedBaseline } from './useLinkedBaseline.js';

// ─── Component ───

export default function BudgetItemForm({
  editing,
  budgetData,
  groups,
  yearPlanId,
  onClose,
  onSave,
}: CategoryFormProps) {
  const fid = useId();
  const isEdit = editing !== null;

  const createCategory = useCreateBudgetItem();
  const updateCategory = useUpdateBudgetItem();
  const createBudget = useCreateBudget();
  const updateBudget = useUpdateBudget();
  const bulkLink = useBulkLinkExpenses();
  const unlinkExpense = useUnlinkExpense();

  const currentMonth = new Date().getMonth() + 1;

  // Staged link/unlink changes
  const [stagedLinks, setStagedLinks] = useState<Set<string>>(new Set());
  const [stagedUnlinks, setStagedUnlinks] = useState<Set<string>>(new Set());
  const [doneForYear, setDoneForYear] = useState(budgetData?.doneForYear ?? false);

  const toggleStagedLink = useCallback((expenseId: string) => {
    setStagedLinks((prev) => {
      const next = new Set(prev);
      if (next.has(expenseId)) next.delete(expenseId);
      else next.add(expenseId);
      return next;
    });
  }, []);

  const stageUnlink = useCallback((linkId: string) => {
    setStagedUnlinks((prev) => new Set(prev).add(linkId));
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      emoji: editing?.icon ?? '',
      name: editing?.name ?? '',
      groupId: editing?.groupId ?? groups[0]?.id ?? '',
      trackOnly: budgetData?.version?.amount === 0,
      amount:
        budgetData?.version?.amount === 0 ? undefined : (budgetData?.version?.amount ?? undefined),
      frequency:
        (budgetData?.version?.frequency === 'YEARLY' ? 'ANNUAL' : budgetData?.version?.frequency) ??
        'MONTHLY',
      effectiveMonth: budgetData?.version?.effectiveDate
        ? new Date(budgetData.version.effectiveDate).getUTCMonth() + 1
        : currentMonth,
      seasonal: (budgetData?.version?.activeMonths ?? []).length > 0,
      activeMonths: budgetData?.version?.activeMonths ?? [],
    },
  });

  const trackOnly = watch('trackOnly');
  const currentAmount = watch('amount');
  const frequency = watch('frequency');
  const seasonal = watch('seasonal');
  const activeMonths = watch('activeMonths') ?? [];

  // Baseline tracking for linked expenses (state + derivation extracted to a hook)
  const {
    derivedBaseline,
    hasUserEdited,
    handleBaselineChange,
    handleStagedBaselineChange,
    handleResetToDerived,
  } = useLinkedBaseline({
    frequency,
    currentAmount,
    setAmount: (value, shouldValidate) =>
      setValue('amount', value, shouldValidate ? { shouldValidate: true } : undefined),
    initialManualOverride: budgetData?.version?.manualOverride ?? false,
  });

  const { data: linkedExpenses } = useBudgetLinks(budgetData?.id ?? undefined);
  const hasLinkedExpenses = (linkedExpenses ?? []).length > 0 || stagedLinks.size > 0;

  const isManualOverride =
    hasLinkedExpenses &&
    derivedBaseline !== null &&
    currentAmount !== undefined &&
    !Number.isNaN(currentAmount) &&
    Math.round(currentAmount * 100) !== Math.round(derivedBaseline * 100);

  // ─── Submit ───

  const onSubmit = async (values: CategoryFormValues) => {
    if (
      yearPlanId &&
      !values.trackOnly &&
      (!values.amount || isNaN(values.amount) || values.amount <= 0)
    ) {
      setError('amount', { message: 'Enter a budget amount or enable track only' });
      return;
    }

    let categoryId = editing?.id;

    try {
      if (isEdit && categoryId) {
        await updateCategory.mutateAsync({
          id: categoryId,
          body: { name: values.name, groupId: values.groupId, icon: values.emoji || undefined },
        });
      } else {
        const created = await createCategory.mutateAsync({
          name: values.name,
          groupId: values.groupId,
          icon: values.emoji || undefined,
        });
        categoryId = (created as { id: string }).id;
      }
    } catch (err) {
      console.warn('[BudgetItemForm] Failed to create/update budget item', err);
      return;
    }

    const finalAmount = values.trackOnly ? 0 : values.amount;
    if (finalAmount !== undefined && yearPlanId && categoryId) {
      const budgetPayload = {
        amount: finalAmount,
        frequency: values.trackOnly ? ('MONTHLY' as const) : values.frequency,
        effectiveMonth: values.trackOnly ? currentMonth : values.effectiveMonth,
        activeMonths:
          !values.trackOnly &&
          values.seasonal &&
          values.activeMonths &&
          values.activeMonths.length > 0
            ? values.activeMonths
            : [],
        ...(hasLinkedExpenses && derivedBaseline !== null
          ? {
              manualOverride:
                Math.round((finalAmount ?? 0) * 100) !== Math.round(derivedBaseline * 100),
            }
          : {}),
        ...(budgetData?.id ? { doneForYear } : {}),
      };

      try {
        if (budgetData?.id) {
          await updateBudget.mutateAsync({ id: budgetData.id, body: budgetPayload });
        } else {
          await createBudget.mutateAsync({ yearPlanId, budgetId: categoryId, ...budgetPayload });
        }
      } catch (err) {
        console.warn('[BudgetItemForm] Failed to create/update budget allocation', err);
        return;
      }
    }

    try {
      if (budgetData?.id) {
        if (stagedLinks.size > 0) {
          await bulkLink.mutateAsync({
            categoryBudgetId: budgetData.id,
            expenseIds: Array.from(stagedLinks),
          });
        }
        if (stagedUnlinks.size > 0) {
          await Promise.all(
            Array.from(stagedUnlinks).map((linkId) =>
              unlinkExpense.mutateAsync({ categoryBudgetId: budgetData.id, linkId }),
            ),
          );
        }
      }
    } catch (err) {
      console.warn('[BudgetItemForm] Failed to commit link/unlink changes', err);
    }

    onSave();
  };

  // ─── Select options ───

  const groupOptions: SelectOption[] = groups.map((g) => ({ value: g.id, label: g.name }));

  // Amount conversion for CurrencyInput (cents)
  const amountCents = currentAmount ? Math.round(currentAmount * 100) : 0;

  // ─── Footer ───

  const footerContent = (
    <>
      <button
        type="submit"
        form="budget-drawer-form"
        disabled={isSubmitting}
        className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
      >
        {isSubmitting ? 'Saving…' : isEdit ? 'Save' : 'Add'}
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

  // ─── Render ───

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit Budget' : 'Add Budget'}
      variant="drawer"
      closeButton="none"
      footer={footerContent}
    >
      <form id="budget-drawer-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className={inputStyles.formStack}>
          {/* ── BUDGET INFORMATION ── */}
          <SectionHeading>Budget Information</SectionHeading>

          {/* Emoji */}
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Icon</label>
            <Controller
              name="emoji"
              control={control}
              render={({ field }) => (
                <EmojiPicker value={field.value ?? ''} onChange={field.onChange} />
              )}
            />
            {errors.emoji?.message && (
              <div className={inputStyles.fieldError}>
                <Info size={12} /> {errors.emoji.message}
              </div>
            )}
          </div>

          {/* Name */}
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-name`} className={inputStyles.fieldLabel}>
              Name <span className={inputStyles.fieldRequired}>*</span>
            </label>
            <input
              id={`${fid}-name`}
              type="text"
              placeholder="e.g. Groceries"
              className={`${inputStyles.input} ${errors.name ? inputStyles.inputError : ''}`}
              {...register('name')}
            />
            {errors.name?.message && (
              <div className={inputStyles.fieldError}>
                <Info size={12} /> {errors.name.message}
              </div>
            )}
          </div>

          {/* Group */}
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-group`} className={inputStyles.fieldLabel}>
              Group <span className={inputStyles.fieldRequired}>*</span>
            </label>
            <Select
              id={`${fid}-group`}
              options={groupOptions}
              value={watch('groupId')}
              onChange={(v) => setValue('groupId', v)}
              placeholder="Select group…"
            />
            {errors.groupId?.message && (
              <div className={inputStyles.fieldError}>
                <Info size={12} /> {errors.groupId.message}
              </div>
            )}
          </div>

          {/* ── ALLOCATION ── */}
          {yearPlanId ? (
            <>
              <SectionHeading>Allocation</SectionHeading>

              {/* Track Only */}
              <div className={inputStyles.field}>
                <label className={inputStyles.fieldLabel}>Allocation limit</label>
                <Toggle
                  label="This budget does not have a limit"
                  checked={trackOnly}
                  onChange={(v) => setValue('trackOnly', v)}
                />
              </div>

              {/* Budget fields — hidden when track only */}
              {!trackOnly && (
                <>
                  {/* Amount */}
                  <div className={inputStyles.field}>
                    <label htmlFor={`${fid}-amount`} className={inputStyles.fieldLabel}>
                      Amount <span className={inputStyles.fieldRequired}>*</span>
                    </label>
                    <CurrencyInput
                      id={`${fid}-amount`}
                      value={amountCents}
                      onChange={(cents) => {
                        hasUserEdited.current = true;
                        setValue('amount', cents / 100);
                      }}
                      placeholder="0.00"
                    />
                    {isManualOverride && (
                      <button
                        type="button"
                        onClick={handleResetToDerived}
                        className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnSecondary}`}
                      >
                        Reset
                      </button>
                    )}
                    {errors.amount?.message && (
                      <div className={inputStyles.fieldError}>
                        <Info size={12} /> {errors.amount.message}
                      </div>
                    )}
                  </div>

                  {/* Frequency */}
                  <div className={inputStyles.field}>
                    <label htmlFor={`${fid}-freq`} className={inputStyles.fieldLabel}>
                      Frequency
                    </label>
                    <Select
                      id={`${fid}-freq`}
                      options={FREQUENCY_OPTIONS}
                      value={frequency}
                      onChange={(v) => setValue('frequency', v as CategoryFormValues['frequency'])}
                    />
                  </div>

                  {/* Effective Month */}
                  <div className={inputStyles.field}>
                    <label htmlFor={`${fid}-eff-month`} className={inputStyles.fieldLabel}>
                      Effective Month
                    </label>
                    <Select
                      id={`${fid}-eff-month`}
                      options={MONTH_OPTIONS}
                      value={String(watch('effectiveMonth'))}
                      onChange={(v) => setValue('effectiveMonth', Number(v))}
                    />
                  </div>

                  {/* Seasonal */}
                  <div className={inputStyles.field}>
                    <label className={inputStyles.fieldLabel}>Seasonal</label>
                    <Toggle
                      label="This budget is seasonal"
                      checked={seasonal}
                      onChange={(v) => {
                        setValue('seasonal', v);
                        if (!v) setValue('activeMonths', []);
                      }}
                    />
                  </div>

                  {/* Active Months */}
                  {seasonal && (
                    <div className={inputStyles.field}>
                      <label className={inputStyles.fieldLabel}>Active Months</label>
                      <Select
                        multi
                        options={MONTH_OPTIONS}
                        value={activeMonths.map(String)}
                        onChange={(vals) =>
                          setValue('activeMonths', vals.map(Number), { shouldValidate: true })
                        }
                        placeholder="Select months…"
                        aria-label="Active months"
                      />
                    </div>
                  )}
                </>
              )}

              {/* Link Expenses — available when editing an existing budget */}
              {budgetData?.id && editing?.id && (
                <>
                  <SectionHeading>Linked Expenses</SectionHeading>
                  <LinkExpensesSection
                    budgetId={editing.id}
                    categoryBudgetId={budgetData.id}
                    stagedLinks={stagedLinks}
                    onToggle={toggleStagedLink}
                    onStagedBaselineChange={handleStagedBaselineChange}
                    budgetFrequency={frequency}
                  />
                  <LinkedExpensesPanel
                    categoryBudgetId={budgetData.id}
                    highWaterMark={budgetData.highWaterMark ?? 0}
                    stagedUnlinks={stagedUnlinks}
                    onUnlink={stageUnlink}
                    onBaselineChange={handleBaselineChange}
                    budgetFrequency={frequency}
                  />
                </>
              )}

              {/* Done for the year — annual unlinked budgets only */}
              {budgetData?.id && budgetData.linkedExpenseCount === 0 && frequency === 'ANNUAL' && (
                <div className={inputStyles.field}>
                  <Toggle
                    label="Done for the year"
                    checked={doneForYear}
                    onChange={setDoneForYear}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <SectionHeading>Allocation</SectionHeading>
              <div
                style={{
                  padding: `${vars.space['3']} ${vars.space['4']}`,
                  borderRadius: vars.radius.md,
                  border: `${vars.border.thin} solid ${vars.color.border}`,
                  background: vars.color.surfaceRaised,
                }}
              >
                <p style={{ fontSize: vars.font.sm, color: vars.color.textSecondary }}>
                  Create a year plan to add budgets.
                </p>
              </div>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
