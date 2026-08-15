import { z } from 'zod';

/**
 * Reconciliation schemas.
 *
 * A reconciliation is anchored to the bank's statement ending balance and
 * cannot close while the residual is non-zero. See
 * `.kiro/specs/reconciliation/design.md`.
 */

export const ReconciliationStatusSchema = z.enum(['DRAFT', 'RECONCILED']);
export const MatchTypeSchema = z.enum(['EXACT', 'SUM', 'FUZZY', 'MANUAL']);

/** Bounds every monetary input, per the security hardening in ADR-002. */
const money = z.number().finite().min(-100_000_000).max(100_000_000);

// ─── Residual ───

export const ResidualSchema = z.object({
  openingBalance: z.number(),
  transactionSum: z.number(),
  expectedBalance: z.number(),
  statementEndingBalance: z.number(),
  residual: z.number(),
  isBalanced: z.boolean(),
  /**
   * Signed sum of transactions dated after the period end. Context, never
   * subtracted from the residual — see `lib/reconciliation/residual.ts`.
   */
  activityAfterPeriodEnd: z.number(),
});

// ─── Statement rows ───

export const StatementRowSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  postedDate: z.coerce.date(),
  transactionDate: z.coerce.date(),
  description: z.string(),
  amount: z.number(),
  rawLine: z.string(),
  createdAt: z.coerce.date(),
});

// ─── Matches ───

export const ReconciliationMatchSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  statementRowId: z.string(),
  transactionId: z.string(),
  matchType: MatchTypeSchema,
  createdAt: z.coerce.date(),
});

export const CreateMatchSchema = z.object({
  statementRowId: z.string().min(1),
  transactionId: z.string().min(1),
});

// ─── Merge on combine ───

/**
 * Replace N app transactions with one parent + N child allocations, matched to a
 * single statement row (reconcile-merge). The chosen name is the merged
 * transaction's name; it is asked for explicitly rather than inherited from an
 * arbitrary row (Requirement 2).
 */
export const MergeTransactionsSchema = z.object({
  statementRowId: z.string().min(1),
  /** The app transactions being replaced — at least one. */
  transactionIds: z.array(z.string().min(1)).min(1),
  /** The merged transaction's name — required and non-blank. */
  name: z.string().trim().min(1).max(200),
});

export const MergeResultSchema = z.object({
  /** The created parent transaction (the one row that now mirrors the bank line). */
  parentTransactionId: z.string(),
  /** How many child allocations were created (one per replaced transaction). */
  childCount: z.number().int().nonnegative(),
  match: ReconciliationMatchSchema,
});

// ─── Sessions ───

export const ReconciliationSessionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  statementEndingBalance: z.number(),
  status: ReconciliationStatusSchema,
  residualAtClose: z.number(),
  reconciledAt: z.coerce.date().nullable(),
  adjustmentTransactionId: z.string().nullable(),
  adjustmentReason: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateReconciliationSessionSchema = z
  .object({
    accountId: z.string().min(1),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    /**
     * The bank's ending balance for the period — the external anchor. Required:
     * without it there is no residual, and without a residual there is no
     * completion check, which is the entire point of the feature.
     */
    statementEndingBalance: money,
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: 'periodEnd must be on or after periodStart',
    path: ['periodEnd'],
  });

/**
 * Changes permitted on a draft session: the anchor and the cutoff.
 *
 * The account is fixed at creation. `periodStart` stays derived from the
 * imported rows (it is only the matching window's start). `periodEnd` is the
 * user's cutoff — the date the entered balance is measured at — and IS editable,
 * because it is a stated fact about the reconciliation, not something derived
 * from the file. Welding it to the file's last posted date is exactly what hid
 * activity the user needed inside the comparison.
 *
 * Both fields are optional so a PATCH can change either alone; at least one must
 * be present, or the request changes nothing.
 */
export const UpdateReconciliationSessionSchema = z
  .object({
    statementEndingBalance: money.optional(),
    periodEnd: z.coerce.date().optional(),
  })
  .refine((v) => v.statementEndingBalance !== undefined || v.periodEnd !== undefined, {
    message: 'Provide statementEndingBalance or periodEnd',
  });

