/**
 * Tests for the decision list and the actions on each card.
 *
 * Step 2 writes NOTHING — every button records an intent that step 3 applies.
 * That is the property most worth pinning: an earlier version acted on click,
 * so a row vanished the moment you touched it and there was no way back.
 *
 * The other important one is the multi-part guard: when several app
 * transactions sum to one statement line there is no single row to correct, so
 * offering "use the bank's figure" would put the whole line's total onto
 * whichever row happened to be first — silently inventing money.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MatchGroups, { type MatchGroupsProps } from './MatchGroups.js';
import type { ClusterHint, ReentryHint, ResolutionItem, StagedAction } from './types.js';

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const EMPTY = {
  amountDiffers: [],
  combinations: [],
  onStatementNotInApp: [],
  inAppNotOnStatement: [],
  pendingInApp: [],
  cancelledOnStatement: [],
  clusters: [],
  reentries: [],
  matchedCount: 0,
  isBusy: false,
  staged: new Map<string, StagedAction>(),
};

function renderGroups(over: Partial<MatchGroupsProps> = {}) {
  const handlers = { onStage: vi.fn(), onUnstage: vi.fn() };
  render(<MatchGroups {...EMPTY} {...handlers} {...over} />);
  return handlers;
}

/** The action staged for a decision, or undefined if nothing was staged. */
function stagedFor(onStage: ReturnType<typeof vi.fn>, key: string): StagedAction | undefined {
  const call = onStage.mock.calls.find((c) => c[0] === key);
  return call?.[1] as StagedAction | undefined;
}

const differing: ResolutionItem = {
  key: 'diff-r1',
  statements: [{ id: 'r1', date: '2026-06-10', description: 'ACME BAKERY', amount: 24.5 }],
  apps: [{ id: 't1', date: '2026-06-10', name: 'Acme Bakery', amount: 24.0 }],
  delta: 0.5,
};

describe('correcting an amount', () => {
  it('offers the bank figure and reports it back', async () => {
    const user = userEvent.setup();
    const { onStage } = renderGroups({ amountDiffers: [differing] });

    await user.click(screen.getByRole('button', { name: /use the statement amount/i }));
    expect(stagedFor(onStage, 'diff-r1')).toEqual({
      kind: 'correct',
      transactionId: 't1',
      amount: 24.5,
      was: 24,
      label: 'Acme Bakery',
    });
  });

  it('stores the gross that nets to the bank figure', async () => {
    // The app records the full basket; rewards and gift cards are settled
    // before the charge reaches the card. Writing the bank's number straight in
    // would wipe $60.00 of rewards off a $200.00 basket.
    const user = userEvent.setup();
    const { onStage } = renderGroups({
      amountDiffers: [
        {
          key: 'diff-wf',
          statements: [
            { id: 'rwf', date: '2026-07-05', description: 'Whole Foods', amount: 140.0 },
          ],
          apps: [{ id: 'wf', date: '2026-07-03', name: 'Whole Foods', amount: 118, offset: 60.0 }],
          delta: 6.04,
        },
      ],
    });

    await user.click(screen.getByRole('button', { name: /use the statement amount/i }));
    expect(stagedFor(onStage, 'diff-wf')).toMatchObject({ transactionId: 'wf', amount: 200.0 });
  });

  it('refuses the one-click fix when several rows sum to the line', () => {
    // `apps` holds three real rows; there is no single amount to correct.
    renderGroups({
      amountDiffers: [
        {
          ...differing,
          apps: [
            ...differing.apps,
            { id: 't2', date: '2026-06-10', name: 'Second', amount: 10 },
            { id: 't3', date: '2026-06-10', name: 'Third', amount: 10 },
          ],
        },
      ],
    });
    expect(screen.queryByRole('button', { name: /use the statement amount/i })).toBeNull();
  });
});

