import { type Transaction as CoreTransaction } from '@budget-tracker/core';
import { type FormValues } from './transactionFormSchema.js';

export interface BuildTransactionBodyContext {
  editing: CoreTransaction | null;
  uncategorizedId: string;
  /** Budget id for the system "Income" budget (INCOME transactions are pinned to it). */
  incomeBudgetId: string | undefined;
}

/**
 * Assemble the create/update request body from validated form values —
 * extracted verbatim from useTransactionForm's onSubmit. Pure: no React state.
 */
export function buildTransactionBody(
  values: FormValues,
  ctx: BuildTransactionBodyContext,
): Record<string, unknown> {
  const amt = parseFloat(values.amount);
  const { editing, uncategorizedId, incomeBudgetId } = ctx;

  const body: Record<string, unknown> = {
    type: values.type,
    name: values.name,
    amount: amt,
    date: values.date,
    accountId: values.accountId,
    budgetId: values.budgetId || uncategorizedId || null,
  };
  if (values.type === 'EXPENSE' || values.type === 'REFUND') {
    body.incomeId = null;
    body.toAccountId = null;
    body.isCashBack = false;
    if (editing?.expenseId) body.expenseId = editing.expenseId;
  } else if (values.type === 'INCOME') {
    const rawIncomeId = values.incomeId || null;
    body.incomeId = rawIncomeId && rawIncomeId.startsWith('account:') ? null : rawIncomeId;
    body.expenseId = null;
    body.toAccountId = null;
    body.budgetId = incomeBudgetId;
    // Only ever sent on INCOME — the API refuses the flag on any other type,
    // and an editor switching type away from Income must clear it rather than
    // leave a flag behind on a row that cannot mean it.
    body.isCashBack = values.isCashBack ?? false;
  } else {
    body.toAccountId = values.toAccountId || null;
    body.expenseId = null;
    body.incomeId = null;
    body.isCashBack = false;
  }
  body.note = values.note || null;

  // Assemble tradeMetadata for TRADE type
  if (values.type === 'TRADE') {
    const meta: Record<string, unknown> = {
      direction: values.tradeDirection,
      assetType: values.assetType,
      unitPrice: parseFloat(values.unitPrice || '0'),
      quantity: parseFloat(values.tradeQuantity || '0'),
    };
    if (values.assetType === 'Stock') {
      meta.ticker = values.ticker;
      meta.custodianId = values.custodianId;
      // Compute amount from unitPrice * quantity for stock trades
      body.amount = (meta.unitPrice as number) * (meta.quantity as number);
    } else {
      meta.walletId = values.walletId;
      meta.bitcoinUnit = values.bitcoinUnit;
      // Compute amount from unitPrice * quantity (BTC quantity is in sats, convert to BTC)
      const btcQty = (meta.quantity as number) / 100_000_000;
      body.amount = (meta.unitPrice as number) * btcQty;
    }
    body.tradeMetadata = meta;
  }

  // Assemble bitcoinMetadata for Bitcoin payment method (EXPENSE, INCOME, REFUND only)
  if (values.paymentMethod === 'bitcoin') {
    const qty = parseFloat(values.btcQuantity || '0');
    const price = parseFloat(values.btcUnitPrice || '0');
    const btcQty = values.btcUnit === 'Sats' ? qty / 100_000_000 : qty;
    body.amount = btcQty * price;
    // Bitcoin transactions don't use a bank account — wallet is in bitcoinMetadata
    delete body.accountId;
    body.bitcoinMetadata = {
      walletId: values.btcWalletId,
      quantity: qty,
      bitcoinUnit: values.btcUnit,
      unitPrice: price,
      ...(values.type === 'INCOME' ? { incomeType: values.btcIncomeType } : {}),
    };
  }

  // Remove null values — API expects undefined, not null, for optional fields.
  // Exception: fields that are explicitly nullable in the DB (note, expenseId, incomeId,
  // toAccountId, accountId, budgetId) must keep null so the backend clears them.
  const nullableFields = new Set([
    'note',
    'expenseId',
    'incomeId',
    'toAccountId',
    'accountId',
    'budgetId',
  ]);
  return Object.fromEntries(
    Object.entries(body).filter(([key, v]) => v !== null || nullableFields.has(key)),
  );
}
