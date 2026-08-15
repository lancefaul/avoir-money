/**
 * Unit tests for CreateTransactionSchema's TRADE rules.
 *
 * The funding-account rule is the one that matters here: a trade must be funded
 * from a tracked account. The web form already forces it; this schema is the
 * API-side guard so `POST /transactions` cannot repeat the NULL-accountId trades
 * that let the Cash Wallet BTC buys update the holding while never debiting cash
 * (BACKLOG "Enforce a funding account on every TRADE"). The rule is TRADE-scoped —
 * every other type may legitimately omit an account.
 */
import { describe, it, expect } from 'vitest';
import { CreateTransactionSchema } from './transaction.js';

/** A valid Bitcoin trade metadata block — mirrors the Cash Wallet BTC-buy case. */
const bitcoinTradeMetadata = {
  direction: 'BUY',
  assetType: 'Bitcoin',
  unitPrice: 65000,
  quantity: 100000,
  bitcoinUnit: 'Sats',
  walletId: 'wallet-1',
} as const;

const baseTrade = {
  type: 'TRADE',
  name: 'Buy BTC',
  amount: 65,
  date: '2026-05-08T00:00:00.000Z',
  tradeMetadata: bitcoinTradeMetadata,
} as const;

describe('CreateTransactionSchema — TRADE requires a funding account', () => {
  it('rejects a TRADE with no accountId', () => {
    const result = CreateTransactionSchema.safeParse(baseTrade);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'accountId');
      expect(issue?.message).toBe('A funding account is required for TRADE transactions');
    }
  });

  it('rejects a TRADE with a null accountId', () => {
    const result = CreateTransactionSchema.safeParse({ ...baseTrade, accountId: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'accountId')).toBe(true);
    }
  });

  it('rejects a TRADE with an empty-string accountId', () => {
    const result = CreateTransactionSchema.safeParse({ ...baseTrade, accountId: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'accountId')).toBe(true);
    }
  });

  it('accepts a TRADE that names a funding account', () => {
    const result = CreateTransactionSchema.safeParse({ ...baseTrade, accountId: 'acc-1' });
    expect(result.success).toBe(true);
  });

  it('leaves non-TRADE types free to omit an account (rule is TRADE-scoped)', () => {
    const expense = {
      type: 'EXPENSE',
      name: 'Coffee',
      amount: 4.5,
      date: '2026-05-08T00:00:00.000Z',
    };
    const result = CreateTransactionSchema.safeParse(expense);
    expect(result.success).toBe(true);
  });
});
