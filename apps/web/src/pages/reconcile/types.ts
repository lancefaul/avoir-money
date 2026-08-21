import type { ReconciliationSessionDetail, Residual } from '@budget-tracker/core';

export type { ReconciliationSessionDetail, Residual };

/** The three steps of the reconcile flow. */
export type Step = 'setup' | 'reconcile' | 'finish';

export const STEP_ORDER: Step[] = ['setup', 'reconcile', 'finish'];

/**
 * How a difference is presented to the user.
 *
 * These mirror the matcher's finding kinds but collapse them into the four
 * groups the UI actually shows — the matcher distinguishes twelve outcomes, and
 * most of them mean "nothing to do here".
 */
export type DifferenceGroup =
  | 'amount_differs'
  | 'combination'
  | 'on_statement_not_in_app'
  | 'in_app_not_on_statement'
  | 'pending_in_app'
  | 'cancelled_on_statement'
  | 'matched';

/** One row on the bank's side of a decision. */
export interface StatementSide {
  /** The `StatementRow` id, used when pairing by hand. */
  id: string;
  date: string;
  description: string;
  amount: number;
  /**
   * Which way the money moved. Shown explicitly because a charge and a refund
   * of the same amount are otherwise indistinguishable once the sign is
   * stripped — two $28.85 rows that are actually a purchase and its reversal
   * read as a duplicate charge.
   */
  direction?: 'charge' | 'credit';
}

/** One row on the app's side of a decision. */
export interface AppSide {
  id: string;
  date: string;
  name: string;
  /** Net of rewards and gift cards. */
  amount: number;
  /** Rewards + gift card applied, so a correction can rebuild the gross. */
  offset?: number;
  direction?: 'charge' | 'credit';
  /** Existing note, so an ignore appends to it rather than replacing it. */
  note?: string | null;
  /**
   * The transaction type, used to decide whether a combination can be merged: a
   * merge collapses the rows into one typed parent, so they must all be the same
   * EXPENSE or REFUND (a mixed set stays a pairing). See `mergeEligible`.
   */
  type?: string;
  /** Linked to a recurring Expense/Income — a merge drops this occurrence's record (disclosure). */
  recurringLink?: boolean;
  /** Matched to a scheduled item — a merge reverts it to unpaid (disclosure). */
  scheduledMatch?: boolean;
}

/**
 * Whether a combination's app rows can be merged into one parent transaction.
 *
 * The split model stores every child with the parent's single type, so a merge
 * needs all rows to be the same type and that type to be EXPENSE or REFUND. A
 * mixed set, or one containing an income/transfer/trade, stays a plain pairing.
 * The server re-enforces this — this only decides which button to offer.
 */
export function mergeEligible(apps: AppSide[]): boolean {
  if (apps.length === 0) return false;
  const first = apps[0]!.type;
  if (first !== 'EXPENSE' && first !== 'REFUND') return false;
  return apps.every((a) => a.type === first);
}

/**
 * One decision the user has to make.
 *
 * Both sides are arrays because a decision is not always one row against one
 * row: a single statement line can be explained by several app transactions, or
 * one app entry can cover several statement lines. Modelling those as a single
 * row plus a count meant the other rows had nowhere to be displayed, so the
 * screen showed one of them and described the rest in prose.
 *
 * Either array may be empty — a charge the app never recorded has no app side,
 * and a transaction the bank never posted has no statement side.
 */
export interface ResolutionItem {
  key: string;
  /**
   * What was found, shown as the card's heading.
   *
   * Distinct from the recommendation: the heading says what the reconciler
   * noticed ("Possibly 2 app transactions combined"), the recommendation says
   * what to do about it ("Combine them into one transaction"). Falls back to
   * the group's title when a decision has nothing more specific to add.
   */
  title?: string;
  /** Overrides the group's recommendation for this one decision. */
  recommendation?: string;
  statements: StatementSide[];
  apps: AppSide[];
  /** Effect on the residual if this decision is left as-is. */
  delta: number;
  note?: string;
  /** Ids of the matches backing this pairing, so it can be undone. */
  matchIds?: string[];
}

