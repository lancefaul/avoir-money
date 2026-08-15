import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { SelectOption } from '@budget-tracker/ui';
import FundingFields from './FundingFields.js';
import type { UseTransactionFormReturn } from './useTransactionForm.js';
import type { Account } from './types.js';

const accountOptions: SelectOption[] = [
  { value: 'acc-1', label: 'Checking' },
  { value: 'acc-2', label: 'Gift Card' },
  { value: 'acc-3', label: 'Chase Card' },
];

const accounts: Account[] = [
  { id: 'acc-1', name: 'Checking', type: 'Checking', balance: 500 },
  { id: 'acc-2', name: 'Gift Card', type: 'Gift Card', balance: 41.19 },
  { id: 'acc-3', name: 'Chase Card', type: 'Credit Card', balance: -1200 },
];

/** Only the fields FundingFields reads. `availableCents` mirrors the hook: a
 *  credit card has no cap (null); a finite account caps at its balance. */
function mockForm(overrides: {
  fundingAccountIds?: string[];
  legAmounts?: Record<string, number>;
  amount?: string;
}): UseTransactionFormReturn {
  const ids = overrides.fundingAccountIds ?? ['acc-1'];
  const values: Record<string, string> = { amount: overrides.amount ?? '0.00' };
  return {
    watch: vi.fn((f?: string) => (f ? values[f] : values)),
    setValue: vi.fn(),
    errors: {},
    fundingMode: ids.length >= 2 ? 'multiple' : 'single',
    fundingAccountIds: ids,
    legAmounts: overrides.legAmounts ?? {},
    rewardsAmounts: {},
    isSplit: ids.length >= 2,
    remainderId: ids[ids.length - 1] ?? '',
    remainderCents: 0,
    fundingError: null,
    switchFundingMode: vi.fn(),
    setFundingAccounts: vi.fn(),
    setLegAmount: vi.fn(),
    setRewardsAmount: vi.fn(),
    rewardsAccountFor: vi.fn(() => undefined),
    availableCents: vi.fn((id: string) => {
      const a = accounts.find((x) => x.id === id);
      if (!a || a.type === 'Credit Card') return null;
      return Math.round((a.balance ?? 0) * 100);
    }),
  } as unknown as UseTransactionFormReturn;
}

describe('FundingFields', () => {
  it('single account: Account select + one Amount field + an available hint for finite money', () => {
    const form = mockForm({ fundingAccountIds: ['acc-1'] });
    render(<FundingFields form={form} accountOptions={accountOptions} accounts={accounts} />);
    expect(screen.getByText('Payment Method (Account)')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getByText('Available: $500.00')).toBeInTheDocument();
  });

  it('single credit card: no available hint (credit is never capped)', () => {
    const form = mockForm({ fundingAccountIds: ['acc-3'] });
    render(<FundingFields form={form} accountOptions={accountOptions} accounts={accounts} />);
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.queryByText(/Available:/)).not.toBeInTheDocument();
  });

  it('two accounts: one full-width amount field per account, labelled by name, with its available cap', () => {
    const form = mockForm({
      fundingAccountIds: ['acc-1', 'acc-2'],
      legAmounts: { 'acc-1': 6000, 'acc-2': 4119 },
    });
    render(<FundingFields form={form} accountOptions={accountOptions} accounts={accounts} />);
    // One per-account amount field per account, each showing its available cap.
    expect(screen.getByText('Available: $500.00')).toBeInTheDocument();
    expect(screen.getByText('Available: $41.19')).toBeInTheDocument();
  });
});
