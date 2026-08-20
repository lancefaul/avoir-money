import { describe, it, expect } from 'vitest';
import type { HookContext, TransactionRecord } from '../../types.js';
import { balanceHook } from '../balance.hook.js';
import { tradeHoldingHook } from '../trade-holding.hook.js';
import { bitcoinHoldingHook } from '../bitcoin-holding.hook.js';
import { debtPaymentHook } from '../debt-payment.hook.js';
import { payPeriodHook } from '../pay-period.hook.js';
import { systemBudgetHook } from '../system-budget.hook.js';

// ─── Helper: build a minimal TransactionRecord ───

function makeTx(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    id: 'tx-1',
    type: 'EXPENSE',
    name: 'Test',
    amount: 100,
    date: new Date(),
    createdAt: new Date(),
    accountId: 'acct-1',
    toAccountId: null,
    expenseId: null,
    incomeId: null,
    budgetId: null,
    ...overrides,
  };
}

function makeCtx(txOverrides: Partial<TransactionRecord> = {}, event?: string): HookContext {
  return {
    tx: makeTx(txOverrides),
    ...(event ? { event: event as HookContext['event'] } : {}),
  };
}

// ─── Balance Hook ───

describe('balanceHook', () => {
  it('has correct name, events, and priority', () => {
    expect(balanceHook.name).toBe('balance-update');
    expect(balanceHook.events).toEqual(['created', 'updated', 'deleted']);
    expect(balanceHook.priority).toBe(10);
  });

  it('condition returns true for non-BITCOIN accounts', () => {
    expect(balanceHook.condition!(makeCtx({ accountId: 'checking-1' }))).toBe(true);
    expect(balanceHook.condition!(makeCtx({ accountId: 'savings-1' }))).toBe(true);
  });

  it('condition returns false for null accountId (bitcoin transactions)', () => {
    expect(balanceHook.condition!(makeCtx({ accountId: null }))).toBe(false);
  });
});

// ─── Trade Holding Hook ───

describe('tradeHoldingHook', () => {
  it('has correct name, events, and priority', () => {
    expect(tradeHoldingHook.name).toBe('trade-holding');
    expect(tradeHoldingHook.events).toEqual(['created', 'updated', 'deleted']);
    expect(tradeHoldingHook.priority).toBe(20);
  });

  it('condition returns true for TRADE with tradeDetail', () => {
    const ctx = makeCtx({
      type: 'TRADE',
      tradeDetail: {
        direction: 'BUY',
        assetType: 'Stock',
        ticker: 'AAPL',
        unitPrice: 150,
        quantity: 10,
        bitcoinUnit: null,
        custodianId: 'c1',
        walletId: null,
      },
    });
    expect(tradeHoldingHook.condition!(ctx)).toBe(true);
  });

  it('condition returns false for TRADE without tradeDetail', () => {
    const ctx = makeCtx({ type: 'TRADE' });
    expect(tradeHoldingHook.condition!(ctx)).toBe(false);
  });

  it('condition returns false for non-TRADE type', () => {
    const ctx = makeCtx({
      type: 'EXPENSE',
      tradeDetail: {
        direction: 'BUY',
        assetType: 'Stock',
        ticker: 'AAPL',
        unitPrice: 150,
        quantity: 10,
        bitcoinUnit: null,
        custodianId: 'c1',
        walletId: null,
      },
    });
    expect(tradeHoldingHook.condition!(ctx)).toBe(false);
  });
});

// ─── Bitcoin Holding Hook ───

describe('bitcoinHoldingHook', () => {
  it('has correct name, events, and priority', () => {
    expect(bitcoinHoldingHook.name).toBe('bitcoin-holding');
    expect(bitcoinHoldingHook.events).toEqual(['created', 'updated', 'deleted']);
    expect(bitcoinHoldingHook.priority).toBe(20);
  });

  it('condition returns true when bitcoinPaymentDetail is present', () => {
    const ctx = makeCtx({
      bitcoinPaymentDetail: {
        walletId: 'w1',
        quantity: 0.5,
        bitcoinUnit: 'Bitcoin',
        unitPrice: 60000,
        incomeType: null,
      },
    });
    expect(bitcoinHoldingHook.condition!(ctx)).toBe(true);
  });

  it('condition returns false when bitcoinPaymentDetail is absent', () => {
    expect(bitcoinHoldingHook.condition!(makeCtx())).toBe(false);
  });

  it('condition returns false when bitcoinPaymentDetail is null', () => {
    const ctx = makeCtx({ bitcoinPaymentDetail: null });
    expect(bitcoinHoldingHook.condition!(ctx)).toBe(false);
  });
});

