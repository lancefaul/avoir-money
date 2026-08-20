/**
 * Cash back only means something on INCOME, and the API refuses the flag on any
 * other type. The form's type switch is therefore load-bearing: a user who
 * marks an income as cash back and then changes the type must not carry the
 * flag with them, or the submit fails with an error about a control they can no
 * longer see.
 */
import { describe, it, expect } from 'vitest';
import { buildTransactionBody } from './transactionFormBody.js';
import type { FormValues } from './transactionFormSchema.js';

const ctx = { editing: null, uncategorizedId: 'uncat-1', incomeBudgetId: 'income-1' };

function values(over: Partial<FormValues>): FormValues {
  return {
    type: 'INCOME',
    name: 'Prime Visa cash back',
    amount: '42.17',
    date: '2026-08-08',
    accountId: 'acct-1',
    budgetId: '',
    incomeId: '',
    note: '',
    ...over,
  } as FormValues;
}

describe('buildTransactionBody — cash back', () => {
  it('sends the flag on INCOME', () => {
    const body = buildTransactionBody(values({ isCashBack: true }), ctx);
    expect(body.isCashBack).toBe(true);
  });

  it('sends false on INCOME when the toggle is off', () => {
    const body = buildTransactionBody(values({ isCashBack: false }), ctx);
    expect(body.isCashBack).toBe(false);
  });

  it('treats a missing flag as off rather than omitting it', () => {
    // An omitted key would leave a previously-true value untouched on update,
    // which is how an unmarked row silently stays marked.
    const body = buildTransactionBody(values({ isCashBack: undefined }), ctx);
    expect(body.isCashBack).toBe(false);
  });

  it.each(['EXPENSE', 'REFUND', 'TRANSFER', 'TRADE'] as const)(
    'clears a stale flag when the type is switched to %s',
    (type) => {
      // The user marked it cash back, then changed the type. Carrying the flag
      // over would submit a value the API rejects for a control now hidden.
      const body = buildTransactionBody(values({ type, isCashBack: true }), ctx);
      expect(body.isCashBack).toBe(false);
    },
  );
});
