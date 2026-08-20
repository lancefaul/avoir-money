/**
 * Classification of app rows the matcher could not pair.
 *
 * This lives apart from `matcher.ts` because two callers need the identical
 * answer and previously each derived its own. The matcher classified leftovers
 * in its final pass; the reconcile UI, which rebuilds its groups from the
 * *persisted pairings* rather than from the matcher's output, had no way to see
 * that work and silently dropped it. The result was one list mixing charges the
 * bank simply has not posted yet with genuine months-old discrepancies, and
 * double-entered transactions shown as ordinary unmatched rows.
 *
 * A pairing is the only thing the matcher persists, so anything it concluded
 * *without* pairing has to be re-derivable. That is what this module is: the
 * derivation, written once, called from both sides.
 */

import { normalizeName, dayDiff } from './name-similarity.js';
import type { Direction } from './types.js';

/**
 * Which way a transaction moved money, from the reconciling account's view.
 *
 * The rule is small but it is not obvious — a TRANSFER is a credit or a charge
 * depending on which side of it this account sits — and it is needed by the
 * matcher, the API's serialization, and the UI's hints. Written once here so
 * the three cannot disagree about whether a row is a refund.
 *
 * A TRADE needs its BUY/SELL direction. When the broker IS the account being
 * reconciled — a Cash Wallet Bitcoin or stock trade settles straight against the
 * cash balance — a BUY spends dollars (charge) and a SELL deposits them
 * (credit). `type` alone says only "TRADE", so without the direction every sell
 * reads as a charge and pairs with its statement credit as a false sign-flip.
 * This mirrors the balance hook's own sign rule (BUY → −amount, SELL → +amount).
 */
export function appTxDirection(tx: {
  type: string;
  inbound: boolean;
  tradeDirection?: string | null;
}): Direction {
  if (tx.inbound || tx.type === 'REFUND' || tx.type === 'INCOME') return 'credit';
  if (tx.type === 'TRADE' && tx.tradeDirection === 'SELL') return 'credit';
  return 'charge';
}

export type LeftoverKind =
  /** An identical app row whose twin already matched a statement line. */
  | 'duplicate_in_app'
  /** In the app, not yet posted — within the pending grace window. */
  | 'missing_in_bank_pending'
  /** In the app, absent from the statement, and too old to be pending. */
  | 'missing_in_bank_phantom';

/** The fields classification needs, on either side. */
export interface LeftoverRow {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  name: string;
  /** Net of rewards and gift cards — what the bank charged. */
  amount: number;
  /**
   * What the purchase actually cost, before rewards and gift cards.
   *
   * Duplicate detection uses this, not `amount`. Two rows are the same
   * transaction entered twice only if they are the same *purchase*; netting to
   * an identical figure is not the same thing. A $25.00 charge and a $40.00
   * basket that nets to $25.00 after $15.00 of rewards look identical to the
   * bank and to `amount`, and are two entirely different purchases — calling
   * them a double entry invites deleting a real one.
   *
   * Optional: a caller without rewards data falls back to `amount`, which is
   * correct for every row where nothing was applied.
   */
  gross?: number;
}

export interface LeftoverVerdict {
  kind: LeftoverKind;
  /**
   * True only when the duplicate call rests on a row that *already matched* the
   * statement, rather than on a second lookalike among the leftovers.
   *
   * The distinction decides how loudly to say it. A matched twin is real
   * evidence — the bank printed the charge once and the app holds it twice. Two
   * unmatched lookalikes are just as often both genuine: the two identical
   * $300.00 Ticketmaster charges are one $600.00 statement line split in half,
   * and calling either a duplicate would be advice to delete good data.
   */
  duplicateOfMatched: boolean;
  /**
   * True when this row is part of a detected re-entry run — a whole period that
   * appears to have been entered twice.
   *
   * Separate from `duplicateOfMatched` because the evidence is of a different
   * kind, not merely a different strength. That flag is a statement about one
   * row; this one is a statement about the set, and it is the only thing that
   * can carry a row whose twin is dated too far away to say anything on its own.
   */
  inDuplicateRun: boolean;
}

/**
 * Days either side of the period end within which an unposted row is ordinary.
 *
 * Deliberately absolute rather than forward-only: a charge made three days
 * before the statement closed can post three days after it, and one dated after
 * the close obviously has not appeared yet. Both are timing, not discrepancy.
 */
export const DEFAULT_PENDING_GRACE_DAYS = 5;

