import { useMemo } from 'react';
import {
  classifyLeftovers,
  findClusters,
  findCombinations,
  findDuplicateRuns,
  findDuplicates,
  findReversals,
} from '@budget-tracker/core';
import { isDurablyIgnored } from './types.js';
import type {
  ClusterHint,
  DifferenceGroup,
  ReconciliationSessionDetail,
  ReentryHint,
  ResolutionItem,
} from './types.js';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Stable identity, so the default argument never re-triggers the memo. */
const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

export interface ReconcileGroups {
  amountDiffers: ResolutionItem[];
  /**
   * Rows on one side that add up to a row on the other.
   *
   * A decision in its own right rather than a note on three separate rows: the
   * user is being asked whether these belong together, which they can only
   * judge with all of them in front of them.
   */
  combinations: ResolutionItem[];
  onStatementNotInApp: ResolutionItem[];
  inAppNotOnStatement: ResolutionItem[];
  /**
   * Unmatched app rows dated close enough to the statement's close that the bank
   * has simply not posted them yet.
   *
   * Split from `inAppNotOnStatement` because mixing them buries the real
   * discrepancies. On a five-month Prime Visa period, eight of twenty-six
   * unmatched rows were charges from the final three days — ordinary timing —
   * sitting in the same list as a five-month-old double-entered pair. One list
   * gave both the same weight and left the user to sort out which was which.
   */
  pendingInApp: ResolutionItem[];
  /**
   * Statement charges that were refunded in full on the same statement.
   *
   * They cancel to zero, so an app that recorded neither side is correct and
   * there is nothing to create. Left in `onStatementNotInApp` they read as two
   * separate discrepancies and the screen recommends creating two transactions
   * that would sum to nothing.
   */
  cancelledOnStatement: ResolutionItem[];
  /**
   * How many STATEMENT rows reconciled.
   *
   * Statement rows rather than decisions, because the screen reports it to
   * someone reconciling a statement: three lines explained by one transaction
   * is three lines accounted for, and calling it "1 matched" would understate
   * the statement's coverage.
   */
  matchedCount: number;
  /**
   * Same-merchant leftovers that do not reconcile — advisory spotlights, not
   * decisions. Their member rows still appear in the sections above; a cluster
   * only draws the two sides together and shows the gap. See `ClusterHint`.
   */
  clusters: ClusterHint[];
  /**
   * Periods that look entered twice — advisory spotlights, like `clusters`.
   * Member rows still appear and are still resolved in their own sections.
   */
  reentries: ReentryHint[];
}

interface AppTxLite {
  id: string;
  name: string;
  date: string;
  /** Net of rewards and gift cards — comparable with the statement. */
  amount: number;
  /** Rewards + gift card applied; zero for most rows. */
  offset: number;
  /** Existing note, so an ignore appends to it rather than replacing it. */
  note?: string | null;
  /**
   * Which way the money moved. Carried because amounts arrive here with the
   * sign already stripped, and a refund is otherwise indistinguishable from the
   * charge it reversed.
   */
  direction: 'charge' | 'credit';
  /** Transaction type — decides whether a combination can be merged. */
  type?: string;
  /** Linked to a recurring Expense/Income (merge disclosure). */
  recurringLink?: boolean;
  /** Matched to a scheduled item (merge disclosure). */
  scheduledMatch?: boolean;
}

const day = (d: Date | string): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

/**
 * Turn a session's rows and matches into the groups step 2 displays.
 *
 * Grouping happens here rather than on the server because the server persists
 * only the *pairings* — the classification is derived, so it always reflects
 * current data instead of a snapshot taken when the match last ran.
 */
