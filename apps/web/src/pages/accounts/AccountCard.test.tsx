/**
 * Prop forwarding through the card layouts.
 *
 * `AccountCard` picks one of ~11 brand layouts and hand-forwards every action
 * prop to it, which then hand-forwards to `ActionButtons`. Optional props that
 * are missed at any level vanish silently — the menu item simply never renders,
 * and typecheck cannot catch it because the prop is optional the whole way down.
 * That is exactly how "Reconcile with statement" went missing from every card.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountCard from './AccountCard.js';

beforeEach(() => {
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
});

const base = {
  id: 'a1',
  balance: 100,
  archived: false,
  hasRewards: false,
};

/**
 * One case per branch of the layout switch, including the name-sniffed brand
 * layouts — those are the easiest to miss when threading a new prop.
 */
const LAYOUTS = [
  { name: 'Prime Visa', type: 'Credit Card', brand: 'PRIME_VISA' },
  { name: 'X Money', type: 'Checking', brand: 'X_MONEY' },
  { name: 'Generic Card', type: 'Credit Card' },
  { name: 'Wallet Cash', type: 'Cash' },
  { name: 'Amazon Gift Card', type: 'Gift Card', brand: 'AMAZON_GIFT' },
  { name: 'Other Gift Card', type: 'Gift Card' },
  { name: 'Main Checking', type: 'Checking' },
  { name: 'Rainy Day', type: 'Savings' },
  { name: 'Health Account', type: 'HSA' },
];

describe('AccountCard forwards onReconcile to every layout', () => {
  it.each(LAYOUTS)('$type — $name', async ({ name, type }) => {
    const user = userEvent.setup();
    const onReconcile = vi.fn();

    render(
      <AccountCard
        account={{ ...base, name, type }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleArchive={vi.fn()}
        onReconcile={onReconcile}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByText('Reconcile with statement'));
    expect(onReconcile).toHaveBeenCalledTimes(1);
  });

  it('omits the item when the account cannot be reconciled', async () => {
    const user = userEvent.setup();
    render(
      <AccountCard
        account={{ ...base, name: 'Archived Card', type: 'Credit Card', archived: true }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleArchive={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.queryByText('Reconcile with statement')).toBeNull();
  });

  it('renders the X debit/flex face for an X Money account', () => {
    render(
      <AccountCard
        account={{ ...base, name: 'X Money', type: 'Checking', brand: 'X_MONEY' }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleArchive={vi.fn()}
      />,
    );
    // "Debit / Flex" is unique to the X card, so its presence proves the X
    // layout was selected rather than a generic checking fallback.
    expect(screen.getByText('Debit / Flex')).toBeInTheDocument();
    expect(screen.getByAltText('Visa')).toBeInTheDocument();
  });
});

describe('AccountCard on-card rewards row (rewards-as-child-account)', () => {
  const CARD_LAYOUTS = [
    { name: 'Prime Visa', type: 'Credit Card', brand: 'PRIME_VISA' },
    { name: 'Generic Card', type: 'Credit Card' },
  ];

  it.each(CARD_LAYOUTS)(
    '$name — shows the child rewards balance and taps through to its ledger',
    async ({ name, type }) => {
      const user = userEvent.setup();
      const onRewardsRowClick = vi.fn();
      render(
        <AccountCard
          account={{ ...base, name, type }}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onToggleArchive={vi.fn()}
          rewardsAccount={{ id: 'r1', balance: 27.91 }}
          onRewardsRowClick={onRewardsRowClick}
        />,
      );
      const row = screen.getByRole('button', { name: /Rewards/ });
      expect(row).toHaveTextContent('$27.91');
      await user.click(row);
      expect(onRewardsRowClick).toHaveBeenCalledTimes(1);
    },
  );

  it('offers "Add rewards account" on a credit card that has none', async () => {
    const user = userEvent.setup();
    const onAddRewardsAccount = vi.fn();
    render(
      <AccountCard
        account={{ ...base, name: 'Generic Card', type: 'Credit Card' }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleArchive={vi.fn()}
        onAddRewardsAccount={onAddRewardsAccount}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByText('Add rewards account'));
    expect(onAddRewardsAccount).toHaveBeenCalledTimes(1);
  });

  it('offers "Add rewards earned" when a rewards account exists', async () => {
    const user = userEvent.setup();
    const onEarnRewards = vi.fn();
    render(
      <AccountCard
        account={{ ...base, name: 'Prime Visa', type: 'Credit Card' }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleArchive={vi.fn()}
        rewardsAccount={{ id: 'r1', balance: 10 }}
        onEarnRewards={onEarnRewards}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(screen.getByText('Add rewards earned'));
    expect(onEarnRewards).toHaveBeenCalledTimes(1);
  });

  it('renders no rewards row when the card has no rewards account', () => {
    const { container } = render(
      <AccountCard
        account={{ ...base, name: 'Prime Visa', type: 'Credit Card', hasRewards: true }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleArchive={vi.fn()}
      />,
    );
    // No child rewards account → no on-card rewards row at all (the old
    // rewardsBalance fallback was retired). The card still shows its balance.
    expect(screen.queryByRole('button', { name: /Rewards/ })).toBeNull();
    expect(container.textContent).toContain('$100.00');
  });
});