/**
 * How far apart a leftover and its already-matched twin can be dated.
 *
 * Wider than it looks safe, and deliberately so. The check requires that the
 * twin ALREADY MATCHED the statement — the bank printed this merchant and
 * amount exactly once, and the app holds it twice. That constraint does the
 * real work; the date window only has to be generous enough to catch a double
 * entry made days apart, which is how they actually happen. A $16.36 Amazon
 * charge entered on the 25th and again on the 30th is one purchase recorded
 * twice, and an exact-date rule saw nothing at all.
 *
 * A genuine repeat purchase is not caught by this, because the bank would have
 * printed it twice too and both rows would have matched.
 */
export const DEFAULT_DUPLICATE_WINDOW_DAYS = 7;

/**
 * The identity two rows must share to be the same transaction entered twice.
 *
 * Normalized name, exact cents, exact date. Amount is stringified to two places
 * so 2.72 and 2.7200000001 collapse — these arrive from a Decimal column.
 */
const identity = (r: LeftoverRow): string =>
  `${normalizeName(r.name)}|${(r.gross ?? r.amount).toFixed(2)}|${r.date}`;

/**
 * Same merchant and same purchase price, ignoring the date.
 *
 * Compared on gross so that two rows netting to the same figure by different
 * routes — one paid in full, one part-paid with rewards — are not mistaken for
 * one purchase recorded twice.
 */
const sameThing = (a: LeftoverRow, b: LeftoverRow): boolean =>
  normalizeName(a.name) === normalizeName(b.name) &&
  (a.gross ?? a.amount).toFixed(2) === (b.gross ?? b.amount).toFixed(2);

/**
 * How many twinned leftovers it takes before a re-entered period is claimed.
 *
 * This number is the entire safety mechanism. Once the date window is dropped,
 * a single leftover with a far-dated matched twin is evidence of *nothing* — a
 * monthly recurring charge has exactly that shape, and calling it a duplicate is
 * advice to delete a real bill. Five of them, all twinned, all landing inside
 * one period, is not a coincidence any recurring schedule produces.
 */
export const DEFAULT_RUN_MIN_ROWS = 5;

/**
 * How wide the *originals* may span for their copies to count as one re-entry.
 *
 * Measured on the twins rather than on the copies, because the claim being made
 * is that a **period** was entered twice, and the period is defined by the rows
 * that matched the statement — those are the ones known to be real. The copies
 * may sit anywhere, which is the whole point of dropping the date window.
 *
 * 45 days rather than 31: a statement period is rarely a clean calendar month,
 * and a re-entry that straddles two of them is still one mistake.
 */
export const DEFAULT_RUN_MAX_TWIN_SPAN_DAYS = 45;

