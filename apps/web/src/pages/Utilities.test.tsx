import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createWrapper } from '../test/wrapper.js';
import { useUIStore } from '../store/ui.js';

// Mock matchMedia for responsive column collapse (useIsNarrow in ReadingTable/SummaryCard)
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

// Mock recharts
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../hooks/useApi.js', () => ({
  useProviders: () => ({
    data: [
      { id: 'p1', name: 'Metro Power', createdAt: new Date(), updatedAt: new Date() },
      { id: 'p2', name: 'AT&T', createdAt: new Date(), updatedAt: new Date() },
    ],
    isLoading: false,
  }),
  useCreateProvider: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProvider: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteProvider: () => ({ mutate: vi.fn(), isPending: false }),
  useServices: () => ({
    data: [
      {
        id: 's1',
        providerId: 'p1',
        serviceType: 'ELECTRIC',
        metering: 'METERED',
        expenseId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 's2',
        providerId: 'p1',
        serviceType: 'GAS',
        metering: 'METERED',
        expenseId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    isLoading: false,
  }),
  useCreateService: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateService: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteService: () => ({ mutate: vi.fn(), isPending: false }),
  useLinkService: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlinkService: () => ({ mutate: vi.fn(), isPending: false }),
  useUtilities: () => ({
    data: [
      {
        id: 'r1',
        serviceId: 's1',
        billDate: '2026-03-01',
        dueDate: '2026-03-15',
        usage: 1200,
        cost: 150,
        unitCost: 0.125,
        convenienceFee: null,
        convenienceFeeType: null,
        otherFees: null,
      },
      {
        id: 'r2',
        serviceId: 's1',
        billDate: '2026-02-01',
        dueDate: '2026-02-15',
        usage: 1100,
        cost: 140,
        unitCost: 0.1273,
        convenienceFee: null,
        convenienceFeeType: null,
        otherFees: null,
      },
    ],
    isLoading: false,
  }),
  useCreateUtility: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateUtility: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteUtility: () => ({ mutate: vi.fn(), isPending: false }),
  useExpenses: () => ({
    data: [{ id: 'exp1', name: 'Electric Bill' }],
  }),
}));

import UtilitiesPage from './Utilities.js';

describe('Utilities Page', () => {
  it('renders provider list as tabs', () => {
    render(<UtilitiesPage />, { wrapper: createWrapper() });
    // Provider names appear in tabs and as the selected provider heading
    expect(screen.getAllByText('Metro Power').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('AT&T')).toBeInTheDocument();
  });

  it('renders service list for selected provider', () => {
    render(<UtilitiesPage />, { wrapper: createWrapper() });
    // Electric service has readings so it shows the card title
    expect(screen.getByText('Electric Bills')).toBeInTheDocument();
    // Gas service has no readings so it shows empty state
    expect(screen.getByText('No readings for this service')).toBeInTheDocument();
  });

  it('renders reading data with cost', () => {
    render(<UtilitiesPage />, { wrapper: createWrapper() });
    // ReadingPanel and SummaryCard both display costs with a minus prefix
    expect(screen.getAllByText('-$150.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('-$140.00').length).toBeGreaterThanOrEqual(1);
  });

  it('shows usage data for metered readings', () => {
    render(<UtilitiesPage />, { wrapper: createWrapper() });
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('1,100')).toBeInTheDocument();
  });

  it('renders page header', () => {
    render(<UtilitiesPage />, { wrapper: createWrapper() });
    expect(useUIStore.getState().pageTitle).toContain('Utilities');
  });

  it('groups readings by year', () => {
    render(<UtilitiesPage />, { wrapper: createWrapper() });
    // Year section labels appear in the reading tables
    expect(screen.getAllByText('2026').length).toBeGreaterThanOrEqual(1);
  });

  it('renders tab-based layout with provider tabs and service cards', () => {
    render(<UtilitiesPage />, { wrapper: createWrapper() });
    // Tab navigation for providers
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    // Selected provider heading
    const headings = screen.getAllByText('Metro Power');
    expect(headings.length).toBeGreaterThanOrEqual(1);
    // Service type shown in card headers
    expect(screen.getByText('Electric Bills')).toBeInTheDocument();
  });
});
