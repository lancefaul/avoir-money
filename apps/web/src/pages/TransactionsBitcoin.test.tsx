/**
 * Unit tests for Bitcoin payment method UI form logic.
 *
 * Tests the TransactionFormSchema validation, payment method toggle visibility,
 * USD equivalent computation, and edit form population of bitcoinMetadata fields.
 *
 * Since TransactionFormSchema is not exported, we replicate the schema and pure
 * logic here to test the validation rules in isolation.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { TransactionTypeSchema } from '@budget-tracker/core';

// ─── Replicate the TransactionFormSchema from Transactions.tsx ───
const TransactionFormSchema = z
  .object({
    type: TransactionTypeSchema,
    name: z.string().min(1, 'Name is required').max(200),
    amount: z
      .string()
      .min(1, 'Amount is required')
      .refine((v) => {
        const n = parseFloat(v);
        return !isNaN(n) && n > 0;
      }, 'Must be a positive number'),
    date: z.string().min(1, 'Date is required'),
    budgetId: z.string().optional(),
    incomeId: z.string().optional(),
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
    paymentMethod: z.enum(['account', 'bitcoin']).default('account'),
    btcQuantity: z.string().optional(),
    btcUnit: z.enum(['Bitcoin', 'Sats']).default('Bitcoin'),
    btcUnitPrice: z.string().optional(),
    btcWalletId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.paymentMethod !== 'bitcoin' && (!data.accountId || data.accountId.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Account is required',
        path: ['accountId'],
      });
    }
    if (data.type === 'TRANSFER' && !data.toAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Destination account is required',
        path: ['toAccountId'],
      });
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

// ─── Replicate the USD equivalent computation from Transactions.tsx ───
function computeBtcUsdEquivalent(
  btcQuantity: string | undefined,
  btcUnitPrice: string | undefined,
  btcUnit: 'Bitcoin' | 'Sats',
): number | null {
  const qty = parseFloat(btcQuantity || '');
  const price = parseFloat(btcUnitPrice || '');
  if (isNaN(qty) || isNaN(price) || qty <= 0 || price <= 0) return null;
  const btcQty = btcUnit === 'Sats' ? qty / 100_000_000 : qty;
  return btcQty * price;
}

// ─── Replicate the showPaymentToggle logic from Transactions.tsx ───
function shouldShowPaymentToggle(txType: string): boolean {
  return txType === 'EXPENSE' || txType === 'INCOME' || txType === 'REFUND';
}

// ─── Helper to build a valid base form object ───
function baseForm(overrides: Record<string, unknown> = {}) {
  return {
    type: 'EXPENSE' as const,
    name: 'Test',
    amount: '100',
    date: '2026-01-15',
    accountId: 'acct-1',
    paymentMethod: 'account' as const,
    btcUnit: 'Bitcoin' as const,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. Payment method toggle visibility
// ═══════════════════════════════════════════════════════════════════
describe('Payment method toggle visibility', () => {
  it('shows for EXPENSE', () => {
    expect(shouldShowPaymentToggle('EXPENSE')).toBe(true);
  });

  it('shows for INCOME', () => {
    expect(shouldShowPaymentToggle('INCOME')).toBe(true);
  });

  it('shows for REFUND', () => {
    expect(shouldShowPaymentToggle('REFUND')).toBe(true);
  });

  it('hides for TRADE', () => {
    expect(shouldShowPaymentToggle('TRADE')).toBe(false);
  });

  it('hides for TRANSFER', () => {
    expect(shouldShowPaymentToggle('TRANSFER')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Bitcoin payment method schema validation
// ═══════════════════════════════════════════════════════════════════
describe('TransactionFormSchema — Bitcoin payment method', () => {
  it('accepts valid bitcoin payment for EXPENSE', () => {
    const result = TransactionFormSchema.safeParse(
      baseForm({
        paymentMethod: 'bitcoin',
        btcWalletId: 'wallet-1',
        btcQuantity: '0.5',
        btcUnit: 'Bitcoin',
        btcUnitPrice: '60000',
        accountId: '', // not required for bitcoin
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts valid bitcoin payment for INCOME', () => {
    const result = TransactionFormSchema.safeParse(
      baseForm({
        type: 'INCOME',
        paymentMethod: 'bitcoin',
        btcWalletId: 'wallet-1',
        btcQuantity: '100000',
        btcUnit: 'Sats',
        btcUnitPrice: '60000',
        accountId: '',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts valid bitcoin payment for REFUND', () => {
    const result = TransactionFormSchema.safeParse(
      baseForm({
        type: 'REFUND',
        paymentMethod: 'bitcoin',
        btcWalletId: 'wallet-1',
        btcQuantity: '0.01',
        btcUnit: 'Bitcoin',
        btcUnitPrice: '65000',
        accountId: '',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('requires btcWalletId when paymentMethod is bitcoin', () => {
    const result = TransactionFormSchema.safeParse(
      baseForm({
        paymentMethod: 'bitcoin',
        btcWalletId: '',
        btcQuantity: '0.5',
        btcUnitPrice: '60000',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const walletIssue = result.error.issues.find((i) => i.path.includes('btcWalletId'));
      expect(walletIssue).toBeDefined();
      expect(walletIssue!.message).toBe('Wallet is required');
    }
  });

  it('requires btcQuantity when paymentMethod is bitcoin', () => {
    const result = TransactionFormSchema.safeParse(
      baseForm({
        paymentMethod: 'bitcoin',
        btcWalletId: 'wallet-1',
        btcQuantity: '',
        btcUnitPrice: '60000',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const qtyIssue = result.error.issues.find((i) => i.path.includes('btcQuantity'));
      expect(qtyIssue).toBeDefined();
      expect(qtyIssue!.message).toBe('Quantity must be a positive number');
    }
  });

  it('requires btcUnitPrice when paymentMethod is bitcoin', () => {
    const result = TransactionFormSchema.safeParse(
      baseForm({
        paymentMethod: 'bitcoin',
        btcWalletId: 'wallet-1',
        btcQuantity: '0.5',
        btcUnitPrice: '',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const priceIssue = result.error.issues.find((i) => i.path.includes('btcUnitPrice'));
      expect(priceIssue).toBeDefined();
      expect(priceIssue!.message).toBe('Unit price must be a positive number');
    }
  });

  it('enforces integer quantity when btcUnit is Sats', () => {
    const result = TransactionFormSchema.safeParse(
      baseForm({
        paymentMethod: 'bitcoin',
        btcWalletId: 'wallet-1',
        btcQuantity: '100.5',
        btcUnit: 'Sats',
        btcUnitPrice: '60000',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const satsIssue = result.error.issues.find(
        (i) => i.path.includes('btcQuantity') && i.message.includes('whole number'),
      );
      expect(satsIssue).toBeDefined();
    }
  });

  it('allows decimal quantity when btcUnit is Bitcoin', () => {
    const result = TransactionFormSchema.safeParse(
      baseForm({
        paymentMethod: 'bitcoin',
        btcWalletId: 'wallet-1',
        btcQuantity: '0.00123456',
        btcUnit: 'Bitcoin',
        btcUnitPrice: '60000',
        accountId: '',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('does not require accountId when paymentMethod is bitcoin', () => {
    const result = TransactionFormSchema.safeParse(
      baseForm({
        paymentMethod: 'bitcoin',
        btcWalletId: 'wallet-1',
        btcQuantity: '0.5',
        btcUnitPrice: '60000',
        accountId: '',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('requires accountId when paymentMethod is account', () => {
    const result = TransactionFormSchema.safeParse(
      baseForm({
        paymentMethod: 'account',
        accountId: '',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const acctIssue = result.error.issues.find((i) => i.path.includes('accountId'));
      expect(acctIssue).toBeDefined();
      expect(acctIssue!.message).toBe('Account is required');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. USD equivalent computation
// ═══════════════════════════════════════════════════════════════════
describe('USD equivalent computation', () => {
  it('computes correctly for Bitcoin unit', () => {
    // 0.5 BTC × $60,000 = $30,000
    expect(computeBtcUsdEquivalent('0.5', '60000', 'Bitcoin')).toBe(30000);
  });

  it('computes correctly for Sats unit', () => {
    // 100,000,000 sats = 1 BTC × $60,000 = $60,000
    expect(computeBtcUsdEquivalent('100000000', '60000', 'Sats')).toBe(60000);
  });

  it('converts sats to BTC before multiplying', () => {
    // 50,000,000 sats = 0.5 BTC × $80,000 = $40,000
    expect(computeBtcUsdEquivalent('50000000', '80000', 'Sats')).toBe(40000);
  });

  it('handles small sats amounts', () => {
    // 1000 sats = 0.00001 BTC × $100,000 = $1
    expect(computeBtcUsdEquivalent('1000', '100000', 'Sats')).toBeCloseTo(1, 5);
  });

  it('returns null for empty quantity', () => {
    expect(computeBtcUsdEquivalent('', '60000', 'Bitcoin')).toBeNull();
  });

  it('returns null for empty unit price', () => {
    expect(computeBtcUsdEquivalent('0.5', '', 'Bitcoin')).toBeNull();
  });

  it('returns null for zero quantity', () => {
    expect(computeBtcUsdEquivalent('0', '60000', 'Bitcoin')).toBeNull();
  });

  it('returns null for zero unit price', () => {
    expect(computeBtcUsdEquivalent('0.5', '0', 'Bitcoin')).toBeNull();
  });

  it('returns null for negative quantity', () => {
    expect(computeBtcUsdEquivalent('-1', '60000', 'Bitcoin')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(computeBtcUsdEquivalent('abc', '60000', 'Bitcoin')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Edit form populates bitcoinMetadata fields
// ═══════════════════════════════════════════════════════════════════
describe('Edit form — bitcoinMetadata population', () => {
  it('validates form values matching a populated bitcoin edit', () => {
    // Simulates what openEdit() sets when editing a tx with bitcoinMetadata
    const editValues = baseForm({
      type: 'EXPENSE',
      name: 'Coffee with BTC',
      amount: '5.50',
      date: '2026-04-10',
      paymentMethod: 'bitcoin',
      btcWalletId: 'wallet-abc',
      btcQuantity: '0.0001',
      btcUnit: 'Bitcoin',
      btcUnitPrice: '55000',
      accountId: '',
    });

    const result = TransactionFormSchema.safeParse(editValues);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paymentMethod).toBe('bitcoin');
      expect(result.data.btcWalletId).toBe('wallet-abc');
      expect(result.data.btcQuantity).toBe('0.0001');
      expect(result.data.btcUnit).toBe('Bitcoin');
      expect(result.data.btcUnitPrice).toBe('55000');
    }
  });

  it('validates form values matching a populated Sats edit', () => {
    const editValues = baseForm({
      type: 'INCOME',
      name: 'Mining reward',
      amount: '3.00',
      date: '2026-04-12',
      paymentMethod: 'bitcoin',
      btcWalletId: 'wallet-xyz',
      btcQuantity: '5000',
      btcUnit: 'Sats',
      btcUnitPrice: '60000',
      accountId: '',
    });

    const result = TransactionFormSchema.safeParse(editValues);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paymentMethod).toBe('bitcoin');
      expect(result.data.btcUnit).toBe('Sats');
      expect(result.data.btcQuantity).toBe('5000');
    }
  });

  it('validates form values for a non-bitcoin edit (account payment)', () => {
    // When editing a tx without bitcoinMetadata, paymentMethod stays 'account'
    const editValues = baseForm({
      type: 'EXPENSE',
      name: 'Groceries',
      amount: '85.00',
      date: '2026-04-10',
      paymentMethod: 'account',
      accountId: 'acct-checking',
      btcQuantity: '',
      btcUnit: 'Bitcoin',
      btcUnitPrice: '',
      btcWalletId: '',
    });

    const result = TransactionFormSchema.safeParse(editValues);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paymentMethod).toBe('account');
      expect(result.data.accountId).toBe('acct-checking');
    }
  });
});