describe('creating from a statement line', () => {
  const missing: ResolutionItem = {
    key: 'stmt-r2',
    statements: [
      {
        id: 'r2',
        date: '2026-06-12',
        description: 'CORNER COFFEE',
        amount: 5,
        direction: 'charge',
      },
    ],
    apps: [],
    delta: -5,
  };

  it('creates with the line’s own values', async () => {
    const user = userEvent.setup();
    const { onStage } = renderGroups({ onStatementNotInApp: [missing] });

    await user.click(screen.getByRole('button', { name: /create this transaction/i }));
    expect(stagedFor(onStage, 'stmt-r2')).toEqual({
      kind: 'create',
      statementRowId: 'r2',
      txType: 'EXPENSE',
      name: 'CORNER COFFEE',
      amount: 5,
      date: '2026-06-12',
      // Settled in step 3, where every pending create is listed together.
      budgetId: null,
    });
  });

  it('infers income from a refund', async () => {
    // Direction is the only signal for this; the old form defaulted to EXPENSE
    // for everything and left the user to notice.
    const user = userEvent.setup();
    const { onStage } = renderGroups({
      onStatementNotInApp: [
        { ...missing, statements: [{ ...missing.statements[0]!, direction: 'credit' }] },
      ],
    });

    await user.click(screen.getByRole('button', { name: /create this transaction/i }));
    expect(stagedFor(onStage, 'stmt-r2')).toMatchObject({ txType: 'INCOME' });
  });
});

describe('deleting a transaction the bank never posted', () => {
  const phantom: ResolutionItem = {
    key: 'app-t9',
    statements: [],
    apps: [{ id: 't9', date: '2026-06-28', name: 'Phantom', amount: 18.75 }],
    delta: -18.75,
  };

  it('stages the deletion rather than performing it', async () => {
    // No second-click confirm here any more: staging IS the pause. The
    // destructive step happens once, in step 3, after a summary.
    const user = userEvent.setup();
    const { onStage } = renderGroups({ inAppNotOnStatement: [phantom] });

    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(stagedFor(onStage, 'app-t9')).toEqual({
      kind: 'delete',
      transactionId: 't9',
      label: 'Phantom',
    });
  });

  it('offers no "keep" button', () => {
    // Keeping is what happens if you do nothing. A button that does nothing
    // invites clicking it to make the row disappear.
    renderGroups({ inAppNotOnStatement: [phantom] });
    expect(screen.queryByRole('button', { name: /keep/i })).toBeNull();
  });
});

describe('combining rows that add up', () => {
  const journey: ResolutionItem = {
    key: 'combo-j',
    title: 'Possibly 2 app transactions combined',
    statements: [{ id: 'j1', date: '2026-02-08', description: 'TM *JOURNEY', amount: 838.8 }],
    apps: [
      { id: 'a1', date: '2026-02-05', name: 'Ticketmaster', amount: 419.4 },
      { id: 'a2', date: '2026-02-05', name: 'Ticketmaster', amount: 419.4 },
    ],
    delta: 0,
  };

  it('offers no free-form correction', () => {
    // Correcting edits ONE transaction. A combination is a claim about several
    // rows at once, so there is no single row the button could mean — it would
    // silently pick whichever happened to be first.
    renderGroups({ combinations: [journey] });
    expect(screen.queryByRole('button', { name: /^correct$/i })).toBeNull();
  });

  it('pairs every app row to the one statement line', async () => {
    const user = userEvent.setup();
    const { onStage } = renderGroups({
      combinations: [
        {
          key: 'combo-j',
          title: 'Possibly 2 app transactions combined',
          statements: [{ id: 'j1', date: '2026-02-08', description: 'TM *JOURNEY', amount: 838.8 }],
          apps: [
            { id: 'a1', date: '2026-02-05', name: 'Ticketmaster', amount: 419.4 },
            { id: 'a2', date: '2026-02-05', name: 'Ticketmaster', amount: 419.4 },
          ],
          delta: 0,
        },
      ],
    });

    await user.click(screen.getByRole('button', { name: /combine them/i }));
    expect(stagedFor(onStage, 'combo-j')).toMatchObject({
      kind: 'pair',
      pairs: [{ statementRowId: 'j1', transactionIds: ['a1', 'a2'] }],
    });
  });

  it('pairs each statement line when one app row covers several', async () => {
    // A match is keyed by its statement row, so this direction needs one call
    // per line rather than one call with several.
    const user = userEvent.setup();
    const { onStage } = renderGroups({
      combinations: [
        {
          key: 'combo-u',
          statements: [
            { id: 'r1', date: '2026-06-10', description: 'METRO MOBILE', amount: 250 },
            { id: 'r2', date: '2026-06-11', description: 'METRO MOBILE', amount: 250 },
          ],
          apps: [{ id: 'a1', date: '2026-06-10', name: 'Metro Mobile', amount: 500 }],
          delta: 0,
        },
      ],
    });

    await user.click(screen.getByRole('button', { name: /combine them/i }));
    // A match is keyed by its statement row, so this direction needs one entry
    // per line rather than one entry with several.
    expect(stagedFor(onStage, 'combo-u')).toMatchObject({
      kind: 'pair',
      pairs: [
        { statementRowId: 'r1', transactionIds: ['a1'] },
        { statementRowId: 'r2', transactionIds: ['a1'] },
      ],
    });
  });
});