export function useReconcileGroups(
  session: ReconciliationSessionDetail | undefined,
  appTransactions: AppTxLite[],
  /**
   * Decision keys dismissed during this sitting.
   *
   * The period-scoped half of ignoring. It covers every group, including the
   * ones no marker may touch, and it is what stops a decision the user settled
   * a moment ago from reappearing the instant the match re-runs. Gone on
   * reload, which is correct: it is a judgement about this sitting's questions.
   */
  dismissedKeys: ReadonlySet<string> = EMPTY_IDS,
): ReconcileGroups {
  return useMemo(() => {
    if (!session) {
      return {
        amountDiffers: [],
        combinations: [],
        onStatementNotInApp: [],
        inAppNotOnStatement: [],
        pendingInApp: [],
        cancelledOnStatement: [],
        matchedCount: 0,
        clusters: [],
        reentries: [],
      };
    }

    const txById = new Map(appTransactions.map((t) => [t.id, t]));
    const matchedRowIds = new Set(session.matches.map((m) => m.statementRowId));
    const matchedTxIds = new Set(session.matches.map((m) => m.transactionId));

    const rowById = new Map(session.statementRows.map((r) => [r.id, r]));

    /*
     * Pairings form a graph, and a decision is a connected piece of it.
     *
     * Comparing each statement row against its own matched transactions treats
     * the graph as if every edge were independent, which is only true for 1:1
     * and for several transactions summing to one line. It is wrong in the
     * other direction: when ONE transaction covers THREE statement lines — a
     * single $780 Metro Mobile entry against three $390 bank rows — each line was
     * compared against the whole $780 and reported as its own "amounts differ",
     * turning one correct grouping into three fabricated discrepancies.
     *
     * Walking the graph instead means a decision is however many rows are
     * transitively linked, and the comparison is sum against sum. That is the
     * same shape for 1:1, N:1, 1:N and anything else the matcher produces.
     */
    const neighbours = new Map<string, string[]>();
    const matchIdsByNode = new Map<string, string[]>();
    const link = (a: string, b: string, matchId: string) => {
      neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
      matchIdsByNode.set(a, [...(matchIdsByNode.get(a) ?? []), matchId]);
    };
    for (const m of session.matches) {
      link(`s:${m.statementRowId}`, `t:${m.transactionId}`, m.id);
      link(`t:${m.transactionId}`, `s:${m.statementRowId}`, m.id);
    }

    const amountDiffers: ResolutionItem[] = [];
    let matchedCount = 0;
    const visited = new Set<string>();

    for (const m of session.matches) {
      const root = `s:${m.statementRowId}`;
      if (visited.has(root)) continue;

      // Breadth-first over the pairings, collecting everything reachable.
      const component: string[] = [];
      const queue = [root];
      visited.add(root);
      while (queue.length > 0) {
        const node = queue.shift()!;
        component.push(node);
        for (const next of neighbours.get(node) ?? []) {
          if (visited.has(next)) continue;
          visited.add(next);
          queue.push(next);
        }
      }

      const rows = component
        .filter((n) => n.startsWith('s:'))
        .map((n) => rowById.get(n.slice(2)))
        .filter((r): r is NonNullable<typeof r> => Boolean(r));
      const paired = component
        .filter((n) => n.startsWith('t:'))
        .map((n) => txById.get(n.slice(2)))
        .filter((t): t is AppTxLite => Boolean(t));

      const bankTotal =
        Math.round(rows.reduce((sum, r) => sum + Math.abs(r.amount), 0) * 100) / 100;
      const appTotal = Math.round(paired.reduce((sum, t) => sum + t.amount, 0) * 100) / 100;
      const diff = Math.round((bankTotal - appTotal) * 100) / 100;

      if (Math.abs(diff) < 0.005) {
        // Counted in STATEMENT rows, not decisions and not both sides. The
        // screen says "N rows matched cleanly" to someone reconciling a
        // statement, so N is how many of that statement's lines are explained:
        // three lines covered by one transaction is 3, not 1 and not 4.
        matchedCount += rows.length;
        continue;
      }

      amountDiffers.push({
        key: `diff-${component.slice().sort().join('|')}`,
        matchIds: [...new Set(component.flatMap((n) => matchIdsByNode.get(n) ?? []))],
        statements: rows.map((r) => ({
          id: r.id,
          date: day(r.postedDate),
          description: r.description,
          amount: Math.abs(r.amount),
          direction: r.amount < 0 ? ('charge' as const) : ('credit' as const),
        })),
        apps: paired.map((t) => ({
          id: t.id,
          name: t.name,
          date: t.date,
          amount: t.amount,
          offset: t.offset,
          direction: t.direction,
          note: t.note,
        })),
        delta: diff,
        note: `Bank ${bankTotal.toFixed(2)} vs app ${appTotal.toFixed(2)}`,
      });
    }

    const unmatchedStatement: ResolutionItem[] = session.statementRows
      .filter((r) => !matchedRowIds.has(r.id))
      .map((r) => ({
        key: `stmt-${r.id}`,
        statements: [
          {
            id: r.id,
            date: day(r.postedDate),
            description: r.description,
            amount: Math.abs(r.amount),
            direction: r.amount < 0 ? ('charge' as const) : ('credit' as const),
          },
        ],
        apps: [],
        delta: r.amount,
      }));

    // A charge and the refund that undid it are one non-event: they cancel to
    // zero, so an app holding neither is right and there is nothing to create.
    // Split out before anything else looks at these rows, so they are never
    // offered the "Create this transaction" recommendation.
    const reversedKeys = new Set<string>();
    for (const pair of findReversals(
      unmatchedStatement.map((i) => ({
        id: i.key,
        date: i.statements[0]!.date,
        amount: i.statements[0]!.amount,
        direction: i.statements[0]!.direction,
        label: i.statements[0]!.description,
      })),
    )) {
      reversedKeys.add(pair.charge.id);
      reversedKeys.add(pair.credit.id);
    }

    const statementLeftovers = unmatchedStatement.filter((i) => !reversedKeys.has(i.key));
    const cancelledOnStatement = unmatchedStatement
      .filter((i) => reversedKeys.has(i.key))
      .map((i) => ({
        ...i,
        title: 'Charged and refunded on this statement',
      }));

    // Only rows the statement should have carried.
    //
    // The server loads a padded window so the matcher can pair a charge dated at
    // period end against a line that posted days later. That padding must not
    // leak into what gets REPORTED: a transaction dated before this period
    // belonged to the previous statement, and one dated after belongs to the
    // next, so neither is a discrepancy in this one. Listing them produced
    // phantoms that looked exactly like missing rows — the same false-positive
    // class that generated 11 bogus findings during the manual investigation.
    const periodStart = day(session.periodStart);
    const periodEnd = day(session.periodEnd);
    const withinPeriod = (iso: string): boolean => iso >= periodStart && iso <= periodEnd;

    // Classified over EVERY unmatched row, then filtered for display.
    //
    // Classifying the filtered set instead would change the answer: a duplicate
    // whose twin sits a day outside the window would stop being recognisable,
    // and the verdict here would quietly disagree with the matcher's for the
    // same row. Evidence is unrestricted; only what gets *shown* is narrowed.
    // Gross is reconstructed from the net plus whatever was settled before the
    // charge reached the card, so duplicate detection compares purchases rather
    // than the figures the bank happened to print.
    const withGross = (t: AppTxLite) => ({ ...t, gross: t.amount + (t.offset ?? 0) });
    const unmatched = appTransactions.filter((t) => !matchedTxIds.has(t.id));
    const verdicts = classifyLeftovers(
      unmatched.map(withGross),
      appTransactions.filter((t) => matchedTxIds.has(t.id)).map(withGross),
      periodEnd,
    );

    const toItem = (t: AppTxLite): ResolutionItem => ({
      key: `app-${t.id}`,
      statements: [],
      apps: [
        {
          id: t.id,
          name: t.name,
          date: t.date,
          amount: t.amount,
          offset: t.offset,
          direction: t.direction,
          note: t.note,
          // Carried through so a combination built from these rows can decide
          // mergeability and disclose what a merge would drop.
          type: t.type,
          recurringLink: t.recurringLink,
          scheduledMatch: t.scheduledMatch,
        },
      ],
      delta: -t.amount,
      // A twin that already matched the statement is the strongest signal
      // available here, and it is invisible to the leftover-only hint pass
      // below: the twin is not a leftover. Stated up front so it survives.
      ...(verdicts.get(t.id)?.duplicateOfMatched
        ? {
            title: 'Possible duplicate — an identical transaction already matched',
            recommendation: 'Check whether this was entered twice',
          }
        : {}),
    });

    const reportable = unmatched.filter((t) => withinPeriod(t.date));
    const isPending = (t: AppTxLite): boolean =>
      verdicts.get(t.id)?.kind === 'missing_in_bank_pending';

    const appLeftovers = reportable.filter((t) => !isPending(t)).map(toItem);
    const pendingInApp: ResolutionItem[] = reportable.filter(isPending).map(toItem);

    // ── Combinations become their own decisions ──
    //
    // A statement line explained by two app rows is ONE decision about three
    // rows. It used to be three separate entries carrying prose about each
    // other — "possibly part of a larger row" — which left the user to find the
    // other pieces themselves. Merging them into a single item is what lets the
    // card show all three together.
    const {
      combinations,
      statements: onStatementNotInApp,
      apps: inAppNotOnStatement,
    } = extractCombinations(statementLeftovers, appLeftovers);

    // Duplicates stay advisory. Unlike a combination they are not a claim about
    // which rows belong together, only that two look alike — so they annotate a
    // row rather than merging any.
    annotateDuplicates(onStatementNotInApp, inAppNotOnStatement);

    /**
     * Decisions already dismissed drop out of the list.
     *
     * An ignore that left the row in place was not an ignore: the row was
     * re-derived and asked about again on the very next match, and a decision
     * the user had made a moment earlier looked like it had been forgotten.
     *
     * Two reasons a decision is gone, and they expire differently. Dismissed
     * this sitting — any group, forgotten on reload. Durably marked — only the
     * groups whose verdict cannot change, carried on the transactions' own
     * notes. A pending charge is deliberately only ever the first kind.
     *
     * Applied last, to the finished groups, so a dismissed row still takes part
     * in matching, combination-finding and duplicate detection — it is hidden
     * from the questions, not removed from the arithmetic.
     */
    const live = (items: ResolutionItem[], group: DifferenceGroup) =>
      items.filter((i) => !dismissedKeys.has(i.key) && !isDurablyIgnored(i, group));

    // Clusters are drawn from the LIVE leftovers only, so a row already
    // dismissed this sitting never resurfaces inside a "looks related" card.
    const liveOnStatement = live(onStatementNotInApp, 'on_statement_not_in_app');
    const liveInApp = live(inAppNotOnStatement, 'in_app_not_on_statement');

    return {
      amountDiffers: live(amountDiffers, 'amount_differs'),
      combinations: live(combinations, 'combination'),
      onStatementNotInApp: liveOnStatement,
      inAppNotOnStatement: liveInApp,
      pendingInApp: live(pendingInApp, 'pending_in_app'),
      cancelledOnStatement: live(cancelledOnStatement, 'cancelled_on_statement'),
      matchedCount,
      clusters: buildClusters(liveOnStatement, liveInApp),
      // Drawn from the LIVE leftovers for the same reason clusters are: a row
      // the user already dismissed this sitting must not reappear inside a card
      // telling them to look at it again.
      reentries: buildReentries(liveInApp, appTransactions, matchedTxIds),
    };
  }, [session, appTransactions, dismissedKeys]);
}

