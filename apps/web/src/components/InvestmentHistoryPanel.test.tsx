import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createWrapper } from '../test/wrapper.js';
import type { HistoryEntry } from '@budget-tracker/core';

const mockUseInvestmentHistory = vi.fn();

vi.mock('../hooks/useApi.js', () => ({
  useInvestmentHistory: (...args: unknown[]) => mockUseInvestmentHistory(...args),
}));

vi.mock('../lib/utils.js', () => ({
  formatDate: (d: string) => d,
  formatCurrency: (n: number) => `$${n.toFixed(2)}`,
  formatCurrencyCompact: (n: number) => `c$${n}`,
}));

import InvestmentHistoryPanel from './InvestmentHistoryPanel.js';

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

const ENTRIES: HistoryEntry[] = [
  {
    id: '1',
    entryType: 'TRADE',
    date: new Date('2026-03-15'),
    description: 'Bought AAPL on Robinhood',
    assetType: 'STOCK',
    ticker: 'AAPL',
    quantity: 10,
    direction: 'BUY',
    fromName: null,
    toName: null,
    custodianName: 'Robinhood',
    amount: 1500,
    costBasisAllocated: null,
    feeAmount: null,
  },
  {
    id: '2',
    entryType: 'TRADE',
    date: new Date('2026-03-15'),
    description: 'Sold MSFT on Fidelity',
    assetType: 'STOCK',
    ticker: 'MSFT',
    quantity: 5,
    direction: 'SELL',
    fromName: null,
    toName: null,
    custodianName: 'Fidelity',
    amount: 2000,
    costBasisAllocated: 1400,
    feeAmount: null,
  },
  {
    id: '3',
    entryType: 'TRANSFER',
    date: new Date('2026-03-14'),
    description: 'Custodian A → Cold Wallet',
    assetType: 'BITCOIN',
    ticker: null,
    quantity: 0.5,
    direction: null,
    fromName: 'Custodian A',
    toName: 'Cold Wallet',
    custodianName: null,
    amount: null,
    costBasisAllocated: null,
    feeAmount: null,
  },
];

function mockHistoryData(entries: HistoryEntry[]) {
  mockUseInvestmentHistory.mockReturnValue({
    data: { pages: [{ entries }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
  });
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

describe('InvestmentHistoryPanel', () => {
  beforeEach(() => {
    mockViewportWidth(1280);
  });

  it('renders grouped history entries by date', () => {
    mockHistoryData(ENTRIES);

    render(<InvestmentHistoryPanel />, { wrapper: createWrapper() });

    // Two date groups rendered
    expect(screen.getByText('2026-03-15')).toBeInTheDocument();
    expect(screen.getByText('2026-03-14')).toBeInTheDocument();

    // Symbols rendered
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('MSFT')).toBeInTheDocument();
    expect(screen.getByText('BTC')).toBeInTheDocument();

    // Custodians rendered (transfers show their route instead)
    expect(screen.getByText('Robinhood')).toBeInTheDocument();
    expect(screen.getByText('Fidelity')).toBeInTheDocument();
    expect(screen.getByText(/Custodian A/)).toBeInTheDocument();
    expect(screen.getByText(/Cold Wallet/)).toBeInTheDocument();

    // Quantities rendered (BTC shows sats)
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('50,000,000 sats')).toBeInTheDocument();

    // Amounts rendered
    expect(screen.getByText('$1500.00')).toBeInTheDocument();
    expect(screen.getByText('$2000.00')).toBeInTheDocument();

    // P/L rendered for the SELL trade with a "+" on gains
    expect(screen.getByText('+$600.00')).toBeInTheDocument();

    // Icon badges carry accessible names (lucide icons are aria-hidden)
    expect(screen.getByRole('img', { name: 'Buy' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sell' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Transfer' })).toBeInTheDocument();
  });

  it('renders empty state when no entries', () => {
    mockHistoryData([]);

    render(<InvestmentHistoryPanel />, { wrapper: createWrapper() });

    expect(screen.getByText('No investment history yet')).toBeInTheDocument();
  });

  it('renders loading state', () => {
    mockUseInvestmentHistory.mockReturnValue({
      data: undefined,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: true,
      isError: false,
    });

    render(<InvestmentHistoryPanel />, { wrapper: createWrapper() });

    // Should not show empty state or entries while loading
    expect(screen.queryByText('No investment history yet')).not.toBeInTheDocument();
  });

  it('renders error state', () => {
    mockUseInvestmentHistory.mockReturnValue({
      data: undefined,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      isError: true,
    });

    render(<InvestmentHistoryPanel />, { wrapper: createWrapper() });

    expect(screen.getByText('Could not load history')).toBeInTheDocument();
  });

  describe('responsive tiers', () => {
    it.each([
      { width: 1280, cols: 7, tier: 'desktop: badge, symbol, custodian, price, qty, amount, P/L' },
      { width: 800, cols: 6, tier: 'merged: custodian stacks under symbol' },
      { width: 600, cols: 6, tier: 'compact values, still merged' },
      { width: 500, cols: 4, tier: 'condensed: price dropped, P/L stacks under amount' },
    ])('at $width px renders $cols columns ($tier)', ({ width, cols }) => {
      mockViewportWidth(width);
      mockHistoryData(ENTRIES);

      const { container } = render(<InvestmentHistoryPanel />, { wrapper: createWrapper() });

      expectColumnIntegrity(container, cols);
    });

    it('stacks the custodian under the symbol below 1024px', () => {
      mockViewportWidth(800);
      mockHistoryData(ENTRIES);

      render(<InvestmentHistoryPanel />, { wrapper: createWrapper() });

      // Custodian still visible, now as a subline in the symbol cell
      const custodian = screen.getByText('Robinhood');
      expect(custodian.closest('td')).toBe(screen.getByText('AAPL').closest('td'));
    });

    it('abbreviates sats and dollar values below 640px', () => {
      mockViewportWidth(600);
      mockHistoryData(ENTRIES);

      render(<InvestmentHistoryPanel />, { wrapper: createWrapper() });

      // 0.5 BTC = 50,000,000 sats → compact m-tier
      expect(screen.getByText('50.00m sats')).toBeInTheDocument();
      expect(screen.queryByText('50,000,000 sats')).not.toBeInTheDocument();
      // Dollar values go through formatCurrencyCompact (mocked as c$N)
      expect(screen.getByText('c$1500')).toBeInTheDocument();
    });

    it('condenses below 540px: price dropped, P/L stacked under amount', () => {
      mockViewportWidth(500);
      mockHistoryData(ENTRIES);

      render(<InvestmentHistoryPanel />, { wrapper: createWrapper() });

      // Price for AAPL trade would be $150 (1500/10) — gone below 540
      expect(screen.queryByText('c$150')).not.toBeInTheDocument();
      // Quantity and amount survive
      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('c$1500')).toBeInTheDocument();
      // P/L (+600 on the MSFT sell) now lives in the same cell as its amount
      const pl = screen.getByText('+c$600');
      expect(pl.closest('td')).toBe(screen.getByText('c$2000').closest('td'));
    });
  });
});
