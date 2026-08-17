import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createWrapper } from '../test/wrapper.js';

// Mock matchMedia for responsive column collapse in PayPeriodCard
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

// Mock recharts to avoid SVG rendering issues in jsdom
vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => null,
  Cell: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReferenceLine: () => null,
}));

vi.mock('../hooks/useApi.js', () => ({
  useCurrentPeriod: () => ({
    data: {
      totalIncome: 5000,
      totalExpenses: 3200,
      netIncome: 1800,
      payPeriod: { startDate: '2026-04-01', endDate: '2026-04-14', payDate: '2026-04-01' },
      schedule: { name: 'Biweekly', type: 'BIWEEKLY' },
      incomeItems: [
        {
          id: 'i1',
          name: 'Paycheck',
          amount: 5000,
          frequency: 'BIWEEKLY',
          budgetId: null,
          actualAmount: null,
          anticipationStatus: 'DUE',
          anticipationId: 'ant_i1',
        },
      ],
      expenseItems: [
        {
          id: 'e1',
          name: 'Mortgage',
          amount: 1099,
          frequency: 'MONTHLY',
          budgetId: 'c1',
          accountId: 'a1',
          dueDay: 1,
          actualAmount: null,
          isPaid: false,
          isAutomatic: true,
          anticipationStatus: 'OVERDUE',
          anticipationId: 'ant_e1',
          paidDate: null,
          expenseType: 'cash',
        },
        {
          id: 'e2',
          name: 'Electric',
          amount: 150,
          frequency: 'MONTHLY',
          budgetId: 'c2',
          accountId: 'a1',
          dueDay: 10,
          actualAmount: 150,
          isPaid: true,
          isAutomatic: false,
          anticipationStatus: 'PAID',
          anticipationId: null,
          paidDate: '2026-04-10',
          expenseType: 'cash',
        },
        {
          id: 'e3',
          name: 'Internet',
          amount: 80,
          frequency: 'MONTHLY',
          budgetId: 'c3',
          accountId: 'a1',
          dueDay: 5,
          actualAmount: null,
          isPaid: false,
          isAutomatic: false,
          anticipationStatus: 'DUE',
          anticipationId: 'ant_e3',
          paidDate: null,
          expenseType: 'cash',
        },
      ],
      balances: [],
      cashFlowSummary: {
        cashExpenses: 1329,
        creditExpenses: 0,
        previousPeriodCreditExpenses: 200,
        previousPeriodCheckingBalance: 2000,
        previousPeriodSavingsBalance: 500,
        adHocCashSpending: 131,
        cashNeeded: 1529,
        creditCardPayments: 0,
      },
    },
    isLoading: false,
  }),
  useYTD: () => ({
    data: {
      year: 2026,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      totalIncome: 20000,
      totalExpenses: 12000,
      netIncome: 8000,
      byCategory: [],
    },
  }),
  useIncomeTrend: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('../hooks/useDashboard.js', () => ({
  useSpendPrediction: () => ({
    data: null,
    isLoading: false,
  }),
}));

vi.mock('../hooks/useScheduledTransactions.js', () => ({
  useMarkAsPaid: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Mock sub-chart components to avoid complex rendering
vi.mock('../components/SpendPredictionChart.js', () => ({
  default: () => <div data-testid="spend-prediction-chart" />,
}));

vi.mock('../components/NetSavingsBarChart.js', () => ({
  default: () => <div data-testid="net-savings-chart" />,
}));

import Dashboard from './Dashboard.js';

describe('Dashboard Page', () => {
  it('renders pay period date range', () => {
    render(<Dashboard />, { wrapper: createWrapper() });
    // The dashboard shows "Pay Period" label and date range in display font
    expect(screen.getByText(/April 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/April 14, 2026/)).toBeInTheDocument();
  });

  it('renders Cash Spending card with income and expenses sections', () => {
    render(<Dashboard />, { wrapper: createWrapper() });
    expect(screen.getByText('Cash Spending')).toBeInTheDocument();
    // "Income" appears as both a section label in the table and a YTD stat card label
    expect(screen.getAllByText('Income').length).toBeGreaterThanOrEqual(1);
    // "Expenses" appears as both a section label in the table and a YTD stat card label
    expect(screen.getAllByText('Expenses').length).toBeGreaterThanOrEqual(1);
  });

  it('renders expense names in the table', () => {
    render(<Dashboard />, { wrapper: createWrapper() });
    expect(screen.getByText('Mortgage')).toBeInTheDocument();
    expect(screen.getByText('Electric')).toBeInTheDocument();
    expect(screen.getByText('Internet')).toBeInTheDocument();
  });

  it('renders income item name', () => {
    render(<Dashboard />, { wrapper: createWrapper() });
    expect(screen.getByText('Paycheck')).toBeInTheDocument();
  });

  it('renders YTD section with stat cards', () => {
    render(<Dashboard />, { wrapper: createWrapper() });
    // YTD section has Income, Expenses, Net stat cards
    expect(screen.getByText('Year to Date')).toBeInTheDocument();
    // StatCard labels
    const incomeLabels = screen.getAllByText('Income');
    expect(incomeLabels.length).toBeGreaterThanOrEqual(1);
    const expenseLabels = screen.getAllByText('Expenses');
    expect(expenseLabels.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Net')).toBeInTheDocument();
  });

  it('renders YTD amounts', () => {
    render(<Dashboard />, { wrapper: createWrapper() });
    expect(screen.getByText('$20,000.00')).toBeInTheDocument();
    expect(screen.getByText('$12,000.00')).toBeInTheDocument();
    expect(screen.getByText('$8,000.00')).toBeInTheDocument();
  });

  it('renders spend prediction section', () => {
    render(<Dashboard />, { wrapper: createWrapper() });
    // With null data, shows "Add a pay schedule and expenses to see spend predictions"
    expect(
      screen.getByText('Add a pay schedule and expenses to see spend predictions'),
    ).toBeInTheDocument();
  });

  it('renders savings outlook section', () => {
    render(<Dashboard />, { wrapper: createWrapper() });
    expect(
      screen.getByText('Add income and expenses to see your savings outlook'),
    ).toBeInTheDocument();
  });

  it('shows previous period credit expenses row', () => {
    render(<Dashboard />, { wrapper: createWrapper() });
    expect(screen.getByText('Previous Period Credit Expenses')).toBeInTheDocument();
  });

  it('shows the split prev-bank rows, income total, ad-hoc line, and live cash remaining', () => {
    render(<Dashboard />, { wrapper: createWrapper() });
    expect(screen.getByText('Previous Period Checking Balance')).toBeInTheDocument();
    expect(screen.getByText('Previous Period Savings Balance')).toBeInTheDocument();
    expect(screen.getByText('Total Income')).toBeInTheDocument();
    expect(screen.getByText('Current Cash Balance')).toBeInTheDocument();
    expect(screen.getByText('Total Cash Expenses')).toBeInTheDocument();
    expect(screen.getByText('Discretionary Cash Spending')).toBeInTheDocument();
    expect(screen.getByText('Cash After Expenses')).toBeInTheDocument();
    // "After Credit Expenses" is a still-retired projection-era subtotal —
    // unlike Total Cash Expenses, it was not asked to come back.
    expect(screen.queryByText('After Credit Expenses')).not.toBeInTheDocument();
  });

  it('orders the cash-spending summary rows: balance, total expenses, other spending, balance after', () => {
    render(<Dashboard />, { wrapper: createWrapper() });
    const table = screen.getByRole('table', { name: 'Cash spending breakdown' });
    const summaryLabels = [
      'Current Cash Balance',
      'Total Cash Expenses',
      'Discretionary Cash Spending',
      'Cash After Expenses',
    ];
    const rowTexts = within(table)
      .getAllByRole('row')
      .map((row) => row.textContent ?? '')
      .filter((text) => summaryLabels.some((label) => text.includes(label)));

    expect(rowTexts).toHaveLength(4);
    summaryLabels.forEach((label, i) => expect(rowTexts[i]).toContain(label));
  });

  it('puts each summary amount in the credit or debit column, matching the itemized rows', () => {
    // The table splits amounts across two columns — income/balances in the
    // credit column, expenses in the debit one. A summary row that lands in the
    // wrong column prints its total one column off from the figures it sums.
    // At wide widths a summary row's cells are:
    //   credit → [icon, label(span 2), AMOUNT, spacer, actions]
    //   debit  → [icon, label(span 2), spacer, AMOUNT, actions]
    render(<Dashboard />, { wrapper: createWrapper() });
    const table = screen.getByRole('table', { name: 'Cash spending breakdown' });
    const cellsOf = (label: string) => {
      const row = within(table)
        .getAllByRole('row')
        .find((r) => r.textContent?.includes(label));
      return within(row!).getAllByRole('cell');
    };
    const CREDIT = 2;
    const DEBIT = 3;

    expect(cellsOf('Total Income')[CREDIT]).toHaveTextContent('$7,500.00');
    expect(cellsOf('Current Cash Balance')[CREDIT]).toHaveTextContent('$7,019.00');
    expect(cellsOf('Cash After Expenses')[CREDIT]).toHaveTextContent('$5,840.00');
    // Expenses sit in the debit column, leaving the credit cell empty.
    expect(cellsOf('Total Cash Expenses')[DEBIT]).toHaveTextContent('$1,329.00');
    expect(cellsOf('Total Cash Expenses')[CREDIT]).toBeEmptyDOMElement();
    expect(cellsOf('Discretionary Cash Spending')[DEBIT]).toHaveTextContent('$131.00');
    expect(cellsOf('Discretionary Cash Spending')[CREDIT]).toBeEmptyDOMElement();
  });
});

describe('Dashboard Page — empty state', () => {
  it('shows spend prediction empty state when no data', () => {
    render(<Dashboard />, { wrapper: createWrapper() });
    expect(
      screen.getByText('Add a pay schedule and expenses to see spend predictions'),
    ).toBeInTheDocument();
  });

  it('shows savings outlook empty state when income trend is empty', () => {
    render(<Dashboard />, { wrapper: createWrapper() });
    expect(
      screen.getByText('Add income and expenses to see your savings outlook'),
    ).toBeInTheDocument();
  });
});
