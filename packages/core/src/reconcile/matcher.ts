/**
 * Reconciliation matcher — pure, deterministic, no I/O.
 *
 * Compares a bank statement export against the app's transactions for one
 * account and classifies every row on both sides. It prepares findings only; it
 * never mutates anything.
 *
 * App-specific rules the caller must respect (each produces false positives if
 * missed):
 *  - **Split parents only.** A $120 charge split three ways is ONE bank line but
 *    a parent plus three children in the app. Children must be excluded upstream.
 *  - **Card payments are TRANSFERs** whose card side is `toAccountId`, so they
 *    must be supplied as inbound rows or every payment reads as missing.
 *  - **Match on gross `amount`, not `netAmount`.** Rewards and gift-card offsets
 *    reduce recorded cash movement, but the bank still prints the full charge.
 */

import { nameSimilarity, dayDiff } from './name-similarity.js';
import { classifyLeftovers } from './leftovers.js';
import type {
  AppTx,
  Direction,
  Finding,
  FindingKind,
  ReconcileInput,
  ReconcileOptions,
  ReconcileResult,
  StatementLine,
} from './types.js';

export const DEFAULT_OPTIONS: ReconcileOptions = {
  dateWindowDays: 3,
  amountTolerance: 0.5,
  /**
   * A few cents — the observed drift is 2¢ on a $99.72 buy and 2¢ on a $402.23
   * sell, so this clears it with margin while staying far below the $0.50 typo
   * tolerance. It has to be this tight: it is the only key holding the pairing
   * together once the name gate is dropped.
   *
   * A *proportional* band was the obvious alternative, since the drift really is
   * `unitPrice` rounding × quantity and therefore scales with trade size. It was
   * rejected because it widens exactly where a wrong pairing costs most — 0.05%
   * of a $10,000 trade is $5, which is no longer a rounding artefact but a real
   * difference the user needs to see rather than have silently absorbed.
   * A high-quantity trade whose drift exceeds a nickel falls back to the
   * existing behaviour and is reported, which is the safe direction to fail.
   */
  tradeAmountTolerance: 0.05,
  nameThreshold: 0.55,
  strongNameThreshold: 0.7,
  /**
   * Matches `dateWindowDays`. It was 1, which is stricter than the 1:1 pass for
   * no principled reason: a purchase split across two app entries is often
   * recorded a couple of days from when the bank posted the single line.
   */
  sumDateWindowDays: 3,
  sumNameThreshold: 0.35,
  /**
   * Real data needs more than a handful. A single app "Amazon refund 76.00"
   * covered SIX separate statement returns; at 4 the group is unreachable and
   * reports as one mispair plus five missing rows.
   */
  maxSumParts: 8,
  pendingGraceDays: 5,
  /**
   * How late a charge can post and still be treated as ordinary lag.
   *
   * Inside this window an exact-cent pairing outranks an approximate-amount one;
   * beyond it the date gap is suspicious enough that a close amount on a close
   * date is the better explanation. See KIND_WEIGHT.
   */
  postingLagDays: 10,
};

const round2 = (n: number): number => Math.round(n * 100) / 100;
const cents = (n: number): number => Math.round(n * 100);

function signed(r: { amount: number; direction: Direction }): number {
  return r.direction === 'charge' ? -r.amount : r.amount;
}

type PairKind = Extract<
  FindingKind,
  'matched' | 'amount_mismatch' | 'sign_flip' | 'date_far' | 'amount_differs'
>;

interface Candidate {
  si: number;
  ai: number;
  score: number;
  kind: PairKind;
}

/**
 * Preference order when several pairings compete for the same row.
 *
 * The ordering question that matters: is an EXACT cent match dated a few days
 * off better evidence than an APPROXIMATE amount dated close? Within ordinary
 * posting lag, yes — decisively. A $25.44 charge that posts five days after it
 * was recorded is routine; a $25.44 statement line explained by an $25.00 app
 * row is a guess that two different amounts are the same purchase. Ranking the
 * guess first consumed the statement row and orphaned the real match, producing
 * a false "amounts differ" AND a false "missing from the statement" from one
 * transaction.
 *
 * Beyond that lag the preference inverts: a same-day near-miss beats an exact
 * amount from three weeks away, which is more likely a different purchase that
 * happens to cost the same.
 */
