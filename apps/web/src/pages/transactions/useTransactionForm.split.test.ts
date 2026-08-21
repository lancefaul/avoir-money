import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createWrapper } from '../../test/wrapper.js';
import { useTransactionForm } from './useTransactionForm.js';
import type { UseTransactionFormOptions } from './useTransactionFormTypes.js';
import type { Account, Category } from './types.js';
import type { Transaction as CoreTransaction } from '@budget-tracker/core';
import type { FormValues } from './transactionFormSchema.js';

/**
 * Unit coverage for the payment-split (ADR-030) logic that lives in the form
 * hook: the overdraw clamp, the auto-balanced remainder, `fundingError` /
 * `resplitError` validity, the optional rewards leg, and the create-split /
 * re-split mutation payloads. These are the financial leg-math paths.
 */

// A finite account (Checking) caps a leg at its balance; a Credit Card never does.
// `card1` has a rewards child account (ADR-030) with a $30 balance.
const accounts: Account[] = [
  { id: 'card1', name: 'Prime Visa', type: 'Credit Card', balance: -500 },
  { id: 'card2', name: 'Amex', type: 'Credit Card', balance: 0 },
  { id: 'check', name: 'Checking', type: 'Checking', balance: 100 }, // cap = 10000 cents
  { id: 'rw1', name: 'Prime Visa Rewards', type: 'Rewards', balance: 30, parentAccountId: 'card1' },
];

const categories: Category[] = [
  { id: 'cat-unc', name: 'Uncategorized', icon: null },
  { id: 'cat-food', name: 'Food', icon: '🍕' },
];

/** Minimal UseMutationResult stand-in; only `.mutate` / `.isPending` are read. */
function mut(mutate: ReturnType<typeof vi.fn> = vi.fn()) {
  return { mutate, mutateAsync: vi.fn(), isPending: false, reset: vi.fn() };
}

function setup() {
  const createPurchase = vi.fn();
  const updatePayments = vi.fn();
  const options = {
    accounts,
    categories,
    stockHoldings: [],
    pricesData: undefined,
    lastAccountId: 'card1',
    createTx: mut(),
    updateTx: mut(),
    deleteTx: mut(),
    createPurchase: mut(createPurchase),
    updatePurchasePayments: mut(updatePayments),
    bitcoinTransferMutation: mut(),
    stockTransferMutation: mut(),
  } as unknown as UseTransactionFormOptions;

  const { result } = renderHook(() => useTransactionForm(options), { wrapper: createWrapper() });
  return { result, createPurchase, updatePayments };
}

const anchor = {
  purchaseGroupId: 'g1',
  amount: 100,
  name: 'Dinner',
  budgetId: 'cat-food',
  note: null,
} as unknown as CoreTransaction;

const baseSubmit = {
  type: 'EXPENSE',
  paymentMethod: 'account',
  name: 'Dinner',
  date: '2025-01-01',
  budgetId: 'cat-food',
  note: '',
  amount: '100.00',
} as FormValues;

