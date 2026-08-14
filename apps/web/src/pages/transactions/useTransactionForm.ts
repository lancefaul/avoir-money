import { useState, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { type Transaction as CoreTransaction } from '@budget-tracker/core';
import { TransactionFormSchema, type FormValues } from './transactionFormSchema.js';
import { localToday, formatCurrency } from '../../lib/utils.js';
import { applyEditValues, applyDuplicateValues } from './transactionFormPrefill.js';
import { buildTransactionBody } from './transactionFormBody.js';
import type {
  UseTransactionFormOptions,
  UseTransactionFormReturn,
  ResplitLeg,
} from './useTransactionFormTypes.js';

// Re-export the option/return interfaces so consumers keep importing from here.
export type { UseTransactionFormOptions, UseTransactionFormReturn };

// ─── Hook Implementation ─────────────────────────────────────────────────────

export function useTransactionForm(options: UseTransactionFormOptions): UseTransactionFormReturn {
  const {
    accounts,
    categories,
    stockHoldings,
    pricesData: _pricesData,
    lastAccountId,
    createTx,
    updateTx,
    createPurchase,
    updatePurchasePayments,
    bitcoinTransferMutation,
    stockTransferMutation,
  } = options;

  const qc = useQueryClient();
  const today = localToday();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CoreTransaction | null>(null);
  const [isCopyAndChange, setIsCopyAndChange] = useState(false);
  const [tradeError, setTradeError] = useState('');

  // Multi-account funding (payment-split, ADR-030). `fundingMode` is the explicit
  // Single/Multiple toggle. `fundingAccountIds` is the account selection (one id in
  // single mode, the multi-select value in multiple). `legAmounts` holds each
  // non-remainder account's portion in cents; the remainder account (single, or the
  // last selected) auto-absorbs the rest. `rewardsAmounts` is the optional rewards
  // applied per card, funded from the card's hidden rewards account.
  const [fundingMode, setFundingMode] = useState<'single' | 'multiple'>('single');
  const [fundingAccountIds, setFundingAccountIds] = useState<string[]>([]);
  const [legAmounts, setLegAmounts] = useState<Record<string, number>>({});
  const [rewardsAmounts, setRewardsAmounts] = useState<Record<string, number>>({});

  // Re-split mode: editing an existing group's legs, with the total fixed to the
  // Anchor's amount (the endpoint rejects any sum that differs). Distinct from
  // create so the create/edit submit paths are never touched.
  const [resplitGroupId, setResplitGroupId] = useState<string | null>(null);
  const [resplitTotalCents, setResplitTotalCents] = useState(0);
  const isResplit = resplitGroupId !== null;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(TransactionFormSchema),
    defaultValues: {
      type: 'EXPENSE',
      date: today,
      tradeDirection: 'BUY',
      assetType: 'Stock',
      bitcoinUnit: 'Bitcoin',
    },
    mode: 'onBlur',
  });

  const txType = watch('type');
  const watchAccountId = watch('accountId');
  const watchAssetType = watch('assetType');
  const watchBitcoinUnit = watch('bitcoinUnit');
  const watchPaymentMethod = watch('paymentMethod');
  const watchBtcQuantity = watch('btcQuantity');
  const watchBtcUnitPrice = watch('btcUnitPrice');
  const watchBtcUnit = watch('btcUnit');
  const watchTransferType = watch('transferType');
  const watchBtcTransferFee = watch('btcTransferFee');
  const watchBtcTransferFeeUnit = watch('btcTransferFeeUnit');
  const watchStockHoldingId = watch('stockHoldingId');
  const watchStockFeeAmount = watch('stockFeeAmount');
  const watchBtcEntryMode = watch('btcEntryMode');
  const watchBtcUsdAmount = watch('btcUsdAmount');

  // Show payment method toggle only for EXPENSE, INCOME, REFUND
  const showPaymentToggle = txType === 'EXPENSE' || txType === 'INCOME' || txType === 'REFUND';
  const isBitcoinPayment = showPaymentToggle && watchPaymentMethod === 'bitcoin';

  // Transfer type helpers
  const isTransfer = txType === 'TRANSFER';
  const isBtcTransfer = isTransfer && watchTransferType === 'bitcoin';
  const isStockTransfer = isTransfer && watchTransferType === 'stock';
  const isUsdTransfer = isTransfer && watchTransferType === 'usd';
  const hideAmountField = isBtcTransfer || isStockTransfer || isBitcoinPayment;
  const stockHoldingsFiltered = stockHoldings.filter((h) => h.type === 'STOCK');
  const selectedStockHolding = stockHoldingsFiltered.find((h) => h.id === watchStockHoldingId);
  const selectedStockFromCustodian = selectedStockHolding?.custodianId ?? null;
  const selectedStockFromCustodianName = selectedStockHolding?.custodianName ?? '';
  const btcTransferFeeNum = parseFloat(watchBtcTransferFee || '0');
  const stockFeeNum = parseFloat(watchStockFeeAmount || '0');

  // Compute USD equivalent in real time (works in both entry modes)
  const btcUsdEquivalent = useMemo(() => {
    if (watchBtcEntryMode === 'usdEquivalent') {
      const usd = parseFloat(watchBtcUsdAmount || '');
      if (isNaN(usd) || usd <= 0) return null;
      return usd;
    }
    const qty = parseFloat(watchBtcQuantity || '');
    const price = parseFloat(watchBtcUnitPrice || '');
    if (isNaN(qty) || isNaN(price) || qty <= 0 || price <= 0) return null;
    const btcQty = watchBtcUnit === 'Sats' ? qty / 100_000_000 : qty;
    return btcQty * price;
  }, [watchBtcQuantity, watchBtcUnitPrice, watchBtcUnit, watchBtcEntryMode, watchBtcUsdAmount]);

  // Back-calculate unitPrice when in USD Equivalent mode
  useEffect(() => {
    if (watchBtcEntryMode !== 'usdEquivalent') return;
    const usd = parseFloat(watchBtcUsdAmount || '');
    const qty = parseFloat(watchBtcQuantity || '');
    if (isNaN(usd) || isNaN(qty) || usd <= 0 || qty <= 0) return;
    const btcQty = watchBtcUnit === 'Sats' ? qty / 100_000_000 : qty;
    const calculatedPrice = usd / btcQty;
    setValue('btcUnitPrice', String(calculatedPrice));
  }, [watchBtcEntryMode, watchBtcUsdAmount, watchBtcQuantity, watchBtcUnit, setValue]);

  // Reset payment method to 'account' when switching to TRADE or TRANSFER
  // and ensure transferType defaults to 'usd' when switching TO TRANSFER
  useEffect(() => {
    if (txType === 'TRADE' || txType === 'TRANSFER') {
      setValue('paymentMethod', 'account');
    }
    if (txType === 'TRANSFER') {
      setValue('transferType', 'usd');
    }
  }, [txType, setValue]);

  // NOTE: Bitcoin unit price is never prefilled — market price is stale
  // and would almost certainly be wrong at the time of the actual transaction.

  const selectedAccount = accounts.find((a) => a.id === watchAccountId);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  // The rewards child account for a card (ADR-030), or undefined if it has none.
  function rewardsAccountFor(cardId: string) {
    return accounts.find((a) => a.type === 'Rewards' && a.parentAccountId === cardId);
  }

  // Credit cards are debt — they can go negative, so a charge is never capped.
  // Every other account holds finite money and a spend can't exceed its balance.
  // Returns the spendable cents, or null when there is no cap (a credit card).
  function availableCents(accountId: string): number | null {
    const a = accountById.get(accountId);
    if (!a || a.type === 'Credit Card') return null;
    return Math.max(0, Math.round((a.balance ?? 0) * 100));
  }

  // Rewards total (create only). Rewards are an optional extra leg funded from a
  // card's hidden rewards account.
  const rewardsTotalCents = isResplit
    ? 0
    : Object.values(rewardsAmounts).reduce((s, n) => s + n, 0);

  // Sum of the per-account leg amounts (Multiple mode and re-split).
  const legsSumCents = fundingAccountIds.reduce((s, id) => s + (legAmounts[id] ?? 0), 0);

  // The Amount the user typed (Single mode's total / the ordinary amount field).
  const singleAmountCents = Math.round(parseFloat(watch('amount') || '0') * 100) || 0;

  // The purchase total. Single: the typed Amount. Multiple: the sum of the
  // per-account legs plus any rewards. Re-split: the group's fixed total.
  const totalCents = isResplit
    ? resplitTotalCents
    : fundingMode === 'multiple'
      ? legsSumCents + rewardsTotalCents
      : singleAmountCents;

  // While splitting on create, mirror the form `amount` to the derived total so the
  // schema, the submit-button total, and the Anchor amount all agree.
  useEffect(() => {
    if (!isResplit && fundingMode === 'multiple') {
      setValue('amount', (totalCents / 100).toFixed(2));
    }
  }, [isResplit, fundingMode, totalCents, setValue]);

  // The payment legs this funding produces (payment-split, ADR-030). Single mode:
  // the card pays the Amount less any rewards, and rewards fund the rest. Multiple
  // mode / re-split: one leg per account, as typed. Rewards are their own legs.
  // Zero legs are dropped. One leg is an ordinary transaction; two or more a group.
  function buildFundingPayments(): { accountId: string; amount: number }[] {
    const payments: { accountId: string; amount: number }[] = [];
    if (isResplit || fundingMode === 'multiple') {
      for (const id of fundingAccountIds) {
        const cents = legAmounts[id] ?? 0;
        if (cents > 0) payments.push({ accountId: id, amount: cents / 100 });
      }
    } else {
      const single = fundingAccountIds[0] ?? '';
      const cardCents = singleAmountCents - rewardsTotalCents;
      if (single && cardCents > 0) payments.push({ accountId: single, amount: cardCents / 100 });
    }
    if (!isResplit) {
      for (const [cardId, cents] of Object.entries(rewardsAmounts)) {
        const rw = rewardsAccountFor(cardId);
        if (rw && cents > 0) payments.push({ accountId: rw.id, amount: cents / 100 });
      }
    }
    return payments;
  }

  // A purchase group (vs. an ordinary single-account transaction) once the funding
  // produces two or more legs — a split, a rewards redemption, or both.
  const isSplit = buildFundingPayments().length >= 2;

  // Why the create funding can't be submitted yet, or null when valid. Per-leg
  // overdraw is handled by the input clamps; the only cross-field rule is that
  // rewards can't exceed the Amount in Single mode (the card leg would go negative).
  const fundingError = useMemo<string | null>(() => {
    if (txType !== 'EXPENSE' || watchPaymentMethod === 'bitcoin' || isResplit) return null;
    if (fundingMode === 'single' && singleAmountCents > 0 && rewardsTotalCents > singleAmountCents)
      return 'Rewards Points Used can’t exceed the amount';
    return null;
  }, [txType, watchPaymentMethod, isResplit, fundingMode, singleAmountCents, rewardsTotalCents]);

  // Re-split validity: at least two accounts (collapsing to one is a delete) and
  // the legs summing to the group's fixed total.
  const resplitError = useMemo<string | null>(() => {
    if (!isResplit) return null;
    if (fundingAccountIds.length < 2) return 'A split needs at least two accounts';
    if (legsSumCents !== resplitTotalCents)
      return `Legs must sum to the purchase total ${formatCurrency(resplitTotalCents / 100)} (currently ${formatCurrency(legsSumCents / 100)})`;
    return null;
  }, [isResplit, fundingAccountIds, legsSumCents, resplitTotalCents]);

  // Replace the funding account selection. Keeps the primary `accountId` (the
  // schema's account field) as the first selection, re-clamps preserved leg amounts
  // to still-selected accounts, and prunes rewards to selected cards.
  function setFundingAccounts(ids: string[]) {
    setFundingAccountIds(ids);
    const primary = ids[0] ?? '';
    setValue('accountId', primary);
    setLegAmounts((prev) => {
      const next: Record<string, number> = {};
      for (const id of ids) {
        const cap = availableCents(id);
        const preserved = prev[id] ?? 0;
        next[id] = cap == null ? preserved : Math.min(preserved, cap);
      }
      return next;
    });
    setRewardsAmounts((prev) => {
      const next: Record<string, number> = {};
      for (const id of ids) if (rewardsAccountFor(id) && prev[id]) next[id] = prev[id];
      return next;
    });
    // Single mode: re-clamp the form `amount` to the new account's cap so switching
    // from a credit card (no cap) to a finite account can't leave an amount above
    // the new balance.
    if (fundingMode === 'single' && primary) {
      const cap = availableCents(primary);
      if (cap != null) {
        const curCents = Math.round(parseFloat(watch('amount') || '0') * 100) || 0;
        if (curCents > cap) setValue('amount', (cap / 100).toFixed(2));
      }
    }
  }

  // Set one account's portion, clamped so a finite account can never be overdrawn.
  function setLegAmount(accountId: string, cents: number) {
    const cap = availableCents(accountId);
    const clamped = cap == null ? Math.max(0, cents) : Math.min(Math.max(0, cents), cap);
    setLegAmounts((prev) => ({ ...prev, [accountId]: clamped }));
  }

  // Set a card's rewards applied, clamped to that card's rewards balance.
  function setRewardsAmount(cardId: string, cents: number) {
    const rw = rewardsAccountFor(cardId);
    const cap = rw ? Math.max(0, Math.round((rw.balance ?? 0) * 100)) : 0;
    setRewardsAmounts((prev) => ({ ...prev, [cardId]: Math.min(Math.max(0, cents), cap) }));
  }

  // Switch funding mode (create flow). Collapsing to Single keeps the first account
  // and drops the rest and their leg amounts; expanding keeps the current pick.
  function switchFundingMode(mode: 'single' | 'multiple') {
    setFundingMode(mode);
    if (mode === 'single') {
      const first = fundingAccountIds[0] ?? '';
      setFundingAccountIds(first ? [first] : []);
      setValue('accountId', first);
      setLegAmounts({});
      setRewardsAmounts((prev) => (first && prev[first] ? { [first]: prev[first] } : {}));
    }
  }

  // A split only exists for a U.S.-dollar EXPENSE. Leaving that context (Bitcoin
  // payment, or any other type) collapses back to a single account so a stale split
  // can't be submitted for a transaction that can't have one.
  useEffect(() => {
    if ((txType !== 'EXPENSE' || watchPaymentMethod === 'bitcoin') && fundingMode === 'multiple') {
      setFundingMode('single');
      const first = fundingAccountIds[0] ?? '';
      setFundingAccountIds(first ? [first] : []);
      setLegAmounts({});
      setRewardsAmounts({});
    }
  }, [txType, watchPaymentMethod, fundingMode, fundingAccountIds]);

  const uncategorizedId = categories.find((c) => c.name === 'Uncategorized')?.id ?? '';

  function openCreate(defaultType?: FormValues['type']) {
    setEditing(null);
    setIsCopyAndChange(false);
    setTradeError('');
    // Default to Single funding on the last-used account.
    setFundingMode('single');
    setFundingAccountIds(lastAccountId ? [lastAccountId] : []);
    setLegAmounts({});
    setRewardsAmounts({});
    reset({
      type: defaultType ?? 'EXPENSE',
      date: today,
      name: '',
      amount: '',
      accountId: lastAccountId ?? '',
      budgetId: uncategorizedId,
      incomeId: '',
      isCashBack: false,
      toAccountId: '',
      note: '',
      tradeDirection: 'BUY',
      assetType: 'Stock',
      bitcoinUnit: 'Bitcoin',
      ticker: '',
      unitPrice: '',
      tradeQuantity: '',
      custodianId: '',
      walletId: '',
      paymentMethod: 'account',
      btcQuantity: '',
      btcUnit: 'Bitcoin',
      btcUnitPrice: '',
      btcWalletId: '',
      btcEntryMode: 'unitPrice',
      btcUsdAmount: '',
      btcIncomeType: 'Payment',
      transferType: 'usd',
      btcFromWalletId: '',
      btcToWalletId: '',
      btcTransferQuantity: '',
      btcTransferUnit: 'Bitcoin',
      btcTransferFee: '',
      btcTransferFeeUnit: undefined,
      btcTransferPrice: '',
      stockHoldingId: '',
      stockToCustodianId: '',
      stockFeeAmount: '',
      stockFeeAccountId: '',
      stockFeeBudgetId: '',
    });
    setShowForm(true);
  }

  function openEdit(tx: CoreTransaction) {
    setEditing(tx);
    setIsCopyAndChange(false);
    applyEditValues(setValue, tx);
    // Editing an ordinary transaction shows its single account; a group's legs
    // are edited from its collapsed row, not the drawer.
    setFundingMode('single');
    setFundingAccountIds(tx.accountId ? [tx.accountId] : []);
    setLegAmounts({});
    setRewardsAmounts({});

    setShowForm(true);
  }

  function openDuplicate(tx: CoreTransaction) {
    setEditing(null);
    setIsCopyAndChange(true);
    setTradeError('');
    applyDuplicateValues(setValue, tx, today);
    setFundingMode('single');
    setFundingAccountIds(tx.accountId ? [tx.accountId] : []);
    setLegAmounts({});
    setRewardsAmounts({});
    setShowForm(true);
  }

  // Re-split an existing group: pre-load the current legs, fix the total to the
  // Anchor's amount, and show the drawer in re-split mode. Budget/name/date are
  // not editable here — the endpoint only replaces legs.
  function openResplit(anchor: CoreTransaction, legs: ResplitLeg[]) {
    setEditing(null);
    setIsCopyAndChange(false);
    setTradeError('');
    setResplitGroupId(anchor.purchaseGroupId ?? null);
    const anchorTotalCents = Math.round(Number(anchor.amount) * 100);
    setResplitTotalCents(anchorTotalCents);
    const ids = legs.map((l) => l.accountId);
    setFundingMode('multiple');
    setFundingAccountIds(ids);
    setLegAmounts(Object.fromEntries(legs.map((l) => [l.accountId, l.amountCents])));
    setRewardsAmounts({});
    reset({
      type: 'EXPENSE',
      date: today,
      name: anchor.name,
      amount: (anchorTotalCents / 100).toFixed(2),
      accountId: ids[0] ?? '',
      budgetId: anchor.budgetId ?? uncategorizedId,
      note: anchor.note ?? '',
      paymentMethod: 'account',
      tradeDirection: 'BUY',
      assetType: 'Stock',
      bitcoinUnit: 'Bitcoin',
    });
    setShowForm(true);
  }

  function submitResplit() {
    if (!resplitGroupId || resplitError) return;
    const payments = fundingAccountIds.map((id) => ({
      accountId: id,
      amount: (legAmounts[id] ?? 0) / 100,
    }));
    updatePurchasePayments.mutate(
      { groupId: resplitGroupId, body: { payments } },
      { onSuccess: () => closeForm() },
    );
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setIsCopyAndChange(false);
    setTradeError('');
    setFundingMode('single');
    setFundingAccountIds([]);
    setLegAmounts({});
    setRewardsAmounts({});
    setResplitGroupId(null);
    setResplitTotalCents(0);
    reset();
  }

  function onSubmit(values: FormValues) {
    if (values.type === 'TRANSFER' && values.transferType === 'usd' && !values.toAccountId) return;

    // Bitcoin transfer — route to investment transfer API
    if (values.type === 'TRANSFER' && values.transferType === 'bitcoin') {
      const fee = parseFloat(values.btcTransferFee || '0');
      const body: Record<string, unknown> = {
        fromWalletId: values.btcFromWalletId,
        toWalletId: values.btcToWalletId,
        quantity: parseFloat(values.btcTransferQuantity || '0'),
        bitcoinUnit: values.btcTransferUnit,
      };
      if (fee > 0) {
        body.feeAmount = fee;
        body.feeUnit = values.btcTransferFeeUnit;
        if (values.btcTransferFeeUnit !== 'USD') {
          body.bitcoinPrice = parseFloat(values.btcTransferPrice || '0');
        }
      }
      bitcoinTransferMutation.mutate(body, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ['investment-history'] });
          qc.invalidateQueries({ queryKey: ['investments'] });
          qc.invalidateQueries({ queryKey: ['transactions'] });
          closeForm();
        },
        onError: (err) => setTradeError(err instanceof Error ? err.message : String(err)),
      });
      return;
    }

    // Stock transfer — route to investment transfer API
    if (values.type === 'TRANSFER' && values.transferType === 'stock') {
      const fee = parseFloat(values.stockFeeAmount || '0');
      const body: Record<string, unknown> = {
        fromCustodianId: selectedStockFromCustodian,
        toCustodianId: values.stockToCustodianId,
        holdingId: values.stockHoldingId,
      };
      if (fee > 0) {
        body.feeAmount = fee;
        body.feeAccountId = values.stockFeeAccountId;
        body.feeBudgetId = values.stockFeeBudgetId;
      }
      stockTransferMutation.mutate(body, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ['investment-history'] });
          qc.invalidateQueries({ queryKey: ['investments'] });
          qc.invalidateQueries({ queryKey: ['transactions'] });
          closeForm();
        },
        onError: (err) => setTradeError(err instanceof Error ? err.message : String(err)),
      });
      return;
    }

    // Multi-leg funding → a purchase group (payment-split, ADR-030): a split, a
    // rewards redemption, or both. A single leg falls through to the ordinary
    // create path below. Only for a brand-new U.S.-dollar EXPENSE; a group's later
    // edits are made from its collapsed row, never re-derived here.
    if (!editing && values.type === 'EXPENSE' && values.paymentMethod !== 'bitcoin') {
      const payments = buildFundingPayments();
      if (payments.length >= 2) {
        if (fundingError) return; // the submit button is disabled in this state
        createPurchase.mutate(
          {
            name: values.name,
            date: new Date(values.date),
            amount: totalCents / 100,
            budgetId: values.budgetId || uncategorizedId || null,
            note: values.note || null,
            payments,
          },
          { onSuccess: () => closeForm() },
        );
        return;
      }
    }

    if (editing && editing.expenseId && values.budgetId && values.budgetId !== editing.budgetId) {
      if (
        !confirm(
          'This transaction is linked to a recurring expense. Changing the category will update it on the recurring expense and all its transactions. Continue?',
        )
      )
        return;
    }

    const cleanBody = buildTransactionBody(values, {
      editing,
      uncategorizedId,
      incomeBudgetId: categories.find((c) => c.name === 'Income')?.id,
    });

    const afterSuccess = () => {
      closeForm();
    };

    const extractError = (err: unknown): string => {
      if (err instanceof Error) {
        // ApiValidationError wraps Zod errors — show a simpler message
        if (err.name === 'ApiValidationError') return 'Invalid response from server';
        return err.message;
      }
      return String(err);
    };

    if (editing)
      updateTx.mutate(
        { id: editing.id, body: cleanBody },
        {
          onSuccess: () => {
            afterSuccess();
          },
          onError: (err) => {
            if (values.type === 'TRADE') setTradeError(extractError(err));
          },
        },
      );
    else
      createTx.mutate(cleanBody, {
        onSuccess: () => {
          afterSuccess();
        },
        onError: (err) => {
          if (values.type === 'TRADE') setTradeError(extractError(err));
        },
      });
  }

  return {
    // React Hook Form
    register,
    handleSubmit,
    watch,
    setValue,
    errors,

    // Form visibility state
    showForm,
    editing,

    // Watched values
    txType,
    watchAccountId,
    watchAssetType,
    watchBitcoinUnit,
    watchPaymentMethod,
    watchBtcQuantity,
    watchBtcUnitPrice,
    watchBtcUnit,
    watchTransferType,
    watchBtcTransferFee,
    watchBtcTransferFeeUnit,
    watchStockHoldingId,
    watchStockFeeAmount,
    watchBtcEntryMode,
    watchBtcUsdAmount,

    // Computed values
    btcUsdEquivalent,
    showPaymentToggle,
    isBitcoinPayment,
    isTransfer,
    isBtcTransfer,
    isStockTransfer,
    isUsdTransfer,
    hideAmountField,
    selectedStockHolding,
    selectedStockFromCustodianName,
    btcTransferFeeNum,
    stockFeeNum,
    selectedAccount,

    // Funding split state
    fundingMode,
    fundingAccountIds,
    legAmounts,
    rewardsAmounts,
    isSplit,
    fundingError,
    switchFundingMode,
    setFundingAccounts,
    setLegAmount,
    setRewardsAmount,
    rewardsAccountFor,
    availableCents,

    // Re-split mode
    isResplit,
    resplitTotalCents,
    resplitError,

    // Trade error state
    tradeError,

    // Copy & Change state
    isCopyAndChange,

    // Actions
    openCreate,
    openEdit,
    openDuplicate,
    openResplit,
    closeForm,
    onSubmit,
    submitResplit,
  };
}
