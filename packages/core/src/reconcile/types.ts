/**
 * Reconciliation matcher types.
 *
 * `StatementLine` and `AppTx` are the matcher's *inputs* — plain value objects
 * with no database identity. They are deliberately not the Prisma `StatementRow`
 * and `Transaction` models: the matcher is pure and must stay usable from tests,
 * the import tool, and anywhere else without dragging in a database client.
 */

export type Direction = 'charge' | 'credit';

export interface StatementLine {
  /**
   * Caller's stable identifier for this line, carried through untouched so a
   * finding can be mapped back to the exact row it came from.
   *
   * Without it callers must re-identify lines by their values, and (date,
   * description) is emphatically not unique — five identical-merchant charges
   * on one day are ordinary. Collapsing them assigns every finding to whichever
   * row happened to be last and orphans the rest.
   */
  id?: string;
  /** YYYY-MM-DD. */
  date: string;
  description: string;
  /** Absolute value; `direction` carries the sign. */
  amount: number;
  direction: Direction;
}

export interface AppTx {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  name: string;
  /**
   * Gross amount — what the statement would show. Not `netAmount`: rewards and
   * gift-card offsets reduce what the app records as cash moved, but the bank
   * still prints the full charge. Matching on netAmount misses those rows.
   */
  amount: number;
  direction: Direction;
  /**
   * True when this row is a securities trade.
   *
   * The matcher needs it because a trade's amount is *computed* — the app stores
   * `unitPrice × quantity` rounded to cents, while the broker settles at the
   * actual fill — so the two sides legitimately disagree by a few cents on a
   * transaction that is otherwise a perfect match. That drift is a property of
   * the app row, and only the app row: a statement line carries no type, so the
   * relaxation it enables can never key off the statement side.
   */
  isTrade?: boolean;
}

export type FindingKind =
  /** Statement line and app row agree on amount, direction, and date. */
  | 'matched'
  /** Paired, but the amounts differ by less than the typo tolerance. */
  | 'amount_mismatch'
  /** Paired on amount and date, but recorded in opposite directions. */
  | 'sign_flip'
  /** Paired on amount and direction, but dated far apart. */
  | 'date_far'
  /** On the statement, absent from the app. */
  | 'missing_in_app'
  /** In the app, not yet posted — within the pending grace window. */
  | 'missing_in_bank_pending'
  /** In the app, absent from the statement, and too old to be pending. */
  | 'missing_in_bank_phantom'
  /** An identical app row whose twin already matched a statement line. */
  | 'duplicate_in_app'
  /**
   * Paired on amount, date, and direction, but the merchant names disagree —
   * the bank's descriptor is an alias. Balance is unaffected; surfaced so the
   * label can be corrected or ignored.
   */
  | 'name_mismatch'
  /** One statement line explained by several app rows summing to it exactly. */
  | 'grouped_in_app'
  /** One app row explained by several statement lines summing to it exactly. */
  | 'grouped_in_bank'
  /**
   * Same merchant and date, amount differs too much to be a typo — often
   * combined receipts. Paired so the relationship is visible instead of
   * orphaning both sides.
   */
  | 'amount_differs';

export interface Finding {
  kind: FindingKind;
  statement?: StatementLine;
  app?: AppTx;
  /** Set when one row on the other side is explained by several rows here. */
  statements?: StatementLine[];
  apps?: AppTx[];
  /** Signed effect on the unexplained remainder. */
  delta: number;
  note?: string;
}

export interface ReconcileOptions {
  /** Days of posting slack allowed for a match. */
  dateWindowDays: number;
  /** Absolute dollar tolerance for the "probable typo" bucket. */
  amountTolerance: number;
  /**
   * Absolute dollar tolerance for pairing a TRADE with no name agreement.
   *
   * Deliberately far tighter than `amountTolerance`, because this is the one
   * pairing where the amount carries the entire key — see `matcher.ts`.
   */
  tradeAmountTolerance: number;
  /** Name similarity 0..1 required to consider two rows the same merchant. */
  nameThreshold: number;
  /** Higher bar used to pair rows whose amounts materially disagree. */
  strongNameThreshold: number;
  /** Date slack when summing several rows against one on the other side. */
  sumDateWindowDays: number;
  /**
   * Lower name bar for sum-matching: at least one part must clear it. Set to 0
   * to disable the gate entirely — bank descriptors are aliases and can score
   * near zero against a correct match, so this trades missed groupings against
   * spurious subset-sum groups. See the note in `matcher.ts`.
   */
  sumNameThreshold: number;
  /** Largest group considered when sum-matching. */
  maxSumParts: number;
  /** App rows within this many days of `endDate` are presumed pending, not phantom. */
  pendingGraceDays: number;
  /**
   * Ordinary posting lag. Within it, an exact-cent pairing outranks an
   * approximate-amount one; beyond it that preference inverts.
   */
  postingLagDays: number;
}

export interface ReconcileInput {
  statement: StatementLine[];
  app: AppTx[];
  /**
   * The statement's period end (YYYY-MM-DD). Required, never defaulted to
   * "today": pending-vs-phantom classification depends on it, so a
   * clock-derived default would make identical inputs produce different output
   * on different days, breaking determinism.
   */
  endDate: string;
  options?: Partial<ReconcileOptions>;
}

export interface ReconcileResult {
  findings: Finding[];
  /** Sum of every finding's delta — the unexplained difference. */
  remainder: number;
  summary: Partial<Record<FindingKind, number>>;
}
