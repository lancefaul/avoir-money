/**
 * The cash-back flag has to survive both ways into the form.
 *
 * Editing must show the row as it is, and duplicating must carry the flag over
 * — a rebate copied becomes another rebate. The duplicate path deliberately
 * clears `incomeId` because that links to one specific occurrence, and the flag
 * was first written to mirror it. That was wrong: this is a property of the
 * money, like type and budget, both of which the same function copies. Clearing
 * it turns the copy into ordinary taxable income with the toggle scrolled out of
 * view, which is the kind of default nobody catches.
 */
import { describe, it, expect, vi } from 'vitest';
import { applyEditValues, applyDuplicateValues } from './transactionFormPrefill.js';
import type { Transaction as CoreTransaction } from '@budget-tracker/core';

function tx(over: Partial<CoreTransaction> = {}): CoreTransaction {
  return {
    id: 'tx-1',
    type: 'INCOME',
    name: 'Prime Visa cash back',
    amount: 42.17,
    netAmount: 42.17,
    date: new Date('2026-08-08T00:00:00.000Z'),
    payPeriodId: null,
    expenseId: null,
    incomeId: null,
    accountId: 'acct-1',
    toAccountId: null,
    budgetId: 'bud-1',
    note: null,
    isCashBack: true,
    createdAt: new Date('2026-08-08T00:00:00.000Z'),
    ...over,
  } as CoreTransaction;
}

/** Collect setValue calls into a plain object. */
function capture() {
  const values: Record<string, unknown> = {};
  const setValue = vi.fn((field: string, value: unknown) => {
    values[field] = value;
  });
  return { values, setValue: setValue as never };
}

describe('transaction form prefill — cash back', () => {
  it('shows the flag when editing a cash-back row', () => {
    const { values, setValue } = capture();
    applyEditValues(setValue, tx());
    expect(values.isCashBack).toBe(true);
  });

  it('shows it off when editing an ordinary income row', () => {
    const { values, setValue } = capture();
    applyEditValues(setValue, tx({ isCashBack: false }));
    expect(values.isCashBack).toBe(false);
  });

  it('carries the flag onto a duplicate', () => {
    const { values, setValue } = capture();
    applyDuplicateValues(setValue, tx(), '2026-08-09');
    expect(values.isCashBack).toBe(true);
  });

  it('does not invent the flag when duplicating ordinary income', () => {
    const { values, setValue } = capture();
    applyDuplicateValues(setValue, tx({ isCashBack: false }), '2026-08-09');
    expect(values.isCashBack).toBe(false);
  });

  it('still clears incomeId on a duplicate — a link, not a property', () => {
    // Guards the distinction this test file exists for: the two fields sit next
    // to each other and must behave oppositely.
    const { values, setValue } = capture();
    applyDuplicateValues(setValue, tx({ incomeId: 'inc-1' }), '2026-08-09');
    expect(values.incomeId).toBe('');
    expect(values.isCashBack).toBe(true);
  });

  it('treats a row predating the column as not cash back', () => {
    const { values, setValue } = capture();
    applyEditValues(setValue, tx({ isCashBack: undefined }));
    expect(values.isCashBack).toBe(false);
  });
});
