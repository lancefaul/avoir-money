/**
 * Advisory hints over the rows the matcher could not pair.
 *
 * This is deliberately NOT a second matcher. The matcher decides what pairs; if
 * it could have paired these rows it already would have. This layer only points
 * at leftovers that look related — two identical charges that may be one
 * transaction entered twice, or several rows that add up to a single line — so
 * the user can confirm or dismiss. Nothing here ever pairs anything.
 *
 * It exists because the alternative is worse: the guards that stop the matcher
 * inventing pairings (name similarity, date windows) also stop it from telling
 * you a split *might* be there. A hint carries no risk — the user still has to
 * act on it — so it can be far looser than a match.
 */

import { nameSimilarity } from './name-similarity.js';

const cents = (n: number): number => Math.round(n * 100);

/** The shape both sides share: an identified, dated, signed row. */
export interface HintRow {
  id: string;
  date: string;
  /** Absolute value; `direction` carries the sign. */
  amount: number;
  /**
   * Merchant name or bank descriptor, when the caller has one.
   *
   * Used only by `findReversals`, which needs the extra confidence: it is the
   * one hint that tells the user to do *nothing*, so a coincidental pair would
   * excuse a real discrepancy rather than merely mislabel it.
   */
  label?: string;
  /**
   * Which way the money moved.
   *
   * Optional only so a caller that genuinely has no direction can still get
   * hints. Supply it whenever it is known: amounts reach here with the sign
   * already stripped, so without it a $28.85 purchase and the $28.85 refund
   * that reversed it are indistinguishable — and they are the single most
   * common pair of same-amount, same-day rows there is.
   */
  direction?: 'charge' | 'credit';
}

/**
 * Whether two rows moved money the same way.
 *
 * Unknown direction on either side is permissive: a caller that cannot supply
 * it gets the old behaviour rather than no hints at all.
 */
const sameDirection = (a: HintRow, b: HintRow): boolean =>
  a.direction === undefined || b.direction === undefined || a.direction === b.direction;

export interface HintOptions {
  /** How far apart two rows can be dated and still look like duplicates. */
  duplicateDateWindowDays: number;
  /** Name similarity two rows must clear to be called duplicates. */
  duplicateNameThreshold: number;
  /** How far a part can sit from the row it may combine into. */
  combinationDateWindowDays: number;
  /** Largest combination suggested. Kept small — long combinations are noise. */
  maxCombinationParts: number;
  /** How long after a charge its refund can post and still read as a reversal. */
  reversalDateWindowDays: number;
  /** Name similarity a reversal pair must clear. See `findReversals`. */
  reversalNameThreshold: number;
  /**
   * Name similarity two rows must clear to land in the same cluster.
   *
   * Higher than every other hint's bar because a cluster has NO amount anchor —
   * its members deliberately do not add up — so the name is doing nearly all the
   * work. See `findClusters`.
   */
  clusterNameThreshold: number;
  /** How far apart two clustered rows can be dated. */
  clusterDateWindowDays: number;
}

export const DEFAULT_HINT_OPTIONS: HintOptions = {
  duplicateDateWindowDays: 1,
  duplicateNameThreshold: 0.5,
  combinationDateWindowDays: 4,
  /**
   * Five. It was three, on the reasoning that "these 7 rows might add up" is
   * not actionable prose — but a combination is no longer prose. It is a card
   * showing every row it names, so the user can check the arithmetic by
   * looking. Real baskets split further than three: five Amazon charges
   * against one order refund is an ordinary shape.
   *
   * Still well below the matcher's eight, because a hint pairs rows the
   * matcher already declined to pair, and longer subsets hit by coincidence
   * far more often than short ones.
   */
  maxCombinationParts: 5,
  reversalDateWindowDays: 3,
  reversalNameThreshold: 0.5,
  /**
   * The strong bar (0.7). Every other hint pins the amount to the cent and lets
   * the name be loose; a cluster is the opposite — the amounts are exactly what
   * do NOT reconcile, so the name is the only evidence the rows belong together
   * and it has to be strong. A false cluster only draws the eye to two rows and a
   * gap, which the user reads and dismisses, so this is not as costly to get
   * wrong as a match — but noise is still noise, and 0.7 keeps it obviously-right.
   */
  clusterNameThreshold: 0.7,
  /** The combination window: a cluster is "a combination that didn't quite sum". */
  clusterDateWindowDays: 4,
};

const dayDiff = (a: string, b: string): number =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Groups of rows that may be the same thing entered more than once.
 *
 * Same amount to the cent, same direction, same merchant, dated within the
 * window.
 *
 * The merchant used to be ignored, on the reasoning that a duplicate is the
 * same merchant anyway so the name adds nothing. It adds nothing when the guess
 * is right and everything when it is wrong: two *unrelated* charges that happen
 * to cost the same on the same day were reported as a duplicate pair. On a real
 * statement that is not rare — a lone $25.00 Amazon charge was accused of being
 * a double entry because something else that day also cost $25.00.
 *
 * Direction matters for the same reason. A charge and the refund that reversed
 * it share an amount and a date and are the opposite of a duplicate — one
 * cancels the other, and calling them duplicates invites deleting half of a
 * correctly recorded pair.
 */
