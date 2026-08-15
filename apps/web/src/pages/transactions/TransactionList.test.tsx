import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createWrapper } from '../../test/wrapper.js';
import type { TransactionLogEntry } from '@budget-tracker/core';

/** The DS dropdown uses a double-rAF opening phase; flush it so the portal renders. */
async function flushRAF() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
  });
}

// Mock matchMedia for responsive column collapse (useIsNarrow in TransactionList)
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

// ─── Mocks ───

vi.mock('../../components/LoadMoreTrigger.js', () => ({
  LoadMoreTrigger: ({ onLoadMore, hasMore }: { onLoadMore: () => void; hasMore: boolean }) =>
    hasMore ? <button onClick={onLoadMore}>Load More</button> : null,
}));

vi.mock('./AnticipationRow.js', () => ({
  default: ({ anticipation }: { anticipation: { id: string; name: string } }) => (
    <tr data-testid={`anticipation-${anticipation.id}`}>
      <td colSpan={6}>{anticipation.name}</td>
    </tr>
  ),
}));

import TransactionList from './TransactionList.js';

// ─── Helpers ───

function makeTx(
  overrides: Partial<{
    id: string;
    type: string;
    name: string;
    amount: number;
    date: Date;
    netAmount: number;
    expenseId: string | null;
    incomeId: string | null;
    accountId: string | null;
    toAccountId: string | null;
    budgetId: string | null;
    note: string | null;
    tradeMetadata: unknown;
    bitcoinMetadata: unknown;
    parentId: string | null;
    childCount: number;
    payPeriodId: string | null;
    costBasisAllocated: number | null;
    balanceBefore: number | null;
    balanceAfter: number | null;
    createdAt: Date;
  }> = {},
): TransactionLogEntry {
  return {
    kind: 'transaction',
    data: {
      id: 'tx-1',
      type: 'EXPENSE',
      name: 'Groceries',
      amount: 50,
      netAmount: 50,
      date: new Date('2025-06-01T00:00:00.000Z'),
      payPeriodId: null,
      expenseId: null,
      incomeId: null,
      accountId: 'acc-1',
      toAccountId: null,
      budgetId: 'cat-1',
      note: null,
      tradeMetadata: null,
      bitcoinMetadata: null,
      costBasisAllocated: null,
      balanceBefore: null,
      balanceAfter: null,
      parentId: null,
      childCount: 0,
      createdAt: new Date('2025-06-01T00:00:00.000Z'),
      ...overrides,
    },
  } as TransactionLogEntry;
}

/**
 * The row-action handlers now arrive as one `rowActions` bundle (supplied in the
 * app by `useTransactionRowActions`), so a test overriding a single handler
 * spreads this and replaces just that key — see `withAction` below.
 */
const rowActions = {
  expenses: [{ id: 'exp-1', name: 'Netflix', budgetId: 'cat-1' }],
  incomes: [{ id: 'inc-1', name: 'Salary' }],
  onEdit: vi.fn(),
  onDuplicate: vi.fn(),
  onInstantDuplicate: vi.fn(),
  onSplit: vi.fn(),
  onDelete: vi.fn(),
  onDeleteGroup: vi.fn(),
  onManageGroup: vi.fn(),
  onResplit: vi.fn(),
  onUnlink: vi.fn(),
  onLink: vi.fn(),
};

const defaultProps = {
  filteredEntries: [] as TransactionLogEntry[],
  selected: new Set<string>(),
  onToggleSelect: vi.fn(),
  categories: [{ id: 'cat-1', name: 'Food', icon: '🍕', groupName: 'Living' }],
  accounts: [
    { id: 'acc-1', name: 'Chase', type: 'CHECKING' },
    { id: 'acc-2', name: 'Savings', type: 'SAVINGS' },
  ],
  custodians: [{ id: 'cust-1', name: 'Fidelity' }],
  wallets: [{ id: 'wal-1', name: 'Ledger' }],
  rowActions,
  onChangeBudget: vi.fn(),
  onMarkAsPaid: vi.fn(),
  onConfirmPaidEarly: vi.fn(),
  onSnooze: vi.fn(),
  markAsPaidPending: false,
  onLoadMore: vi.fn(),
  hasNextPage: false,
  isFetchingNextPage: false,
};

