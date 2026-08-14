import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import LedgerTable from './LedgerTable.js';
import type { Transaction as CoreTransaction } from '@budget-tracker/core';

/**
 * jsdom has no matchMedia — mock it per the Investments.test.tsx convention.
 * `mockViewportWidth(w)` makes useIsNarrow behave as if the viewport were
 * w px wide: a `(max-width: Npx)` query matches when w <= N.
 */
function mockViewportWidth(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const m = /\(max-width:\s*([\d.]+)px\)/.exec(query);
      const max = m ? Number(m[1]) : Number.POSITIVE_INFINITY;
      return {
        matches: width <= max,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });
}

const makeTx = (overrides: Partial<CoreTransaction>): CoreTransaction => ({
  id: 't1',
  type: 'EXPENSE',
  name: 'Market Run',
  amount: 54.2,
  netAmount: 54.2,
  date: new Date('2026-07-10'),
  payPeriodId: null,
  expenseId: null,
  incomeId: null,
  accountId: 'a1',
  toAccountId: null,
  budgetId: 'b1',
  note: null,
  balanceBefore: 1200.5,
  balanceAfter: 1146.3,
  createdAt: new Date('2026-07-10'),
  ...overrides,
});

const GROUPS = [
  {
    dateKey: '2026-07-10',
    txs: [makeTx({})],
  },
];

const PROPS = {
  groups: GROUPS,
  isLoading: false,
  accountId: 'a1',
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
};

/**
 * Column integrity (see ERRORS.md): every row's summed colSpan must equal the
 * <colgroup>'s <col> count — a dropped column must switch its <col> and <td>
 * together or cells silently shift.
 */
function expectColumnIntegrity(container: HTMLElement, expectedCols: number) {
  const tables = container.querySelectorAll('table');
  expect(tables.length).toBeGreaterThan(0);
  tables.forEach((table) => {
    const colCount = table.querySelectorAll('colgroup col').length;
    expect(colCount).toBe(expectedCols);
    table.querySelectorAll('tr').forEach((tr) => {
      let span = 0;
      tr.querySelectorAll('td, th').forEach((cell) => {
        span += (cell as HTMLTableCellElement).colSpan || 1;
      });
      expect(span).toBe(colCount);
    });
  });
}

describe('LedgerTable', () => {
  beforeEach(() => {
    mockViewportWidth(1280);
  });

  it('renders name + both balance columns and amount at desktop (no category column)', () => {
    const { container } = render(<LedgerTable {...PROPS} />);

    expectColumnIntegrity(container, 4);
    expect(screen.getByText('Market Run')).toBeInTheDocument();
    expect(screen.getByText('$1,200.50')).toBeInTheDocument();
    expect(screen.getByText('$1,146.30')).toBeInTheDocument();
  });

  it('drops the balance-before column below 640px', () => {
    mockViewportWidth(600);
    const { container } = render(<LedgerTable {...PROPS} />);

    expectColumnIntegrity(container, 3);
    expect(screen.queryByText('$1,200.50')).not.toBeInTheDocument();
    // Amount and balance after survive
    expect(screen.getByText('-$54.20')).toBeInTheDocument();
    expect(screen.getByText('$1,146.30')).toBeInTheDocument();
  });

  it('drops the balance-after column too below 540px', () => {
    mockViewportWidth(480);
    const { container } = render(<LedgerTable {...PROPS} />);

    expectColumnIntegrity(container, 2);
    // Both balance columns are gone…
    expect(screen.queryByText('$1,200.50')).not.toBeInTheDocument();
    expect(screen.queryByText('$1,146.30')).not.toBeInTheDocument();
    // …leaving Amount to carry the row.
    expect(screen.getByText('Market Run')).toBeInTheDocument();
    expect(screen.getByText('-$54.20')).toBeInTheDocument();
  });

  /**
   * Requirement 6.7 — a reconciliation adjustment must never look like an
   * ordinary transaction. It is the visible record of an amount nobody could
   * explain, and it earns that visibility by being marked.
   */
  it('badges a reconciliation adjustment and leaves ordinary rows unmarked', () => {
    render(<LedgerTable {...PROPS} />);
    expect(screen.queryByText('Adjustment')).not.toBeInTheDocument();

    render(
      <LedgerTable
        {...PROPS}
        groups={[
          {
            dateKey: '2026-07-10',
            txs: [
              makeTx({ id: 't2', name: 'Ordinary' }),
              makeTx({
                id: 't3',
                name: 'Reconciliation adjustment — Unidentified fee',
                isReconciliationAdjustment: true,
              }),
            ],
          },
        ]}
      />,
    );
    expect(screen.getAllByText('Adjustment')).toHaveLength(1);
    expect(screen.getByText('Ordinary')).toBeInTheDocument();
  });
});
