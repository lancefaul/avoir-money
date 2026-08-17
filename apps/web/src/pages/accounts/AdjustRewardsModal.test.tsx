/**
 * Rewards can only ever go up outside a redemption — there was an Earn action
 * and no way to record points expiring, a clawback on a returned purchase, or a
 * balance entered wrong.
 *
 * The mechanism is deliberately unremarkable: an EXPENSE row on the nested
 * Rewards account, the mirror of the INCOME row the earn modal writes. The
 * balance is the running sum of the account's rows, so there is no stored
 * rewards figure to adjust — the same discipline that retired the old
 * `rewardsBalance` column.
 *
 * What these tests pin is the part that is easy to get wrong and invisible
 * afterwards: the row must say WHY (an unexplained decrease is indistinguishable
 * from a redemption months later), and it must not land in a budget (points
 * expiring is not household spending).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdjustRewardsModal from './AdjustRewardsModal.js';

const createMock = vi.fn().mockResolvedValue({});
const listBudgetItemsMock = vi.fn();

vi.mock('../../lib/api.js', () => ({
  api: {
    transactions: { create: (body: unknown) => createMock(body) },
    budgetItems: { list: () => listBudgetItemsMock() },
  },
}));

/** The DS Select renders its options into a portal across a few rAF frames. */
async function flushRAF() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
  });
}

beforeEach(() => {
  createMock.mockClear();
  listBudgetItemsMock.mockReset().mockResolvedValue([
    { id: 'sys-payment', name: 'Payment', isSystem: true },
    { id: 'sys-income', name: 'Income', isSystem: true },
    // A real budget sharing the name — the lookup must prefer the system one,
    // or an adjustment starts counting against a category the user budgets for.
    { id: 'user-payment', name: 'Payment', isSystem: false },
    { id: 'user-groceries', name: 'Groceries', isSystem: false },
  ]);
});

function renderModal(currentBalance = 131) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdjustRewardsModal
        open
        onClose={() => {}}
        rewardsAccountId="rw-1"
        currentBalance={currentBalance}
      />
    </QueryClientProvider>,
  );
}

/**
 * Enter an amount into the CurrencyInput.
 *
 * The input is digit-shift, not free text: every keystroke is
 * `cents * 10 + digit`, so the argument is CENTS. "20000" is $200.00. Typing
 * "200" would silently mean $2.00 — which is how the first version of the
 * negative-balance test passed against a warning that never rendered.
 */
async function enterAmount(user: ReturnType<typeof userEvent.setup>, cents: string) {
  await user.type(screen.getByLabelText('Amount to remove'), cents);
}

async function enterAmountAndSave(user: ReturnType<typeof userEvent.setup>, cents: string) {
  await enterAmount(user, cents);
  await user.click(screen.getByRole('button', { name: 'Save' }));
}

describe('AdjustRewardsModal', () => {
  it('writes an EXPENSE on the rewards account, not an adjustment to a stored figure', async () => {
    const user = userEvent.setup();
    renderModal();

    await enterAmountAndSave(user, '1250');

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]![0]).toMatchObject({
      type: 'EXPENSE',
      amount: 12.5,
      accountId: 'rw-1',
    });
  });

  it('names the row from the reason so history says why', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('combobox', { name: 'Reason' }));
    await flushRAF();
    await user.click(screen.getByText('Clawback (returned purchase)'));

    await enterAmountAndSave(user, '800');

    expect(createMock.mock.calls[0]![0]).toMatchObject({ name: 'Rewards clawback' });
  });

  it('defaults to expiry rather than an unlabelled decrease', async () => {
    const user = userEvent.setup();
    renderModal();

    await enterAmountAndSave(user, '500');

    // The point is that SOME reason is always recorded — a decrease with no
    // stated cause is the outcome this feature exists to avoid.
    expect(createMock.mock.calls[0]![0]).toMatchObject({ name: 'Rewards expired' });
  });

  it('carries the system Payment allocation, never a real budget', async () => {
    const user = userEvent.setup();
    renderModal();

    // Wait for the budget list before submitting, otherwise the assertion would
    // pass for the wrong reason — an unresolved query also yields no budget.
    await screen.findByLabelText('Amount to remove');
    await act(async () => {
      await Promise.resolve();
    });

    await enterAmountAndSave(user, '1000');

    expect(createMock.mock.calls[0]![0]).toMatchObject({ budgetId: 'sys-payment' });
  });

  it('warns before leaving the balance negative, and still allows it', async () => {
    const user = userEvent.setup();
    renderModal(131);

    await enterAmount(user, '20000');

    // The warning states the resulting figure — "this will go negative" without
    // the number leaves the user to do the arithmetic that prompted the warning.
    expect(screen.getByRole('status')).toHaveTextContent(/-\$69\.00/);

    // Refusing the entry would preserve a balance already known to be wrong, so
    // Save stays enabled: the negative is a decision, not an accident.
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the decrease fits inside the balance', async () => {
    const user = userEvent.setup();
    renderModal(131);

    await enterAmount(user, '2000');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('will not submit an empty amount', async () => {
    renderModal();

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(createMock).not.toHaveBeenCalled();
  });
});
