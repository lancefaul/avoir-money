import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import NetSavingsBarChart from './NetSavingsBarChart.js';

// Recharts components don't render in jsdom — mock them to render children/data-testid
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children, data }: any) => (
    <div data-testid="bar-chart" data-length={data?.length}>
      {children}
    </div>
  ),
  Bar: ({ children }: any) => <div data-testid="bar">{children}</div>,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  Tooltip: () => <div data-testid="tooltip" />,
  ReferenceLine: () => <div data-testid="reference-line" />,
  Cell: ({ fill }: any) => <div data-testid="cell" data-fill={fill} />,
}));

const makeDataPoint = (
  overrides: Partial<{
    periodLabel: string;
    startDate: Date;
    endDate: Date;
    income: number;
    expenses: number;
    trades: number;
    budgetExpenses: number;
    projected: boolean;
  }> = {},
) => ({
  periodLabel: 'Jan 1–15',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-15'),
  income: 3000,
  expenses: 1500,
  trades: 0,
  budgetExpenses: 500,
  projected: false,
  ...overrides,
});

describe('NetSavingsBarChart', () => {
  it('renders chart container with valid data', () => {
    const data = [
      makeDataPoint({ periodLabel: 'Jan 1–15', income: 3000, expenses: 1500, budgetExpenses: 500 }),
      makeDataPoint({
        periodLabel: 'Jan 16–31',
        income: 3000,
        expenses: 2000,
        budgetExpenses: 400,
      }),
    ];

    render(<NetSavingsBarChart data={data} isLoading={false} isError={false} />);

    expect(screen.getByText('Savings Outlook')).toBeInTheDocument();
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('displays projected savings amount when positive', () => {
    const data = [
      makeDataPoint({
        periodLabel: 'Jan 1–15',
        income: 3000,
        expenses: 1000,
        budgetExpenses: 500,
        projected: true,
      }),
    ];

    render(<NetSavingsBarChart data={data} isLoading={false} isError={false} />);

    // net = 3000 - 1000 - 500 = 1500, projected & positive → shows formatted amount
    expect(screen.getByText('$1,500.00')).toBeInTheDocument();
  });

  it('displays $0 when no projected savings', () => {
    const data = [
      makeDataPoint({
        periodLabel: 'Jan 1–15',
        income: 3000,
        expenses: 1500,
        budgetExpenses: 500,
        projected: false,
      }),
    ];

    render(<NetSavingsBarChart data={data} isLoading={false} isError={false} />);

    expect(screen.getByText('$0')).toBeInTheDocument();
  });

  it('shows empty state when data array is empty', () => {
    render(<NetSavingsBarChart data={[]} isLoading={false} isError={false} />);

    expect(
      screen.getByText('Add income and expenses to see your savings outlook'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('shows loading spinner when isLoading is true', () => {
    const { container } = render(<NetSavingsBarChart data={[]} isLoading={true} isError={false} />);

    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByText('Savings Outlook')).not.toBeInTheDocument();
  });

  it('shows error message when isError is true', () => {
    render(<NetSavingsBarChart data={[]} isLoading={false} isError={true} />);

    expect(screen.getByText('Failed to load data.')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });
});
