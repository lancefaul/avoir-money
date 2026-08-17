import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { z } from 'zod';
import type { SpendPredictionResponseSchema } from '@budget-tracker/core';

// Mock recharts — SVG components don't render in jsdom
vi.mock('recharts', async () => {
  const React = await import('react');
  return {
    LineChart: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="line-chart">{children}</div>
    ),
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    ResponsiveContainer: ({
      children,
    }: {
      children: React.ReactNode | ((w: number, h: number) => React.ReactNode);
    }) => (
      <div data-testid="chart-container">
        {typeof children === 'function' ? children(400, 220) : children}
      </div>
    ),
    ReferenceDot: ({ label }: { label?: React.ReactElement; [k: string]: unknown }) => {
      // Clone the label element and inject viewBox like Recharts would
      if (label && React.isValidElement(label)) {
        const cloned = React.cloneElement(label as React.ReactElement<Record<string, unknown>>, {
          viewBox: { x: 100, y: 100 },
        });
        return <div data-testid="reference-dot">{cloned}</div>;
      }
      return null;
    },
  };
});

import SpendPredictionChart from './SpendPredictionChart.js';

type SpendPredictionResponse = z.infer<typeof SpendPredictionResponseSchema>;

function makeData(overrides: Partial<SpendPredictionResponse> = {}): SpendPredictionResponse {
  return {
    expectedPeriodSpend: 3000,
    overUnderAmount: -200,
    periodStartDate: new Date('2026-06-01'),
    periodEndDate: new Date('2026-06-30'),
    currentDayNumber: 15,
    totalDays: 30,
    dailyData: Array.from({ length: 30 }, (_, i) => ({
      dayNumber: i + 1,
      date: new Date(`2026-06-${String(i + 1).padStart(2, '0')}`),
      expectedCumulative: (i + 1) * 100,
      actualCumulative: i < 15 ? (i + 1) * 90 : null,
    })),
    ...overrides,
  };
}

describe('SpendPredictionChart', () => {
  it('renders chart container with valid data', () => {
    render(<SpendPredictionChart data={makeData()} />);

    expect(screen.getByTestId('chart-container')).toBeInTheDocument();
    expect(screen.getByText('Left to Spend')).toBeInTheDocument();
  });

  it('displays remaining amount and budget total', () => {
    // remaining = expectedPeriodSpend - actualCumulative at currentDayNumber
    // day 15 actual = 15 * 90 = 1350, remaining = 3000 - 1350 = 1650
    render(<SpendPredictionChart data={makeData()} />);

    expect(screen.getByText('$1,650.00')).toBeInTheDocument();
    expect(screen.getByText('$3,000.00')).toBeInTheDocument();
  });

  it('displays daily budget in subtitle', () => {
    // 3000 / 30 = 100
    render(<SpendPredictionChart data={makeData()} />);

    expect(screen.getByText('$100.00/day')).toBeInTheDocument();
  });

  it('displays "under" label when overUnderAmount is negative', () => {
    render(<SpendPredictionChart data={makeData({ overUnderAmount: -200 })} />);

    expect(screen.getByText(/\$200\.00 under/)).toBeInTheDocument();
  });

  it('displays "over" label when overUnderAmount is positive', () => {
    render(<SpendPredictionChart data={makeData({ overUnderAmount: 150 })} />);

    expect(screen.getByText(/\$150\.00 over/)).toBeInTheDocument();
  });

  it('displays "on track" label when overUnderAmount is zero', () => {
    render(<SpendPredictionChart data={makeData({ overUnderAmount: 0 })} />);

    expect(screen.getByText('$0.00 on track')).toBeInTheDocument();
  });

  it('handles empty dailyData gracefully', () => {
    const data = makeData({
      dailyData: [],
      currentDayNumber: 1,
      totalDays: 30,
    });

    // Should not throw — renders with $3,000.00 remaining (no actual data)
    render(<SpendPredictionChart data={data} />);

    expect(screen.getByText('Left to Spend')).toBeInTheDocument();
    // $3,000.00 appears twice: as remaining amount and as budget total
    expect(screen.getAllByText('$3,000.00')).toHaveLength(2);
  });

  it('handles data where all actualCumulative values are null', () => {
    const data = makeData({
      dailyData: Array.from({ length: 30 }, (_, i) => ({
        dayNumber: i + 1,
        date: new Date(`2026-06-${String(i + 1).padStart(2, '0')}`),
        expectedCumulative: (i + 1) * 100,
        actualCumulative: null,
      })),
    });

    render(<SpendPredictionChart data={data} />);

    expect(screen.getByTestId('chart-container')).toBeInTheDocument();
    expect(screen.getByText('Left to Spend')).toBeInTheDocument();
  });

  it('applies overspent styling when remaining is negative', () => {
    // If actual at currentDayNumber exceeds expectedPeriodSpend, remaining < 0
    const data = makeData({
      expectedPeriodSpend: 1000,
      currentDayNumber: 15,
      dailyData: Array.from({ length: 30 }, (_, i) => ({
        dayNumber: i + 1,
        date: new Date(`2026-06-${String(i + 1).padStart(2, '0')}`),
        expectedCumulative: (i + 1) * 33.33,
        actualCumulative: i < 15 ? (i + 1) * 100 : null, // day 15 = 1500 > 1000
      })),
    });

    render(<SpendPredictionChart data={data} />);

    // remaining = 1000 - 1500 = -500, displays abs value
    expect(screen.getByText('$500.00')).toBeInTheDocument();
  });
});