describe('merging a combination', () => {
  const mergeable: ResolutionItem = {
    key: 'combo-tm',
    title: 'Possibly 2 app transactions combined',
    statements: [{ id: 'j1', date: '2026-02-08', description: 'TM *JOURNEY', amount: 838.8 }],
    apps: [
      {
        id: 'a1',
        date: '2026-02-05',
        name: 'Ticketmaster',
        amount: 419.4,
        type: 'EXPENSE',
        recurringLink: false,
        scheduledMatch: false,
      },
      {
        id: 'a2',
        date: '2026-02-05',
        name: 'Ticketmaster',
        amount: 419.4,
        type: 'EXPENSE',
        recurringLink: true,
        scheduledMatch: true,
      },
    ],
    delta: 0,
  };

  it('offers "Merge them" for a same-type combination and stages the merge with its parts', async () => {
    const user = userEvent.setup();
    const { onStage } = renderGroups({ combinations: [mergeable] });

    // Merge replaces Combine for an eligible combination.
    expect(screen.queryByRole('button', { name: /combine them/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /merge them/i }));

    expect(stagedFor(onStage, 'combo-tm')).toMatchObject({
      kind: 'merge',
      statementRowId: 'j1',
      // Seeded from the bank description; the user settles it in step 3.
      name: 'TM *JOURNEY',
      parts: [
        { transactionId: 'a1', amount: 419.4, recurringLink: false, scheduledMatch: false },
        { transactionId: 'a2', amount: 419.4, recurringLink: true, scheduledMatch: true },
      ],
    });
  });

  it('falls back to "Combine them" for a mixed expense + refund combination', () => {
    // A refund child under an expense parent would be miscounted as spending, so
    // a mixed set is not mergeable — it stays a pairing.
    renderGroups({
      combinations: [
        {
          ...mergeable,
          apps: [
            { ...mergeable.apps[0]!, type: 'EXPENSE' },
            { ...mergeable.apps[1]!, type: 'REFUND' },
          ],
        },
      ],
    });
    expect(screen.getByRole('button', { name: /combine them/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /merge them/i })).toBeNull();
  });

  it('falls back to "Combine them" when the rows are not expenses or refunds', () => {
    renderGroups({
      combinations: [
        { ...mergeable, apps: mergeable.apps.map((a) => ({ ...a, type: 'TRANSFER' })) },
      ],
    });
    expect(screen.getByRole('button', { name: /combine them/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /merge them/i })).toBeNull();
  });
});

describe('what the list says when there is nothing to do', () => {
  it('reports a clean reconciliation', () => {
    renderGroups({ matchedCount: 12 });
    expect(screen.getByText(/All 12 rows matched cleanly/)).toBeTruthy();
  });

  it('still says so when only informational rows remain', () => {
    // Unposted charges are expected, not unfinished work.
    renderGroups({
      matchedCount: 12,
      pendingInApp: [
        {
          key: 'app-p',
          statements: [],
          apps: [{ id: 'p1', date: '2026-06-29', name: 'Recent', amount: 9 }],
          delta: -9,
        },
      ],
    });
    expect(screen.getByText(/Nothing to resolve/)).toBeTruthy();
    expect(screen.getByText('Recent')).toBeTruthy();
  });
});

/**
 * The property that matters most on this screen.
 *
 * An earlier version acted on click: it created, deleted and re-matched as you
 * scanned, so the row you touched vanished and its neighbours re-sorted under
 * you. Nothing here may write, and every decision must be reversible.
 */
