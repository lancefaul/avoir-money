import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createWrapper } from '../test/wrapper.js';

// Mock matchMedia for responsive column merge (useIsNarrow in TransactionList)
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

vi.mock('../hooks/useHealthcare.js', () => ({
  usePolicyYears: () => ({ data: [2026, 2025] }),
  usePolicies: () => ({
    data: [
      {
        id: 'p1',
        type: 'MEDICAL',
        year: 2026,
        employer: 'Acme',
        premium: 477,
        deductibleLimit: 7600,
        oopmLimit: 8600,
        status: 'ACTIVE',
        endedOn: null,
        closedOn: null,
        deductibleOverride: false,
        oopmOverride: false,
        metadata: { insurer: 'Anthem', policyId: 'ABC123', groupNumber: 'GRP456' },
        budgetId: 'bud_1',
        createdAt: new Date(),
        updatedAt: new Date(),
        balance: {
          deductibleSpent: 3000,
          deductibleRaw: 3000,
          deductibleLimit: 7600,
          oopmSpent: 3000,
          oopmRaw: 3000,
          oopmLimit: 8600,
          deductibleOverride: false,
          oopmOverride: false,
        },
      },
      {
        id: 'p2',
        type: 'DENTAL',
        year: 2026,
        employer: 'Acme',
        premium: 50,
        deductibleLimit: null,
        oopmLimit: null,
        status: 'ACTIVE',
        endedOn: null,
        closedOn: null,
        deductibleOverride: false,
        oopmOverride: false,
        metadata: { insurer: 'Delta Dental' },
        budgetId: 'bud_2',
        createdAt: new Date(),
        updatedAt: new Date(),
        balance: {
          deductibleSpent: null,
          deductibleRaw: 0,
          deductibleLimit: null,
          oopmSpent: null,
          oopmRaw: 0,
          oopmLimit: null,
          deductibleOverride: false,
          oopmOverride: false,
        },
      },
    ],
    isLoading: false,
  }),
  usePolicyTransactions: () => ({ data: [], isLoading: false }),
  useHealthcareSummary: () => ({ data: { healthcareBudgetSpent: 0, medicineBudgetSpent: 0 } }),
  useCreatePolicy: () => ({ mutateAsync: vi.fn() }),
  useUpdatePolicy: () => ({ mutateAsync: vi.fn(), mutate: vi.fn() }),
  useUpdateOverrides: () => ({ mutate: vi.fn() }),
  useEndCoverage: () => ({ mutate: vi.fn() }),
  useClosePolicy: () => ({ mutate: vi.fn() }),
}));

import HealthcarePage from './Healthcare.js';

describe('Healthcare Page', () => {
  it('renders insurer name as tab label', () => {
    render(<HealthcarePage />, { wrapper: createWrapper() });
    // Tabs are now dynamic per policy — labeled by insurer
    expect(screen.getByRole('tab', { name: /Anthem/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Delta Dental/ })).toBeInTheDocument();
  });

  it('shows per-limit cost rows on the coverage cards, with no totals', () => {
    render(<HealthcarePage />, { wrapper: createWrapper() });
    // Each coverage card carries its own Costs Paid / Costs Covered rows
    expect(screen.getAllByText('Costs Paid')).toHaveLength(2);
    expect(screen.getAllByText('Costs Covered')).toHaveLength(2);
    // Premiums / Total Paid went away with the summary card
    expect(screen.queryByText('Total Paid')).not.toBeInTheDocument();
    expect(screen.queryByText('Premiums')).not.toBeInTheDocument();
    // Deductible card's Costs Paid: $3,000 spent on the Anthem fixture
    expect(screen.getByText('$3,000.00')).toBeInTheDocument();
  });

  it('shows deductible and coinsurance coverage cards for medical policy', () => {
    render(<HealthcarePage />, { wrapper: createWrapper() });
    expect(screen.getByText('Deductible')).toBeInTheDocument();
    expect(screen.getByText('Coinsurance')).toBeInTheDocument();
    // Deductible 3,000 spent of 7,600 → remaining line in budget-row style
    expect(screen.getByText('$4,600.00 remaining')).toBeInTheDocument();
    expect(screen.getByText('$1,000.00 remaining')).toBeInTheDocument();
  });

  it('shows Add Policy button', () => {
    render(<HealthcarePage />, { wrapper: createWrapper() });
    expect(screen.getByText('Add Policy')).toBeInTheDocument();
  });

  it('shows the year filter icon button', () => {
    render(<HealthcarePage />, { wrapper: createWrapper() });
    expect(screen.getByRole('button', { name: 'Filter by year' })).toBeInTheDocument();
  });

  it('shows premiums on the virtual insurance card modal', () => {
    render(<HealthcarePage />, { wrapper: createWrapper() });
    // Premiums are not on the page itself…
    expect(screen.queryByText('Premiums')).not.toBeInTheDocument();
    // …they live on the insurance card modal
    fireEvent.click(screen.getByRole('button', { name: 'View virtual insurance card' }));
    expect(screen.getByText('Premiums')).toBeInTheDocument();
    expect(screen.getByText('$477.00')).toBeInTheDocument();
  });

  it('shows policy actions menu', () => {
    render(<HealthcarePage />, { wrapper: createWrapper() });
    expect(screen.getByLabelText('Policy actions')).toBeInTheDocument();
  });
});