describe('useTransactionForm — payment split', () => {
  describe('overdraw clamp / availableCents', () => {
    it('caps a finite account at its balance and leaves a credit card uncapped', () => {
      const { result } = setup();
      act(() => result.current.openCreate());

      expect(result.current.availableCents('check')).toBe(10000);
      expect(result.current.availableCents('card1')).toBeNull();

      act(() => result.current.setLegAmount('check', 20000)); // over balance
      expect(result.current.legAmounts.check).toBe(10000); // clamped

      act(() => result.current.setLegAmount('card1', 20000)); // credit — no cap
      expect(result.current.legAmounts.card1).toBe(20000);
    });

    it('re-clamps the single-account amount when switching to a smaller account', () => {
      const { result } = setup();
      act(() => result.current.openCreate());
      // A credit card has no cap: a large single amount is allowed.
      act(() => result.current.setFundingAccounts(['card1']));
      act(() => result.current.setValue('amount', '200.00'));
      expect(result.current.watch('amount')).toBe('200.00');
      // Switching to Checking ($100 balance) must re-clamp the amount to the cap.
      act(() => result.current.setFundingAccounts(['check']));
      expect(result.current.watch('amount')).toBe('100.00');
    });

    it('leaves the amount alone when the new account still covers it', () => {
      const { result } = setup();
      act(() => result.current.openCreate());
      act(() => result.current.setFundingAccounts(['check']));
      act(() => result.current.setValue('amount', '50.00')); // within the $100 cap
      act(() => result.current.setFundingAccounts(['card1'])); // credit — no cap
      expect(result.current.watch('amount')).toBe('50.00');
    });
  });

  describe('funding mode + fundingError (create)', () => {
    it('a single account with no rewards is not a split and has no funding error', () => {
      const { result } = setup();
      act(() => result.current.openCreate());
      act(() => result.current.setFundingAccounts(['card1']));
      act(() => result.current.setValue('amount', '50.00'));
      expect(result.current.fundingMode).toBe('single');
      expect(result.current.isSplit).toBe(false);
      expect(result.current.fundingError).toBeNull();
    });

    it('Multiple mode: each account is typed and the total is their sum', () => {
      const { result } = setup();
      act(() => result.current.openCreate());
      act(() => result.current.switchFundingMode('multiple'));
      act(() => result.current.setFundingAccounts(['card1', 'card2']));
      act(() => result.current.setLegAmount('card1', 6000));
      act(() => result.current.setLegAmount('card2', 4000));

      expect(result.current.isSplit).toBe(true);
      expect(result.current.fundingError).toBeNull();
      // The form amount mirrors the sum of the legs.
      expect(result.current.watch('amount')).toBe('100.00');
    });

    it('Single mode: rewards greater than the amount is flagged', () => {
      const { result } = setup();
      act(() => result.current.openCreate());
      act(() => result.current.setFundingAccounts(['card1']));
      act(() => result.current.setValue('amount', '10.00'));
      act(() => result.current.setRewardsAmount('card1', 3000)); // $30 rewards > $10 amount
      expect(result.current.fundingError).toMatch(/exceed the amount/);
    });
  });

  describe('create-split submit', () => {
    it('routes a valid split to createPurchase with one leg per typed account', () => {
      const { result, createPurchase } = setup();
      act(() => result.current.openCreate());
      act(() => result.current.switchFundingMode('multiple'));
      act(() => result.current.setFundingAccounts(['card1', 'card2']));
      act(() => result.current.setLegAmount('card1', 6000));
      act(() => result.current.setLegAmount('card2', 4000));

      act(() => result.current.onSubmit(baseSubmit));

      expect(createPurchase).toHaveBeenCalledTimes(1);
      const body = createPurchase.mock.calls[0]![0];
      expect(body.amount).toBe(100);
      expect(body.budgetId).toBe('cat-food');
      expect(body.payments).toEqual([
        { accountId: 'card1', amount: 60 },
        { accountId: 'card2', amount: 40 },
      ]);
    });
  });

  describe('rewards leg (create)', () => {
    it('exposes a card rewards account and none for a plain account', () => {
      const { result } = setup();
      act(() => result.current.openCreate());
      expect(result.current.rewardsAccountFor('card1')?.id).toBe('rw1');
      expect(result.current.rewardsAccountFor('check')).toBeUndefined();
    });

    it('clamps rewards applied to the card rewards balance', () => {
      const { result } = setup();
      act(() => result.current.openCreate());
      act(() => result.current.setFundingAccounts(['card1']));
      act(() => result.current.setRewardsAmount('card1', 9999)); // > $30 balance
      expect(result.current.rewardsAmounts.card1).toBe(3000); // clamped
    });

    it('a single card + rewards applied becomes a two-leg purchase (card + rewards)', () => {
      const { result, createPurchase } = setup();
      act(() => result.current.openCreate());
      act(() => result.current.setFundingAccounts(['card1'])); // single mode
      act(() => result.current.setValue('amount', '100.00'));
      act(() => result.current.setRewardsAmount('card1', 2000)); // $20 rewards

      expect(result.current.isSplit).toBe(true); // card ($80) + rewards ($20)

      act(() => result.current.onSubmit(baseSubmit));

      const body = createPurchase.mock.calls[0]![0];
      expect(body.amount).toBe(100);
      expect(body.payments).toEqual([
        { accountId: 'card1', amount: 80 },
        { accountId: 'rw1', amount: 20 },
      ]);
    });
  });

  describe('re-split validation', () => {
    it('fixes the total to the anchor and validates the legs sum to it', () => {
      const { result } = setup();
      act(() =>
        result.current.openResplit(anchor, [
          { accountId: 'card1', amountCents: 6000 },
          { accountId: 'card2', amountCents: 4000 },
        ]),
      );

      expect(result.current.isResplit).toBe(true);
      expect(result.current.resplitTotalCents).toBe(10000);
      expect(result.current.resplitError).toBeNull();

      act(() => result.current.setLegAmount('card1', 5000)); // sum 9000 ≠ 10000
      expect(result.current.resplitError).toMatch(/must sum to the purchase total/);
    });

    it('rejects collapsing a re-split below two accounts', () => {
      const { result } = setup();
      act(() =>
        result.current.openResplit(anchor, [
          { accountId: 'card1', amountCents: 6000 },
          { accountId: 'card2', amountCents: 4000 },
        ]),
      );

      act(() => result.current.setFundingAccounts(['card1']));
      expect(result.current.resplitError).toBe('A split needs at least two accounts');
    });
  });

  describe('submitResplit', () => {
    it('PUTs the new legs when valid', () => {
      const { result, updatePayments } = setup();
      act(() =>
        result.current.openResplit(anchor, [
          { accountId: 'card1', amountCents: 6000 },
          { accountId: 'card2', amountCents: 4000 },
        ]),
      );

      act(() => result.current.submitResplit());

      expect(updatePayments).toHaveBeenCalledTimes(1);
      const arg = updatePayments.mock.calls[0]![0];
      expect(arg.groupId).toBe('g1');
      expect(arg.body.payments).toEqual([
        { accountId: 'card1', amount: 60 },
        { accountId: 'card2', amount: 40 },
      ]);
    });

    it('is a no-op while the legs do not sum to the total', () => {
      const { result, updatePayments } = setup();
      act(() =>
        result.current.openResplit(anchor, [
          { accountId: 'card1', amountCents: 6000 },
          { accountId: 'card2', amountCents: 4000 },
        ]),
      );

      act(() => result.current.setLegAmount('card1', 1)); // sum 4001 ≠ 10000
      act(() => result.current.submitResplit());

      expect(updatePayments).not.toHaveBeenCalled();
    });
  });
});