// ─── Debt Payment Hook ───

describe('debtPaymentHook', () => {
  it('has correct name, events, and priority', () => {
    expect(debtPaymentHook.name).toBe('debt-payment');
    expect(debtPaymentHook.events).toEqual(['created', 'deleted']);
    expect(debtPaymentHook.priority).toBe(30);
  });

  it('condition returns true when expenseId is present', () => {
    const ctx = makeCtx({ expenseId: 'exp-1' });
    expect(debtPaymentHook.condition!(ctx)).toBe(true);
  });

  it('condition returns false when expenseId is null', () => {
    const ctx = makeCtx({ expenseId: null });
    expect(debtPaymentHook.condition!(ctx)).toBe(false);
  });
});

// ─── Pay Period Hook ───

describe('payPeriodHook', () => {
  it('has correct name, events, and priority', () => {
    expect(payPeriodHook.name).toBe('pay-period-extension');
    expect(payPeriodHook.events).toEqual(['created']);
    expect(payPeriodHook.priority).toBe(40);
  });

  it('condition returns true when incomeId is present', () => {
    const ctx = makeCtx({ incomeId: 'inc-1' });
    expect(payPeriodHook.condition!(ctx)).toBe(true);
  });

  it('condition returns true when expenseId is present', () => {
    const ctx = makeCtx({ expenseId: 'exp-1' });
    expect(payPeriodHook.condition!(ctx)).toBe(true);
  });

  it('condition returns true when both incomeId and expenseId are present', () => {
    const ctx = makeCtx({ incomeId: 'inc-1', expenseId: 'exp-1' });
    expect(payPeriodHook.condition!(ctx)).toBe(true);
  });

  it('condition returns false when neither incomeId nor expenseId', () => {
    const ctx = makeCtx({ incomeId: null, expenseId: null });
    expect(payPeriodHook.condition!(ctx)).toBe(false);
  });
});

// ─── System Category Hook ───

describe('systemBudgetHook', () => {
  it('has correct name, events, and priority', () => {
    expect(systemBudgetHook.name).toBe('system-budget');
    expect(systemBudgetHook.events).toEqual(['created', 'updated']);
    expect(systemBudgetHook.priority).toBe(5);
  });

  it('condition returns true for INCOME, TRADE, TRANSFER on create', () => {
    expect(systemBudgetHook.condition!(makeCtx({ type: 'INCOME' }))).toBe(true);
    expect(systemBudgetHook.condition!(makeCtx({ type: 'TRADE' }))).toBe(true);
    expect(systemBudgetHook.condition!(makeCtx({ type: 'TRANSFER' }))).toBe(true);
  });

  it('condition returns false for EXPENSE and REFUND on create', () => {
    expect(systemBudgetHook.condition!(makeCtx({ type: 'EXPENSE' }))).toBe(false);
    expect(systemBudgetHook.condition!(makeCtx({ type: 'REFUND' }))).toBe(false);
  });

  it('condition returns true on update when type changed to a system type', () => {
    const ctx: HookContext = {
      event: 'updated',
      tx: makeTx({ type: 'TRADE' }),
      oldTx: makeTx({ type: 'EXPENSE' }),
    };
    expect(systemBudgetHook.condition!(ctx)).toBe(true);
  });

  it('condition returns false on update when type did not change', () => {
    const ctx: HookContext = {
      event: 'updated',
      tx: makeTx({ type: 'INCOME' }),
      oldTx: makeTx({ type: 'INCOME' }),
    };
    expect(systemBudgetHook.condition!(ctx)).toBe(false);
  });
});
