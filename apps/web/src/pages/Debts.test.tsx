import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createWrapper } from '../test/wrapper.js';

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

beforeEach(() => {
  mockViewportWidth(1280);
});

// ── Mock sub-components that fetch their own data ───────────────────────────
vi.mock('./debts/AmortizationPanel.js', () => ({
  default: () => <div data-testid="amortization-panel" />,
}));
vi.mock('./debts/EscrowHistoryPanel.js', () => ({
  default: () => <div data-testid="escrow-history-panel" />,
}));
vi.mock('./debts/EscrowReminderBanner.js', () => ({
  default: ({ debtName }: { debtName: string }) => (
    <div data-testid="escrow-reminder">{debtName}</div>
  ),
}));
vi.mock('./debts/DebtForm.js', () => ({
  default: ({ editing }: { editing: unknown }) => (
    <div data-testid="debt-form">{editing ? 'Edit' : 'Add'}</div>
  ),
}));

// ── Configurable mock state ─────────────────────────────────────────────────
let mockDebtsReturn = { data: [] as unknown[], isLoading: false };
let mockSummaryReturn = { data: undefined as unknown };
const deleteMutate = vi.fn();

vi.mock('../hooks/useApi.js', () => ({
  useDebts: () => mockDebtsReturn,
  useDebtSummary: () => mockSummaryReturn,
  useDeleteDebt: () => ({ mutate: deleteMutate, isPending: false }),
  useAccounts: () => ({ data: [{ id: 'a1', name: 'Cash Wallet' }] }),
  useExpenses: () => ({ data: [{ id: 'e1', name: 'Mortgage Payment' }] }),
  useExtraPayment: () => ({ mutate: vi.fn(), isPending: false }),
  DebtRecord: {},
}));

import DebtsPage from './Debts.js';

// ── Sample data ─────────────────────────────────────────────────────────────
const sampleDebts = [
  {
    id: 'd1',
    name: 'Home Mortgage',
    type: 'MORTGAGE',
    originalBalance: 200000,
    currentBalance: 180000,
    apr: 6.5,
    minimumPayment: 1200,
    monthlyPayment: 1650,
    estimatedPayoffDate: '2040-06-15T00:00:00.000Z',
    frequency: 'MONTHLY',
    paidOff: false,
    managementUrl: 'https://example.com',
    escrowEnabled: true,
    accountId: null,
    expenseId: null,
    note: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'd2',
    name: 'Car Loan',
    type: 'AUTO_LOAN',
    originalBalance: 30000,
    currentBalance: 15000,
    apr: 4.9,
    minimumPayment: 450,
    monthlyPayment: 450,
    estimatedPayoffDate: null,
    frequency: 'MONTHLY',
    paidOff: false,
    managementUrl: null,
    escrowEnabled: false,
    accountId: null,
    expenseId: null,
    note: null,
    createdAt: '2025-02-01T00:00:00.000Z',
    updatedAt: '2025-02-01T00:00:00.000Z',
  },
];

const sampleSummary = {
  totalBalance: 195000,
  totalMinimumMonthly: 1650,
  debtFreeDate: '2050-06-01',
  activeCount: 2,
  paidOffCount: 1,
};