/**
 * Same-merchant leftovers that do NOT add up — advisory only.
 *
 * The bank shows one "CityWater" charge, the app holds two "CityWater" rows, and
 * they do not sum, so no combination could claim them and they scatter across
 * the on-statement and in-app sections with nothing linking them. This gathers
 * them so the screen can show both sides and the gap between them in one place.
 *
 * It asserts nothing and offers no action: because the members do not sum, they
 * can never feed the merge, which refuses a non-summing set. It is a spotlight
 * and an on-ramp to the tools that are safe — correct a row so the group adds
 * up, then combine — never a claim that these rows belong together. The member
 * rows still appear, and are still resolved, in their normal sections below.
 */
export interface ClusterHint {
  /** Stable key derived from the member rows. */
  key: string;
  /** A representative merchant name for the group's heading. */
  label: string;
  direction: 'charge' | 'credit';
  statements: StatementSide[];
  apps: AppSide[];
  statementTotal: number;
  appTotal: number;
  /** Absolute difference between the two totals — what does not reconcile. */
  gap: number;
}

/**
 * A period that appears to have been entered twice — advisory only.
 *
 * The rows in it are individually unremarkable, which is the whole problem: a
 * copy dated a month from its original looks exactly like an ordinary unmatched
 * transaction, and thirty of them look like thirty unrelated discrepancies. The
 * claim can only be made about the set, so the set is what gets shown.
 *
 * Like `ClusterHint` it offers no action and stages nothing. Deleting a month of
 * transactions on a heuristic is not something a screen should offer, and the
 * member rows are still listed and still resolvable in their own sections — this
 * only says the word "re-entered" out loud so the user can go and check.
 */
export interface ReentryHint {
  /** Stable key derived from the member rows. */
  key: string;
  /** The period the ORIGINALS span — what is being claimed as entered twice. */
  start: string;
  end: string;
  /** The duplicate copies. */
  apps: AppSide[];
  /** Summed value of the copies. */
  total: number;
}

/**
 * A decision the user has made, held until step 3 applies it.
 *
 * Step 2 writes NOTHING. It used to act on every click — creating, deleting and
 * re-matching as you scanned — so a row you touched vanished under you and its
 * neighbours re-sorted, and there was no way back. A reconciliation is a review;
 * the writes belong at the end of it, once, deliberately, with a summary of
 * everything about to happen.
 *
 * Pairing is staged too. It writes no ledger data, but "combined" is still a
 * decision about the period, and having half the actions take effect
 * immediately while the other half wait would be the worst of both.
 */
export type StagedAction =
  | {
      kind: 'create';
      /** The line being explained; also what the review row is titled with. */
      statementRowId: string;
      name: string;
      amount: number;
      /** YYYY-MM-DD. */
      date: string;
      txType: 'EXPENSE' | 'INCOME';
      /** Null until chosen in step 3 — the server assigns Uncategorized. */
      budgetId: string | null;
    }
  | { kind: 'correct'; transactionId: string; amount: number; was: number; label: string }
  | {
      kind: 'edit';
      transactionId: string;
      name: string;
      /** YYYY-MM-DD. */
      date: string;
      amount: number;
      /** What the row said before, so the summary can show the change. */
      was: { name: string; date: string; amount: number };
    }
  | {
      /**
       * The user has looked and is content.
       *
       * Recorded on the transactions themselves rather than only in this
       * session. A session is scaffolding for one sitting — abandon it and the
       * judgement is gone, so the same row is flagged again next month and
       * re-examined from scratch. Appending to the note makes "I have already
       * looked at this" outlive the reconciliation that produced it.
       *
       * EVERY app row in the decision is annotated, not just the first. A
       * decision can hold four transactions summing to one statement line;
       * marking one of them left the other three unmarked, so the whole group
       * came back on the next match as though nothing had been decided.
       */
      kind: 'ignore';
      label: string;
      /**
       * The app rows to mark permanently, and their notes so the marker is
       * appended not substituted.
       *
       * Absent when the dismissal must not outlive the period — a row that has
       * not posted yet, or an amount that disagrees with the bank. Those are
       * remembered for the sitting only (see `DURABLE_IGNORE_GROUPS`), so the
       * next statement asks about them again with fresh facts.
       */
      transactions?: { id: string; note?: string | null }[];
    }
  | { kind: 'delete'; transactionId: string; label: string }
  | {
      kind: 'pair';
      /** A match is keyed by its statement row, so N:1 needs one entry per row. */
      pairs: { statementRowId: string; transactionIds: string[] }[];
      label: string;
    }
  | {
      /**
       * Replace N app rows with one parent transaction at the bank's amount and
       * date, split across the budgets the originals carried, matched to the
       * statement line — the ledger then mirrors the statement one row per row.
       * The whole thing is one atomic request (`POST /reconciliations/:id/merge`).
       */
      kind: 'merge';
      /** The statement line the merged parent is matched to. */
      statementRowId: string;
      /** The merged transaction's name, seeded from the statement description and settled in step 3. */
      name: string;
      /** The rows being replaced — carried for the request, the step-3 breakdown, and the disclosure. */
      parts: {
        transactionId: string;
        name: string;
        amount: number;
        recurringLink: boolean;
        scheduledMatch: boolean;
      }[];
      label: string;
    };

