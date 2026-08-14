import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createWrapper } from '../../test/wrapper.js';
import TransactionActionsMenu from './TransactionActionsMenu.js';
import type { Transaction as CoreTransaction } from '@budget-tracker/core';

/**
 * The overflow (⋯) menu's purchase-group behaviour (payment-split, ADR-030).
 * The property that must never regress: a payment **leg** (a row with an account
 * inside a group) is NEVER independently editable — editing one leg in isolation
 * desyncs the purchase group — so its menu offers only "Manage purchase" (jump to
 * the parent) and a whole-group delete. The budget-carrying **Anchor** (no
 * account) keeps Split-into-categories + Delete.
 */
const makeTx = (overrides: Partial<CoreTransaction>): CoreTransaction => ({
  id: 'tx-1',
  type: 'EXPENSE',
  name: 'Groceries',
  amount: 90,
  netAmount: 90,
  date: new Date('2026-04-10T00:00:00.000Z'),
  payPeriodId: null,
  expenseId: null,
  incomeId: null,
  accountId: 'acct-1',
  toAccountId: null,
  budgetId: 'b1',
  note: null,
  balanceBefore: null,
  balanceAfter: null,
  createdAt: new Date('2026-04-10T00:00:00.000Z'),
  purchaseGroupId: null,
  ...overrides,
});

const handlers = () => ({
  expenses: [],
  incomes: [],
  onEdit: vi.fn(),
  onDuplicate: vi.fn(),
  onInstantDuplicate: vi.fn(),
  onSplit: vi.fn(),
  onLink: vi.fn(),
  onUnlink: vi.fn(),
  onDelete: vi.fn(),
  onDeleteGroup: vi.fn(),
  onManageGroup: vi.fn(),
  onResplit: vi.fn(),
});

describe('TransactionActionsMenu — purchase groups', () => {
  it('a split leg offers only Manage purchase + Delete purchase — never Edit/Split/Duplicate', async () => {
    const user = userEvent.setup();
    const leg = makeTx({ id: 'leg-1', purchaseGroupId: 'grp-1', accountId: 'acct-1' });
    render(<TransactionActionsMenu tx={leg} {...handlers()} />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('button', { name: 'Actions' }));

    expect(screen.getByText('Manage purchase')).toBeInTheDocument();
    expect(screen.getByText('Delete purchase')).toBeInTheDocument();
    // The whole point of the change: a leg is not independently actionable.
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Split into categories')).not.toBeInTheDocument();
    expect(screen.queryByText('Split')).not.toBeInTheDocument();
    expect(screen.queryByText('Duplicate')).not.toBeInTheDocument();
  });

  it('a leg’s Manage purchase passes the purchaseGroupId (not the leg id)', async () => {
    const user = userEvent.setup();
    const h = handlers();
    const leg = makeTx({ id: 'leg-1', purchaseGroupId: 'grp-1', accountId: 'acct-1' });
    render(<TransactionActionsMenu tx={leg} {...h} />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByText('Manage purchase'));

    expect(h.onManageGroup).toHaveBeenCalledWith('grp-1');
    expect(h.onSplit).not.toHaveBeenCalled();
  });

  it('a leg’s Delete purchase deletes the whole group (purchaseGroupId)', async () => {
    const user = userEvent.setup();
    const h = handlers();
    const leg = makeTx({ id: 'leg-1', purchaseGroupId: 'grp-1', accountId: 'acct-1' });
    render(<TransactionActionsMenu tx={leg} {...h} />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByText('Delete purchase'));

    expect(h.onDeleteGroup).toHaveBeenCalledWith('grp-1');
    expect(h.onDelete).not.toHaveBeenCalled();
  });

  it('the Anchor (no account) keeps Split into categories + Delete, not the leg menu', async () => {
    const user = userEvent.setup();
    const anchor = makeTx({ id: 'anchor-1', purchaseGroupId: 'grp-1', accountId: null });
    render(<TransactionActionsMenu tx={anchor} {...handlers()} />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('button', { name: 'Actions' }));

    expect(screen.getByText('Split into categories')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.queryByText('Manage purchase')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  it('the Anchor offers "Edit payment split" and re-splits the whole purchase', async () => {
    const user = userEvent.setup();
    const anchor = makeTx({ id: 'anchor-1', purchaseGroupId: 'grp-1', accountId: null });
    const h = handlers();
    render(<TransactionActionsMenu tx={anchor} {...h} />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByText('Edit payment split'));

    // Re-split takes the whole Anchor (it needs the total/name/budget), not an id.
    expect(h.onResplit).toHaveBeenCalledWith(anchor);
  });
});