/**
 * Editing a purchase that emptied one of its own accounts.
 *
 * An account's stored balance ALREADY has the transaction applied, so when the
 * editor computes "how much can this account contribute", the row's own money
 * looks like it is gone. A gift card drained to zero by this very purchase
 * therefore reported a $0 cap and its leg clamped to nothing — with no way to
 * type the real figure back, because every recompute clamped it again.
 *
 * Reported 2026-08-20: changing the account on a split zeroed the gift-card leg,
 * and removing or adding a payment method did the same. It reaches any finite
 * account left at exactly $0 by the transaction being edited.
 */
describe('editing a purchase that spent an account down to zero', () => {
  // A gift card with $0 left, because this very purchase took all $40 of it.
  const drained: Account[] = [
    { id: 'card1', name: 'Prime Visa', type: 'Credit Card', balance: -500 },
    { id: 'gift', name: 'Gift Card', type: 'Gift Card', balance: 0 },
  ];

  function setupWith(accts: Account[]) {
    const updatePayments = vi.fn();
    const options = {
      accounts: accts,
      categories,
      stockHoldings: [],
      pricesData: undefined,
      lastAccountId: 'card1',
      createTx: mut(),
      updateTx: mut(),
      deleteTx: mut(),
      createPurchase: mut(),
      updatePurchasePayments: mut(updatePayments),
      bitcoinTransferMutation: mut(),
      stockTransferMutation: mut(),
    } as unknown as UseTransactionFormOptions;
    const { result } = renderHook(() => useTransactionForm(options), { wrapper: createWrapper() });
    return { result, updatePayments };
  }

  it('keeps the drained account spendable up to what this purchase took', () => {
    const { result } = setupWith(drained);
    act(() =>
      result.current.openResplit(anchor, [
        { accountId: 'card1', amountCents: 6000 },
        { accountId: 'gift', amountCents: 4000 },
      ]),
    );
    // $0 balance + the $40 this row already took back = $40 spendable.
    expect(result.current.availableCents('gift')).toBe(4000);
  });

  it('does not zero the leg when the accounts change', () => {
    const { result } = setupWith(drained);
    act(() =>
      result.current.openResplit(anchor, [
        { accountId: 'card1', amountCents: 6000 },
        { accountId: 'gift', amountCents: 4000 },
      ]),
    );
    // Exactly the reported action: change which accounts are involved.
    act(() => result.current.setFundingAccounts(['card1', 'gift']));
    expect(result.current.legAmounts['gift']).toBe(4000);
  });

  it('lets the amount be typed back in', () => {
    const { result } = setupWith(drained);
    act(() =>
      result.current.openResplit(anchor, [
        { accountId: 'card1', amountCents: 6000 },
        { accountId: 'gift', amountCents: 4000 },
      ]),
    );
    act(() => result.current.setLegAmount('gift', 4000));
    expect(result.current.legAmounts['gift']).toBe(4000);
  });

  it('still refuses to overdraw beyond what this purchase took', () => {
    // The allowance is the row's OWN portion, not a licence to ignore the cap.
    const { result } = setupWith(drained);
    act(() =>
      result.current.openResplit(anchor, [
        { accountId: 'card1', amountCents: 6000 },
        { accountId: 'gift', amountCents: 4000 },
      ]),
    );
    act(() => result.current.setLegAmount('gift', 9999));
    expect(result.current.legAmounts['gift']).toBe(4000);
  });

  it('grants no allowance when CREATING, where nothing has been spent yet', () => {
    // The dangerous direction. A stale allowance here would let a brand new
    // purchase spend money the account does not have.
    const { result } = setupWith(drained);
    act(() => result.current.openResplit(anchor, [{ accountId: 'gift', amountCents: 4000 }]));
    act(() => result.current.openCreate('EXPENSE'));
    expect(result.current.availableCents('gift')).toBe(0);
    act(() => result.current.setFundingAccounts(['gift']));
    act(() => result.current.setLegAmount('gift', 4000));
    expect(result.current.legAmounts['gift']).toBe(0);
  });
});