export function findDuplicates<T extends HintRow>(
  rows: T[],
  options: Partial<HintOptions> = {},
): T[][] {
  const o = { ...DEFAULT_HINT_OPTIONS, ...options };
  const groups: T[][] = [];
  const claimed = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]!;
    if (claimed.has(a.id)) continue;
    const group = [a];
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j]!;
      if (claimed.has(b.id)) continue;
      if (cents(a.amount) !== cents(b.amount)) continue;
      if (!sameDirection(a, b)) continue;
      if (dayDiff(a.date, b.date) > o.duplicateDateWindowDays) continue;
      // Unknown names stay permissive, so a caller without labels keeps the
      // old behaviour rather than losing duplicate detection entirely.
      if (a.label && b.label && nameSimilarity(a.label, b.label) < o.duplicateNameThreshold) {
        continue;
      }
      group.push(b);
    }
    if (group.length > 1) {
      for (const r of group) claimed.add(r.id);
      groups.push(group);
    }
  }

  return groups;
}

export interface Reversal<T extends HintRow> {
  charge: T;
  credit: T;
}

/**
 * Charges that were refunded in full on the same statement.
 *
 * A $28.85 purchase and the $28.85 refund that undid it are one non-event: they
 * cancel to zero, the account balance never moved, and an app that recorded
 * neither is *correct*. Reported as ordinary missing rows they read as two
 * discrepancies and the screen advises creating two transactions that would
 * sum to nothing — the most confidently wrong output the reconciler produced.
 *
 * The bar here is higher than for other hints, because this is the only one
 * whose advice is "do nothing": a coincidental pair would excuse a real
 * discrepancy instead of just mislabelling it. So a reversal needs the same
 * cents, opposing directions, a tight date window, AND a matching descriptor.
 * Without a usable name on both sides it declines to guess.
 *
 * Each row is claimed once — a charge refunded twice is not a thing, and
 * offering the same refund against two charges is advice that cannot be taken.
 */
export function findReversals<T extends HintRow>(
  rows: T[],
  options: Partial<HintOptions> = {},
): Reversal<T>[] {
  const o = { ...DEFAULT_HINT_OPTIONS, ...options };
  const out: Reversal<T>[] = [];
  const claimed = new Set<string>();

  const charges = rows.filter((r) => r.direction === 'charge');
  const credits = rows.filter((r) => r.direction === 'credit');

  for (const charge of charges) {
    if (claimed.has(charge.id)) continue;
    const credit = credits.find(
      (c) =>
        !claimed.has(c.id) &&
        cents(c.amount) === cents(charge.amount) &&
        dayDiff(c.date, charge.date) <= o.reversalDateWindowDays &&
        // Both descriptors are required. A missing one is not treated as a
        // match: silence is not evidence, and the cost of being wrong here is
        // hiding a genuine gap behind "nothing to do".
        Boolean(charge.label) &&
        Boolean(c.label) &&
        nameSimilarity(charge.label!, c.label!) >= o.reversalNameThreshold,
    );
    if (!credit) continue;
    claimed.add(charge.id);
    claimed.add(credit.id);
    out.push({ charge, credit });
  }

  return out;
}

export interface Combination<Target extends HintRow, Part extends HintRow> {
  target: Target;
  parts: Part[];
}

/** Smallest subset of `pool` summing exactly to `goal`, or null. */
function subsetSummingTo<T extends HintRow>(pool: T[], goal: number, maxParts: number): T[] | null {
  const out: T[] = [];
  const walk = (start: number, remaining: number, depth: number): boolean => {
    if (remaining === 0 && out.length >= 2) return true;
    if (depth === 0 || remaining < 0) return false;
    for (let i = start; i < pool.length; i++) {
      out.push(pool[i]!);
      if (walk(i + 1, remaining - cents(pool[i]!.amount), depth - 1)) return true;
      out.pop();
    }
    return false;
  };
  return walk(0, goal, maxParts) ? [...out] : null;
}

/**
 * Targets that several parts add up to exactly.
 *
 * One statement line recorded as two app entries, or one app entry covering two
 * statement lines. Each part is offered once: suggesting the same row as an
 * ingredient of two different combinations would be advice the user cannot act
 * on twice.
 */
