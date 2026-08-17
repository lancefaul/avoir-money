import { z } from 'zod';
import { AnticipationSchema } from './anticipation.js';

export const TransactionTypeSchema = z.enum(['EXPENSE', 'INCOME', 'TRANSFER', 'REFUND', 'TRADE']);

// ─── Trade Enums ───

export const TradeDirectionSchema = z.enum(['BUY', 'SELL']);
export const TradeAssetTypeSchema = z.enum(['Bitcoin', 'Stock']);
export const BitcoinUnitSchema = z.enum(['Bitcoin', 'Sats']);

// ─── Trade Metadata Schemas ───

export const StockTradeMetadataSchema = z.object({
  direction: TradeDirectionSchema,
  assetType: z.literal('Stock'),
  ticker: z
    .string()
    .min(1)
    .max(10)
    .regex(/^[A-Z]+$/, 'Ticker must be 1-10 uppercase letters'),
  unitPrice: z.number().positive(),
  quantity: z.number().positive(),
  custodianId: z.string().min(1),
});

export const BitcoinTradeMetadataSchema = z.object({
  direction: TradeDirectionSchema,
  assetType: z.literal('Bitcoin'),
  unitPrice: z.number().positive(),
  quantity: z.number().positive(),
  bitcoinUnit: BitcoinUnitSchema,
  walletId: z.string().min(1),
});

export const TradeMetadataSchema = z
  .discriminatedUnion('assetType', [StockTradeMetadataSchema, BitcoinTradeMetadataSchema])
  .refine(
    (data) =>
      data.assetType !== 'Bitcoin' ||
      data.bitcoinUnit !== 'Sats' ||
      Number.isInteger(data.quantity),
    { message: 'Sats amount must be a whole number', path: ['quantity'] },
  );

// ─── Bitcoin Payment Metadata Schema ───

export const BitcoinPaymentMetadataSchema = z
  .object({
    walletId: z.string().min(1),
    quantity: z.number().positive(),
    bitcoinUnit: BitcoinUnitSchema,
    unitPrice: z.number().positive(),
    incomeType: z.enum(['Payment', 'Rewards']).optional(),
  })
  .refine((data) => data.bitcoinUnit !== 'Sats' || Number.isInteger(data.quantity), {
    message: 'Sats amount must be a whole number',
    path: ['quantity'],
  });

export type BitcoinPaymentMetadata = z.infer<typeof BitcoinPaymentMetadataSchema>;

// ─── Investment Detail Schemas (serialized DB rows — typed replacements for the JSON metadata) ───

export const TradeDetailSchema = z.object({
  id: z.string(),
  transactionId: z.string(),
  direction: TradeDirectionSchema,
  assetType: TradeAssetTypeSchema,
  ticker: z.string().nullable(),
  quantity: z.number(),
  unitPrice: z.number(),
  bitcoinUnit: BitcoinUnitSchema.nullable(),
  custodianId: z.string().nullable(),
  walletId: z.string().nullable(),
});

export type TradeDetail = z.infer<typeof TradeDetailSchema>;

export const BitcoinPaymentDetailSchema = z.object({
  id: z.string(),
  transactionId: z.string(),
  walletId: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  bitcoinUnit: BitcoinUnitSchema,
  incomeType: z.enum(['Payment', 'Rewards']).nullable(),
});

export type BitcoinPaymentDetail = z.infer<typeof BitcoinPaymentDetailSchema>;