/**
 * What happened to a decision when Apply ran.
 *
 * Recorded per decision rather than as one batch flag because the batch is not
 * atomic — these are separate HTTP requests, and a failure halfway leaves the
 * earlier ones committed. The user needs to see which, and a retry needs to
 * know what to skip.
 */
export interface AppliedResult {
  ok: boolean;
  error?: string;
}

/** One line of the step-3 summary: what will happen, in the user's words. */
export function describeStaged(action: StagedAction): string {
  switch (action.kind) {
    case 'create':
      return `Create “${action.name}”`;
    case 'correct':
      return `Change ${action.label} to the bank's figure`;
    case 'edit':
      return `Correct “${action.was.name}”`;
    case 'ignore':
      return `Leave ${action.label} as it is`;
    case 'delete':
      return `Delete ${action.label}`;
    case 'pair':
      return action.label;
    case 'merge':
      return `Merge ${action.parts.length} rows into “${action.name}”`;
  }
}

/**
 * The row a single-sided action operates on.
 *
 * Actions like "use the bank's amount" or "delete this transaction" act on one
 * row even when the decision holds several. Reading `[0]` through a named
 * helper keeps that assumption visible rather than scattered across the modal.
 */
/**
 * The sentence appended to a transaction the user chose to ignore.
 *
 * Deliberately a fixed, greppable prefix followed by the date: a future
 * reconciliation (or a person) can find every previously-dismissed row by
 * searching for it, which a free-form remark would not allow.
 */
export const IGNORED_NOTE_PREFIX = 'Reviewed during reconciliation';

export function appendIgnoredNote(existing: string | null | undefined, on: string): string {
  const marker = `${IGNORED_NOTE_PREFIX} on ${on}: left as-is.`;
  const trimmed = (existing ?? '').trim();
  return trimmed ? `${trimmed} ${marker}` : marker;
}

/**
 * Groups where "leave it" is a permanent judgement about the row.
 *
 * A dismissal is only allowed to outlive the period when the thing dismissed
 * cannot change. Two qualify:
 *
 * - `in_app_not_on_statement` — recorded, long past due to post, and still
 *   absent. That verdict is about history and history does not move.
 * - `combination` — "these rows do belong together" stays true.
 *
 * Everything else is deliberately excluded, and `pending_in_app` is the reason
 * the distinction exists at all. A charge that has not posted yet posts LATER,
 * and often not for the amount the app holds: a restaurant tab settles with the
 * tip added, and a hand-entered figure is only ever as good as the typing. A
 * permanent marker on such a row would hide the very statement line that proves
 * it wrong — the row would never be asked about again, and the discrepancy
 * would sit in the residual with nothing on screen accounting for it.
 *
 * `amount_differs` is excluded for the same reason from the other direction: a
 * disagreement between the app's figure and the bank's is a live arithmetic
 * fact, not a question a past dismissal is entitled to answer. If the delta
 * changes, it is a new question.
 */
const DURABLE_IGNORE_GROUPS: ReadonlySet<string> = new Set<DifferenceGroup>([
  'in_app_not_on_statement',
  'combination',
]);