describe('step 2 decides, it does not act', () => {
  const missing: ResolutionItem = {
    key: 'stmt-r2',
    statements: [
      {
        id: 'r2',
        date: '2026-06-12',
        description: 'CORNER COFFEE',
        amount: 5,
        direction: 'charge',
      },
    ],
    apps: [],
    delta: -5,
  };

  it('keeps a decided row on screen instead of removing it', async () => {
    // The subject of a decision has to stay visible; a row that disappears the
    // moment you act on it cannot be checked, and made this list unusable.
    const staged = new Map<string, StagedAction>([
      [
        'stmt-r2',
        {
          kind: 'create',
          statementRowId: 'r2',
          name: 'CORNER COFFEE',
          amount: 5,
          date: '2026-06-12',
          txType: 'EXPENSE',
          budgetId: null,
        },
      ],
    ]);
    renderGroups({ onStatementNotInApp: [missing], staged });

    expect(screen.getByText('CORNER COFFEE')).toBeTruthy();
    expect(screen.getByText(/Create “CORNER COFFEE”/)).toBeTruthy();
  });

  it('stops offering choices once a decision is made', () => {
    const staged = new Map<string, StagedAction>([
      ['app-t9', { kind: 'delete', transactionId: 't9', label: 'Phantom' }],
    ]);
    renderGroups({
      inAppNotOnStatement: [
        {
          key: 'app-t9',
          statements: [],
          apps: [{ id: 't9', date: '2026-06-28', name: 'Phantom', amount: 18.75 }],
          delta: -18.75,
        },
      ],
      staged,
    });

    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
    const undo = screen.getByRole('button', { name: /undo/i });
    expect(undo).toBeTruthy();
    // Carries the undo glyph, not the word alone. Undo is the only way back out
    // of a decision, and it has to be findable by shape in a row of ghost
    // buttons that otherwise all look alike.
    expect(undo.querySelector('svg')).toBeTruthy();
  });

  it('can take a decision back', async () => {
    const user = userEvent.setup();
    const staged = new Map<string, StagedAction>([
      ['app-t9', { kind: 'delete', transactionId: 't9', label: 'Phantom' }],
    ]);
    const { onUnstage } = renderGroups({
      inAppNotOnStatement: [
        {
          key: 'app-t9',
          statements: [],
          apps: [{ id: 't9', date: '2026-06-28', name: 'Phantom', amount: 18.75 }],
          delta: -18.75,
        },
      ],
      staged,
    });

    await user.click(screen.getByRole('button', { name: /undo/i }));
    expect(onUnstage).toHaveBeenCalledWith('app-t9');
  });

  it('leaves other decisions alone when one is made', () => {
    // Staging is per decision. An earlier version re-ran the matcher after
    // every action, which re-sorted rows the user had not touched — including,
    // in the reported case, the other half of a refund pair.
    const other: ResolutionItem = {
      key: 'stmt-r3',
      statements: [{ id: 'r3', date: '2026-06-13', description: 'OTHER VENDOR', amount: 9 }],
      apps: [],
      delta: -9,
    };
    const staged = new Map<string, StagedAction>([
      ['stmt-r2', { kind: 'delete', transactionId: 'x', label: 'x' }],
    ]);
    renderGroups({ onStatementNotInApp: [missing, other], staged });

    expect(screen.getByText('OTHER VENDOR')).toBeTruthy();
    expect(screen.getByRole('button', { name: /create this transaction/i })).toBeTruthy();
  });
});

describe('the actions added for judgement calls', () => {
  const phantom: ResolutionItem = {
    key: 'app-t9',
    statements: [],
    apps: [{ id: 't9', date: '2026-06-28', name: 'Phantom', amount: 18.75 }],
    delta: -18.75,
  };

  it('records "leave it alone" as a decision', async () => {
    // Without this a row the user has judged fine looks identical to one they
    // have not looked at yet, so the list never reads as finished.
    const user = userEvent.setup();
    const { onStage } = renderGroups({ inAppNotOnStatement: [phantom] });

    await user.click(screen.getByRole('button', { name: /^ignore$/i }));
    expect(stagedFor(onStage, 'app-t9')).toMatchObject({
      kind: 'ignore',
      label: 'Phantom',
      // Carried so apply can append to each row's note rather than replace it.
      // A phantom is a verdict about history, so it is allowed to be permanent.
      transactions: [{ id: 't9' }],
    });
  });

  it('offers no correction when there is no transaction to correct', () => {
    renderGroups({
      onStatementNotInApp: [
        {
          key: 'stmt-r2',
          statements: [{ id: 'r2', date: '2026-06-12', description: 'CORNER COFFEE', amount: 5 }],
          apps: [],
          delta: -5,
        },
      ],
    });
    expect(screen.queryByRole('button', { name: /correct/i })).toBeNull();
  });

  it('puts the recommended action last, where the eye finishes', () => {
    renderGroups({ amountDiffers: [{ ...differing, matchIds: ['m1'] }] });
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => /ignore|correct|use the statement/i.test(t));

    expect(labels.at(-1)).toMatch(/use the statement/i);
  });
});

