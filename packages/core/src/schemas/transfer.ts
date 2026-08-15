import { z } from 'zod';

// ─── Bitcoin Transfer Request ───

export const BitcoinTransferSchema = z
  .object({
    fromWalletId: z.string().min(1),
    toWalletId: z.string().min(1),
    quantity: z.number().positive(),
    bitcoinUnit: z.enum(['Bitcoin', 'Sats']),
    bitcoinPrice: z.number().positive().optional(),
    feeAmount: z.number().nonnegative().optional(),
    feeUnit: z.enum(['Bitcoin', 'Sats', 'USD']).optional(),
  })
  .refine((d) => d.fromWalletId !== d.toWalletId, {
    message: 'Source and destination wallets must be different',
    path: ['toWalletId'],
  })
  .refine((d) => d.bitcoinUnit !== 'Sats' || Number.isInteger(d.quantity), {
    message: 'Sats quantity must be a whole number',
    path: ['quantity'],
  })
  .refine((d) => !d.feeAmount || d.feeUnit, {
    message: 'Fee unit is required when fee amount is provided',
    path: ['feeUnit'],
  })
  .refine(
    (d) => {
      // Bitcoin price is only required when there's a fee paid in bitcoin
      const hasBtcFee = d.feeAmount && d.feeAmount > 0 && d.feeUnit && d.feeUnit !== 'USD';
      return !hasBtcFee || (d.bitcoinPrice !== undefined && d.bitcoinPrice > 0);
    },
    {
      message: 'Bitcoin price is required when fee is paid in bitcoin',
      path: ['bitcoinPrice'],
    },
  );

export type BitcoinTransferInput = z.infer<typeof BitcoinTransferSchema>;

// ─── Stock Transfer Request ───

export const StockTransferSchema = z
  .object({
    fromCustodianId: z.string().min(1),
    toCustodianId: z.string().min(1),
    holdingId: z.string().min(1),
    quantity: z.number().positive().optional(),
    feeAmount: z.number().nonnegative().optional(),
    feeBudgetId: z.string().optional(),
    feeAccountId: z.string().optional(),
  })
  .refine((d) => d.fromCustodianId !== d.toCustodianId, {
    message: 'Source and destination custodians must be different',
    path: ['toCustodianId'],
  })
  .refine((d) => !d.feeAmount || (d.feeBudgetId && d.feeAccountId), {
    message: 'Fee budget and account are required when fee is provided',
    path: ['feeAmount'],
  });

export type StockTransferInput = z.infer<typeof StockTransferSchema>;

// ─── Bitcoin Transfer Response ───

export const BitcoinTransferResponseSchema = z.object({
  id: z.string(),
  fromWalletId: z.string(),
  toWalletId: z.string(),
  quantity: z.number(),
  bitcoinUnit: z.enum(['Bitcoin', 'Sats']),
  bitcoinPrice: z.number().nullable(),
  feeAmount: z.number().nullable(),
  feeUnit: z.enum(['Bitcoin', 'Sats', 'USD']).nullable(),
  feeBtc: z.number().nullable(),
  createdAt: z.coerce.date(),
});

export type BitcoinTransferResponse = z.infer<typeof BitcoinTransferResponseSchema>;

// ─── Stock Transfer Response ───

export const StockTransferResponseSchema = z.object({
  id: z.string(),
  fromCustodianId: z.string(),
  toCustodianId: z.string(),
  holdingId: z.string(),
  ticker: z.string().nullable(),
  quantity: z.number(),
  feeAmount: z.number().nullable(),
  feeTransactionId: z.string().nullable(),
  createdAt: z.coerce.date(),
});

export type StockTransferResponse = z.infer<typeof StockTransferResponseSchema>;
