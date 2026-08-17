/**
 * Tests for the close modal — the point where the residual rule meets the user.
 *
 * The behaviour worth defending: when a period does not balance there is no
 * "close anyway". The only route through is an adjustment with a stated reason,
 * which lands in the ledger as a real transaction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CloseSessionModal from './CloseSessionModal.js';
import type { Residual } from './types.js';

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

const balanced: Residual = {
  openingBalance: 1000,
  transactionSum: -200,
  expectedBalance: 800,
  statementEndingBalance: 800,
  residual: 0,
  isBalanced: true,
  activityAfterPeriodEnd: 0,
};

const unbalanced: Residual = {
  ...balanced,
  statementEndingBalance: 940,
  residual: 140,
  isBalanced: false,
};

function renderModal(
  residual: Residual,
  overrides: Partial<Parameters<typeof CloseSessionModal>[0]> = {},
) {
  const onFinish = vi.fn();
  const onAdjust = vi.fn();
  const onCorrectOpening = vi.fn();
  render(
    <CloseSessionModal
      open
      onClose={vi.fn()}
      residual={residual}
      onFinish={onFinish}
      onAdjust={onAdjust}
      onCorrectOpening={onCorrectOpening}
      isBusy={false}
      {...overrides}
    />,
  );
  return { onFinish, onAdjust, onCorrectOpening };
}

describe('when the period balances', () => {
  it('offers a plain finish with no adjustment path', () => {
    renderModal(balanced);
    expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy();
    expect(screen.queryByLabelText(/why can.t this be explained/i)).toBeNull();
  });

  it('calls onFinish', async () => {
    const user = userEvent.setup();
    const { onFinish } = renderModal(balanced);
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});

describe('when the period does not balance', () => {
  it('offers no way to close without an adjustment', () => {
    renderModal(unbalanced);
    expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull();
    expect(screen.queryByRole('button', { name: /close anyway/i })).toBeNull();
    expect(screen.getByRole('button', { name: /record adjustment/i })).toBeTruthy();
  });

  it('disables the adjustment until a reason is given', async () => {
    const user = userEvent.setup();
    const { onAdjust } = renderModal(unbalanced);

    const button = screen.getByRole('button', { name: /record adjustment/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByLabelText(/why can.t this be explained/i), 'Unidentified fee');
    expect((button as HTMLButtonElement).disabled).toBe(false);

    await user.click(button);
    expect(onAdjust).toHaveBeenCalledWith('Unidentified fee');
  });

  it('rejects a whitespace-only reason', async () => {
    const user = userEvent.setup();
    renderModal(unbalanced);
    await user.type(screen.getByLabelText(/why can.t this be explained/i), '    ');
    const button = screen.getByRole('button', { name: /record adjustment/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('states that the adjustment stays visible rather than hidden in the opening', () => {
    renderModal(unbalanced);
    expect(screen.getByText(/will not be hidden in your\s+starting balance/i)).toBeTruthy();
  });

  it('shows the unexplained amount and both sides of the disagreement', () => {
    renderModal(unbalanced);
    expect(screen.getByText('$940.00')).toBeTruthy();
    expect(screen.getByText('$800.00')).toBeTruthy();
    expect(screen.getByText('$140.00')).toBeTruthy();
  });
});

/**
 * The opening-balance path is the other half of the combined-correction rule:
 * once a transaction the opening was offsetting gets fixed, the opening itself
 * has to move or the account stays wrong. It is deliberately NOT the front
 * door — an unexplained amount buried in the opening is precisely the silent
 * absorption this whole feature exists to prevent.
 */
describe('correcting the starting balance', () => {
  it('is never the default action', () => {
    renderModal(unbalanced);
    expect(screen.queryByRole('button', { name: /set starting balance/i })).toBeNull();
    expect(screen.getByRole('button', { name: /record adjustment/i })).toBeTruthy();
  });

  it('is not offered at all when the period already balances', () => {
    renderModal(balanced);
    expect(screen.queryByRole('button', { name: /starting balance was wrong/i })).toBeNull();
  });

  it('computes the opening that zeroes the residual', async () => {
    const user = userEvent.setup();
    const { onCorrectOpening } = renderModal(unbalanced);

    await user.click(screen.getByRole('button', { name: /starting balance was wrong/i }));
    // opening 1000 + residual 140 = 1140, which makes expected match the bank.
    await user.click(screen.getByRole('button', { name: /set starting balance to \$1,140\.00/i }));
    expect(onCorrectOpening).toHaveBeenCalledWith(1140);
  });

  it('states both when this is right and when it is wrong', async () => {
    const user = userEvent.setup();
    renderModal(unbalanced);
    await user.click(screen.getByRole('button', { name: /starting balance was wrong/i }));

    expect(screen.getByText(/just corrected a transaction/i)).toBeTruthy();
    expect(screen.getByText(/wrong move if you cannot say what the difference is/i)).toBeTruthy();
  });

  it('can be backed out of, returning to the adjustment path', async () => {
    const user = userEvent.setup();
    renderModal(unbalanced);
    await user.click(screen.getByRole('button', { name: /starting balance was wrong/i }));
    expect(screen.queryByLabelText(/why can.t this be explained/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText(/why can.t this be explained/i)).toBeTruthy();
  });
});