export function findCombinations<Target extends HintRow, Part extends HintRow>(
  targets: Target[],
  parts: Part[],
  options: Partial<HintOptions> = {},
): Combination<Target, Part>[] {
  const o = { ...DEFAULT_HINT_OPTIONS, ...options };
  const out: Combination<Target, Part>[] = [];
  const used = new Set<string>();

  // Largest targets first: a big line explained by small parts is the shape
  // worth surfacing, and it keeps small rows from being consumed by a
  // coincidental pairing before their real target is considered.
  const ordered = [...targets].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  for (const target of ordered) {
    const pool = parts
      .filter(
        (p) =>
          !used.has(p.id) &&
          p.id !== target.id &&
          // Same reason as duplicates: a refund is not an ingredient of a
          // charge. Summing across directions invents combinations that no
          // arrangement of the real rows could produce.
          sameDirection(p, target) &&
          dayDiff(p.date, target.date) <= o.combinationDateWindowDays,
      )
      // Bound the search; nearest dates are the likeliest ingredients.
      .sort((x, y) => dayDiff(x.date, target.date) - dayDiff(y.date, target.date))
      .slice(0, 12);

    const combo = subsetSummingTo(pool, cents(Math.abs(target.amount)), o.maxCombinationParts);
    if (!combo) continue;
    for (const p of combo) used.add(p.id);
    out.push({ target, parts: combo });
  }

  return out;
}

export interface Cluster<S extends HintRow, A extends HintRow> {
  /** The statement-side leftovers in this cluster (at least one). */
  statements: S[];
  /** The app-side leftovers in this cluster (at least one). */
  apps: A[];
}

/**
 * Same-merchant leftovers whose amounts do NOT reconcile.
 *
 * The case this exists for: the bank shows one "CITY UTILITIES" charge, the app holds
 * two "CityWater" rows, and they do not add up. `findCombinations` requires an
 * exact sum and so declines them; they then fall to opposite leftover
 * sections — one "missing from app", the others "missing from statement" — with
 * nothing linking them, and the user has to notice the relationship by eye.
 *
 * This finds those relationships and hands them back grouped, so the caller can
 * show both sides and the gap between them in one place. It is emphatically
 * advisory: it asserts nothing, pairs nothing, and — because the members do not
 * sum — it can never feed the merge action, which refuses a non-summing set. It
 * is a spotlight, and an on-ramp to the tools that ARE safe (correct a row so
 * they add up, then combine).
 *
 * Both sides are the leftover rows the caller has left AFTER combination-finding,
 * so a cluster's non-zero gap is inherent. A cluster is a connected component of
 * the "same merchant, same direction, near in time" graph over both sides at
 * once, kept only when it spans both — a same-side-only group has no gap to
 * show, which is the whole value here. Because the name is the only anchor
 * (`clusterNameThreshold`), a missing label on either side is not a link, as in
 * `findReversals`: silence is not evidence.
 *
 * The graph is connected, not a clique, so a chain of near-identical descriptors
 * can in principle draw two merchants together. At the strong 0.7 bar over the
 * handful of rows that survive matching this is rare, and an over-broad cluster
 * costs only a glance — the card shows the rows and the gap and the user judges,
 * exactly as intended.
 */
export function findClusters<S extends HintRow, A extends HintRow>(
  statementRows: S[],
  appRows: A[],
  options: Partial<HintOptions> = {},
): Cluster<S, A>[] {
  const o = { ...DEFAULT_HINT_OPTIONS, ...options };

  // Tag each row with its side, then treat both sides as one pool.
  type Node = { statement: boolean; idx: number; row: HintRow };
  const nodes: Node[] = [
    ...statementRows.map((row, idx) => ({ statement: true, idx, row })),
    ...appRows.map((row, idx) => ({ statement: false, idx, row })),
  ];

  const related = (a: HintRow, b: HintRow): boolean =>
    Boolean(a.label) &&
    Boolean(b.label) &&
    sameDirection(a, b) &&
    dayDiff(a.date, b.date) <= o.clusterDateWindowDays &&
    nameSimilarity(a.label!, b.label!) >= o.clusterNameThreshold;

  const adjacency: number[][] = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (!related(nodes[i]!.row, nodes[j]!.row)) continue;
      adjacency[i]!.push(j);
      adjacency[j]!.push(i);
    }
  }

  const seen = new Set<number>();
  const clusters: Cluster<S, A>[] = [];

  for (let i = 0; i < nodes.length; i++) {
    if (seen.has(i)) continue;

    // Breadth-first over the similarity graph, collecting the whole component.
    const component: number[] = [];
    const queue = [i];
    seen.add(i);
    while (queue.length > 0) {
      const n = queue.shift()!;
      component.push(n);
      for (const m of adjacency[n]!) {
        if (seen.has(m)) continue;
        seen.add(m);
        queue.push(m);
      }
    }

    const statements = component
      .filter((n) => nodes[n]!.statement)
      .map((n) => statementRows[nodes[n]!.idx]!);
    const apps = component.filter((n) => !nodes[n]!.statement).map((n) => appRows[nodes[n]!.idx]!);

    // Only a two-sided cluster is worth surfacing: the value is the gap between
    // the statement total and the app total, and a one-sided group has none.
    if (statements.length > 0 && apps.length > 0) clusters.push({ statements, apps });
  }

  return clusters;
}
