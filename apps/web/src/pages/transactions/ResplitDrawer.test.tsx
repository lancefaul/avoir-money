import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { createWrapper } from '../../test/wrapper.js';
import ResplitDrawer from './ResplitDrawer.js';
import type { UseTransactionFormReturn } from './useTransactionForm.js';
import type { Account } from './types.js';

/**
 * A purchase can have been split across an account that was later archived. The
 * re-split drawer must still show that leg's account by name — archived accounts
 * are filtered out of the selectable options, so without special handling the
 * multi-select chip falls back to the raw CUID.
 */
const accounts: Account[] = [
  { id: 'acc-1', name: 'Checking', type: 'Checking', balance: 500 },
  { id: 'acc-2', name: 'Old Card', type: 'Credit Card', balance: -100, archived: true },
];

function mockForm(fundingAccountIds: string[]): UseTransactionFormReturn {
  const values: Record<string, unknown> = { name: 'Dinner', amount: '100.00' };
  return {
    watch: vi.fn((f?: string) => (f ? values[f] : values)),
    setValue: vi.fn(),
    errors: {},
    fundingMode: 'multiple',
    fundingAccountIds,
    legAmounts: { 'acc-1': 6000, 'acc-2': 4000 },
    rewardsAmounts: {},
    isSplit: fundingAccountIds.length >= 2,
    remainderId: fundingAccountIds[fundingAccountIds.length - 1] ?? '',
    remainderCents: 4000,
    fundingError: null,
    switchFundingMode: vi.fn(),
    setFundingAccounts: vi.fn(),
    setLegAmount: vi.fn(),
    setRewardsAmount: vi.fn(),
    rewardsAccountFor: vi.fn(() => undefined),
    availableCents: vi.fn(() => null),
    resplitTotalCents: 10000,
    resplitError: null,
    submitResplit: vi.fn(),
    closeForm: vi.fn(),
  } as unknown as UseTransactionFormReturn;
}

describe('ResplitDrawer — archived leg account', () => {
  it('labels an archived leg account instead of showing its raw id', () => {
    render(
      <ResplitDrawer form={mockForm(['acc-1', 'acc-2'])} accounts={accounts} isPending={false} />,
      {
        wrapper: createWrapper(),
      },
    );
    // The chip for the archived funding account shows its name (with a hint),
    // not the raw CUID.
    expect(screen.getByText(/Old Card \(archived\)/)).toBeInTheDocument();
    expect(screen.queryByText('acc-2')).not.toBeInTheDocument();
  });
});
