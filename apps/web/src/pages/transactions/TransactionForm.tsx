import {
  ButtonGroup,
  Select,
  type SelectOption,
  CurrencyInput,
  DatePicker,
  toPickerDate,
  fromPickerDate,
  ResizableTextarea,
  Modal,
  SectionHeading,
  Toggle,
  inputStyles,
  buttonStyles,
} from '@budget-tracker/ui';
import { Info } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import type { UseTransactionFormReturn } from './useTransactionForm.js';
import type { FormValues } from './transactionFormSchema.js';
import type { Account, Category, Income, NamedEntity, StockHolding } from './types.js';
import TradeFields from './TradeFields.js';
import BitcoinPaymentFields from './BitcoinPaymentFields.js';
import TransferFields from './TransferFields.js';
import FundingFields from './FundingFields.js';
import ResplitDrawer from './ResplitDrawer.js';
import PaymentMethodFields from './PaymentMethodFields.js';
import NameAutocomplete from './NameAutocomplete.js';
import { formatCurrency } from '../../lib/utils.js';
import { api } from '../../lib/api.js';
import * as dr from './transaction-form.css.js';

interface TransactionFormProps {
  form: UseTransactionFormReturn;
  accounts: Account[];
  categories: Category[];
  incomes: Income[];
  wallets: NamedEntity[];
  custodians: NamedEntity[];
  stockHoldings: StockHolding[];
  isPending: boolean;
  nameSuggestions: string[];
  hideTypeSelector?: boolean;
  title?: string;
}

const TYPE_OPTIONS = [
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'REFUND', label: 'Refund' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'INCOME', label: 'Income' },
  { value: 'TRADE', label: 'Trade' },
];

