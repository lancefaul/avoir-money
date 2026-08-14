import { z } from 'zod';

// Enum schemas for each transaction type's sign rule options
export const PositiveExpenseMeaningSchema = z.enum(['money_out', 'money_in']);
export const NegativeExpenseMeaningSchema = z.enum(['refund', 'ignore', 'spending']);

export const PositiveIncomeMeaningSchema = z.enum(['money_in', 'money_out']);
export const NegativeIncomeMeaningSchema = z.enum(['flip_sign', 'ignore']);

export const PositiveTransferMeaningSchema = z.enum(['withdrawal', 'deposit']);
export const PositiveTradeMeaningSchema = z.enum(['buy', 'sell']);

// Object schemas for each transaction type's sign rule
export const ExpenseSignRuleSchema = z.object({
  positiveMeaning: PositiveExpenseMeaningSchema,
  negativeMeaning: NegativeExpenseMeaningSchema,
});

export const IncomeSignRuleSchema = z.object({
  positiveMeaning: PositiveIncomeMeaningSchema,
  negativeMeaning: NegativeIncomeMeaningSchema,
});

export const TransferSignRuleSchema = z.object({
  positiveMeaning: PositiveTransferMeaningSchema,
});

export const TradeSignRuleSchema = z.object({
  positiveMeaning: PositiveTradeMeaningSchema,
});

export const RefundSignRuleSchema = z.object({
  positiveMeaning: z.literal('money_in'),
});

// Top-level config schema combining all five transaction types
export const SignConventionConfigSchema = z.object({
  expense: ExpenseSignRuleSchema,
  income: IncomeSignRuleSchema,
  transfer: TransferSignRuleSchema,
  trade: TradeSignRuleSchema,
  refund: RefundSignRuleSchema,
});

export type SignConventionConfig = z.infer<typeof SignConventionConfigSchema>;

export const DEFAULT_SIGN_CONVENTION_CONFIG: SignConventionConfig = {
  expense: { positiveMeaning: 'money_out', negativeMeaning: 'refund' },
  income: { positiveMeaning: 'money_in', negativeMeaning: 'flip_sign' },
  transfer: { positiveMeaning: 'withdrawal' },
  trade: { positiveMeaning: 'buy' },
  refund: { positiveMeaning: 'money_in' },
};

// --- Normalization logic ---

export type NormalizeResult = { amount: number } | { excluded: true };

type ExpenseSignRule = z.infer<typeof ExpenseSignRuleSchema>;
type IncomeSignRule = z.infer<typeof IncomeSignRuleSchema>;
type TransferSignRule = z.infer<typeof TransferSignRuleSchema>;
type TradeSignRule = z.infer<typeof TradeSignRuleSchema>;

function normalizeExpense(raw: number, rule: ExpenseSignRule): NormalizeResult {
  if (raw > 0) {
    return rule.positiveMeaning === 'money_out'
      ? { amount: -Math.abs(raw) }
      : { amount: Math.abs(raw) };
  }
  // raw < 0
  if (rule.negativeMeaning === 'refund' || rule.negativeMeaning === 'spending') {
    return { amount: Math.abs(raw) };
  }
  return { excluded: true };
}

function normalizeIncome(raw: number, _rule: IncomeSignRule): NormalizeResult {
  return { amount: Math.abs(raw) };
}

function normalizeTransfer(raw: number, rule: TransferSignRule): NormalizeResult {
  if (raw > 0) {
    return rule.positiveMeaning === 'withdrawal'
      ? { amount: -Math.abs(raw) }
      : { amount: Math.abs(raw) };
  }
  // raw < 0: opposite of positive meaning
  return rule.positiveMeaning === 'withdrawal'
    ? { amount: Math.abs(raw) }
    : { amount: -Math.abs(raw) };
}

function normalizeTrade(raw: number, rule: TradeSignRule): NormalizeResult {
  if (raw > 0) {
    return rule.positiveMeaning === 'buy' ? { amount: -Math.abs(raw) } : { amount: Math.abs(raw) };
  }
  // raw < 0: opposite of positive meaning
  return rule.positiveMeaning === 'buy' ? { amount: Math.abs(raw) } : { amount: -Math.abs(raw) };
}

function normalizeRefund(raw: number): NormalizeResult {
  return { amount: Math.abs(raw) };
}

export function normalizeAmount(
  rawAmount: number,
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'TRADE' | 'REFUND',
  config: SignConventionConfig,
): NormalizeResult {
  if (rawAmount === 0) return { excluded: true };

  switch (type) {
    case 'EXPENSE':
      return normalizeExpense(rawAmount, config.expense);
    case 'INCOME':
      return normalizeIncome(rawAmount, config.income);
    case 'TRANSFER':
      return normalizeTransfer(rawAmount, config.transfer);
    case 'TRADE':
      return normalizeTrade(rawAmount, config.trade);
    case 'REFUND':
      return normalizeRefund(rawAmount);
  }
}