/**
 * Gather leftovers that look like a whole period entered twice.
 *
 * The detection is `findDuplicateRuns` in core, shared with the matcher so the
 * two cannot disagree — this only supplies the rows and maps the result back to
 * the items the screen renders.
 *
 * Evidence is drawn from EVERY matched transaction, not just the displayed ones:
 * the twin that proves a copy is a copy is by definition a row that reconciled,
 * so restricting the evidence to what is on screen would hide the only thing
 * that makes the claim. Only the copies are taken from the live leftovers.
 */
function buildReentries(
  appItems: ResolutionItem[],
  appTransactions: AppTxLite[],
  matchedTxIds: ReadonlySet<string>,
): ReentryHint[] {
  const byId = new Map<string, ResolutionItem>();
  for (const i of appItems) {
    const row = i.apps[0];
    if (row && i.apps.length === 1) byId.set(row.id, i);
  }

  const gross = (t: { amount: number; offset?: number }) => t.amount + (t.offset ?? 0);
  const copies = [...byId.entries()].map(([id, i]) => ({
    id,
    date: i.apps[0]!.date,
    name: i.apps[0]!.name,
    amount: i.apps[0]!.amount,
    gross: gross(i.apps[0]!),
  }));
  const matched = appTransactions
    .filter((t) => matchedTxIds.has(t.id))
    .map((t) => ({ id: t.id, date: t.date, name: t.name, amount: t.amount, gross: gross(t) }));

  return findDuplicateRuns(copies, matched).map((run) => ({
    key: `reentry-${run.rows
      .map((r) => r.id)
      .sort()
      .join('|')}`,
    start: run.start,
    end: run.end,
    apps: run.rows.flatMap((r) => byId.get(r.id)?.apps ?? []),
    total: run.total,
  }));
}

