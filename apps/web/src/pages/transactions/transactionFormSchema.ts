import { z } from 'zod';
import { TransactionTypeSchema } from '@budget-tracker/core';

// Form-level Zod schema for flat form fields (transformed to API shape in onSubmit)
export const TransactionFormSchema = z
  .object({
    type: TransactionTypeSchema,
    name: z.string().max(200).default(''),
    amount: z.string().default(''),
    date: z.string().default(''),
    budgetId: z.string().optional(),
    incomeId: z.string().optional(),
    isCashBack: z.boolean().optional(),
    accountId: z.string().optional(),
    toAccountId: z.string().optional(),
    note: z.string().optional(),
    tradeDirection: z.enum(['BUY', 'SELL']).optional(),
    assetType: z.enum(['Bitcoin', 'Stock']).optional(),
    ticker: z.string().optional(),
    unitPrice: z.string().optional(),
    tradeQuantity: z.string().optional(),
    custodianId: z.string().optional(),
    walletId: z.string().optional(),
    bitcoinUnit: z.enum(['Bitcoin', 'Sats']).optional(),
    // Bitcoin payment method fields
    paymentMethod: z.enum(['account', 'bitcoin']).default('account'),
    btcQuantity: z.string().optional(),
    btcUnit: z.enum(['Bitcoin', 'Sats']).default('Bitcoin'),
    btcUnitPrice: z.string().optional(),
    btcWalletId: z.string().optional(),
    btcEntryMode: z.enum(['unitPrice', 'usdEquivalent']).default('unitPrice'),
    btcUsdAmount: z.string().optional(),
    btcIncomeType: z.enum(['Payment', 'Rewards']).default('Payment'),
    // Transfer type fields (USD / Bitcoin / Stock)
    transferType: z.enum(['usd', 'bitcoin', 'stock']).default('usd'),
    btcFromWalletId: z.string().optional(),
    btcToWalletId: z.string().optional(),
    btcTransferQuantity: z.string().optional(),
    btcTransferUnit: z.enum(['Bitcoin', 'Sats']).default('Bitcoin'),
    btcTransferFee: z.string().optional(),
    btcTransferFeeUnit: z.enum(['Bitcoin', 'Sats', 'USD']).optional(),
    btcTransferPrice: z.string().optional(),
    stockHoldingId: z.string().optional(),
    stockToCustodianId: z.string().optional(),
    stockFeeAmount: z.string().optional(),
    stockFeeAccountId: z.string().optional(),
    stockFeeBudgetId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Require name and date for all transaction types
    if (!data.name || data.name.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Description is required.',
        path: ['name'],
      });
    }
    if (!data.date || data.date.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date is required', path: ['date'] });
    }
    // Require amount for all types except bitcoin/stock transfers and bitcoin payments
    const isBtcOrStockTransfer =
      data.type === 'TRANSFER' &&
      (data.transferType === 'bitcoin' || data.transferType === 'stock');
    const needsAmount =
      !isBtcOrStockTransfer && data.paymentMethod !== 'bitcoin' && data.type !== 'TRADE';
    if (needsAmount) {
      if (!data.amount || data.amount.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Amount is required',
          path: ['amount'],
        });
      } else {
        const n = parseFloat(data.amount);
        if (isNaN(n) || n <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Must be a positive number',
            path: ['amount'],
          });
        }
      }
    }
    // Require accountId when not using bitcoin payment
    if (
      data.paymentMethod !== 'bitcoin' &&
      !(data.type === 'TRANSFER' && data.transferType !== 'usd') &&
      (!data.accountId || data.accountId.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Account is required',
        path: ['accountId'],
      });
    }
    if (data.type === 'TRANSFER' && data.transferType === 'usd' && !data.toAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Destination account is required',
        path: ['toAccountId'],
      });
    }
    // Bitcoin transfer validation
    if (data.type === 'TRANSFER' && data.transferType === 'bitcoin') {
      if (!data.btcFromWalletId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Source wallet is required',
          path: ['btcFromWalletId'],
        });
      }
      if (!data.btcToWalletId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Destination wallet is required',
          path: ['btcToWalletId'],
        });
      }
      if (
        data.btcFromWalletId &&
        data.btcToWalletId &&
        data.btcFromWalletId === data.btcToWalletId
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Source and destination must be different',
          path: ['btcToWalletId'],
        });
      }
      if (
        !data.btcTransferQuantity ||
        isNaN(parseFloat(data.btcTransferQuantity)) ||
        parseFloat(data.btcTransferQuantity) <= 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Quantity must be a positive number',
          path: ['btcTransferQuantity'],
        });
      }
      if (
        data.btcTransferUnit === 'Sats' &&
        data.btcTransferQuantity &&
        !Number.isInteger(parseFloat(data.btcTransferQuantity))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Sats amount must be a whole number',
          path: ['btcTransferQuantity'],
        });
      }
      const fee = parseFloat(data.btcTransferFee || '0');
      if (fee > 0 && !data.btcTransferFeeUnit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Fee unit is required when fee is provided',
          path: ['btcTransferFeeUnit'],
        });
      }
      if (fee > 0 && data.btcTransferFeeUnit && data.btcTransferFeeUnit !== 'USD') {
        if (
          !data.btcTransferPrice ||
          isNaN(parseFloat(data.btcTransferPrice)) ||
          parseFloat(data.btcTransferPrice) <= 0
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Bitcoin price is required when fee is in BTC/Sats',
            path: ['btcTransferPrice'],
          });
        }
      }
    }
    // Stock transfer validation
    if (data.type === 'TRANSFER' && data.transferType === 'stock') {
      if (!data.stockHoldingId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Holding is required',
          path: ['stockHoldingId'],
        });
      }
      if (!data.stockToCustodianId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Destination custodian is required',
          path: ['stockToCustodianId'],
        });
      }
      const sFee = parseFloat(data.stockFeeAmount || '0');
      if (sFee > 0 && !data.stockFeeAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Fee account is required',
          path: ['stockFeeAccountId'],
        });
      }
      if (sFee > 0 && !data.stockFeeBudgetId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Fee category is required',
          path: ['stockFeeBudgetId'],
        });
      }
    }
    if (data.type === 'TRADE') {
      if (!data.unitPrice || isNaN(parseFloat(data.unitPrice)) || parseFloat(data.unitPrice) <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Unit price must be positive',
          path: ['unitPrice'],
        });
      }
      if (
        !data.tradeQuantity ||
        isNaN(parseFloat(data.tradeQuantity)) ||
        parseFloat(data.tradeQuantity) <= 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Quantity must be positive',
          path: ['tradeQuantity'],
        });
      }
      if (data.assetType === 'Stock') {
        if (!data.ticker || !/^[A-Z]+$/.test(data.ticker)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Ticker must be 1-10 uppercase letters',
            path: ['ticker'],
          });
        }
        if (!data.custodianId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Custodian is required',
            path: ['custodianId'],
          });
        }
      }
      if (data.assetType === 'Bitcoin') {
        if (!data.walletId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Wallet is required',
            path: ['walletId'],
          });
        }
        if (
          data.bitcoinUnit === 'Sats' &&
          data.tradeQuantity &&
          !Number.isInteger(parseFloat(data.tradeQuantity))
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Sats amount must be a whole number',
            path: ['tradeQuantity'],
          });
        }
      }
    }
    // Bitcoin payment method validation
    if (data.paymentMethod === 'bitcoin') {
      if (!data.btcWalletId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Wallet is required',
          path: ['btcWalletId'],
        });
      }
      if (
        !data.btcQuantity ||
        isNaN(parseFloat(data.btcQuantity)) ||
        parseFloat(data.btcQuantity) <= 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Quantity must be a positive number',
          path: ['btcQuantity'],
        });
      }
      if (data.btcEntryMode === 'usdEquivalent') {
        if (
          !data.btcUsdAmount ||
          isNaN(parseFloat(data.btcUsdAmount)) ||
          parseFloat(data.btcUsdAmount) <= 0
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'USD amount must be a positive number',
            path: ['btcUsdAmount'],
          });
        }
      } else {
        if (
          !data.btcUnitPrice ||
          isNaN(parseFloat(data.btcUnitPrice)) ||
          parseFloat(data.btcUnitPrice) <= 0
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Unit price must be a positive number',
            path: ['btcUnitPrice'],
          });
        }
      }
      if (
        data.btcUnit === 'Sats' &&
        data.btcQuantity &&
        !Number.isInteger(parseFloat(data.btcQuantity))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Sats amount must be a whole number',
          path: ['btcQuantity'],
        });
      }
    }
  });

export type FormValues = z.infer<typeof TransactionFormSchema>;