/**
 * A statement's worth of unmatched rows must not take the page down.
 *
 * Every card is its own table with tooltips and buttons, so rendering a
 * thousand at once is not merely slow — it crashed the Accounts page. The state
 * that produces it is usually a symptom (a statement imported against the wrong
 * account, or a period that does not cover its rows), but the list has to
 * survive it rather than assume it cannot happen.
 */
describe('a very large difference list', () => {
  const many = (n: number): ResolutionItem[] =>
    Array.from({ length: n }, (_, i) => ({
      key: `stmt-${i}`,
      statements: [{ id: `r${i}`, date: '2026-06-10', description: `VENDOR ${i}`, amount: 10 + i }],
      apps: [],
      delta: -10,
    }));

  it('renders a bounded number of cards', () => {
    renderGroups({ onStatementNotInApp: many(1000) });
    // One "Ignore" per rendered card is the cheapest way to count them —
    // anchored so the section's "Ignore all" is not counted as a card.
    expect(screen.getAllByRole('button', { name: /^ignore$/i }).length).toBeLessThanOrEqual(50);
  });

  it('still reports the true total in the heading', () => {
    // Capping what is drawn must never understate what was found. Separated
    // like every other count — at this size `1000` reads as a year.
    renderGroups({ onStatementNotInApp: many(1000) });
    expect(screen.getByText('1,000')).toBeTruthy();
  });

  // The only test in the web suite that renders a large list AND drives an
  // async interaction over it, which is why it alone needs a raised timeout.
  // The cost is inherent to what it asserts: `getAllByRole` with a name matcher
  // computes an accessible name for every candidate button, and it runs that
  // over 60 expanded cards. ~0.5s locally; a shared CI runner is roughly ten
  // times slower (the suite's jsdom environment setup alone costs 150s there),
  // which put it right on the 5s default and made it fail intermittently —
  // once for real, on 2026-08-09, taking the `needs: test`-gated e2e job with
  // it. Raised rather than trimmed because the list size IS the assertion.
  it('can show the rest on request', async () => {
    const user = userEvent.setup();
    renderGroups({ onStatementNotInApp: many(60) });

    expect(screen.getByRole('button', { name: /show the remaining 10/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /show the remaining 10/i }));
    expect(screen.getAllByRole('button', { name: /^ignore$/i })).toHaveLength(60);
  }, 20_000);

  it('does not offer to expand a list that fits', () => {
    renderGroups({ onStatementNotInApp: many(3) });
    expect(screen.queryByRole('button', { name: /show the remaining/i })).toBeNull();
  });
});

/**
 * Dismissing a whole section.
 *
 * For the groups that are usually fine — unposted charges, reversals — going
 * row by row is busywork. It stages like everything else, so a mis-click costs
 * Undos rather than a batch of edits.
 */
