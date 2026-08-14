/**
 * Integration tests for the transaction-validation module.
 *
 * Tests validateTradeMetadata and validateBitcoinPayment with real DB state.
 *
 * Feature: backend-coverage-push
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6
 */
import { describe, it, expect } from 'vitest';
import { validateTradeMetadata, validateBitcoinPayment } from './transaction-validation.js';
import { createWallet, createCustodian, createHolding } from '../test/helpers.js';

// ─── validateTradeMetadata ───

describe('validateTradeMetadata', () => {
  it('BUY direction — returns { ok: true } without querying holdings', async () => {
    // No custodian/wallet/holding seeded — BUY should skip all DB checks
    const result = await validateTradeMetadata({
      direction: 'BUY',
      assetType: 'Stock',
      ticker: 'AAPL',
      quantity: 100,
      custodianId: 'nonexistent-id',
    });

    expect(result).toEqual({ ok: true });
  });

  it('SELL direction for stock, nonexistent custodian — returns { ok: false, error: "Custodian not found", status: 400 }', async () => {
    const result = await validateTradeMetadata({
      direction: 'SELL',
      assetType: 'Stock',
      ticker: 'AAPL',
      quantity: 10,
      custodianId: 'nonexistent-custodian-id',
    });

    expect(result).toEqual({ ok: false, error: 'Custodian not found', status: 400 });
  });

  it('SELL direction for bitcoin, nonexistent wallet — returns { ok: false, error: "Wallet not found", status: 400 }', async () => {
    const result = await validateTradeMetadata({
      direction: 'SELL',
      assetType: 'Bitcoin',
      quantity: 0.5,
      walletId: 'nonexistent-wallet-id',
    });

    expect(result).toEqual({ ok: false, error: 'Wallet not found', status: 400 });
  });

  it('SELL direction, quantity exceeding holdings — returns insufficient holdings error with current and requested quantities', async () => {
    const custodian = await createCustodian();
    await createHolding({
      type: 'STOCK',
      ticker: 'TSLA',
      quantity: 5,
      costBasis: 1000,
      custodianId: custodian.id,
      walletId: null,
    });

    const result = await validateTradeMetadata({
      direction: 'SELL',
      assetType: 'Stock',
      ticker: 'TSLA',
      quantity: 10,
      custodianId: custodian.id,
    });

    expect(result).toEqual({
      ok: false,
      error: 'Insufficient holdings: have 5, trying to sell 10',
      status: 400,
    });
  });
});

// ─── validateBitcoinPayment ───

describe('validateBitcoinPayment', () => {
  it('EXPENSE with insufficient BTC — returns insufficient holdings error', async () => {
    const wallet = await createWallet();
    await createHolding({
      type: 'BITCOIN',
      quantity: 0.1,
      costBasis: 5000,
      walletId: wallet.id,
      custodianId: null,
      ticker: null,
    });

    const result = await validateBitcoinPayment(
      {
        walletId: wallet.id,
        quantity: 0.5,
        bitcoinUnit: 'Bitcoin',
        unitPrice: 60000,
      },
      'EXPENSE',
    );

    expect(result).toEqual({
      ok: false,
      error: 'Insufficient holdings: have 0.1, trying to spend 0.5',
      status: 400,
    });
  });

  it('INCOME — returns { ok: true } with computed USD amount, no holdings check', async () => {
    const wallet = await createWallet();
    // No holding seeded — INCOME should not check balance

    const result = await validateBitcoinPayment(
      {
        walletId: wallet.id,
        quantity: 0.25,
        bitcoinUnit: 'Bitcoin',
        unitPrice: 60000,
      },
      'INCOME',
    );

    expect(result).toEqual({
      ok: true,
      data: { usdAmount: 15000 }, // 0.25 * 60000
    });
  });
});
