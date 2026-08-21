/**
 * Tests for step 3 — the list of writes, before any of them happen.
 *
 * Two properties matter most. First, the values shown are the ones about to be
 * WRITTEN, not the ones being replaced: a correction that displayed the old
 * amount would ask the user to confirm a figure the change does not produce.
 * Second, no per-row Remove — Undo lives in step 2 and Back is one click away,
 * and a second, subtly different way to unstage on the screen whose job is
 * confirming is one more thing to get wrong.
 *
 * The combine exception is pinned too. Every other operation collapses to one
 * row; a combine keeps both sides, because the question it asks is which rows
 * go with which and collapsing it leaves nothing to check.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReviewStep from './ReviewStep.js';
import type { AppliedResult, ResolutionItem, StagedAction } from './types.js';

vi.mock('../../lib/api.js', () => ({
  api: {
    descriptions: { list: () => Promise.resolve([{ id: 'd1', name: 'AliExpress' }]) },
    budgetItems: {
      list: () =>
        Promise.resolve([
          // Uncategorized is a system budget with its own icon (ADR-017), not a
          // placeholder — the default has to render like any other budget.
          { id: 'sys-unc', name: 'Uncategorized', icon: '📋' },
          { id: 'b1', name: 'Shopping', icon: '🛍️' },
        ]),
    },
  },
}));

beforeEach(() => {
  cleanup();
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

const bankOnly: ResolutionItem = {
  key: 'stmt-r1',
  statements: [{ id: 'r1', date: '2026-06-30', description: 'WALMART #123', amount: 5.44 }],
  apps: [],
  delta: 5.44,
};

const bothSides: ResolutionItem = {
  key: 'diff-r2',
  statements: [{ id: 'r2', date: '2026-06-12', description: 'ACME BAKERY', amount: 24.5 }],
  apps: [{ id: 't2', date: '2026-06-12', name: 'Acme Bakery', amount: 24.0 }],
  delta: 0.5,
};

const combinable: ResolutionItem = {
  key: 'combo-r3',
  statements: [{ id: 'r3', date: '2026-06-20', description: 'AMAZON MKTPL', amount: 30.0 }],
  apps: [
    { id: 't3', date: '2026-06-20', name: 'Amazon', amount: 18.0 },
    { id: 't4', date: '2026-06-20', name: 'Amazon', amount: 12.0 },
  ],
  delta: 0,
};

const deletable: ResolutionItem = {
  key: 'phantom-t5',
  statements: [],
  apps: [{ id: 't5', date: '2026-05-02', name: 'Ghost Charge', amount: 9.99 }],
  delta: -9.99,
};

const createAction: StagedAction = {
  kind: 'create',
  statementRowId: 'r1',
  name: 'WALMART #123',
  amount: 5.44,
  date: '2026-06-30',
  txType: 'EXPENSE',
  budgetId: null,
};

const correctAction: StagedAction = {
  kind: 'correct',
  transactionId: 't2',
  amount: 24.5,
  was: 24.0,
  label: 'Acme Bakery',
};

const pairAction: StagedAction = {
  kind: 'pair',
  pairs: [{ statementRowId: 'r3', transactionIds: ['t3', 't4'] }],
  label: 'Combine these rows',
};

const deleteAction: StagedAction = {
  kind: 'delete',
  transactionId: 't5',
  label: 'Ghost Charge',
};

const ignoreAction: StagedAction = {
  kind: 'ignore',
  label: 'Ghost Charge',
  transactions: [{ id: 't5', note: null }],
};

function renderReview(
  staged: [string, StagedAction][],
  items: ResolutionItem[],
  applied: [string, AppliedResult][] = [],
) {
  const onEdit = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ReviewStep
        staged={new Map(staged)}
        items={new Map(items.map((i) => [i.key, i]))}
        applied={new Map(applied)}
        onEdit={onEdit}
      />
    </QueryClientProvider>,
  );
  return onEdit;
}

describe('ReviewStep', () => {
  it('shows a create as one row carrying the operation', () => {
    renderReview([[bankOnly.key, createAction]], [bankOnly]);

    // Queried by the cell's own title rather than by text: the name also
    // appears in the Name field below, and this assertion is about the ROW.
    expect(screen.getByTitle('WALMART #123')).toBeInTheDocument();
    expect(screen.getByText('06-30-2026')).toBeInTheDocument();
    // The operation, in the badge where the bank/app side sat in step 2.
    expect(screen.getByLabelText('Create “WALMART #123”')).toBeInTheDocument();
    expect(screen.queryByLabelText('From your bank statement')).not.toBeInTheDocument();
  });

  /**
   * The whole point of a correction is the new figure. Showing $24.00 — the
   * amount being replaced — would be asking the user to confirm a number this
   * change does not produce.
   */
  it('shows a correction at its new amount, not the old one', () => {
    renderReview([[bothSides.key, correctAction]], [bothSides]);

    expect(screen.getByText('-$24.50')).toBeInTheDocument();
    expect(screen.queryByText('-$24.00')).not.toBeInTheDocument();
    expect(screen.getByLabelText("Change Acme Bakery to the bank's figure")).toBeInTheDocument();
  });

  it('collapses a correction to a single row', () => {
    renderReview([[bothSides.key, correctAction]], [bothSides]);

    // The bank line it was compared against was step 2's business; here the
    // subject is the transaction being changed.
    expect(screen.getByTitle('Acme Bakery')).toBeInTheDocument();
    expect(screen.queryByTitle('ACME BAKERY')).not.toBeInTheDocument();
  });

  it('keeps both sides of a combine, with their bank and app badges', () => {
    renderReview([[combinable.key, pairAction]], [combinable]);

    expect(screen.getByTitle('AMAZON MKTPL')).toBeInTheDocument();
    expect(screen.getAllByTitle('Amazon')).toHaveLength(2);
    expect(screen.getByLabelText('From your bank statement')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Recorded in Avoir')).toHaveLength(2);
  });

  it('offers no way to remove a staged decision', () => {
    renderReview(
      [
        [bankOnly.key, createAction],
        [bothSides.key, correctAction],
      ],
      [bankOnly, bothSides],
    );

    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('heads a section per operation, with a count badge', () => {
    renderReview(
      [
        [bankOnly.key, createAction],
        [bothSides.key, correctAction],
        [combinable.key, pairAction],
        [deletable.key, deleteAction],
      ],
      [bankOnly, bothSides, combinable, deletable],
    );

    expect(screen.getByText('Create')).toBeInTheDocument();
    expect(screen.getByText('Correct')).toBeInTheDocument();
    expect(screen.getByText('Combine')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    // One decision in each of the four; nothing was ignored.
    expect(screen.getAllByText('1')).toHaveLength(4);
    expect(screen.queryByText('Ignore')).not.toBeInTheDocument();
  });

  it('files a deletion and an ignore under their own headings', () => {
    renderReview(
      [
        [deletable.key, deleteAction],
        ['other', ignoreAction],
      ],
      [deletable],
    );

    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Ignore')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete Ghost Charge')).toBeInTheDocument();
    expect(screen.getByLabelText('Leave Ghost Charge as it is')).toBeInTheDocument();
  });

  it('asks for a name and budget on a create, and on nothing else', () => {
    renderReview(
      [
        [bankOnly.key, createAction],
        [bothSides.key, correctAction],
      ],
      [bankOnly, bothSides],
    );

    // The two questions that want batch answers, and only on the create — a
    // correction is already fully specified by the decision it came from.
    // Name is the app's description search, so it is a real labelled input.
    expect(screen.getByLabelText('Name')).toHaveValue('WALMART #123');
    // Budget is the DS `Select`, whose trigger is a `div[role="combobox"]`;
    // `<label for>` is inert against a non-labelable element, so the label is
    // asserted as text. Pre-existing and shared by every Select in the app.
    expect(screen.getByText('Budget')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });

  /**
   * Uncategorized is a real system budget with an icon, and the one the server
   * assigns anyway. Shown as a bare placeholder it was the only budget in the
   * app rendering without its emoji, and read as an empty field.
   */
  it('defaults the budget to Uncategorized, with its emoji', async () => {
    renderReview([[bankOnly.key, createAction]], [bankOnly]);

    expect(await screen.findByText('📋 Uncategorized')).toBeInTheDocument();
  });

  /**
   * A delete's date and amount come from the decision, not the action. If the
   * decision has rolled out of the groups — a re-match between deciding and
   * reviewing — the operation must still be stated rather than the card
   * rendering blank.
   */
  it('still names the operation when the decision’s rows are gone', () => {
    renderReview([[deletable.key, deleteAction]], []);

    expect(screen.getByLabelText('Delete Ghost Charge')).toBeInTheDocument();
    expect(screen.getByTitle('Ghost Charge')).toBeInTheDocument();
    expect(screen.queryByText('-$9.99')).not.toBeInTheDocument();
  });

  /**
   * Apply stays on this screen and turns the plan into a report.
   *
   * Sending the user back to the difference list the instant the writes landed
   * removed the only page that could say which ones landed — and with the rows
   * draining as the batch ran, it read as the changes being lost.
   */
  describe('once Apply has run', () => {
    const staged: [string, StagedAction][] = [
      [bankOnly.key, createAction],
      [bothSides.key, correctAction],
      [deletable.key, deleteAction],
    ];
    const items = [bankOnly, bothSides, deletable];

    it('regroups by outcome instead of by operation', () => {
      renderReview(staged, items, [
        [bankOnly.key, { ok: true }],
        [bothSides.key, { ok: false, error: 'Server said no' }],
      ]);

      expect(screen.getByText('Applied')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
      // The third was never reached — the batch stops at the first failure.
      expect(screen.getByText('Not applied')).toBeInTheDocument();
      // The operation headings are gone: after the writes land, "did it work"
      // is the only question left.
      expect(screen.queryByText('Create')).not.toBeInTheDocument();
      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });

    it('says what happened on each row, failure included', () => {
      renderReview(staged, items, [
        [bankOnly.key, { ok: true }],
        [bothSides.key, { ok: false, error: 'Server said no' }],
      ]);

      expect(screen.getByLabelText('Create “WALMART #123” — done')).toBeInTheDocument();
      expect(
        screen.getByLabelText("Change Acme Bakery to the bank's figure — failed: Server said no"),
      ).toBeInTheDocument();
    });

    it('gives success and failure different glyphs, not just different words', () => {
      // The badge is how a long list is scanned. Text alone leaves a failed
      // write wearing the same tick as one that landed, and the one row that
      // needs attention is the one that stops looking like it does.
      renderReview(staged, items, [
        [bankOnly.key, { ok: true }],
        [bothSides.key, { ok: false, error: 'Server said no' }],
      ]);

      const ok = screen.getByLabelText('Create “WALMART #123” — done');
      const bad = screen.getByLabelText(
        "Change Acme Bakery to the bank's figure — failed: Server said no",
      );
      expect(ok.querySelector('.lucide-check')).toBeTruthy();
      expect(bad.querySelector('.lucide-circle-alert')).toBeTruthy();
      expect(bad.querySelector('.lucide-check')).toBeNull();
    });

    it('closes the create’s fields once it has been written', () => {
      // Changing a name here would edit nothing but the screen.
      renderReview([[bankOnly.key, createAction]], [bankOnly], [[bankOnly.key, { ok: true }]]);

      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
      expect(screen.queryByText('Budget')).not.toBeInTheDocument();
    });

    it('keeps the fields open on a create that failed', () => {
      // A bad budget or a duplicate name is exactly what the retry needs to fix.
      renderReview(
        [[bankOnly.key, createAction]],
        [bankOnly],
        [[bankOnly.key, { ok: false, error: 'nope' }]],
      );

      expect(screen.getByLabelText('Name')).toBeInTheDocument();
    });

    it('collapses a combine once it is written', () => {
      // Both sides while it is a proposal — the question is which rows go with
      // which. Written, the grouping is settled and the outcome is the news.
      renderReview([[combinable.key, pairAction]], [combinable], [[combinable.key, { ok: true }]]);

      expect(screen.queryByLabelText('From your bank statement')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Combine these rows — done')).toBeInTheDocument();
    });
  });

  it('says there is nothing to review when nothing is staged', () => {
    renderReview([], [bankOnly]);

    expect(screen.getByText(/no changes staged/i)).toBeInTheDocument();
  });
});

/**
 * A merge settles its name here and discloses what it will discard.
 *
 * The disclosure is named per row (Req 5.4), not a generic caution — a paid
 * scheduled item quietly reverting to unpaid is exactly the surprise it exists
 * to prevent.
 */
describe('merging in step 3', () => {
  const mergeItem: ResolutionItem = {
    key: 'combo-tm',
    statements: [{ id: 'j1', date: '2026-02-08', description: 'TM *ACME TOUR', amount: 600 }],
    apps: [
      { id: 'a1', date: '2026-02-05', name: 'Ticketmaster', amount: 300 },
      { id: 'a2', date: '2026-02-05', name: 'Rent Payment', amount: 300 },
    ],
    delta: 0,
  };

  const mergeAction: StagedAction = {
    kind: 'merge',
    statementRowId: 'j1',
    name: 'Ticketmaster',
    parts: [
      {
        transactionId: 'a1',
        name: 'Ticketmaster',
        amount: 300,
        recurringLink: false,
        scheduledMatch: false,
      },
      {
        transactionId: 'a2',
        name: 'Rent Payment',
        amount: 300,
        recurringLink: true,
        scheduledMatch: true,
      },
    ],
    label: 'Merge these rows',
  };

  it('offers an editable merged-name field, seeded from the decision', () => {
    renderReview([['combo-tm', mergeAction]], [mergeItem]);
    expect(screen.getByLabelText(/merged name/i)).toHaveValue('Ticketmaster');
  });

  it('names each row a merge will discard, with the specific consequence', () => {
    renderReview([['combo-tm', mergeAction]], [mergeItem]);
    // The flagged row is named in the disclosure (the `<strong>`, distinct from
    // the same name shown as an app row above), and the effect is spelled out.
    expect(screen.getByText('Rent Payment', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/revert to unpaid/i)).toBeInTheDocument();
  });

  it('shows no disclosure for a merge that discards nothing', () => {
    const clean: StagedAction = {
      ...mergeAction,
      parts: mergeAction.parts.map((p) => ({
        ...p,
        recurringLink: false,
        scheduledMatch: false,
      })),
    };
    renderReview([['combo-tm', clean]], [mergeItem]);
    expect(screen.queryByText(/revert to unpaid/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/recurring bill/i)).not.toBeInTheDocument();
  });
});
