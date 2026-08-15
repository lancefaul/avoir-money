/**
 * Tests for the Starting Balance consequence preview (2026-07-18).
 *
 * Editing `openingBalance` does not touch a single transaction, so the ledger
 * invariant (openingBalance + SUM(transactions) == balance) forces the current
 * balance to absorb the entire delta. The balance moves whether or not anyone
 * looks — the preview exists so it is seen before saving rather than discovered
 * afterwards, which is precisely how a reversed card payment stayed hidden for
 * four months.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AccountFormModal from './AccountFormModal.js';
import type { EditingAccount } from './AccountFormModal.js';

const updateMock = vi.fn().mockResolvedValue({});
const createMock = vi.fn().mockResolvedValue({});

vi.mock('../../lib/api.js', () => ({
  api: {
    accounts: {
      update: (id: string, body: unknown) => updateMock(id, body),
      create: (body: unknown) => createMock(body),
    },
  },
}));

beforeEach(() => {
  updateMock.mockClear();
  createMock.mockClear();
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

/** Prime Visa's real shape: a card carrying pre-tracking debt. */
const EDITING: EditingAccount = {
  id: 'acct_1',
  name: 'Prime Visa',
  type: 'Credit Card',
  balance: -1478.93,
  openingBalance: -380,
  hasRewards: true,
  earnsInterest: false,
  interestRate: 0,
  interestRateType: 'APY',
};

/**
 * Same account with a zero opening. CurrencyInput appends typed digits to the
 * existing value rather than replacing them (and `user.clear()` does not reset
 * it), so tests that need to *set* a value start from zero and type — the
 * convention the other CurrencyInput tests in this repo already follow.
 */
const EDITING_ZERO_OPENING: EditingAccount = {
  ...EDITING,
  balance: -1098.93,
  openingBalance: 0,
};

function renderModal(editing: EditingAccount | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AccountFormModal open editing={editing} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

function startingBalanceInput() {
  return screen.getByLabelText(/starting balance/i);
}

describe('Starting Balance field visibility', () => {
  it('is shown when editing an existing account', () => {
    renderModal(EDITING);
    expect(startingBalanceInput()).toBeTruthy();
  });

  it('is shown when creating a new account', () => {
    renderModal(null);
    expect(startingBalanceInput()).toBeTruthy();
  });

  it('seeds the field from openingBalance, not from the current balance', () => {
    // The distinction is the whole feature: -380 is the pre-tracking figure,
    // -1,478.93 is what the account holds today.
    renderModal(EDITING);
    expect((startingBalanceInput() as HTMLInputElement).value).toContain('380');
    expect((startingBalanceInput() as HTMLInputElement).value).not.toContain('1,478');
  });
});

describe('consequence preview', () => {
  it('is hidden until the value actually changes', () => {
    renderModal(EDITING);
    expect(screen.queryByText(/current balance will change/i)).toBeNull();
  });

  it('shows the resulting balance once the opening is edited', async () => {
    const user = userEvent.setup();
    renderModal(EDITING_ZERO_OPENING);

    // 50000 cents = $500.00
    await user.type(startingBalanceInput(), '50000');

    expect(screen.getByText(/current balance will change/i)).toBeTruthy();
    // opening 0 -> 500 is a +500 delta, so -1,098.93 -> -598.93.
    expect(screen.getByText(/-\$598\.93/)).toBeTruthy();
  });

  it('never appears when creating — there is no balance to shift yet', async () => {
    const user = userEvent.setup();
    renderModal(null);

    await user.type(startingBalanceInput(), '250');

    expect(screen.queryByText(/current balance will change/i)).toBeNull();
  });
});

describe('submit', () => {
  it('sends openingBalance on save', async () => {
    const user = userEvent.setup();
    renderModal(EDITING_ZERO_OPENING);

    await user.type(startingBalanceInput(), '50000');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateMock).toHaveBeenCalledTimes(1);
    const [id, body] = updateMock.mock.calls[0] as [string, { openingBalance: number }];
    expect(id).toBe('acct_1');
    expect(body.openingBalance).toBe(500);
  });

  /**
   * Debt is negative in this ledger, so every credit card that carried a balance
   * before tracking began has a negative opening — which is what the whole
   * `openingBalance` column exists for. The input clamped to zero without
   * `allowNegative`, so the account type that most needs the field silently
   * dropped its sign and reported no error.
   */
  it('accepts a negative starting balance', async () => {
    const user = userEvent.setup();
    renderModal(EDITING_ZERO_OPENING);

    // A leading '-' on an empty field sets the sign; the digits follow.
    await user.type(startingBalanceInput(), '-38000');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const [, body] = updateMock.mock.calls[0] as [string, { openingBalance: number }];
    expect(body.openingBalance).toBe(-380);
  });

  it('creates an account with a negative starting balance', async () => {
    // The create path writes the field into `balance`, which the API mirrors
    // into `openingBalance` — a new card opened mid-debt has to start negative.
    const user = userEvent.setup();
    renderModal(null);

    await user.type(screen.getByLabelText(/^name$/i), 'New Card');
    await user.type(startingBalanceInput(), '-12550');
    await user.click(screen.getByRole('button', { name: /save|create|add/i }));

    const [body] = createMock.mock.calls[0] as [{ balance: number }];
    expect(body.balance).toBe(-125.5);
  });

  it('still sends the unchanged opening, which the API treats as a no-op', async () => {
    const user = userEvent.setup();
    renderModal(EDITING);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateMock).toHaveBeenCalledTimes(1);
    const [, body] = updateMock.mock.calls[0] as [string, { openingBalance: number }];
    expect(body.openingBalance).toBe(-380);
  });
});
