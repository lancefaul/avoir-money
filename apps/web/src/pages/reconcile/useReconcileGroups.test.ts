/**
 * Tests for the difference grouping.
 *
 * This is where a silent bug would be most damaging: a row that lands in the
 * wrong group, or in no group at all, is a discrepancy the user never sees. The
 * conservation test at the bottom is the important one.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReconcileGroups } from './useReconcileGroups.js';
import type { ReconciliationSessionDetail } from './types.js';

const base = {
  id: 's1',
  accountId: 'a1',
  periodStart: new Date('2026-06-01'),
  periodEnd: new Date('2026-06-30'),
  statementEndingBalance: 0,
  status: 'DRAFT' as const,
  residualAtClose: 0,
  reconciledAt: null,
  adjustmentTransactionId: null,
  adjustmentReason: null,
  createdAt: new Date('2026-06-01'),
  updatedAt: new Date('2026-06-01'),
  appTransactions: [],
  residual: {
    openingBalance: 0,
    transactionSum: 0,
    expectedBalance: 0,
    statementEndingBalance: 0,
    residual: 0,
    isBalanced: true,
    activityAfterPeriodEnd: 0,
  },
};

function row(id: string, description: string, amount: number, date = '2026-06-10') {
  return {
    id,
    sessionId: 's1',
    postedDate: new Date(date),
    transactionDate: new Date(date),
    description,
    amount,
    rawLine: `${date},${description},${amount}`,
    createdAt: new Date(date),
  };
}

function match(statementRowId: string, transactionId: string) {
  return {
    id: `m-${statementRowId}-${transactionId}`,
    sessionId: 's1',
    statementRowId,
    transactionId,
    matchType: 'EXACT' as const,
    createdAt: new Date('2026-06-10'),
  };
}

const tx = (
  id: string,
  name: string,
  amount: number,
  date = '2026-06-10',
  offset = 0,
  direction: 'charge' | 'credit' = 'charge',
) => ({ id, name, date, amount, offset, direction });

function build(
  statementRows: ReturnType<typeof row>[],
  matches: ReturnType<typeof match>[],
): ReconciliationSessionDetail {
  return { ...base, statementRows, matches } as ReconciliationSessionDetail;
}

describe('useReconcileGroups', () => {
  it('counts an agreeing pair as matched with nothing to resolve', () => {
    const session = build([row('r1', 'ACME', 24.5)], [match('r1', 't1')]);
    const { result } = renderHook(() =>
      useReconcileGroups(session, [tx('t1', 'Acme Bakery', 24.5)]),
    );
    expect(result.current.matchedCount).toBe(1);
    expect(result.current.amountDiffers).toHaveLength(0);
    expect(result.current.onStatementNotInApp).toHaveLength(0);
    expect(result.current.inAppNotOnStatement).toHaveLength(0);
  });

  it('flags a paired row whose amounts disagree', () => {
    const session = build([row('r1', 'ACME', 24.5)], [match('r1', 't1')]);
    const { result } = renderHook(() =>
      useReconcileGroups(session, [tx('t1', 'Acme Bakery', 24.0)]),
    );
    expect(result.current.amountDiffers).toHaveLength(1);
    expect(result.current.amountDiffers[0]!.delta).toBeCloseTo(0.5, 2);
    expect(result.current.matchedCount).toBe(0);
  });

  it('treats a multi-part group summing exactly as matched', () => {
    // One statement line explained by three app rows — not a discrepancy.
    const session = build(
      [row('r1', 'CITY UTILITIES', 136.9)],
      [match('r1', 't1'), match('r1', 't2'), match('r1', 't3')],
    );
    const { result } = renderHook(() =>
      useReconcileGroups(session, [
        tx('t1', 'Water', 40.15),
        tx('t2', 'Sewer', 61.4),
        tx('t3', 'Trash', 35.35),
      ]),
    );
    expect(result.current.matchedCount).toBe(1);
    expect(result.current.amountDiffers).toHaveLength(0);
  });

  it('lists an unmatched statement row as on-statement-not-in-app', () => {
    const session = build([row('r1', 'UNKNOWN VENDOR', 88.2)], []);
    const { result } = renderHook(() => useReconcileGroups(session, []));
    expect(result.current.onStatementNotInApp).toHaveLength(1);
    expect(result.current.onStatementNotInApp[0]!.statements[0]?.description).toBe(
      'UNKNOWN VENDOR',
    );
  });

  it('lists an unmatched transaction as in-app-not-on-statement', () => {
    const session = build([], []);
    const { result } = renderHook(() =>
      useReconcileGroups(session, [tx('t9', 'Corner Coffee', 12.4)]),
    );
    expect(result.current.inAppNotOnStatement).toHaveLength(1);
    expect(result.current.inAppNotOnStatement[0]!.apps[0]?.id).toBe('t9');
  });

  it('returns empty groups when there is no session', () => {
    const { result } = renderHook(() => useReconcileGroups(undefined, [tx('t1', 'X', 1)]));
    expect(result.current.matchedCount).toBe(0);
    expect(result.current.inAppNotOnStatement).toHaveLength(0);
  });

  /**
   * The server loads a padded window so the matcher can pair a charge dated at
   * period end against a line that posted after it. Reporting those padded rows
   * as unmatched invents discrepancies: a transaction dated before this period
   * was on the previous statement, and one dated after will be on the next.
   */
  it('excludes transactions outside the statement period from phantoms', () => {
    const session = build([], []);
    const { result } = renderHook(() =>
      useReconcileGroups(session, [
        tx('before', 'Previous statement', 10, '2026-05-28'),
        tx('inside', 'This statement', 20, '2026-06-15'),
        tx('after', 'Next statement', 30, '2026-07-04'),
      ]),
    );
    expect(result.current.inAppNotOnStatement).toHaveLength(1);
    expect(result.current.inAppNotOnStatement[0]!.apps[0]?.id).toBe('inside');
  });

  it('keeps a transaction dated on either boundary', () => {
    // Both are reported; which group they land in is the pending split's job,
    // tested below. What matters here is that neither is silently dropped.
    const session = build([], []);
    const { result } = renderHook(() =>
      useReconcileGroups(session, [
        tx('start', 'First day', 10, '2026-06-01'),
        tx('end', 'Last day', 20, '2026-06-30'),
      ]),
    );
    const reported = [...result.current.inAppNotOnStatement, ...result.current.pendingInApp];
    expect(reported.map((i) => i.apps[0]?.id).sort()).toEqual(['end', 'start']);
  });

  it('places every row in exactly one group', () => {
    // Conservation: a row that falls through the grouping is a discrepancy the
    // user never sees, which is the worst failure this screen can have.
    const session = build(
      [row('r1', 'ACME', 24.5), row('r2', 'MISSING', 10), row('r3', 'DIFFERS', 50)],
      [match('r1', 't1'), match('r3', 't3')],
    );
    const appTxs = [
      tx('t1', 'Acme Bakery', 24.5),
      tx('t3', 'Differs', 45),
      tx('t4', 'Only in app', 7),
    ];
    const { result } = renderHook(() => useReconcileGroups(session, appTxs));

    const { amountDiffers, onStatementNotInApp, inAppNotOnStatement, matchedCount } =
      result.current;

    // 3 statement rows: r1 matched, r3 differs, r2 unmatched.
    expect(matchedCount).toBe(1);
    expect(amountDiffers).toHaveLength(1);
    expect(onStatementNotInApp).toHaveLength(1);
    // 3 app rows: t1 and t3 are referenced by matches, t4 is not.
    expect(inAppNotOnStatement).toHaveLength(1);
    expect(inAppNotOnStatement[0]!.apps[0]?.id).toBe('t4');

    // No row appears twice.
    const keys = [...amountDiffers, ...onStatementNotInApp, ...inAppNotOnStatement].map(
      (i) => i.key,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * Hints are advisory. They point at leftovers the matcher declined to pair so
   * the user can confirm with manual pairing — they never pair anything.
   */
  describe('hints', () => {
    it('flags two identical unmatched statement rows as a possible duplicate', () => {
      const session = build(
        [row('r1', "QUEENIE'S CREAMS", 3.75), row('r2', "QUEENIE'S CREAMS", 3.75)],
        [],
      );
      const { result } = renderHook(() => useReconcileGroups(session, []));
      const hints = result.current.onStatementNotInApp.map((i) => i.title);
      expect(hints.every((h) => h?.includes('Possible duplicate'))).toBe(true);
    });

    it('leaves a combination out of the per-row duplicate pass', () => {
      // The concert tickets are two identical $300.00 charges AND the two
      // halves of one $600.00 line. The combination claims them first, so they
      // are never also called duplicates — "these add up to that" explains the
      // pair exactly, where "these look alike" only observes it.
      const session = build([row('r1', 'TM *JOURNEY', -838.8, '2026-06-12')], []);
      const { result } = renderHook(() =>
        useReconcileGroups(session, [
          tx('a1', 'Ticketmaster', 419.4, '2026-06-10'),
          tx('a2', 'Ticketmaster', 419.4, '2026-06-10'),
        ]),
      );
      expect(result.current.combinations).toHaveLength(1);
      expect(result.current.combinations[0]!.title).not.toMatch(/duplicate/i);
    });

    it('leaves unrelated leftovers unannotated', () => {
      const session = build([row('r1', 'ODD ONE', 41.13)], []);
      const { result } = renderHook(() =>
        useReconcileGroups(session, [tx('a1', 'Something Else', 7.02)]),
      );
      expect(result.current.onStatementNotInApp[0]!.title).toBeUndefined();
      expect(result.current.inAppNotOnStatement[0]!.title).toBeUndefined();
    });

    /**
     * The reported case: two Acme Vending $4.50 entries on one day against a
     * single 24 MARKET line. The matcher paired one and called the other a
     * duplicate — but this hook rebuilds its groups from the persisted
     * *pairings*, which carry no classification, so the leftover arrived as an
     * ordinary unmatched row with no hint at all. The evidence is invisible to
     * the leftover-only duplicate scan below, because the twin is not a
     * leftover: it matched.
     */
    it('flags a leftover whose identical twin already matched the statement', () => {
      const session = build([row('r1', '24 MARKET 800 555-0100', -4.5)], [match('r1', 't1')]);
      const { result } = renderHook(() =>
        useReconcileGroups(session, [tx('t1', 'Acme Vending', 4.5), tx('t2', 'Acme Vending', 4.5)]),
      );

      expect(result.current.matchedCount).toBe(1);
      expect(result.current.inAppNotOnStatement).toHaveLength(1);
      expect(result.current.inAppNotOnStatement[0]!.apps[0]?.id).toBe('t2');
      expect(result.current.inAppNotOnStatement[0]!.title).toMatch(/already matched/);
    });

    it('does not call a statement charge and its refund duplicates', () => {
      const session = build(
        [
          row('r1', 'aliexpress', -28.85, '2026-06-10'),
          row('r2', 'aliexpress', 28.85, '2026-06-10'),
        ],
        [],
      );
      const { result } = renderHook(() => useReconcileGroups(session, []));

      const all = [...result.current.onStatementNotInApp, ...result.current.cancelledOnStatement];
      expect(all.every((i) => !i.title?.includes('duplicate'))).toBe(true);
    });

    it('does not call an app expense and refund duplicates', () => {
      const session = build([], []);
      const { result } = renderHook(() =>
        useReconcileGroups(session, [
          tx('t1', 'AliExpress', 28.85, '2026-06-10', 0, 'charge'),
          tx('t2', 'AliExpress', 28.85, '2026-06-10', 0, 'credit'),
        ]),
      );
      expect(result.current.inAppNotOnStatement.every((i) => !i.title?.includes('duplicate'))).toBe(
        true,
      );
    });

    it('does not call a combination part a duplicate', () => {
      // The Ticketmaster pair: two identical $300.00 rows that are one $600.00
      // line split in half. Neither has a matched twin, so the specific claim
      // wins and the user is never advised to delete a real transaction.
      const session = build([row('r1', 'TM *JOURNEY', -838.8, '2026-06-12')], []);
      const { result } = renderHook(() =>
        useReconcileGroups(session, [
          tx('a1', 'Ticketmaster', 419.4, '2026-06-10'),
          tx('a2', 'Ticketmaster', 419.4, '2026-06-10'),
        ]),
      );
      const hints = result.current.inAppNotOnStatement.map((i) => i.title);
      expect(hints.every((h) => h?.includes('part of'))).toBe(true);
      expect(hints.some((h) => h?.includes('duplicate'))).toBe(false);
    });
  });

  /**
   * Rows that add up are ONE decision about all of them.
   *
   * They used to be several separate entries carrying prose about each other —
   * "possibly part of a larger row" — which left the user to hunt for the other
   * pieces. Merging them is what lets a single card show every row involved.
   */
  describe('combinations', () => {
    // The concert tickets: bank 600.00, app 2 x 300.00.
    const oneBankTwoApp = () => build([row('r1', 'TM *JOURNEY', -838.8, '2026-06-12')], []);
    const twoAppRows = [
      tx('a1', 'Ticketmaster', 419.4, '2026-06-10'),
      tx('a2', 'Ticketmaster', 419.4, '2026-06-10'),
    ];

    it('merges one statement line and the app rows that sum to it', () => {
      const { result } = renderHook(() => useReconcileGroups(oneBankTwoApp(), twoAppRows));
      const combo = result.current.combinations[0]!;

      expect(result.current.combinations).toHaveLength(1);
      expect(combo.statements).toHaveLength(1);
      expect(combo.apps.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
      expect(combo.title).toMatch(/2 app transactions combined/);
    });

    it('merges one app row and the statement lines that sum to it', () => {
      // Metro Mobile: app 500, bank 2 x 250.
      const session = build(
        [
          row('r1', 'METRO MOBILE', -250, '2026-06-10'),
          row('r2', 'METRO MOBILE', -250, '2026-06-11'),
        ],
        [],
      );
      const { result } = renderHook(() =>
        useReconcileGroups(session, [tx('a1', 'Metro Mobile', 500, '2026-06-10')]),
      );
      const combo = result.current.combinations[0]!;

      expect(combo.apps).toHaveLength(1);
      expect(combo.statements).toHaveLength(2);
      expect(combo.title).toMatch(/2 statement lines combined/);
    });

    it('removes the merged rows from the ungrouped lists', () => {
      // A row inside a combination is not ALSO separately unexplained. Listing
      // it in both places would show the same money twice.
      const { result } = renderHook(() => useReconcileGroups(oneBankTwoApp(), twoAppRows));
      expect(result.current.onStatementNotInApp).toHaveLength(0);
      expect(result.current.inAppNotOnStatement).toHaveLength(0);
    });

    it('reports every row exactly once across all groups', () => {
      // Conservation, with an unrelated row alongside so the combination cannot
      // simply swallow everything and still pass.
      const session = build(
        [
          row('r1', 'TM *JOURNEY', -838.8, '2026-06-12'),
          row('r2', 'ODD ONE', -41.13, '2026-06-15'),
        ],
        [],
      );
      const { result } = renderHook(() => useReconcileGroups(session, twoAppRows));
      const g = result.current;
      const all = [
        ...g.combinations,
        ...g.onStatementNotInApp,
        ...g.inAppNotOnStatement,
        ...g.pendingInApp,
        ...g.cancelledOnStatement,
      ];

      const statementIds = all.flatMap((i) => i.statements.map((r) => r.id));
      const appIds = all.flatMap((i) => i.apps.map((a) => a.id));
      expect(statementIds.sort()).toEqual(['r1', 'r2']);
      expect(appIds.sort()).toEqual(['a1', 'a2']);
    });

    it('leaves the residual to the parts, not the group', () => {
      // The pieces sum to the target, so the combination explains itself and
      // must not push the unexplained difference either way.
      const { result } = renderHook(() => useReconcileGroups(oneBankTwoApp(), twoAppRows));
      expect(result.current.combinations[0]!.delta).toBe(0);
    });
  });

  /**
   * The aliexpress pair: a $28.85 charge and the $28.85 refund that undid it,
   * same day, neither recorded in the app. That is one non-event — they cancel
   * to zero and the balance never moved, so an app holding neither is correct.
   * Listed as ordinary missing rows they read as two discrepancies and the
   * screen recommended creating two transactions that would sum to nothing.
   */
  describe('charges reversed on the same statement', () => {
    const pair = () =>
      build(
        [
          row('r1', 'aliexpress', -28.85, '2026-06-10'),
          row('r2', 'aliexpress', 28.85, '2026-06-10'),
        ],
        [],
      );

    it('moves both sides out of the group that asks for action', () => {
      const { result } = renderHook(() => useReconcileGroups(pair(), []));
      expect(result.current.onStatementNotInApp).toHaveLength(0);
      expect(result.current.cancelledOnStatement).toHaveLength(2);
    });

    it('says they cancel rather than recommending a transaction', () => {
      const { result } = renderHook(() => useReconcileGroups(pair(), []));
      expect(
        result.current.cancelledOnStatement.every((i) => i.title?.includes('Charged and refunded')),
      ).toBe(true);
    });

    it('leaves an unrelated same-amount refund alone', () => {
      // Different merchants. Calling this a wash would excuse two real gaps —
      // the one case where a wrong hint hides a discrepancy instead of
      // mislabelling it.
      const session = build(
        [
          row('r1', 'aliexpress', -28.85, '2026-06-10'),
          row('r2', 'HOME DEPOT', 28.85, '2026-06-10'),
        ],
        [],
      );
      const { result } = renderHook(() => useReconcileGroups(session, []));
      expect(result.current.cancelledOnStatement).toHaveLength(0);
      expect(result.current.onStatementNotInApp).toHaveLength(2);
    });

    it('leaves a partial refund alone', () => {
      // $28.85 charged, $20 back — the $8.85 difference is a real balance
      // change the user still has to account for.
      const session = build(
        [row('r1', 'aliexpress', -28.85, '2026-06-10'), row('r2', 'aliexpress', 20, '2026-06-10')],
        [],
      );
      const { result } = renderHook(() => useReconcileGroups(session, []));
      expect(result.current.cancelledOnStatement).toHaveLength(0);
    });

    it('still reports every statement row somewhere', () => {
      // Conservation across the new split — the group must not become a place
      // bank rows quietly disappear into.
      const session = build(
        [
          row('r1', 'aliexpress', -28.85, '2026-06-10'),
          row('r2', 'aliexpress', 28.85, '2026-06-10'),
          row('r3', 'UNKNOWN VENDOR', -12, '2026-06-11'),
        ],
        [],
      );
      const { result } = renderHook(() => useReconcileGroups(session, []));
      const keys = [
        ...result.current.onStatementNotInApp,
        ...result.current.cancelledOnStatement,
      ].map((i) => i.key);
      expect(keys.sort()).toEqual(['stmt-r1', 'stmt-r2', 'stmt-r3']);
    });
  });

  /**
   * Charges made in the last days of a period routinely post after it closes.
   * They were listed beside genuine discrepancies, where they were both the
   * majority and the least interesting rows — on the real Prime Visa period,
   * eight of twenty-six. Separating them is what makes the other eighteen
   * visible.
   */
  describe('pending vs unexplained', () => {
    it('separates a charge near the close from an older one', () => {
      const session = build([], []);
      const { result } = renderHook(() =>
        useReconcileGroups(session, [
          tx('old', 'Amazon', 25.0, '2026-06-05'),
          tx('recent', "Delgado's", 61.25, '2026-06-28'),
        ]),
      );

      expect(result.current.inAppNotOnStatement.map((i) => i.apps[0]?.id)).toEqual(['old']);
      expect(result.current.pendingInApp.map((i) => i.apps[0]?.id)).toEqual(['recent']);
    });

    it('reports every unmatched row across the two groups', () => {
      // Conservation across the split: the pending group must not become a
      // place rows quietly disappear into.
      const session = build([], []);
      const appTxs = [
        tx('a', 'One', 1, '2026-06-02'),
        tx('b', 'Two', 2, '2026-06-15'),
        tx('c', 'Three', 3, '2026-06-27'),
        tx('d', 'Four', 4, '2026-06-30'),
      ];
      const { result } = renderHook(() => useReconcileGroups(session, appTxs));

      const reported = [...result.current.inAppNotOnStatement, ...result.current.pendingInApp];
      expect(reported.map((i) => i.apps[0]?.id).sort()).toEqual(['a', 'b', 'c', 'd']);
      expect(new Set(reported.map((i) => i.key)).size).toBe(4);
    });

    it('keeps a duplicate out of the pending group even when it is recent', () => {
      // Both rules apply; "pending" would excuse a double entry as timing.
      const session = build([row('r1', 'DELGADO', -61.25, '2026-06-28')], [match('r1', 't1')]);
      const { result } = renderHook(() =>
        useReconcileGroups(session, [
          tx('t1', "Delgado's", 61.25, '2026-06-28'),
          tx('t2', "Delgado's", 61.25, '2026-06-28'),
        ]),
      );

      expect(result.current.pendingInApp).toHaveLength(0);
      expect(result.current.inAppNotOnStatement[0]!.apps[0]?.id).toBe('t2');
    });

    it('classifies on all unmatched rows, not just the reportable ones', () => {
      // A duplicate whose twin sits outside the display window is still a
      // duplicate. Classifying the filtered set would lose it and put this hook
      // in disagreement with the matcher about the same row.
      const session = build([], []);
      const { result } = renderHook(() =>
        useReconcileGroups(session, [
          tx('inside', 'Repeat', 5, '2026-06-15'),
          tx('outside', 'Repeat', 5, '2026-06-15'),
        ]),
      );

      const hinted = result.current.inAppNotOnStatement.filter((i) => i.title);
      expect(hinted.length).toBeGreaterThan(0);
    });
  });
});

/**
 * A pairing is a graph, and a decision is a connected piece of it.
 *
 * Comparing each statement row against only its own matched transactions is
 * right for 1:1 and for several transactions summing to one line, and wrong in
 * the other direction: one $500 Metro Mobile transaction covering three $250 bank
 * rows had each row compared against the whole $500, turning one correct
 * grouping into three fabricated "amounts differ" cards.
 */
describe('one transaction covering several statement lines', () => {
  const usMobile = () =>
    build(
      [
        row('r1', 'METRO MOBILE', -250, '2026-06-10'),
        row('r2', 'METRO MOBILE', -250, '2026-06-11'),
      ],
      [match('r1', 'a1'), match('r2', 'a1')],
    );
  const oneApp = [tx('a1', 'Metro Mobile', 500, '2026-06-10')];

  it('treats the whole group as one reconciled decision', () => {
    const { result } = renderHook(() => useReconcileGroups(usMobile(), oneApp));
    expect(result.current.amountDiffers).toHaveLength(0);
    // Two statement lines explained, so two — not one decision, and not three
    // by counting the transaction as well.
    expect(result.current.matchedCount).toBe(2);
  });

  it('does not report either line as unexplained', () => {
    const { result } = renderHook(() => useReconcileGroups(usMobile(), oneApp));
    expect(result.current.onStatementNotInApp).toHaveLength(0);
    expect(result.current.inAppNotOnStatement).toHaveLength(0);
  });

  it('raises ONE decision when the group does not reconcile', () => {
    // Same shape, but the transaction is $20 short. That is one disagreement
    // about a group, not one per line.
    const { result } = renderHook(() =>
      useReconcileGroups(usMobile(), [tx('a1', 'Metro Mobile', 480, '2026-06-10')]),
    );
    expect(result.current.amountDiffers).toHaveLength(1);
    expect(result.current.amountDiffers[0]!.statements).toHaveLength(2);
    expect(result.current.amountDiffers[0]!.delta).toBeCloseTo(20, 2);
  });

  it('still handles several transactions summing to one line', () => {
    // The other direction must keep working — it was already correct.
    const session = build(
      [row('r1', 'CITY UTILITIES', -136.9)],
      [match('r1', 't1'), match('r1', 't2'), match('r1', 't3')],
    );
    const { result } = renderHook(() =>
      useReconcileGroups(session, [
        tx('t1', 'Water', 40.15),
        tx('t2', 'Sewer', 61.4),
        tx('t3', 'Trash', 35.35),
      ]),
    );
    // One statement line, however many transactions explain it.
    expect(result.current.matchedCount).toBe(1);
    expect(result.current.amountDiffers).toHaveLength(0);
  });
});

/**
 * Clusters catch what combinations cannot.
 *
 * `findCombinations` needs the parts to sum to the target exactly, so a
 * same-merchant set that is a few dollars out is declined and its rows scatter
 * into the two leftover sections with nothing linking them. A cluster gathers
 * them so the screen can show both sides and the gap — without claiming they
 * belong together, which the arithmetic does not support.
 */
describe('cluster hints', () => {
  // Negative statement amounts are charges, matching the app rows' direction.
  it('gathers same-merchant leftovers that do not add up', () => {
    const session = build([row('r1', 'CITYWATER UTIL', -150, '2026-06-10')], []);
    const { result } = renderHook(() =>
      useReconcileGroups(session, [
        tx('t1', 'CityWater', 75, '2026-06-09'),
        tx('t2', 'CityWater', 70, '2026-06-11'),
      ]),
    );

    expect(result.current.clusters).toHaveLength(1);
    const [cluster] = result.current.clusters;
    expect(cluster!.statementTotal).toBe(150);
    expect(cluster!.appTotal).toBe(145);
    expect(cluster!.gap).toBe(5);
    expect(cluster!.apps.map((a) => a.id).sort()).toEqual(['t1', 't2']);
  });

  it('leaves its members in their own sections — a cluster consumes nothing', () => {
    // A cluster explains nothing on its own, so the rows it names still have to
    // be resolved individually. Removing them from their sections would hide
    // real discrepancies behind an advisory note.
    const session = build([row('r1', 'CITYWATER UTIL', -150, '2026-06-10')], []);
    const { result } = renderHook(() =>
      useReconcileGroups(session, [
        tx('t1', 'CityWater', 75, '2026-06-09'),
        tx('t2', 'CityWater', 70, '2026-06-11'),
      ]),
    );

    expect(result.current.onStatementNotInApp).toHaveLength(1);
    expect(result.current.inAppNotOnStatement).toHaveLength(2);
  });

  it('yields to a real combination when the parts do sum exactly', () => {
    // The boundary: an exact sum is a provable grouping and belongs in
    // `combinations`, where it can actually be acted on. Only what grouping
    // could not explain is left for a cluster.
    const session = build([row('r1', 'CITYWATER UTIL', -150, '2026-06-10')], []);
    const { result } = renderHook(() =>
      useReconcileGroups(session, [
        tx('t1', 'CityWater', 75, '2026-06-09'),
        tx('t2', 'CityWater', 75, '2026-06-11'),
      ]),
    );

    expect(result.current.combinations).toHaveLength(1);
    expect(result.current.clusters).toHaveLength(0);
  });

  it('says nothing when the merchants differ', () => {
    const session = build([row('r1', 'HOME DEPOT', -150, '2026-06-10')], []);
    const { result } = renderHook(() =>
      useReconcileGroups(session, [tx('t1', 'CityWater', 75, '2026-06-09')]),
    );

    expect(result.current.clusters).toHaveLength(0);
  });
});

/**
 * A whole period entered twice.
 *
 * Each copy is individually unremarkable — that is the problem the card exists
 * for. Before this, a month re-entered more than a week from the original
 * produced no duplicate verdicts at all, only a scatter of phantoms that looked
 * exactly like a month of real discrepancies.
 */
describe('re-entry hints', () => {
  const MERCHANTS = ['Corner Coffee', 'Zenith Hardware', 'Acme Bakery', 'Vendor Co', 'Harbor Fuel'];

  /** `count` reconciled originals in June, each copied `offsetDays` later. */
  function reentered(count: number, offsetDays: number) {
    const rows = [];
    const matches = [];
    const txs = [];
    for (let i = 0; i < count; i++) {
      const d = String(i + 1).padStart(2, '0');
      const name = MERCHANTS[i % MERCHANTS.length]!;
      const amount = Math.round((10 + i * 3.17) * 100) / 100;
      const copyDay = String(i + 1 + offsetDays).padStart(2, '0');
      rows.push(row(`r${i}`, name.toUpperCase(), -amount, `2026-06-${d}`));
      matches.push(match(`r${i}`, `t${i}`));
      txs.push(tx(`t${i}`, name, amount, `2026-06-${d}`));
      txs.push(tx(`c${i}`, name, amount, `2026-06-${copyDay}`));
    }
    return { session: build(rows, matches), txs };
  }

  it('gathers a re-entered period into one card', () => {
    const { session, txs } = reentered(8, 10);
    const { result } = renderHook(() => useReconcileGroups(session, txs));

    expect(result.current.reentries).toHaveLength(1);
    const [hint] = result.current.reentries;
    expect(hint!.apps).toHaveLength(8);
    expect(hint!.start).toBe('2026-06-01');
    expect(hint!.end).toBe('2026-06-08');
    expect(hint!.total).toBeCloseTo(
      txs.filter((t) => t.id.startsWith('c')).reduce((s, t) => s + t.amount, 0),
      2,
    );
  });

  it('leaves its members in their own section — the card consumes nothing', () => {
    // The card explains nothing by itself, so every copy must still be listed
    // and resolvable individually. Swallowing them would hide real rows behind
    // a heuristic.
    const { session, txs } = reentered(8, 10);
    const { result } = renderHook(() => useReconcileGroups(session, txs));

    expect(result.current.inAppNotOnStatement).toHaveLength(8);
  });

  it('says nothing about a handful of far-dated lookalikes', () => {
    // A few monthly recurring charges have exactly this shape — same merchant,
    // same amount, weeks apart, one copy not yet on the statement. The count
    // gate is what stops the screen recommending a real bill be deleted.
    const { session, txs } = reentered(3, 10);
    const { result } = renderHook(() => useReconcileGroups(session, txs));

    expect(result.current.reentries).toHaveLength(0);
  });
});