describe('Debts Page — with data', () => {
  beforeEach(() => {
    mockDebtsReturn = { data: sampleDebts, isLoading: false };
    mockSummaryReturn = { data: sampleSummary };
  });

  it('renders debt names', () => {
    render(<DebtsPage />, { wrapper: createWrapper() });
    // Home Mortgage appears in both the debt card and the escrow reminder
    expect(screen.getAllByText('Home Mortgage').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Car Loan')).toBeInTheDocument();
  });

  it('renders debt progress information', () => {
    render(<DebtsPage />, { wrapper: createWrapper() });
    // Progress bar helper text contains balance remaining and APR
    expect(screen.getByText(/\$180,000\.00 remaining/)).toBeInTheDocument();
    expect(screen.getByText(/6\.5%/)).toBeInTheDocument();
    expect(screen.getByText(/\$15,000\.00 remaining/)).toBeInTheDocument();
    expect(screen.getByText(/4\.9%/)).toBeInTheDocument();
  });

  it('renders summary cards', () => {
    render(<DebtsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Total Balance')).toBeInTheDocument();
    expect(screen.getByText('$195,000.00')).toBeInTheDocument();
    // "Monthly Payment" and its value also appear on the per-debt detail rows
    expect(screen.getAllByText('Monthly Payment').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$1,650.00').length).toBeGreaterThanOrEqual(1);
    // Debt-Free Date card was dropped — per-debt pay-off dates live on the cards
    expect(screen.queryByText('Debt-Free Date')).not.toBeInTheDocument();
  });

  it('renders detail rows on each debt card', () => {
    render(<DebtsPage />, { wrapper: createWrapper() });
    // Summary card + one row per debt
    expect(screen.getAllByText('Monthly Payment')).toHaveLength(3);
    expect(screen.getAllByText('Interest Rate')).toHaveLength(2);
    expect(screen.getAllByText('Pay-off Date')).toHaveLength(2);
    // Mortgage has a computed pay-off date; the car loan's is null → dash
    expect(screen.getByText('Jun 15, 2040')).toBeInTheDocument();
    expect(screen.getAllByText('–').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('$450.00')).toBeInTheDocument();
  });

  describe('responsive tiers', () => {
    function summaryGrid(): HTMLElement {
      let el: HTMLElement | null = screen.getByText('Total Balance');
      while (el && el.style.display !== 'grid') el = el.parentElement;
      expect(el).not.toBeNull();
      return el!;
    }

    it('shows the summary cards side by side with exact values at desktop', () => {
      render(<DebtsPage />, { wrapper: createWrapper() });
      expect(summaryGrid().style.gridTemplateColumns).toBe('repeat(2, 1fr)');
      expect(screen.getByText('$20,000.00 / $200,000.00')).toBeInTheDocument();
    });

    it('stacks the summary cards below 640px', () => {
      mockViewportWidth(600);
      render(<DebtsPage />, { wrapper: createWrapper() });
      expect(summaryGrid().style.gridTemplateColumns).toBe('1fr');
    });

    it('rounds progress-bar values to whole dollars below 540px', () => {
      mockViewportWidth(500);
      render(<DebtsPage />, { wrapper: createWrapper() });
      expect(screen.getByText('$20,000 / $200,000')).toBeInTheDocument();
      expect(screen.getByText('$180,000 remaining')).toBeInTheDocument();
      expect(screen.queryByText('$180,000.00 remaining')).not.toBeInTheDocument();
      // Detail rows keep full precision
      expect(screen.getByText('$450.00')).toBeInTheDocument();
    });
  });

  it('renders escrow reminder for mortgage debts with escrow enabled', () => {
    render(<DebtsPage />, { wrapper: createWrapper() });
    expect(screen.getByTestId('escrow-reminder')).toHaveTextContent('Home Mortgage');
  });

  it('renders active and paid-off section headings', () => {
    mockDebtsReturn = {
      data: [...sampleDebts, { ...sampleDebts[0], id: 'd3', name: 'Paid Debt', paidOff: true }],
      isLoading: false,
    };
    render(<DebtsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Paid Off')).toBeInTheDocument();
  });

  it('opens add form on Add Debt button click', () => {
    render(<DebtsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByText('Add Debt'));
    expect(screen.getByTestId('debt-form')).toHaveTextContent('Add');
  });

  it('does not show delete confirmation initially', () => {
    render(<DebtsPage />, { wrapper: createWrapper() });
    expect(screen.queryByText(/Are you sure you want to delete/)).not.toBeInTheDocument();
  });
});

describe('Debts Page — loading state', () => {
  beforeEach(() => {
    mockDebtsReturn = { data: undefined as unknown as unknown[], isLoading: true };
    mockSummaryReturn = { data: undefined };
  });

  it('shows loading text when data is loading', () => {
    render(<DebtsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('does not show empty state while loading', () => {
    render(<DebtsPage />, { wrapper: createWrapper() });
    expect(screen.queryByText('No debts yet — add one to get started')).not.toBeInTheDocument();
  });

  it('does not show summary cards while loading', () => {
    render(<DebtsPage />, { wrapper: createWrapper() });
    expect(screen.queryByText('Total Balance')).not.toBeInTheDocument();
  });
});

describe('Debts Page — empty state', () => {
  beforeEach(() => {
    mockDebtsReturn = { data: [], isLoading: false };
    mockSummaryReturn = { data: undefined };
  });

  it('shows empty state when no debts exist', () => {
    render(<DebtsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('No debts yet — add one to get started')).toBeInTheDocument();
  });

  it('shows "Add one" action in empty state', () => {
    render(<DebtsPage />, { wrapper: createWrapper() });
    const addButtons = screen.getAllByText('Add Debt');
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
  });
});