/**
 * The "leave this alone" decision for a row.
 *
 * One definition because two callers produce it — the button on a card and
 * Ignore-all on a section — and they must record exactly the same thing. A
 * bulk action that staged a subtly different shape would apply differently.
 *
 * The group decides how long the dismissal lasts. Outside the durable groups
 * nothing is written at all: the decision holds for this sitting and the row is
 * examined afresh next period.
 */
export function ignoreActionFor(item: ResolutionItem, group?: DifferenceGroup): StagedAction {
  const durable = group !== undefined && DURABLE_IGNORE_GROUPS.has(group);
  return {
    kind: 'ignore',
    label: item.apps[0]?.name ?? item.statements[0]?.description ?? 'this row',
    // Every row the decision holds, not just the first — taking `[0]` was why
    // an ignored four-row combination reappeared intact on the next match.
    ...(durable && item.apps.length > 0
      ? { transactions: item.apps.map((a) => ({ id: a.id, note: a.note })) }
      : {}),
  };
}

/**
 * Has this row already been dismissed in an earlier reconciliation?
 *
 * The marker is what makes an ignore stick. Written but never read, it was
 * decoration: the row was re-derived from scratch every time and asked about
 * again, which is exactly what "ignore" is supposed to prevent.
 */
export function isIgnoredNote(note: string | null | undefined): boolean {
  return (note ?? '').includes(IGNORED_NOTE_PREFIX);
}

/**
 * A decision that is entirely accounted for by earlier dismissals.
 *
 * Every row it holds must be individually marked, and it must be in a group
 * where the marker is allowed to speak. A decision that is half dismissed is
 * still a live question — the rows that remain are the ones that do not add up,
 * and hiding them because their neighbours were cleared would bury the part
 * that still needs an answer.
 */
export function isDurablyIgnored(item: ResolutionItem, group: DifferenceGroup): boolean {
  if (!DURABLE_IGNORE_GROUPS.has(group)) return false;
  if (item.apps.length === 0) return false;
  return item.apps.every((a) => isIgnoredNote(a.note));
}

export const primaryStatement = (i: ResolutionItem): StatementSide | undefined => i.statements[0];
export const primaryApp = (i: ResolutionItem): AppSide | undefined => i.apps[0];

export interface GroupMeta {
  title: string;
  hint: string;
  /** The suggested action. Never applied automatically. */
  recommendation: string;
}

export const GROUP_META: Record<Exclude<DifferenceGroup, 'matched'>, GroupMeta> = {
  amount_differs: {
    title: 'Amounts differ',
    hint: 'Same transaction but slightly different amounts.',
    recommendation: 'Use the statement amount.',
  },
  combination: {
    title: 'Rows to combine',
    hint: 'Several rows in Avoir add up to a single transaction on the statement.',
    recommendation: 'Combine them into one transaction',
  },
  on_statement_not_in_app: {
    title: 'On statement, not in app',
    hint: 'A real movement the app never recorded.',
    recommendation: 'Create new transaction',
  },
  in_app_not_on_statement: {
    title: 'In app, not on statement',
    // Now that pending rows have their own group, what remains here is genuinely
    // unexplained: recorded during the period, old enough to have posted, and
    // still absent from the statement.
    hint: 'Recorded in the period but never posted.',
    // Deliberately NOT "delete". These are mostly timing artifacts; during the
    // manual investigation a too-wide window produced 11 rows that looked
    // exactly like phantoms and were every one of them real. Recommending
    // deletion here would train the user to destroy good data.
    recommendation: 'Leave it',
  },
  cancelled_on_statement: {
    title: 'Charged and refunded',
    hint: 'Reversed on the same statement — nets to zero.',
    // The pair nets to zero, so recording neither side is already correct —
    // but recording both is legitimate if you want the merchant history, which
    // is why this offers a choice rather than an instruction.
    recommendation: 'Ignore or create new transaction for matching purposes.',
  },
  pending_in_app: {
    title: 'Not posted yet',
    hint: 'Charged near the statement close — expected.',
    // These are the least interesting rows on the page and the most numerous at
    // the end of a period. Listed separately so they stop competing with the
    // real discrepancies for attention, and worded so the user does not act.
    recommendation: 'Nothing to do — posts next period',
  },
};