describe('ignoring a whole section', () => {
  const rows = (n: number): ResolutionItem[] =>
    Array.from({ length: n }, (_, i) => ({
      key: `app-${i}`,
      statements: [],
      apps: [{ id: `t${i}`, date: '2026-06-28', name: `Vendor ${i}`, amount: 5 + i }],
      delta: -5,
    }));

  it('stages every undecided row in the section', async () => {
    const user = userEvent.setup();
    const { onStage } = renderGroups({ pendingInApp: rows(3) });

    await user.click(screen.getByRole('button', { name: /ignore all/i }));

    expect(onStage).toHaveBeenCalledTimes(3);
    expect(stagedFor(onStage, 'app-0')).toMatchObject({ kind: 'ignore', label: 'Vendor 0' });
    expect(stagedFor(onStage, 'app-2')).toMatchObject({ kind: 'ignore', label: 'Vendor 2' });
  });

  /**
   * The distinction that keeps an ignore honest.
   *
   * A charge that has not posted yet posts LATER, and often not for the amount
   * the app holds — a restaurant tab settles with the tip added, a hand-entered
   * figure is only ever as good as the typing. A permanent marker on such a row
   * would hide the statement line that proves it wrong: the row would never be
   * asked about again and the gap would sit in the residual, unexplained.
   *
   * So dismissing a pending row writes nothing. It holds for the sitting and
   * the next statement examines it afresh.
   */
  it('never marks a pending row permanently', async () => {
    const user = userEvent.setup();
    const { onStage } = renderGroups({ pendingInApp: rows(1) });

    await user.click(screen.getByRole('button', { name: /^ignore$/i }));
    expect(stagedFor(onStage, 'app-0')).not.toHaveProperty('transactions');
  });

  it('marks a phantom permanently — that verdict cannot change', async () => {
    // The opposite case, side by side, so the difference is the subject of the
    // test rather than a property of one example.
    const user = userEvent.setup();
    const { onStage } = renderGroups({ inAppNotOnStatement: rows(1) });

    await user.click(screen.getByRole('button', { name: /^ignore$/i }));
    expect(stagedFor(onStage, 'app-0')).toMatchObject({ transactions: [{ id: 't0' }] });
  });

  it('leaves decisions already made alone', async () => {
    // Pressing it must never overwrite a considered choice with a dismissal.
    const user = userEvent.setup();
    const staged = new Map<string, StagedAction>([
      ['app-1', { kind: 'delete', transactionId: 't1', label: 'Vendor 1' }],
    ]);
    const { onStage } = renderGroups({ pendingInApp: rows(3), staged });

    await user.click(screen.getByRole('button', { name: /ignore all/i }));

    expect(onStage).toHaveBeenCalledTimes(2);
    expect(onStage.mock.calls.map((c) => c[0])).not.toContain('app-1');
  });

  it('disappears once the section is fully decided', () => {
    const staged = new Map<string, StagedAction>(
      rows(2).map((i) => [i.key, { kind: 'ignore', label: 'x' } as StagedAction]),
    );
    renderGroups({ pendingInApp: rows(2), staged });
    expect(screen.queryByRole('button', { name: /ignore all/i })).toBeNull();
  });

  it('records the same decision the per-row button does', async () => {
    // Both go through one builder, so a bulk dismissal and a single one apply
    // identically — including the note appended to the transaction.
    const user = userEvent.setup();
    const one = renderGroups({ pendingInApp: rows(1) });
    await user.click(screen.getByRole('button', { name: /^ignore$/i }));
    const single = stagedFor(one.onStage, 'app-0');

    cleanup();

    const all = renderGroups({ pendingInApp: rows(1) });
    await user.click(screen.getByRole('button', { name: /ignore all/i }));
    expect(stagedFor(all.onStage, 'app-0')).toEqual(single);
  });
});

/**
 * The correction form.
 *
 * A dialog rather than an inline panel: three fields that need focus and a
 * deliberate confirm, and inline it stretched the card mid-list and pushed
 * every decision below it down the page while you typed.
 */