const KIND_WEIGHT: Record<PairKind, number> = {
  matched: 0,
  sign_flip: 1,
  date_far: 2,
  amount_mismatch: 3,
  amount_differs: 5,
};

/** `date_far` drops below `amount_mismatch` once the gap exceeds ordinary lag. */
const DATE_FAR_BEYOND_LAG = 4;

/**
 * Find a subset of `items` whose amounts sum exactly to `target`.
 *
 * Works in integer cents — summing floats and comparing to a float target fails
 * on values that are individually exact but whose sum is not (0.1 + 0.2).
 */
function findSubset<T>(
  items: { row: T; idx: number; amount: number }[],
  target: number,
  maxParts: number,
): { row: T; idx: number }[] | null {
  const goal = cents(target);
  const pool = items.slice(0, 12); // bound the search
  const out: { row: T; idx: number }[] = [];

  const walk = (start: number, remaining: number, depth: number): boolean => {
    if (remaining === 0 && out.length >= 2) return true;
    if (depth === 0 || remaining < 0) return false;
    for (let i = start; i < pool.length; i++) {
      const it = pool[i]!;
      out.push({ row: it.row, idx: it.idx });
      if (walk(i + 1, remaining - cents(it.amount), depth - 1)) return true;
      out.pop();
    }
    return false;
  };

  return walk(0, goal, maxParts) ? [...out] : null;
}