/**
 * Gather same-merchant leftovers that do not reconcile into advisory clusters.
 *
 * The heavy lifting is `findClusters` in core; this only maps the UI's
 * `ResolutionItem`s down to the hint rows it needs and back up to a `ClusterHint`
 * carrying both sides and the gap. Runs on the leftovers that survived
 * combination-finding, so the members never sum — the gap is inherent.
 */
function buildClusters(
  statementItems: ResolutionItem[],
  appItems: ResolutionItem[],
): ClusterHint[] {
  const byKey = new Map<string, ResolutionItem>();
  for (const i of [...statementItems, ...appItems]) byKey.set(i.key, i);

  const back = (keys: { id: string }[]) =>
    keys.map((r) => byKey.get(r.id)).filter((i): i is ResolutionItem => Boolean(i));

  return findClusters(rowsOf(statementItems), rowsOf(appItems)).map((c): ClusterHint => {
    const stmtItems = back(c.statements);
    const appMembers = back(c.apps);
    const statements = stmtItems.flatMap((i) => i.statements);
    const apps = appMembers.flatMap((i) => i.apps);

    const statementTotal = round2(statements.reduce((sum, r) => round2(sum + r.amount), 0));
    const appTotal = round2(apps.reduce((sum, r) => round2(sum + r.amount), 0));

    return {
      // Sorted member keys, so the same cluster keeps its identity across
      // re-derivations regardless of the order the rows arrived in.
      key: `cluster-${[...stmtItems, ...appMembers]
        .map((i) => i.key)
        .sort()
        .join('|')}`,
      // The name the app knows the merchant by, preferred over the bank's alias.
      label: apps[0]?.name ?? statements[0]?.description ?? 'Related rows',
      direction: statements[0]?.direction ?? apps[0]?.direction ?? 'charge',
      statements,
      apps,
      statementTotal,
      appTotal,
      gap: round2(Math.abs(statementTotal - appTotal)),
    };
  });
}