/** A period that appears to have been entered twice. */
export interface DuplicateRun<T extends LeftoverRow> {
  /** The leftover copies. */
  rows: T[];
  /** The already-matched originals they duplicate, in the same order as `rows`. */
  twins: T[];
  /** Earliest and latest original date (YYYY-MM-DD) — the period being claimed. */
  start: string;
  end: string;
  /** Summed amount of the copies. */
  total: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Find periods that look entered twice.
 *
 * The shape of the check is the design: a **run**, not a per-row lookalike.
 * Individually these rows are unremarkable — that is precisely why the existing
 * seven-day rule cannot see them, and widening that window instead would start
 * accusing monthly recurring charges. Confidence here comes from the count, so
 * the date window is dropped entirely and `minRows` is what holds the line.
 *
 * Deliberately NOT required: that the copies be offset from their originals by a
 * consistent number of days. It is tempting, since a re-imported file shifts
 * uniformly — but the other common shape is a bulk re-entry dated to the day it
 * was typed, where every copy collapses onto one date and no consistent offset
 * exists. Requiring one would catch the tidier mistake and miss the messier one.
 *
 * A false positive here is cheap by construction: the verdict is advisory, it
 * moves no money (a duplicate contributes the same delta as a phantom), and the
 * user still has to act. That is what makes dropping the window acceptable.
 */
export function findDuplicateRuns<T extends LeftoverRow>(
  leftovers: readonly T[],
  matched: readonly T[],
  options: { minRows?: number; maxTwinSpanDays?: number } = {},
): DuplicateRun<T>[] {
  const minRows = options.minRows ?? DEFAULT_RUN_MIN_ROWS;
  const maxSpan = options.maxTwinSpanDays ?? DEFAULT_RUN_MAX_TWIN_SPAN_DAYS;
  if (minRows <= 0 || leftovers.length === 0 || matched.length === 0) return [];

  // Each leftover keeps its NEAREST matched twin: with a month entered twice the
  // same merchant and amount can recur, and pairing against an arbitrary one
  // would report a span wider than the mistake actually was.
  const candidates: { row: T; twin: T }[] = [];
  for (const row of leftovers) {
    let best: T | undefined;
    for (const m of matched) {
      if (!sameThing(m, row)) continue;
      if (!best || dayDiff(m.date, row.date) < dayDiff(best.date, row.date)) best = m;
    }
    if (best) candidates.push({ row, twin: best });
  }
  if (candidates.length < minRows) return [];

  // Greedy split by twin date. Two separate months re-entered fall into separate
  // runs rather than one impossibly wide claim, and no gap parameter is needed —
  // the span cap does the splitting on its own.
  const sorted = [...candidates].sort((a, b) => a.twin.date.localeCompare(b.twin.date));
  const runs: DuplicateRun<T>[] = [];
  let group: { row: T; twin: T }[] = [];

  const flush = (): void => {
    if (group.length < minRows) return;
    const twinDates = group.map((c) => c.twin.date).sort();
    runs.push({
      rows: group.map((c) => c.row),
      twins: group.map((c) => c.twin),
      start: twinDates[0]!,
      end: twinDates[twinDates.length - 1]!,
      total: round2(group.reduce((s, c) => round2(s + c.row.amount), 0)),
    });
  };

  for (const c of sorted) {
    if (group.length > 0 && dayDiff(group[0]!.twin.date, c.twin.date) > maxSpan) {
      flush();
      group = [];
    }
    group.push(c);
  }
  flush();

  return runs;
}

/**
 * Classify every unpaired app row.
 *
 * `matched` is the set of app rows that DID pair. It is required, not optional:
 * a duplicate is only recognisable by its twin, and the twin is by definition
 * the row that matched. Omitting it is exactly the bug this module exists to
 * prevent — the leftover looks like an ordinary unmatched row and the double
 * entry survives the reconciliation.
 *
 * Returned keyed by row id so callers can look up a verdict without re-walking.
 */
export function classifyLeftovers(
  leftovers: readonly LeftoverRow[],
  matched: readonly LeftoverRow[],
  endDate: string,
  pendingGraceDays: number = DEFAULT_PENDING_GRACE_DAYS,
  duplicateWindowDays: number = DEFAULT_DUPLICATE_WINDOW_DAYS,
  runOptions: { minRows?: number; maxTwinSpanDays?: number } = {},
): Map<string, LeftoverVerdict> {
  const seen = new Map<string, number>();
  const out = new Map<string, LeftoverVerdict>();

  // Run detection lives here rather than beside the hints because both callers
  // of this module must reach the same verdict — that is the reason the module
  // exists. A run computed in only one of them is the drift it was written to
  // prevent.
  const inRun = new Set<string>();
  for (const run of findDuplicateRuns(leftovers, matched, runOptions)) {
    for (const r of run.rows) inRun.add(r.id);
  }

  for (const row of leftovers) {
    const key = identity(row);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);

    // Order matters: a matched twin is checked first so its stronger evidence is
    // what gets reported, even when a second leftover lookalike also exists.
    //
    // Dated within a window rather than on the same day. Requiring an exact
    // date meant a purchase entered twice a few days apart — the ordinary way
    // a double entry happens — was reported as an unexplained transaction with
    // no hint that its twin was sitting on the statement already matched.
    const duplicateOfMatched = matched.some(
      (m) => sameThing(m, row) && dayDiff(m.date, row.date) <= duplicateWindowDays,
    );
    // A run outranks the pending window. A copy dated near the period end would
    // otherwise read as "not posted yet", which is the one verdict that excuses
    // a row from the remainder — exactly the wrong answer for a row that should
    // not exist at all.
    const inDuplicateRun = inRun.has(row.id);
    const isDuplicate = duplicateOfMatched || inDuplicateRun || n > 1;

    const kind: LeftoverKind = isDuplicate
      ? 'duplicate_in_app'
      : dayDiff(row.date, endDate) <= pendingGraceDays
        ? 'missing_in_bank_pending'
        : 'missing_in_bank_phantom';

    out.set(row.id, { kind, duplicateOfMatched, inDuplicateRun });
  }

  return out;
}
