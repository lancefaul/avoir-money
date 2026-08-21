import { type UseFormSetValue } from 'react-hook-form';
import { type Transaction as CoreTransaction } from '@budget-tracker/core';
import { type FormValues } from './transactionFormSchema.js';
import { type TradeMetadataJson } from './types.js';

/**
 * setValue prefill sequences for editing / duplicating a transaction, extracted
 * verbatim from useTransactionForm. The rewards/gift-card React state resets stay
 * in the hook — these functions only populate form fields.
 */

/** Populate all form fields from an existing transaction for editing. */
export function applyEditValues(setValue: UseFormSetValue<FormValues>, tx: CoreTransaction): void {
  setValue('type', tx.type as FormValues['type']);
  setValue('name', tx.name);
  setValue('amount', String(tx.amount));
  const d =
    tx.date instanceof Date ? tx.date.toISOString().split('T')[0]! : String(tx.date).split('T')[0]!;
  setValue('date', d);
  setValue('accountId', tx.accountId ?? '');
  setValue('toAccountId', tx.toAccountId ?? '');
  setValue('budgetId', tx.budgetId ?? '');
  setValue('incomeId', tx.incomeId ?? '');
  setValue('isCashBack', tx.isCashBack ?? false);
  setValue('note', tx.note ?? '');
  // Populate Bitcoin payment fields from bitcoinMetadata
  if (tx.bitcoinMetadata) {
    const btcMeta = tx.bitcoinMetadata as {
      walletId: string;
      quantity: number;
      bitcoinUnit: 'Bitcoin' | 'Sats';
      unitPrice: number;
      incomeType?: 'Payment' | 'Rewards';
    };
    setValue('paymentMethod', 'bitcoin');
    setValue('btcWalletId', btcMeta.walletId);
    setValue('btcQuantity', String(btcMeta.quantity));
    setValue('btcUnit', btcMeta.bitcoinUnit);
    setValue('btcUnitPrice', String(btcMeta.unitPrice));
    setValue('btcEntryMode', 'unitPrice');
    setValue('btcUsdAmount', '');
    setValue('btcIncomeType', btcMeta.incomeType ?? 'Payment');
  } else {
    setValue('paymentMethod', 'account');
    setValue('btcQuantity', '');
    setValue('btcUnit', 'Bitcoin');
    setValue('btcUnitPrice', '');
    setValue('btcWalletId', '');
    setValue('btcEntryMode', 'unitPrice');
    setValue('btcUsdAmount', '');
    setValue('btcIncomeType', 'Payment');
  }

  // Populate trade fields from tradeMetadata
  if (tx.type === 'TRADE' && tx.tradeMetadata) {
    const meta = tx.tradeMetadata as TradeMetadataJson;
    setValue('tradeDirection', meta.direction);
    setValue('assetType', meta.assetType);
    setValue('unitPrice', String(meta.unitPrice));
    setValue('tradeQuantity', String(meta.quantity));
    if (meta.assetType === 'Stock') {
      setValue('ticker', meta.ticker ?? '');
      setValue('custodianId', meta.custodianId ?? '');
    } else {
      setValue('walletId', meta.walletId ?? '');
      setValue('bitcoinUnit', meta.bitcoinUnit ?? 'Bitcoin');
    }
  }
}

/** Populate form fields from a transaction for copy-and-change (date resets to today). */
export function applyDuplicateValues(
  setValue: UseFormSetValue<FormValues>,
  tx: CoreTransaction,
  today: string,
): void {
  setValue('type', tx.type as FormValues['type']);
  setValue('name', tx.name);
  setValue('amount', String(tx.amount));
  setValue('date', today);
  setValue('accountId', tx.accountId ?? '');
  setValue('toAccountId', tx.toAccountId ?? '');
  setValue('budgetId', tx.budgetId ?? '');
  setValue('incomeId', '');
  setValue('note', tx.note ?? '');
  // Copied, not cleared. `incomeId` above is reset because it links to one
  // specific occurrence; this is a property of the money itself, like type and
  // budget. Duplicating a rebate means recording another rebate, and clearing
  // it would quietly turn the copy into taxable income with the toggle
  // off-screen where nobody would catch it.
  setValue('isCashBack', tx.isCashBack ?? false);
  if (tx.bitcoinMetadata) {
    const btcMeta = tx.bitcoinMetadata as {
      walletId: string;
      quantity: number;
      bitcoinUnit: 'Bitcoin' | 'Sats';
      unitPrice: number;
    };
    setValue('paymentMethod', 'bitcoin');
    setValue('btcWalletId', btcMeta.walletId);
    setValue('btcQuantity', String(btcMeta.quantity));
    setValue('btcUnit', btcMeta.bitcoinUnit);
    setValue('btcUnitPrice', String(btcMeta.unitPrice));
  } else {
    setValue('paymentMethod', 'account');
  }
  if (tx.type === 'TRADE' && tx.tradeMetadata) {
    const meta = tx.tradeMetadata as TradeMetadataJson;
    setValue('tradeDirection', meta.direction);
    setValue('assetType', meta.assetType);
    setValue('unitPrice', String(meta.unitPrice));
    setValue('tradeQuantity', String(meta.quantity));
    if (meta.assetType === 'Stock') {
      setValue('ticker', meta.ticker ?? '');
      setValue('custodianId', meta.custodianId ?? '');
    } else {
      setValue('walletId', meta.walletId ?? '');
      setValue('bitcoinUnit', meta.bitcoinUnit ?? 'Bitcoin');
    }
  }
}