export const TransactionSchema = z.object({
  id: z.string(),
  type: TransactionTypeSchema,
  name: z.string(),
  amount: z.number(),
  netAmount: z.number(),
  date: z.coerce.date(),
  payPeriodId: z.string().nullable(),
  expenseId: z.string().nullable(),
  incomeId: z.string().nullable(),
  accountId: z.string().nullable(),
  toAccountId: z.string().nullable(),
  budgetId: z.string().nullable(),
  note: z.string().nullable(),
  tradeMetadata: z.unknown().nullable().optional(),
  bitcoinMetadata: z.unknown().nullable().optional(),
  tradeDetail: TradeDetailSchema.nullable().optional(),
  bitcoinPaymentDetail: BitcoinPaymentDetailSchema.nullable().optional(),
  costBasisAllocated: z.number().nullable().optional(),
  balanceBefore: z.number().nullable().optional(),
  balanceAfter: z.number().nullable().optional(),
  toBalanceBefore: z.number().nullable().optional(),
  toBalanceAfter: z.number().nullable().optional(),
  parentId: z.string().nullable().optional(),
  childCount: z.number().optional(),
  /**
   * Shared key of the multi-account purchase group this row belongs to
   * (payment-split, ADR-030), or null for an ordinary transaction. A group has
   * one balance-neutral Anchor (`accountId === null`) carrying the budget, plus
   * one balance-visible leg per funding account.
   */
  purchaseGroupId: z.string().nullable().optional(),
  /**
   * True when this transaction is the escape-hatch adjustment that closed a
   * reconciliation. Derived from the session relation rather than stored on the
   * row, so it cannot drift from the session that owns it, and cannot be forged
   * by naming an ordinary transaction to look like one.
   */
  isReconciliationAdjustment: z.boolean().optional(),
  /** Cash back / rebate rather than money earned. Only meaningful on INCOME. */
  isCashBack: z.boolean().optional(),
  createdAt: z.coerce.date(),
});

const CreateTransactionBaseSchema = z.object({
  type: TransactionTypeSchema,
  name: z.string().min(1).max(200),
  amount: z.number().nonnegative().max(999999999),
  date: z.coerce.date(),
  payPeriodId: z.string().nullable().optional(),
  expenseId: z.string().nullable().optional(),
  incomeId: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  toAccountId: z.string().nullable().optional(),
  budgetId: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  imported: z.boolean().optional(),
  /**
   * Marks an INCOME row as cash back / a rebate rather than money earned.
   * Rejected on any other type by the superRefine below — silently storing it
   * on an EXPENSE would create rows nothing can explain later.
   */
  isCashBack: z.boolean().optional(),
  tradeMetadata: TradeMetadataSchema.optional(),
  bitcoinMetadata: BitcoinPaymentMetadataSchema.optional(),
});

/**
 * The cross-field rules, as one definition both paths call.
 *
 * They used to live only in `CreateTransactionSchema`'s `superRefine`, which
 * meant every one of them was enforced on create and silently skipped on
 * update: `UpdateTransactionSchema` is a `.partial()` and carries no refinement.
 * An update could therefore strip a TRADE's funding account, or mark an EXPENSE
 * as cash back — neither reachable from the UI, which is why it went unnoticed.
 *
 * Stated over **booleans rather than the payload** for one reason that matters:
 * on update the answer to "does this have trade metadata?" lives in the stored
 * row's `tradeDetail` relation, not in the request body. Taking facts instead of
 * a DTO lets the route merge stored state with the incoming changes and ask the
 * same question the create path asks, so the two cannot drift.
 *
 * A partial update may not send `type` at all, so the caller is responsible for
 * resolving it against the stored row first. Refining the partial directly
 * would evaluate every rule against `undefined` and pass everything — the trap
 * this design exists to avoid.
 */
export interface TransactionCrossFieldFacts {
  type: string;
  hasFundingAccount: boolean;
  hasTradeMetadata: boolean;
  hasBitcoinMetadata: boolean;
  isCashBack: boolean;
}

export interface CrossFieldIssue {
  /** Field the issue belongs to, matching the create path's `path` entries. */
  path: string;
  message: string;
}