/**
 * Row shape the hint helpers need, drawn from whichever side an item has.
 *
 * Direction is carried through deliberately: amounts are absolute by this
 * point, so without it a $28.85 purchase and the $28.85 refund that reversed it
 * look identical — and they were being reported as duplicates of each other.
 */
const hintRow = (i: ResolutionItem) => {
  const side = i.statements[0] ?? i.apps[0];
  if (!side) return null;
  return {
    id: i.key,
    date: side.date,
    amount: side.amount,
    direction: side.direction,
    label: 'description' in side ? side.description : side.name,
  };
};

const rowsOf = (items: ResolutionItem[]) =>
  items.map(hintRow).filter((r): r is NonNullable<ReturnType<typeof hintRow>> => r !== null);

/**
 * Merge rows that add up into single decisions, and return what is left.
 *
 * Looked for in both directions: one statement line explained by several app
 * rows (a purchase entered as its parts) and one app row covering several
 * statement lines (a single entry for a charge the bank split).
 *
 * Rows consumed by a combination are removed from their original groups — a row
 * that is part of a combination is not *also* separately unexplained, and
 * listing it twice would double-count the same money on screen.
 */
function extractCombinations(
  statementSide: ResolutionItem[],
  appSide: ResolutionItem[],
): { combinations: ResolutionItem[]; statements: ResolutionItem[]; apps: ResolutionItem[] } {
  const byKey = new Map<string, ResolutionItem>();
  for (const i of [...statementSide, ...appSide]) byKey.set(i.key, i);

  const combinations: ResolutionItem[] = [];
  const consumed = new Set<string>();

  for (const [targets, parts, noun] of [
    [statementSide, appSide, 'app transactions'],
    [appSide, statementSide, 'statement lines'],
  ] as const) {
    const available = (items: ResolutionItem[]) => items.filter((i) => !consumed.has(i.key));

    for (const combo of findCombinations(rowsOf(available(targets)), rowsOf(available(parts)))) {
      const target = byKey.get(combo.target.id);
      const pieces = combo.parts
        .map((p) => byKey.get(p.id))
        .filter((i): i is ResolutionItem => !!i);
      if (!target || pieces.length !== combo.parts.length) continue;

      consumed.add(target.key);
      for (const p of pieces) consumed.add(p.key);

      const members = [target, ...pieces];
      combinations.push({
        key: `combo-${target.key}`,
        title: `Possibly ${pieces.length} ${noun} combined`,
        statements: members.flatMap((m) => m.statements),
        apps: members.flatMap((m) => m.apps),
        // The pieces sum to the target, so the group as a whole explains
        // itself: whatever the target contributes, the parts take back.
        delta: 0,
      });
    }
  }

  return {
    combinations,
    statements: statementSide.filter((i) => !consumed.has(i.key)),
    apps: appSide.filter((i) => !consumed.has(i.key)),
  };
}

/**
 * Annotate rows that merely look alike.
 *
 * Weaker than a combination and applied after it: two identical rows are often
 * both at once — the Journey tickets are two identical $300.00 charges AND the
 * two halves of one $600.00 line — and by the time this runs a real combination
 * has already claimed them. What is left is a genuine lookalike.
 *
 * A title already set outranks this. The only one that can be present is the
 * matched-twin duplicate, which is the single hint backed by a row the bank
 * actually printed.
 */
function annotateDuplicates(statementSide: ResolutionItem[], appSide: ResolutionItem[]): void {
  const byKey = new Map<string, ResolutionItem>();
  for (const i of [...statementSide, ...appSide]) byKey.set(i.key, i);

  for (const side of [statementSide, appSide]) {
    for (const group of findDuplicates(rowsOf(side))) {
      for (const r of group) {
        const item = byKey.get(r.id);
        if (item && !item.title) {
          item.title = `Possible duplicate — ${group.length} identical rows`;
        }
      }
    }
  }
}
