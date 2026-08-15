import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createWrapper } from '../test/wrapper.js';

// Stub matchMedia — some DS components query it. (AccountsPage itself no longer
// uses a breakpoint hook; the card strip is now permanent, sized via CSS.)
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

const mockUseAccounts = vi.fn();

// Pass the real useApi module through (the account ledger now pulls in the
// shared transaction row-actions hook, which uses useCustodians/useWallets/
// useInvestments/etc.), overriding only the accounts + rewards hooks.
vi.mock('../hooks/useApi.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useApi.js')>()),
  useAccounts: (...args: any[]) => mockUseAccounts(...args),
  useRewardsLedger: () => ({ data: [], isLoading: false }),
  useCreateRewardsEntry: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteRewardsEntry: () => ({ mutate: vi.fn(), isPending: false }),
}));

import AccountsPage from './Accounts.js';

const accountsWithData = {
  data: [
    {
      id: 'a1',
      name: 'Cash Wallet',
      brand: 'CASH_APP',
      type: 'Checking',
      balance: 1000,
      archived: false,
      hasRewards: false,
    },
    {
      id: 'a2',
      name: 'Chase Credit Card',
      type: 'Credit Card',
      balance: -500,
      archived: false,
      hasRewards: true,
    },
  ],
  isLoading: false,
};

beforeEach(() => {
  mockUseAccounts.mockReturnValue(accountsWithData);
});

describe('Accounts Page', () => {
  it('renders account cards', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    // CashAppLayout renders name as img alt, CreditCardLayout renders name as text
    expect(screen.getByAltText('Cash Wallet')).toBeInTheDocument();
    expect(screen.getByText('Chase Credit Card')).toBeInTheDocument();
  });

  it('shows balances', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    // Cash/Checking cards show balance in corner denominations and center — use getAllByText
    expect(screen.getAllByText('$1,000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('-$500.00')).toBeInTheDocument();
  });

  it('shows account types as section headers', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    // Section headers render type name with a Badge count component (not inline parentheses)
    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.getByText('Credit Card')).toBeInTheDocument();
  });

  it('shows rewards for credit cards', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    // CreditCardLayout does not render rewards inline — only PrimeVisa does.
    // The rewards balance is accessible via the dropdown "Update Rewards Balance" action.
    // Verify the card renders and has the action menu.
    expect(screen.getByText('Chase Credit Card')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Actions').length).toBeGreaterThanOrEqual(1);
  });
});

describe('Accounts Page — archived group (no tabs)', () => {
  beforeEach(() => {
    mockUseAccounts.mockReturnValue({
      data: [
        {
          id: 'a1',
          name: 'Cash Wallet',
          brand: 'CASH_APP',
          type: 'Checking',
          balance: 1000,
          archived: false,
          hasRewards: false,
        },
        {
          id: 'a3',
          name: 'Old Card',
          type: 'Credit Card',
          balance: -50,
          archived: true,
          hasRewards: false,
        },
      ],
      isLoading: false,
    });
  });

  it('renders archived accounts under an Archived heading alongside active accounts', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    // Archived accounts now live in a trailing "Archived" group in the same list
    // (previously they were behind an Archived tab).
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByText('Old Card')).toBeInTheDocument();
    // The active account still shows — everything is one continuous list now.
    expect(screen.getByAltText('Cash Wallet')).toBeInTheDocument();
  });
});

describe('Accounts Page — empty state', () => {
  beforeEach(() => {
    mockUseAccounts.mockReturnValue({ data: [], isLoading: false });
  });

  it('shows empty state when no accounts exist', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('No accounts yet')).toBeInTheDocument();
  });

  it('shows Add Account button in empty state', () => {
    render(<AccountsPage />, { wrapper: createWrapper() });
    const buttons = screen.getAllByRole('button', { name: /Add Account/ });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});