/**
 * Classify every statement line and app transaction.
 *
 * Assignment is global best-first rather than a per-row lookup: identical
 * amounts recur constantly (two $3.48 charges at the same merchant on one day),
 * and a greedy per-row pass pairs those wrong and cascades the error.
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const { statement, app, endDate } = input;
  const o: ReconcileOptions = { ...DEFAULT_OPTIONS, ...input.options };

  // ── Pass 1: score every plausible pairing ──
  const candidates: Candidate[] = [];

  for (let si = 0; si < statement.length; si++) {
    for (let ai = 0; ai < app.length; ai++) {
      const s = statement[si]!;
      const a = app[ai]!;
      const sim = nameSimilarity(s.description, a.name);
      const dd = dayDiff(s.date, a.date);
      const amountEq = round2(s.amount) === round2(a.amount);
      const amountClose = Math.abs(s.amount - a.amount) <= o.amountTolerance;
      const sameDir = s.direction === a.direction;

      /*
       * Name is a TIEBREAKER, not a gate.
       *
       * Bank descriptors are aliases, not spellings. Gating on name similarity
       * rejected most genuine matches on real data. An exact cent amount in the
       * same direction within a few days is already a strong key, and mispairing
       * two candidates that agree on all three has zero financial effect — so
       * name only has to break ties.
       *
       * The exception is `amount_mismatch`: once the amount is allowed to differ
       * the key is no longer pinned, so a name gate is still required there.
       *
       * ...with one exception of its own, for TRADEs. A trade's app amount is
       * computed (`unitPrice × quantity`, rounded) while the broker settles at
       * the actual fill, so the two disagree by a couple of cents on rows that
       * are otherwise identical — and the name gate is unreachable for them,
       * because a statement descriptor like "$120.00 Purchase of Strategy
       * Variable Rate Perpetual Stretch Preferred Stock" scores near zero
       * against "Buy TCKC". Requiring a name there means a trade can never pair,
       * which reports as one phantom plus one missing row for every trade.
       *
       * The gate is replaced rather than removed: `tradeAmountTolerance` is a
       * tenth of the ordinary one, so the amount alone still pins the pairing.
       * Two same-day, same-direction rows agreeing to the nickel, one of them a
       * trade, is not a coincidence worth guarding against.
       */
      const namedNearMiss = amountClose && sim >= o.nameThreshold;
      const tradeNearMiss =
        a.isTrade === true && Math.abs(s.amount - a.amount) <= o.tradeAmountTolerance;

      let kind: PairKind | null = null;
      if (amountEq && sameDir && dd <= o.dateWindowDays) kind = 'matched';
      else if (amountEq && !sameDir && dd <= o.dateWindowDays) kind = 'sign_flip';
      else if (amountEq && sameDir && dd <= 30) kind = 'date_far';
      else if (sameDir && dd <= o.dateWindowDays && (namedNearMiss || tradeNearMiss))
        kind = 'amount_mismatch';
      else if (sameDir && dd <= 1 && sim >= o.strongNameThreshold) kind = 'amount_differs';

      if (!kind) continue;
      const weight =
        kind === 'date_far' && dd > o.postingLagDays ? DATE_FAR_BEYOND_LAG : KIND_WEIGHT[kind];
      candidates.push({ si, ai, kind, score: weight * 1000 - sim * 100 + dd });
    }
  }

  candidates.sort((x, y) => x.score - y.score || x.si - y.si || x.ai - y.ai);

  const usedS = new Set<number>();
  const usedA = new Set<number>();
  const findings: Finding[] = [];

  /*
   * `amount_differs` is DEFERRED until after N:1 sum matching.
   *
   * It is the weakest classification — strong name and tight date but a
   * materially different amount — and it is exactly the shape a grouped entry
   * presents: one app row of 76.00 looks like a near-miss against any one of the
   * bank's six returns. Consuming the app row here starved the sum pass, turning
   * one clean grouping into 1 mispair + 5 "missing" rows and a bogus remainder.
   * Grouping is the stronger explanation, so it runs first; this pass only
   * classifies what grouping could not explain.
   */
  const deferred = candidates.filter((c) => c.kind === 'amount_differs');

  // ── Pass 2: commit the strong pairings ──
  for (const c of candidates) {
    if (c.kind === 'amount_differs') continue;
    if (usedS.has(c.si) || usedA.has(c.ai)) continue;
    usedS.add(c.si);
    usedA.add(c.ai);

    const s = statement[c.si]!;
    const a = app[c.ai]!;
    let delta = 0;
    let note: string | undefined;
    let kind: FindingKind = c.kind;

    if (c.kind === 'matched' && nameSimilarity(s.description, a.name) < o.nameThreshold) {
      // Balance is correct; only the label disagrees.
      kind = 'name_mismatch';
      note = `bank calls it "${s.description}", app has "${a.name}"`;
    } else if (c.kind === 'amount_mismatch') {
      delta = round2(signed(s) - signed(a));
      // The delta is still reported. Pairing a trade explains the difference; it
      // does not absorb it, so the residual keeps showing the cents.
      note = a.isTrade
        ? `statement ${s.amount.toFixed(2)} vs app ${a.amount.toFixed(2)} — a trade's recorded unit price × quantity drifts from the settled amount`
        : `statement ${s.amount.toFixed(2)} vs app ${a.amount.toFixed(2)}`;
    } else if (c.kind === 'sign_flip') {
      delta = round2(signed(s) - signed(a));
      note = `direction differs — app has ${a.direction}, statement has ${s.direction}`;
    } else if (c.kind === 'date_far') {
      note = `dated ${dayDiff(s.date, a.date)} days apart`;
    }

    findings.push({ kind, statement: s, app: a, delta, note });
  }

  /*
   * ── Pass 3: N:1 sum matching ──
   *
   * One statement line can legitimately be several app rows: a $136.90 utility
   * payment entered as separate Water / Sewage / Garbage transactions. Without
   * this pass that reports as 1 missing + 3 phantoms — four findings for zero
   * discrepancy.
   *
   * Guarded tightly (same direction, ±1 day, exact cent sum) because with ~120
   * rows an unconstrained subset-sum finds spurious groups easily. The name
   * signal is the loosest of those guards and can be disabled by setting
   * `sumNameThreshold` to 0.
   */
  const hasNameSignal = (parts: { name: string }[], description: string): boolean =>
    o.sumNameThreshold <= 0 ||
    parts.some((p) => nameSimilarity(description, p.name) >= o.sumNameThreshold);

  // One statement line ← several app rows.
  for (let si = 0; si < statement.length; si++) {
    if (usedS.has(si)) continue;
    const s = statement[si]!;
    const pool = app
      .map((a, i) => ({
        row: a,
        idx: i,
        amount: a.amount,
        sim: nameSimilarity(s.description, a.name),
      }))
      .filter(
        (c) =>
          !usedA.has(c.idx) &&
          c.row.direction === s.direction &&
          dayDiff(c.row.date, s.date) <= o.sumDateWindowDays,
      )
      .sort((x, y) => y.sim - x.sim || x.idx - y.idx);

    const combo = findSubset(pool, s.amount, o.maxSumParts);
    if (!combo) continue;
    const parts = combo.map((c) => c.row);
    if (!hasNameSignal(parts, s.description)) continue;

    usedS.add(si);
    combo.forEach((c) => usedA.add(c.idx));
    findings.push({
      kind: 'grouped_in_app',
      statement: s,
      apps: parts,
      delta: 0,
      note: `one statement line of ${s.amount.toFixed(2)} entered as ${parts.length} app rows summing to it exactly`,
    });
  }

  // One app row ← several statement lines.
  for (let ai = 0; ai < app.length; ai++) {
    if (usedA.has(ai)) continue;
    const a = app[ai]!;
    const pool = statement
      .map((s, i) => ({
        row: s,
        idx: i,
        amount: s.amount,
        sim: nameSimilarity(s.description, a.name),
      }))
      .filter(
        (c) =>
          !usedS.has(c.idx) &&
          c.row.direction === a.direction &&
          dayDiff(c.row.date, a.date) <= o.sumDateWindowDays,
      )
      .sort((x, y) => y.sim - x.sim || x.idx - y.idx);

    const combo = findSubset(pool, a.amount, o.maxSumParts);
    if (!combo) continue;
    const parts = combo.map((c) => c.row);
    if (
      !hasNameSignal(
        parts.map((p) => ({ name: p.description })),
        a.name,
      )
    )
      continue;

    usedA.add(ai);
    combo.forEach((c) => usedS.add(c.idx));
    findings.push({
      kind: 'grouped_in_bank',
      app: a,
      statements: parts,
      delta: 0,
      note: `one app row of ${a.amount.toFixed(2)} covers ${parts.length} statement lines summing to it exactly`,
    });
  }

  // ── Pass 4: leftover near-misses that grouping could not explain ──
  for (const c of deferred) {
    if (usedS.has(c.si) || usedA.has(c.ai)) continue;
    usedS.add(c.si);
    usedA.add(c.ai);
    const s = statement[c.si]!;
    const a = app[c.ai]!;
    findings.push({
      kind: 'amount_differs',
      statement: s,
      app: a,
      delta: round2(signed(s) - signed(a)),
      note: `same merchant and date, but statement ${s.amount.toFixed(2)} vs app ${a.amount.toFixed(2)} (diff ${Math.abs(s.amount - a.amount).toFixed(2)})`,
    });
  }

  // ── Pass 5: unmatched statement lines ──
  for (let si = 0; si < statement.length; si++) {
    if (usedS.has(si)) continue;
    const s = statement[si]!;
    findings.push({ kind: 'missing_in_app', statement: s, delta: round2(signed(s)) });
  }

  // ── Pass 6: unmatched app rows ──
  //
  // A duplicate first (its twin already matched a statement line), otherwise
  // pending if near the end date, otherwise a genuine phantom.
  //
  // Delegated to `classifyLeftovers` because the reconcile UI needs the same
  // verdicts and cannot get them from here — it rebuilds its groups from the
  // persisted pairings, which carry no classification. Two derivations of this
  // rule drifted once already; there is now one.
  const leftoverApp = app.map((a, i) => ({ a, i })).filter(({ i }) => !usedA.has(i));
  const verdicts = classifyLeftovers(
    leftoverApp.map(({ a }) => a),
    app.filter((_, i) => usedA.has(i)),
    endDate,
    o.pendingGraceDays,
  );

  for (const { a } of leftoverApp) {
    const kind: FindingKind = verdicts.get(a.id)!.kind;

    findings.push({
      kind,
      app: a,
      // Pending rows are expected, so they do not count against the remainder.
      delta: kind === 'missing_in_bank_pending' ? 0 : round2(-signed(a)),
      note:
        kind === 'duplicate_in_app'
          ? 'an identical app transaction already matched this statement line'
          : kind === 'missing_in_bank_pending'
            ? 'within grace window — likely not posted yet'
            : undefined,
    });
  }

  const summary = findings.reduce<Partial<Record<FindingKind, number>>>(
    (acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] ?? 0) + 1 }),
    {},
  );
  const remainder = round2(findings.reduce((sum, f) => round2(sum + f.delta), 0));

  return { findings, remainder, summary };
}

export type { StatementLine, AppTx };