/**
 * An app transaction the matcher considered for this session.
 *
 * Returned with the session so the client does not have to re-derive the padded
 * load window — getting that window wrong is what produced 11 false phantoms
 * during the manual investigation, and it should be decided in exactly one place.
 */
export const ReconciliationAppTxSchema = z.object({
  id: z.string(),
  date: z.coerce.date(),
  name: z.string(),
  /** Net of rewards and gift cards — what the statement shows. */
  amount: z.number(),
  /** Rewards + gift card applied, i.e. the part that never reached the card. */
  offset: z.number(),
  type: z.string(),
  /** True when this account is the destination of a transfer. */
  inbound: z.boolean(),
  /**
   * BUY or SELL for a TRADE row, null otherwise.
   *
   * A Cash Wallet trade settles against the cash balance, so reconciliation must
   * know a sell deposits dollars while a buy spends them — `type` only says
   * "TRADE". Kept as a loose string (not an enum) so an unexpected value degrades
   * to "not a sell" rather than failing the whole detail response.
   */
  tradeDirection: z.string().nullable(),
  /**
   * The transaction's existing note.
   *
   * Carried so that marking a row "ignored" can append to it rather than
   * overwrite whatever was already there.
   */
  note: z.string().nullable(),
  /**
   * True when the row is linked to a recurring Expense or Income. A merge deletes
   * the row, removing this occurrence's payment record — disclosed before the
   * merge is applied (reconcile-merge Req 5.1).
   */
  recurringLink: z.boolean(),
  /**
   * True when a ScheduledTransaction is matched to this row. A merge deletes the
   * row, which reverts that scheduled item to PENDING — i.e. a paid bill shows
   * unpaid again (reconcile-merge Req 5.3).
   */
  scheduledMatch: z.boolean(),
});

/** Full session detail: rows, matches, considered transactions, and the residual. */
export const ReconciliationSessionDetailSchema = ReconciliationSessionSchema.extend({
  statementRows: z.array(StatementRowSchema),
  matches: z.array(ReconciliationMatchSchema),
  appTransactions: z.array(ReconciliationAppTxSchema),
  residual: ResidualSchema,
});

// ─── Import ───

export const ImportStatementSchema = z.object({
  /** Raw CSV text. Parsed server-side so the client never decides the shape. */
  csv: z.string().min(1).max(5_000_000),
});

export const ImportStatementResultSchema = z.object({
  imported: z.number(),
  /** Rows skipped because their verbatim source line was already present. */
  skippedDuplicates: z.number(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
});

// ─── Matching ───

export const RunMatchResultSchema = z.object({
  matched: z.number(),
  unmatchedStatement: z.number(),
  unmatchedApp: z.number(),
  summary: z.record(z.string(), z.number()),
});

// ─── Close and the escape hatch ───

export const CloseSessionResultSchema = z.object({
  session: ReconciliationSessionSchema,
  residual: ResidualSchema,
  clearedTransactions: z.number(),
});

export const CreateAdjustmentSchema = z.object({
  /**
   * Why the period could not be balanced. Mandatory and non-empty: the escape
   * hatch exists so a discrepancy can be closed *visibly*, and an adjustment
   * with no stated reason is the invisible absorption this feature was built
   * to eliminate.
   */
  reason: z.string().trim().min(1).max(500),
});

export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;
export type MatchType = z.infer<typeof MatchTypeSchema>;
export type Residual = z.infer<typeof ResidualSchema>;
export type StatementRowRecord = z.infer<typeof StatementRowSchema>;
export type ReconciliationMatchRecord = z.infer<typeof ReconciliationMatchSchema>;
export type ReconciliationSession = z.infer<typeof ReconciliationSessionSchema>;
export type ReconciliationSessionDetail = z.infer<typeof ReconciliationSessionDetailSchema>;
export type CreateReconciliationSession = z.infer<typeof CreateReconciliationSessionSchema>;
export type MergeTransactions = z.infer<typeof MergeTransactionsSchema>;
export type MergeResult = z.infer<typeof MergeResultSchema>;
