import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createWrapper } from '../../test/wrapper.js';

const mockUsePolicyTransactions = vi.fn();

vi.mock('../../hooks/useHealthcare.js', () => ({
  usePolicyTransactions: (...args: unknown[]) => mockUsePolicyTransactions(...args),
}));

vi.mock('../../lib/utils.js', () => ({
  formatDate: (d: string) => d,
  formatCurrency: (n: number) => `$${n.toFixed(2)}`,
}));

import TransactionList from './TransactionList.js';

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

const TRANSACTIONS = [
  {
    id: 't1',
    date: new Date('2026-05-20'),
    name: 'CVS Pharmacy',
    category: 'Medicine',
    categoryIcon: '💊',
    paymentMethod: 'Chase Sapphire',
    amount: -42.5,
  },
  {
    id: 't2',
    date: new Date('2026-05-20'),
    name: 'Lab Work',
    category: 'Healthcare',
    categoryIcon: null,
    paymentMethod: null,
    amount: -1234.56,
  },
  {
    id: 't3',
    date: new Date('2026-04-02'),
    name: 'Annual Physical',
    category: 'Healthcare',
    categoryIcon: '🏥',
    paymentMethod: 'HSA Debit',
    amount: -150,
  },
];

function mockTransactions(data: typeof TRANSACTIONS | undefined, isLoading = false) {
  mockUsePolicyTransactions.mockReturnValue({ data, isLoading });
}

/**
 * Column integrity (see ERRORS.md): in every rendered table, every row's summed
 * colSpan must equal the <colgroup>'s <col> count — merged/dropped columns must
 * switch their <col> and <td> together or cells silently shift.
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

describe('Healthcare TransactionList', () => {
  beforeEach(() => {
    mockViewportWidth(1280);
  });

  it('renders date-grouped transactions with all columns at desktop', () => {
    mockTransactions(TRANSACTIONS);

    render(<TransactionList policyId="p1" />, { wrapper: createWrapper() });

    // Two date groups
    expect(screen.getByText('2026-05-20')).toBeInTheDocument();
    expect(screen.getByText('2026-04-02')).toBeInTheDocument();

    // Names, categories, payment methods, amounts
    expect(screen.getByText('CVS Pharmacy')).toBeInTheDocument();
    expect(screen.getByText('💊 Medicine')).toBeInTheDocument();
    expect(screen.getByText('Chase Sapphire')).toBeInTheDocument();
    expect(screen.getByText('$42.50')).toBeInTheDocument();
    // Null payment method renders a dash
    expect(screen.getByText('–')).toBeInTheDocument();
    // Amounts are shown as absolute values
    expect(screen.getByText('$1234.56')).toBeInTheDocument();
  });

  it('renders empty state when no transactions', () => {
    mockTransactions([]);

    render(<TransactionList policyId="p1" />, { wrapper: createWrapper() });

    expect(
      screen.getByText('All clear — no healthcare expenses yet this year'),
    ).toBeInTheDocument();
  });

  it('renders loading state', () => {
    mockTransactions(undefined, true);

    render(<TransactionList policyId="p1" />, { wrapper: createWrapper() });

    expect(screen.getByText('Loading transactions…')).toBeInTheDocument();
  });

  describe('responsive tiers', () => {
    it.each([
      { width: 1280, cols: 4, tier: 'desktop: name, category, payment, amount' },
      { width: 800, cols: 4, tier: 'still desktop — no 1024 tier for a 4-column table' },
      { width: 600, cols: 3, tier: 'payment merges under name' },
      { width: 500, cols: 3, tier: 'no further tier — same 3 columns' },
    ])('at $width px renders $cols columns ($tier)', ({ width, cols }) => {
      mockViewportWidth(width);
      mockTransactions(TRANSACTIONS);

      const { container } = render(<TransactionList policyId="p1" />, {
        wrapper: createWrapper(),
      });

      expectColumnIntegrity(container, cols);
    });

    it('stacks the payment method under the name below 640px', () => {
      mockViewportWidth(600);
      mockTransactions(TRANSACTIONS);

      render(<TransactionList policyId="p1" />, { wrapper: createWrapper() });

      const payment = screen.getByText('Chase Sapphire');
      expect(payment.closest('td')).toBe(screen.getByText('CVS Pharmacy').closest('td'));
    });

    it('never abbreviates amounts — copays would compact to "$0"', () => {
      mockViewportWidth(500);
      mockTransactions(TRANSACTIONS);

      render(<TransactionList policyId="p1" />, { wrapper: createWrapper() });

      // Full precision survives even at the narrowest tier
      expect(screen.getByText('$42.50')).toBeInTheDocument();
      expect(screen.getByText('$1234.56')).toBeInTheDocument();
    });

    it('keeps the full text category badge at the narrowest tier', () => {
      mockViewportWidth(500);
      mockTransactions(TRANSACTIONS);

      render(<TransactionList policyId="p1" />, { wrapper: createWrapper() });

      expect(screen.getByText('💊 Medicine')).toBeInTheDocument();
      expect(screen.getAllByText('Healthcare').length).toBeGreaterThanOrEqual(1);
    });
  });
});