export function transactionCrossFieldIssues(f: TransactionCrossFieldFacts): CrossFieldIssue[] {
  const issues: CrossFieldIssue[] = [];

  if (f.type === 'TRADE' && !f.hasTradeMetadata) {
    issues.push({
      path: 'tradeMetadata',
      message: 'Trade metadata is required for TRADE transactions',
    });
  }
  if (f.type !== 'TRADE' && f.hasTradeMetadata) {
    issues.push({
      path: 'tradeMetadata',
      message: 'Trade metadata should only be provided for TRADE transactions',
    });
  }

  // A trade must be funded from a tracked account. The web form already forces
  // this (paymentMethod='account' → accountId), but the API path did not, which
  // is how NULL-accountId trades slipped in — the Cash Wallet BTC buys whose cash
  // was never debited. Bulk/import paths carry externally-funded exchange trades
  // and go through the ledger gate rather than this rule.
  if (f.type === 'TRADE' && !f.hasFundingAccount) {
    issues.push({
      path: 'accountId',
      message: 'A funding account is required for TRADE transactions',
    });
  }

  // Cash back is a statement about income — a rebate on spending rather than
  // money earned. On any other type the flag has no meaning, and a row carrying
  // a meaningless flag is one nobody can interpret later.
  if (f.isCashBack && f.type !== 'INCOME') {
    issues.push({
      path: 'isCashBack',
      message: 'Cash back can only be set on INCOME transactions',
    });
  }

  if (f.hasBitcoinMetadata) {
    if (f.type === 'TRADE') {
      issues.push({
        path: 'bitcoinMetadata',
        message: 'Bitcoin metadata is not allowed for TRADE transactions; use tradeMetadata',
      });
    }
    if (f.type === 'TRANSFER') {
      issues.push({
        path: 'bitcoinMetadata',
        message:
          'Bitcoin metadata is not allowed for TRANSFER transactions; use the transfer endpoint',
      });
    }
    if (f.hasFundingAccount) {
      issues.push({
        path: 'bitcoinMetadata',
        message: 'Cannot provide both bitcoinMetadata and accountId',
      });
    }
  }

  return issues;
}

/**
 * Create-side validation delegates to the shared rules above.
 *
 * Nothing about the create behaviour changes; the point is that the update path
 * now evaluates the same function, so a rule cannot be enforced in one place and
 * quietly absent in the other — which is exactly what had happened.
 */
export const CreateTransactionSchema = CreateTransactionBaseSchema.superRefine((data, ctx) => {
  for (const issue of transactionCrossFieldIssues({
    type: data.type,
    hasFundingAccount: Boolean(data.accountId),
    hasTradeMetadata: Boolean(data.tradeMetadata),
    hasBitcoinMetadata: Boolean(data.bitcoinMetadata),
    isCashBack: Boolean(data.isCashBack),
  })) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: issue.message,
      path: [issue.path],
    });
  }
});

export const UpdateTransactionSchema = CreateTransactionBaseSchema.extend({
  note: z.string().nullable().optional(),
}).partial();

/**
 * A boolean that survives the query string.
 *
 * `z.coerce.boolean()` cannot be used for a param that is ever sent as `false`:
 * coercion is JavaScript truthiness, and the string `"false"` is truthy, so it
 * arrives as `true`. That is harmless for a flag only ever sent when enabling
 * something (`skipGenerate`), and wrong for anything defaulting to on.
 */
const queryBoolean = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true'));

export const ListTransactionsQuerySchema = z.object({
  type: TransactionTypeSchema.optional(),
  payPeriodId: z.string().optional(),
  expenseId: z.string().optional(),
  incomeId: z.string().optional(),
  accountId: z.string().optional(),
  budgetIds: z.string().optional(),
  purchaseGroupId: z.string().optional(),
  linkedToRecurring: z.coerce.boolean().optional(),
  sortOrder: z.enum(['newest', 'oldest']).default('newest').optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  skipGenerate: z.coerce.boolean().optional(),
  /**
   * Include upcoming scheduled rows alongside real transactions. Default on —
   * seeing what is coming is the normal reading of the page.
   */
  showAnticipations: queryBoolean(true),
  /**
   * Also include anticipations the user has snoozed. Default off: a snooze is a
   * deliberate "not now", so the page stays quiet. Without this the rows were
   * unreachable from here entirely — not deleted, just invisible — so undoing an
   * accidental snooze meant hunting for it elsewhere.
   */
  showSnoozed: queryBoolean(false),
  cursor: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

export const PaginatedTransactionsResponseSchema = z.object({
  transactions: z.array(TransactionSchema),
  totalCount: z.number().int().nonnegative(),
  totalSpent: z.number().optional(),
  totalEarned: z.number().optional(),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  anticipations: z.array(AnticipationSchema).optional(),
});

// ─── Budget Suggestion Schema ───

export const BudgetSuggestionSchema = z.object({
  budgetId: z.string(),
  budgetName: z.string(),
  count: z.number().int().nonnegative(),
});

export const BudgetSuggestionsResponseSchema = z.object({
  suggestions: z.array(BudgetSuggestionSchema),
});

// ─── Response Schemas ───

export const TransactionResponseSchema = TransactionSchema;
export const TransactionListResponseSchema = z.array(TransactionSchema);