describe('correcting a transaction', () => {
  const phantom: ResolutionItem = {
    key: 'app-t9',
    statements: [],
    apps: [{ id: 't9', date: '2026-06-28', name: 'Phantom', amount: 18.75 }],
    delta: -18.75,
  };

  it('opens a dialog naming the row being corrected', async () => {
    const user = userEvent.setup();
    renderGroups({ inAppNotOnStatement: [phantom] });

    await user.click(screen.getByRole('button', { name: /correct/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Correct .*Phantom/)).toBeTruthy();
  });

  it('offers no close affordance beyond Cancel', async () => {
    // Cancel is the escape and the title says which row this is; an X on top
    // of that is a third way out of a three-field form.
    const user = userEvent.setup();
    renderGroups({ inAppNotOnStatement: [phantom] });

    await user.click(screen.getByRole('button', { name: /correct/i }));
    expect(screen.queryByRole('button', { name: /^close$/i })).toBeNull();
  });

  it('stages the correction with the previous values recorded', async () => {
    const user = userEvent.setup();
    const { onStage } = renderGroups({ inAppNotOnStatement: [phantom] });

    await user.click(screen.getByRole('button', { name: /correct/i }));
    await user.clear(screen.getByLabelText(/name/i));
    await user.type(screen.getByLabelText(/name/i), 'Phantom Co');
    await user.click(screen.getByRole('button', { name: /stage correction/i }));

    expect(stagedFor(onStage, 'app-t9')).toMatchObject({
      kind: 'edit',
      transactionId: 't9',
      name: 'Phantom Co',
      was: { name: 'Phantom', date: '2026-06-28', amount: 18.75 },
    });
  });

  it('refuses to stage an empty name', async () => {
    const user = userEvent.setup();
    const { onStage } = renderGroups({ inAppNotOnStatement: [phantom] });

    await user.click(screen.getByRole('button', { name: /correct/i }));
    await user.clear(screen.getByLabelText(/name/i));

    expect(screen.getByRole('button', { name: /stage correction/i })).toBeDisabled();
    expect(onStage).not.toHaveBeenCalled();
  });

  it('closes without staging when cancelled', async () => {
    const user = userEvent.setup();
    const { onStage } = renderGroups({ inAppNotOnStatement: [phantom] });

    await user.click(screen.getByRole('button', { name: /correct/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onStage).not.toHaveBeenCalled();
  });
});

describe('the correction dialog’s footer', () => {
  const phantom: ResolutionItem = {
    key: 'app-t9',
    statements: [],
    apps: [{ id: 't9', date: '2026-06-28', name: 'Phantom', amount: 18.75 }],
    delta: -18.75,
  };

  it('leads with the action, not the escape', async () => {
    // Opposite of the decision row, deliberately: a row is scanned left to
    // right and its primary sits at the end, but a dialog's footer starts a
    // new line, so the thing you opened it to do comes first.
    const user = userEvent.setup();
    renderGroups({ inAppNotOnStatement: [phantom] });
    await user.click(screen.getByRole('button', { name: /correct/i }));

    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => /stage correction|cancel/i.test(t));

    expect(labels[0]).toMatch(/stage correction/i);
    expect(labels[1]).toMatch(/cancel/i);
  });
});

describe('the matched section', () => {
  const one: ResolutionItem = {
    key: 'stmt-r1',
    statements: [{ id: 'r1', date: '2026-06-12', description: 'UNKNOWN', amount: 5 }],
    apps: [],
    delta: -5,
  };

  it('is headed like the others, with its count', async () => {
    renderGroups({ onStatementNotInApp: [one], matchedCount: 12 });
    expect(screen.getByText('Matched')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('carries no help text', () => {
    // There is nothing to explain about rows that reconciled; the count is the
    // whole message.
    renderGroups({ onStatementNotInApp: [one], matchedCount: 12 });
    expect(screen.queryByText(/nothing to do/i)).toBeNull();
  });

  it('is absent when nothing matched', () => {
    renderGroups({ onStatementNotInApp: [one], matchedCount: 0 });
    expect(screen.queryByText('Matched')).toBeNull();
  });

  /**
   * A five-month card statement runs to four figures, and the count is the
   * whole message of this section. `1234` reads as a year at a glance.
   */
  it('separates thousands in the count', () => {
    renderGroups({ onStatementNotInApp: [one], matchedCount: 1234 });
    expect(screen.getByText('1,234')).toBeTruthy();
  });
});

/**
 * Clusters are the one thing on this screen that is NOT a decision.
 *
 * The matcher only groups rows that sum exactly, so a same-merchant set that
 * does not add up is reported as separate unexplained rows on opposite sides of
 * the screen with nothing linking them. A cluster draws those together and shows
 * the gap — and offers nothing else. That restraint is the property worth
 * pinning: the rows do not sum, so combining them would be a claim the
 * arithmetic does not support, and a wrong grouping invites merging
 * transactions that are genuinely distinct.
 */
describe('cluster hints', () => {
  const cluster: ClusterHint = {
    key: 'cluster-app-t9|stmt-r9',
    label: 'CityWater',
    direction: 'charge',
    statements: [{ id: 'r9', date: '2026-05-10', description: 'CITYWATER UTIL', amount: 150 }],
    apps: [
      { id: 't9', date: '2026-05-09', name: 'CityWater', amount: 75 },
      { id: 't10', date: '2026-05-11', name: 'CityWater', amount: 70 },
    ],
    statementTotal: 150,
    appTotal: 145,
    gap: 5,
  };

  /** A cluster's members also appear in their own sections, as in production. */
  const members = {
    onStatementNotInApp: [
      {
        key: 'stmt-r9',
        statements: cluster.statements,
        apps: [],
        delta: -150,
      } as ResolutionItem,
    ],
    inAppNotOnStatement: cluster.apps.map(
      (a): ResolutionItem => ({ key: `app-${a.id}`, statements: [], apps: [a], delta: -a.amount }),
    ),
  };

  it('heads the section and counts the clusters', () => {
    renderGroups({ ...members, clusters: [cluster] });
    expect(screen.getByText('Looks related')).toBeTruthy();
  });

  it('shows both totals and the gap between them', () => {
    renderGroups({ ...members, clusters: [cluster] });
    expect(screen.getByText(/statement \$150\.00 vs app \$145\.00 — off by \$5\.00/i)).toBeTruthy();
  });

  it('offers no action at all — a non-summing set must never be combinable', () => {
    renderGroups({ ...members, clusters: [cluster] });
    const card = screen.getByText(/off by \$5\.00/i).closest('table');
    expect(within(card!).queryByRole('button')).toBeNull();
  });

  it('stages nothing', async () => {
    const user = userEvent.setup();
    const { onStage } = renderGroups({ ...members, clusters: [cluster] });
    await user.click(screen.getByText(/off by \$5\.00/i));
    expect(onStage).not.toHaveBeenCalled();
  });

  it('is absent when no cluster was found', () => {
    renderGroups(members);
    expect(screen.queryByText('Looks related')).toBeNull();
  });
});

/**
 * A whole period entered twice.
 *
 * The restraint is the property worth pinning, as with clusters, and for a
 * sharper reason: the action this card is closest to suggesting is deleting a
 * month of transactions. That must never be a button. The card names the period
 * and the money and stops, leaving every row listed and resolvable individually
 * below.
 */
describe('re-entry hints', () => {
  const apps = [
    { id: 'c1', date: '2026-07-05', name: 'Corner Coffee', amount: 12.4 },
    { id: 'c2', date: '2026-07-06', name: 'Zenith Hardware', amount: 30.11 },
    { id: 'c3', date: '2026-07-07', name: 'Acme Bakery', amount: 8.5 },
    { id: 'c4', date: '2026-07-08', name: 'Vendor Co', amount: 41.2 },
    { id: 'c5', date: '2026-07-09', name: 'Harbor Fuel', amount: 55.79 },
  ];

  const reentry: ReentryHint = {
    key: 'reentry-c1|c2|c3|c4|c5',
    start: '2026-06-05',
    end: '2026-06-09',
    apps,
    total: 148,
  };

  /** Members also appear in their own section, as in production. */
  const members = {
    inAppNotOnStatement: apps.map(
      (a): ResolutionItem => ({ key: `app-${a.id}`, statements: [], apps: [a], delta: -a.amount }),
    ),
  };

  it('heads the section and names the period and the money', () => {
    renderGroups({ ...members, reentries: [reentry] });
    expect(screen.getByText('Possibly entered twice')).toBeTruthy();
    expect(screen.getByText(/5 rows worth \$148\.00/i)).toBeTruthy();
  });

  it('offers no action — deleting a month must never be one click', () => {
    renderGroups({ ...members, reentries: [reentry] });
    const card = screen.getByText(/5 rows worth/i).closest('table');
    expect(within(card!).queryByRole('button')).toBeNull();
  });

  it('stages nothing', async () => {
    const user = userEvent.setup();
    const { onStage } = renderGroups({ ...members, reentries: [reentry] });
    await user.click(screen.getByText(/5 rows worth/i));
    expect(onStage).not.toHaveBeenCalled();
  });

  it('leaves its members listed in their own section', () => {
    renderGroups({ ...members, reentries: [reentry] });
    // Each copy still appears as its own row outside the card.
    expect(screen.getAllByText('Corner Coffee').length).toBeGreaterThan(1);
  });

  it('is absent when no re-entry was found', () => {
    renderGroups(members);
    expect(screen.queryByText('Possibly entered twice')).toBeNull();
  });
});
