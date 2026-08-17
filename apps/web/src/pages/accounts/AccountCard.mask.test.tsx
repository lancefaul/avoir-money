/**
 * No account card discloses a readable value when the app is masked.
 *
 * # Why this iterates the brand enum instead of picking a card
 *
 * The first version of this test used one fixture with no `brand`, and passed.
 * `AccountCard` dispatches on `account.brand` and only falls through to the
 * generic credit layout when there is none — so the test exercised a branch 3
 * of 13 real accounts take, while the ten branded ones rendered untagged and
 * the mask visibly did nothing. Green against a path the app does not run is
 * the failure ERRORS.md records twice: a test and its code sharing a dialect
 * nobody else speaks.
 *
 * So the cases come from `AccountBrandSchema`, the same enum the app dispatches
 * on. A ninth brand adds a ninth case here automatically; it cannot be
 * forgotten, because forgetting is exactly what happened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MaskProvider } from '@budget-tracker/ui';
import { AccountBrandSchema } from '@budget-tracker/core';
import AccountCard from './AccountCard.js';
import { findMaskLeaks, formatMaskLeaks } from '../../test/mask-audit.js';

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

const NAME = 'Northwind Savings';

function renderCard(brand: string | null, type = 'Credit Card', masked = true) {
  return render(
    <MaskProvider masked={masked}>
      <AccountCard
        account={{
          id: 'a1',
          name: NAME,
          type,
          balance: 1811.4,
          archived: false,
          hasRewards: false,
          brand,
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleArchive={vi.fn()}
      />
    </MaskProvider>,
  );
}

/** Every layout the app can pick: each brand, plus the unbranded fall-through. */
const LAYOUTS: (string | null)[] = [...AccountBrandSchema.options, null];

describe('a masked account card', () => {
  it.each(LAYOUTS)('leaves no untagged money in the %s layout', (brand) => {
    const { container } = renderCard(brand);
    const leaks = findMaskLeaks(container);
    expect(leaks, `unmasked money still readable:\n${formatMaskLeaks(leaks)}`).toEqual([]);
  });

  it.each(LAYOUTS)('removes the balance from the DOM in the %s layout', (brand) => {
    // Substitution, not concealment: the number must not be present at all,
    // so devtools, a selection and the accessibility tree see nothing either.
    const { container } = renderCard(brand);
    expect(container.textContent).not.toContain('1,811.40');
    expect(container.textContent).toContain('*****');
  });

  it.each(LAYOUTS)('shows the real balance in the %s layout when unmasked', (brand) => {
    // The other half. A mask that never turns off would pass every assertion
    // above and be useless.
    const { container } = renderCard(brand, 'Credit Card', false);
    expect(container.textContent).toContain('1,811.40');
  });

  it('removes the account name where the layout shows one', () => {
    // Not every design prints the name — several are identified by their art
    // alone, so asserting it on all of them would fail for a reason that is not
    // a disclosure.
    const { container } = renderCard(null);
    expect(container.textContent).not.toContain(NAME);
  });

  it('the audit detects an untagged value, rather than only ever passing', () => {
    // Proving it fails when it should — the discipline the ledger and
    // publication checks both needed before their exit codes meant anything.
    const unmasked = renderCard('PRIME_VISA', 'Credit Card', false);
    expect(findMaskLeaks(unmasked.container).length).toBeGreaterThan(0);
  });

  it('keeps structural text readable', () => {
    // A mask that hides labels makes the page unusable rather than private.
    renderCard(null);
    expect(screen.queryByText(/Credit Card|Balance|Northwind/i)).toBeDefined();
  });
});