/** Swap a single row-action handler, keeping the rest of the bundle intact. */
const withAction = (overrides: Partial<typeof rowActions>) => ({
  ...rowActions,
  ...overrides,
});

// ─── Tests ───

describe('TransactionList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('grouped rows by date', () => {
    it('renders transactions grouped by date with date headings', () => {
      const entries: TransactionLogEntry[] = [
        makeTx({ id: 'tx-1', name: 'Groceries', date: new Date('2025-06-01T00:00:00.000Z') }),
        makeTx({ id: 'tx-2', name: 'Coffee', date: new Date('2025-06-01T00:00:00.000Z') }),
        makeTx({ id: 'tx-3', name: 'Gas', date: new Date('2025-05-30T00:00:00.000Z') }),
      ];

      render(<TransactionList {...defaultProps} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });

      // Two date groups (formatDate uses 'MMM dd, yyyy' with leading zeros)
      expect(screen.getByText('Jun 01, 2025')).toBeInTheDocument();
      expect(screen.getByText('May 30, 2025')).toBeInTheDocument();

      // All transaction names rendered
      expect(screen.getByText('Groceries')).toBeInTheDocument();
      expect(screen.getByText('Coffee')).toBeInTheDocument();
      expect(screen.getByText('Gas')).toBeInTheDocument();
    });

    it('renders anticipation entries via AnticipationRow', () => {
      const entries: TransactionLogEntry[] = [
        {
          kind: 'anticipation',
          data: {
            id: 'ant-1',
            sourceType: 'expense',
            sourceId: 'exp-1',
            name: 'Netflix Due',
            amount: 15.99,
            occurrenceDate: new Date('2025-06-05T00:00:00.000Z'),
            status: 'DUE',
            budgetId: 'cat-1',
            accountId: 'acc-1',
            isAutomatic: true,
            frequency: 'MONTHLY',
          },
        },
      ];

      render(<TransactionList {...defaultProps} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });

      expect(screen.getByTestId('anticipation-ant-1')).toBeInTheDocument();
      expect(screen.getByText('Netflix Due')).toBeInTheDocument();
    });

    it('displays category badge for categorized transactions', () => {
      const entries = [makeTx({ id: 'tx-1', budgetId: 'cat-1' })];

      render(<TransactionList {...defaultProps} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });

      expect(screen.getByText('🍕 Food')).toBeInTheDocument();
    });

    it('displays Uncategorized badge for uncategorized expense', () => {
      const entries = [makeTx({ id: 'tx-1', budgetId: null, type: 'EXPENSE' })];

      render(<TransactionList {...defaultProps} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });

      expect(screen.getByText(/Uncategorized/)).toBeInTheDocument();
    });

    it('displays account name for regular transactions', () => {
      const entries = [makeTx({ id: 'tx-1', accountId: 'acc-1' })];

      render(<TransactionList {...defaultProps} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });

      expect(screen.getByText('Chase')).toBeInTheDocument();
    });
  });

  describe('checkbox selection', () => {
    it('renders checkbox for each transaction row', () => {
      const entries = [
        makeTx({ id: 'tx-1', name: 'Groceries' }),
        makeTx({ id: 'tx-2', name: 'Coffee', date: new Date('2025-06-01T00:00:00.000Z') }),
      ];

      render(<TransactionList {...defaultProps} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes).toHaveLength(2);
    });

    it('calls onToggleSelect when checkbox is clicked', async () => {
      const user = userEvent.setup();
      const onToggleSelect = vi.fn();
      const entries = [makeTx({ id: 'tx-1', name: 'Groceries' })];

      render(
        <TransactionList
          {...defaultProps}
          filteredEntries={entries}
          onToggleSelect={onToggleSelect}
        />,
        { wrapper: createWrapper() },
      );

      const checkbox = screen.getByRole('checkbox');
      await user.click(checkbox);

      expect(onToggleSelect).toHaveBeenCalledWith('tx-1');
    });

    it('shows checkbox as checked when transaction is in selected set', () => {
      const entries = [makeTx({ id: 'tx-1', name: 'Groceries' })];
      const selected = new Set(['tx-1']);

      render(<TransactionList {...defaultProps} filteredEntries={entries} selected={selected} />, {
        wrapper: createWrapper(),
      });

      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeChecked();
    });
  });

  describe('overflow menu actions', () => {
    it('calls onEdit when Edit is clicked', async () => {
      const user = userEvent.setup();
      const onEdit = vi.fn();
      const entries = [makeTx({ id: 'tx-1', name: 'Groceries' })];

      render(
        <TransactionList
          {...defaultProps}
          filteredEntries={entries}
          rowActions={withAction({ onEdit })}
        />,
        { wrapper: createWrapper() },
      );

      // Open the dropdown menu
      await user.click(screen.getByRole('button', { name: 'Actions' }));
      await user.click(screen.getByText('Edit'));

      expect(onEdit).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tx-1', name: 'Groceries' }),
      );
    });

    it('calls onDelete when Delete is clicked', async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn();
      const entries = [makeTx({ id: 'tx-1', name: 'Groceries' })];

      render(
        <TransactionList
          {...defaultProps}
          filteredEntries={entries}
          rowActions={withAction({ onDelete })}
        />,
        { wrapper: createWrapper() },
      );

      await user.click(screen.getByRole('button', { name: 'Actions' }));
      await user.click(screen.getByText('Delete'));

      expect(onDelete).toHaveBeenCalledWith('tx-1');
    });

    it('shows Link to Recurring submenu for unlinked transactions', async () => {
      const user = userEvent.setup();
      const entries = [makeTx({ id: 'tx-1', expenseId: null, incomeId: null })];

      render(<TransactionList {...defaultProps} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });

      await user.click(screen.getByRole('button', { name: 'Actions' }));

      expect(screen.getByText('Link to Recurring')).toBeInTheDocument();
    });

    it('shows Unlink option for linked transactions', async () => {
      const user = userEvent.setup();
      const onUnlink = vi.fn();
      const entries = [makeTx({ id: 'tx-1', expenseId: 'exp-1' })];

      render(
        <TransactionList
          {...defaultProps}
          filteredEntries={entries}
          rowActions={withAction({ onUnlink })}
        />,
        { wrapper: createWrapper() },
      );

      await user.click(screen.getByRole('button', { name: 'Actions' }));
      await user.click(screen.getByText('Unlink'));

      expect(onUnlink).toHaveBeenCalledWith('tx-1');
    });

    it('shows Duplicate options for unlinked transactions', async () => {
      const user = userEvent.setup();
      const entries = [makeTx({ id: 'tx-1', expenseId: null, incomeId: null })];

      render(<TransactionList {...defaultProps} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });

      await user.click(screen.getByRole('button', { name: 'Actions' }));

      expect(screen.getByText('Copy & Change')).toBeInTheDocument();
      expect(screen.getByText('Duplicate')).toBeInTheDocument();
    });

    it('hides Duplicate options for linked transactions', async () => {
      const user = userEvent.setup();
      const entries = [makeTx({ id: 'tx-1', expenseId: 'exp-1' })];

      render(<TransactionList {...defaultProps} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });

      await user.click(screen.getByRole('button', { name: 'Actions' }));

      expect(screen.queryByText('Copy & Change')).not.toBeInTheDocument();
      expect(screen.queryByText('Duplicate')).not.toBeInTheDocument();
    });
  });

  describe('budget quick-switch', () => {
    it('renders a single-category expense budget as an interactive chevron trigger', () => {
      const entries = [makeTx({ id: 'tx-1', type: 'EXPENSE', budgetId: 'cat-1' })];
      render(<TransactionList {...defaultProps} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });
      // The budget badge is a button (the chevron trigger), labelled by its category.
      expect(screen.getByRole('button', { name: /Food/ })).toBeInTheDocument();
    });

    it('keeps a split transaction budget static (not switchable)', () => {
      const entries = [makeTx({ id: 'tx-1', type: 'EXPENSE', budgetId: 'cat-1', childCount: 2 })];
      render(<TransactionList {...defaultProps} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });
      // Budget renders as a plain badge (its category lives on the child rows).
      expect(screen.queryByRole('button', { name: /Food/ })).not.toBeInTheDocument();
      expect(screen.getByText(/Food/)).toBeInTheDocument();
    });

    it('keeps a purchase-group Anchor budget static (budget lives on the group, not switchable)', () => {
      const entries = [
        makeTx({ id: 'tx-1', type: 'EXPENSE', budgetId: 'cat-1', purchaseGroupId: 'g1' } as never),
      ];
      render(<TransactionList {...defaultProps} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });
      expect(screen.queryByRole('button', { name: /Food/ })).not.toBeInTheDocument();
      expect(screen.getByText(/Food/)).toBeInTheDocument();
    });

    it('fires onChangeBudget with the picked category id from the badge dropdown', async () => {
      const user = userEvent.setup();
      const onChangeBudget = vi.fn();
      const categories = [
        { id: 'cat-1', name: 'Food', icon: '🍕', groupName: 'Living' },
        { id: 'cat-2', name: 'Rent', icon: '🏠', groupName: 'Living' },
      ];
      const entries = [makeTx({ id: 'tx-1', type: 'EXPENSE', budgetId: 'cat-1' })];

      render(
        <TransactionList
          {...defaultProps}
          categories={categories}
          filteredEntries={entries}
          onChangeBudget={onChangeBudget}
        />,
        { wrapper: createWrapper() },
      );

      // Open the budget badge dropdown and pick a different category.
      await user.click(screen.getByRole('button', { name: /Food/ }));
      await flushRAF();
      await user.click(screen.getByText('🏠 Rent'));

      expect(onChangeBudget).toHaveBeenCalledWith('tx-1', 'cat-2');
    });

    it('keeps a recurring-expense-linked budget static (change cascades, needs the full form)', () => {
      const entries = [
        makeTx({ id: 'tx-1', type: 'EXPENSE', budgetId: 'cat-1', expenseId: 'exp-1' }),
      ];
      render(<TransactionList {...defaultProps} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });
      // A plain badge, not a chevron trigger — a one-click switch must not
      // silently rewrite the recurring expense's budget; that goes through the
      // edit form's confirmation instead.
      expect(screen.queryByRole('button', { name: /Food/ })).not.toBeInTheDocument();
      expect(screen.getByText(/Food/)).toBeInTheDocument();
    });

    it('keeps a recurring-income-linked budget switchable (income budget does not cascade)', () => {
      const entries = [
        makeTx({ id: 'tx-1', type: 'INCOME', budgetId: 'cat-1', incomeId: 'inc-1' }),
      ];
      render(<TransactionList {...defaultProps} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });
      expect(screen.getByRole('button', { name: /Food/ })).toBeInTheDocument();
    });
  });

  describe('a split parent whose budget is Uncategorized', () => {
    // A reconcile merge leaves the parent budget Uncategorized with a $0 remainder;
    // its real categories live in the children. Such a row must read as "Split",
    // not the red "needs categorizing" flag.
    const cats = [
      { id: 'cat-1', name: 'Food', icon: '🍕', groupName: 'Living' },
      { id: 'cat-unc', name: 'Uncategorized', icon: '📋', groupName: 'System' },
    ];

    it('reads as "Split", not as Uncategorized', () => {
      const entries = [
        makeTx({ id: 'tx-m', name: 'Ticketmaster', budgetId: 'cat-unc', childCount: 2 }),
      ];
      render(<TransactionList {...defaultProps} categories={cats} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });
      expect(screen.getByText('Split')).toBeInTheDocument();
      expect(screen.queryByText(/Uncategorized/)).not.toBeInTheDocument();
    });

    it('still flags a non-split Uncategorized transaction', () => {
      const entries = [makeTx({ id: 'tx-u', name: 'Mystery', budgetId: 'cat-unc', childCount: 0 })];
      render(<TransactionList {...defaultProps} categories={cats} filteredEntries={entries} />, {
        wrapper: createWrapper(),
      });
      expect(screen.getByText(/Uncategorized/)).toBeInTheDocument();
      expect(screen.queryByText('Split')).not.toBeInTheDocument();
    });
  });
});