export default function TransactionForm({
  form,
  accounts,
  categories,
  incomes,
  wallets,
  custodians,
  stockHoldings,
  isPending,
  nameSuggestions,
  hideTypeSelector,
  title: titleOverride,
}: TransactionFormProps) {
  const fid = useId();
  // Budget suggestion state — must be before early return (rules of hooks)
  const lastSuggestedRef = useRef<string>('');
  const [suggestedBudgetIds, setSuggestedBudgetIds] = useState<string[]>([]);
  const handleDescriptionSelect = useCallback(
    (name: string) => {
      if (!name || form.editing) return; // Don't fetch suggestions when editing
      lastSuggestedRef.current = name;
      api.transactions
        .suggestBudget(name)
        .then((result) => {
          // Only apply if the description hasn't changed since we fired the request
          if (lastSuggestedRef.current !== name) return;
          const ids = result.suggestions.map((s) => s.budgetId);
          setSuggestedBudgetIds(ids);
          // Auto-fill budget when there's exactly one suggestion, reset to Uncategorized otherwise
          if (ids.length === 1) {
            form.setValue('budgetId', ids[0]!);
          } else {
            const uncatId = categories.find((c) => c.name === 'Uncategorized')?.id ?? '';
            form.setValue('budgetId', uncatId);
          }
        })
        .catch(() => {
          /* ignore errors — suggestions are best-effort */
        });
    },
    [form.editing, form.setValue, categories],
  );

  // Clear stale suggestions when form transitions between add/edit (inline state adjustment)
  const [prevEditing, setPrevEditing] = useState(form.editing);
  const [prevShowForm, setPrevShowForm] = useState(form.showForm);
  if (form.editing !== prevEditing || form.showForm !== prevShowForm) {
    setPrevEditing(form.editing);
    setPrevShowForm(form.showForm);
    setSuggestedBudgetIds([]);
    lastSuggestedRef.current = '';
  }

  if (!form.showForm) return null;

  // Re-splitting an existing group is a distinct, stripped-down drawer (funding
  // legs only, total fixed) — it deliberately bypasses the full add/edit form.
  if (form.isResplit) {
    return <ResplitDrawer form={form} accounts={accounts} isPending={isPending} />;
  }

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    errors,
    editing,
    isCopyAndChange,
    txType,
    watchAssetType,
    watchBitcoinUnit,
    watchPaymentMethod,
    watchBtcUnitPrice,
    watchBtcUnit,
    watchTransferType,
    watchBtcTransferFeeUnit,
    btcUsdEquivalent,
    showPaymentToggle,
    isBitcoinPayment,
    isBtcTransfer,
    isStockTransfer,
    isUsdTransfer,
    hideAmountField,
    selectedStockHolding,
    selectedStockFromCustodianName: _selectedStockFromCustodianName,
    btcTransferFeeNum: _btcTransferFeeNum,
    stockFeeNum: _stockFeeNum,
    selectedAccount,
    fundingError,
    tradeError,
    closeForm,
    onSubmit,
    watchBtcEntryMode,
  } = form;

  const title =
    titleOverride ??
    (editing ? 'Edit Transaction' : isCopyAndChange ? 'Copy & Change' : 'Add Transaction');

  // Select options
  // Rewards accounts are never picked directly — a card's rewards ride with the
  // card via the "Rewards applied" field (FundingFields), so keep them out of
  // every account picker.
  const accountOptions: SelectOption[] = accounts.reduce<SelectOption[]>((acc, a) => {
    if (!a.archived && a.type !== 'Rewards') acc.push({ value: a.id, label: a.name });
    return acc;
  }, []);
  const categoryOptions: SelectOption[] = categories.map((c) => ({
    value: c.id,
    label: `${c.icon ?? ''} ${c.name}`.trim(),
  }));
  const incomeOptions: SelectOption[] = [
    { value: '', label: 'None' },
    ...incomes.map((i) => ({ value: i.id, label: i.name })),
    ...accounts
      .filter((a) => a.earnsInterest && !a.archived)
      .map((a) => ({ value: `account:${a.id}`, label: `${a.name} (Interest)` })),
  ];

  // Reorder category options: suggested budgets first (most-used to least), separated from the rest
  const orderedCategoryOptions: SelectOption[] = (() => {
    if (suggestedBudgetIds.length === 0) return categoryOptions;
    const suggestedSet = new Set(suggestedBudgetIds);
    const suggested: SelectOption[] = [];
    const rest: SelectOption[] = [];
    for (const opt of categoryOptions) {
      if (suggestedSet.has(opt.value)) {
        suggested.push({ ...opt, group: 'Suggested' });
      } else {
        rest.push(opt);
      }
    }
    // Sort suggested by their original order (most-used first)
    const sortedSuggested = suggested.toSorted(
      (a, b) => suggestedBudgetIds.indexOf(a.value) - suggestedBudgetIds.indexOf(b.value),
    );
    return [...sortedSuggested, ...rest];
  })();

  // Form stores "YYYY-MM-DD"; the picker wants a local-midnight Date.
  const dateAsObj = toPickerDate(watch('date'));

  // Amount conversion: form stores string, CurrencyInput wants cents (integer)
  const amountStr = watch('amount');
  const amountCents = amountStr ? Math.round(parseFloat(amountStr) * 100) || 0 : 0;

  const primaryLabel = (() => {
    if (isPending && (isBtcTransfer || isStockTransfer)) return 'Transferring…';
    if (editing) return 'Save';
    switch (txType) {
      case 'EXPENSE':
        return 'Spend';
      case 'REFUND':
        return 'Receive';
      case 'TRANSFER':
        return 'Transfer';
      case 'INCOME':
        return 'Receive';
      case 'TRADE':
        return (watch('tradeDirection') ?? 'BUY') === 'BUY' ? 'Buy' : 'Sell';
      default:
        return 'Add';
    }
  })();

  // Show the total in the button.
  const amountNum = parseFloat(amountStr || '0');
  const buttonTotal = amountNum > 0 ? amountNum : null;

  const footerContent = (
    <>
      <button
        type="submit"
        form="tx-drawer-form"
        disabled={isPending || !!fundingError}
        className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
      >
        {buttonTotal !== null ? `${primaryLabel} · ${formatCurrency(buttonTotal)}` : primaryLabel}
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

  return (
    <Modal
      open={form.showForm}
      onClose={closeForm}
      title={title}
      variant="drawer"
      closeButton="none"
      footer={footerContent}
    >
      <form id="tx-drawer-form" onSubmit={handleSubmit(onSubmit)}>
        <div className={inputStyles.formStack}>
          {/* ── TRANSACTION INFORMATION ── */}
          <SectionHeading>Transaction Information</SectionHeading>

          {/* Type */}
          {!hideTypeSelector && (
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-type`} className={inputStyles.fieldLabel}>
                Type <span className={inputStyles.fieldRequired}>*</span>
              </label>
              <ButtonGroup
                id={`${fid}-type`}
                options={TYPE_OPTIONS}
                value={txType}
                onChange={(v) => setValue('type', v as FormValues['type'])}
                ariaLabel="Transaction type"
              />
            </div>
          )}

          {/* Date */}
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-date`} className={inputStyles.fieldLabel}>
              Date <span className={inputStyles.fieldRequired}>*</span>
            </label>
            <DatePicker
              id={`${fid}-date`}
              value={dateAsObj}
              onChange={(d) => setValue('date', fromPickerDate(d))}
              error={!!errors.date}
            />
            {errors.date?.message && (
              <div className={inputStyles.fieldError}>
                <Info size={12} /> {errors.date.message}
              </div>
            )}
          </div>

          {/* Description */}
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-name`} className={inputStyles.fieldLabel}>
              Description <span className={inputStyles.fieldRequired}>*</span>
            </label>
            <NameAutocomplete
              id={`${fid}-name`}
              registration={register('name')}
              setValue={setValue}
              suggestions={nameSuggestions}
              className={`${inputStyles.input} ${errors.name ? inputStyles.inputError : ''}`}
              placeholder={
                txType === 'TRADE' ? 'e.g. Buy 10 AAPL, Sell 0.5 BTC' : 'e.g. Groceries, Paycheck'
              }
              onDescriptionSelect={handleDescriptionSelect}
            />
            {errors.name?.message && (
              <div className={inputStyles.fieldError}>
                <Info size={12} />
                {errors.name.message}
              </div>
            )}
          </div>

          {/* Budget — EXPENSE and REFUND only */}
          {txType !== 'TRANSFER' && txType !== 'TRADE' && txType !== 'INCOME' && (
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-budget`} className={inputStyles.fieldLabel}>
                Budget
              </label>
              <Select
                id={`${fid}-budget`}
                searchable
                options={orderedCategoryOptions}
                value={watch('budgetId') ?? ''}
                onChange={(v) => setValue('budgetId', v)}
                placeholder="Select budget…"
              />
              {editing?.expenseId && (
                <span className={dr.helperTextWarning}>
                  Linked to recurring – changing budget updates it everywhere
                </span>
              )}
            </div>
          )}

          {/* ── PAYMENT / TRANSFER / TRADE INFORMATION ── */}
          <PaymentMethodFields
            watch={watch}
            setValue={setValue}
            errors={errors}
            txType={txType}
            editing={editing}
            showPaymentToggle={showPaymentToggle}
            watchPaymentMethod={watchPaymentMethod}
            watchTransferType={watchTransferType}
            isBitcoinPayment={isBitcoinPayment}
            isBtcTransfer={isBtcTransfer}
            isStockTransfer={isStockTransfer}
            accountOptions={accountOptions}
            selectedAccount={selectedAccount}
          />

          {/* Funding — EXPENSE (U.S. dollars): account multi-select above the
              amount(s), one account or split across several */}
          {txType === 'EXPENSE' && !isBitcoinPayment && (
            <FundingFields form={form} accountOptions={accountOptions} accounts={accounts} />
          )}
          {/* Why the funding can't be submitted (e.g. splits exceed the total).
              Without this the submit button just sits disabled with no explanation. */}
          {txType === 'EXPENSE' && !isBitcoinPayment && fundingError && (
            <div className={inputStyles.fieldError}>
              <Info size={12} /> {fundingError}
            </div>
          )}

          {/* Transfer fields — rendered before Amount so From/To appears above it */}
          {txType === 'TRANSFER' && (
            <TransferFields
              watch={watch}
              setValue={setValue}
              errors={errors}
              accounts={accounts}
              wallets={wallets}
              custodians={custodians}
              categories={categories}
              stockHoldings={stockHoldings}
              selectedStockHolding={selectedStockHolding}
              watchTransferType={watchTransferType}
              watchBtcTransferFeeUnit={watchBtcTransferFeeUnit}
              isUsdTransfer={isUsdTransfer}
              isBtcTransfer={isBtcTransfer}
              isStockTransfer={isStockTransfer}
              tradeError={tradeError}
            />
          )}

          {/* Amount — EXPENSE (U.S. dollars) renders its amount(s) inside
              FundingFields above; hidden here for it and for Bitcoin/Stock
              transfers and income+bitcoin */}
          {!hideAmountField &&
            txType !== 'TRADE' &&
            !(txType === 'EXPENSE' && !isBitcoinPayment) && (
              <div className={inputStyles.field}>
                <label htmlFor={`${fid}-amount`} className={inputStyles.fieldLabel}>
                  Amount <span className={inputStyles.fieldRequired}>*</span>
                </label>
                <CurrencyInput
                  id={`${fid}-amount`}
                  value={amountCents}
                  onChange={(cents) => setValue('amount', (cents / 100).toFixed(2))}
                  placeholder="0.00"
                />
                {errors.amount?.message && (
                  <div className={inputStyles.fieldError}>
                    <Info size={12} /> {errors.amount.message}
                  </div>
                )}
              </div>
            )}

          {/* Trade fields */}
          {txType === 'TRADE' && (
            <TradeFields
              register={register}
              watch={watch}
              setValue={setValue}
              errors={errors}
              watchAssetType={watchAssetType}
              watchBitcoinUnit={watchBitcoinUnit}
              custodians={custodians}
              wallets={wallets}
              accounts={accounts}
              tradeError={tradeError}
            />
          )}

          {/* Bitcoin payment fields */}
          {isBitcoinPayment && (
            <BitcoinPaymentFields
              watch={watch}
              setValue={setValue}
              errors={errors}
              wallets={wallets}
              watchBtcUnit={watchBtcUnit}
              watchBtcEntryMode={watchBtcEntryMode}
              watchBtcUnitPrice={watchBtcUnitPrice}
              btcUsdEquivalent={btcUsdEquivalent}
              txType={txType}
            />
          )}

          {/* Income source */}
          {txType === 'INCOME' && (
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-income`} className={inputStyles.fieldLabel}>
                Income Source
              </label>
              <Select
                id={`${fid}-income`}
                searchable
                options={incomeOptions}
                value={watch('incomeId') ?? ''}
                onChange={(v) => setValue('incomeId', v)}
                placeholder="None"
              />
            </div>
          )}

          {/* Cash back is a rebate on spending rather than money earned, so it
              is a property of the income itself — not a source you pick, and
              not a budget. Shown only for INCOME; the API refuses it on any
              other type. */}
          {txType === 'INCOME' && (
            <div className={inputStyles.field}>
              <label className={inputStyles.fieldLabel}>Rebate (Cash Back)</label>
              <Toggle
                checked={watch('isCashBack') ?? false}
                onChange={(v) => setValue('isCashBack', v)}
                label="This is a non-taxable rebate or cash back."
              />
            </div>
          )}

          {/* ── EXTRA INFORMATION ── */}
          <SectionHeading>Extra Information</SectionHeading>

          {/* Note */}
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-note`} className={inputStyles.fieldLabel}>
              Note
            </label>
            <ResizableTextarea {...register('note')} id={`${fid}-note`} resizable={false} />
          </div>
        </div>
      </form>
    </Modal>
  );
}
