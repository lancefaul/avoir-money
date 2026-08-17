/**
 * Unit tests for trade transaction edge cases.
 * Feature: trade-transactions, Task 6.5
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { post, put, del, get, createAccount } from '../test/helpers.js';

async function createCustodian(name: string) {
  return prisma.custodian.create({ data: { name } });
}

function stockMeta(
  direction: 'BUY' | 'SELL',
  ticker: string,
  quantity: number,
  custodianId: string,
) {
  return {
    direction,
    assetType: 'Stock',
    ticker,
    unitPrice: 100,
    quantity,
    custodianId,
  };
}

describe('Trade transaction edge cases', () => {
  it('retains holding at zero quantity after full sell', async () => {
    const acct = await createAccount();
    const custodian = await createCustodian('ZeroTest');

    // BUY 10 shares
    await post('/transactions', {
      type: 'TRADE',
      name: 'Buy',
      amount: 1000,
      date: '2026-04-01',
      accountId: acct.id,
      tradeMetadata: stockMeta('BUY', 'ZRO', 10, custodian.id),
    });

    // SELL all 10 shares
    await post('/transactions', {
      type: 'TRADE',
      name: 'Sell',
      amount: 1100,
      date: '2026-04-01',
      accountId: acct.id,
      tradeMetadata: stockMeta('SELL', 'ZRO', 10, custodian.id),
    });

    const holding = await prisma.investmentHolding.findFirst({
      where: { type: 'STOCK', ticker: 'ZRO', custodianId: custodian.id },
    });
    // Holding should still exist with zero quantity (Requirement 8.6)
    expect(holding).toBeDefined();
    expect(Number(holding!.quantity)).toBe(0);
  });

  it('upserts holding: creates new then updates existing', async () => {
    const acct = await createAccount();
    const custodian = await createCustodian('UpsertTest');

    // First BUY creates a new holding
    await post('/transactions', {
      type: 'TRADE',
      name: 'Buy 1',
      amount: 500,
      date: '2026-04-01',
      accountId: acct.id,
      tradeMetadata: stockMeta('BUY', 'UPS', 5, custodian.id),
    });

    const h1 = await prisma.investmentHolding.findFirst({
      where: { type: 'STOCK', ticker: 'UPS', custodianId: custodian.id },
    });
    expect(h1).toBeDefined();
    expect(Number(h1!.quantity)).toBe(5);
    expect(Number(h1!.costBasis)).toBe(500);

    // Second BUY updates the same holding
    await post('/transactions', {
      type: 'TRADE',
      name: 'Buy 2',
      amount: 300,
      date: '2026-04-01',
      accountId: acct.id,
      tradeMetadata: stockMeta('BUY', 'UPS', 3, custodian.id),
    });

    const h2 = await prisma.investmentHolding.findFirst({
      where: { type: 'STOCK', ticker: 'UPS', custodianId: custodian.id },
    });
    expect(Number(h2!.quantity)).toBe(8);
    expect(Number(h2!.costBasis)).toBe(800);
  });

  it('allows SELL with exact holding quantity (boundary)', async () => {
    const acct = await createAccount();
    const custodian = await createCustodian('ExactTest');

    await post('/transactions', {
      type: 'TRADE',
      name: 'Buy',
      amount: 2000,
      date: '2026-04-01',
      accountId: acct.id,
      tradeMetadata: stockMeta('BUY', 'EXC', 20, custodian.id),
    });

    // Sell exactly 20 — should succeed
    const sellRes = await post('/transactions', {
      type: 'TRADE',
      name: 'Sell',
      amount: 2200,
      date: '2026-04-01',
      accountId: acct.id,
      tradeMetadata: stockMeta('SELL', 'EXC', 20, custodian.id),
    });
    expect(sellRes.status).toBe(201);

    const holding = await prisma.investmentHolding.findFirst({
      where: { type: 'STOCK', ticker: 'EXC', custodianId: custodian.id },
    });
    expect(Number(holding!.quantity)).toBe(0);
  });
});

describe('Investment detail dual-write (TradeDetail / BitcoinPaymentDetail)', () => {
  it('creating a stock trade writes a TradeDetail row with the custodian FK', async () => {
    const acct = await createAccount();
    const custodian = await createCustodian('DetailStock');

    const res = await post('/transactions', {
      type: 'TRADE',
      name: 'Buy AAPL',
      amount: 1500,
      date: '2026-04-01',
      accountId: acct.id,
      tradeMetadata: stockMeta('BUY', 'AAPL', 10, custodian.id),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const detail = await prisma.tradeDetail.findUnique({ where: { transactionId: id } });
    expect(detail).not.toBeNull();
    expect(detail!.direction).toBe('BUY');
    expect(detail!.assetType).toBe('Stock');
    expect(detail!.ticker).toBe('AAPL');
    expect(Number(detail!.quantity)).toBe(10);
    expect(Number(detail!.unitPrice)).toBe(100);
    expect(detail!.custodianId).toBe(custodian.id);
    expect(detail!.walletId).toBeNull();
  });

  it('creating a bitcoin payment writes a BitcoinPaymentDetail row with the wallet FK', async () => {
    const wallet = await prisma.wallet.create({ data: { name: 'DetailWallet' } });

    const res = await post('/transactions', {
      type: 'INCOME',
      name: 'BTC payment',
      amount: 500,
      date: '2026-04-01',
      bitcoinMetadata: {
        walletId: wallet.id,
        quantity: 0.0125,
        bitcoinUnit: 'Bitcoin',
        unitPrice: 40000,
        incomeType: 'Payment',
      },
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const detail = await prisma.bitcoinPaymentDetail.findUnique({
      where: { transactionId: id },
    });
    expect(detail).not.toBeNull();
    expect(detail!.walletId).toBe(wallet.id);
    expect(Number(detail!.quantity)).toBe(0.0125);
    expect(Number(detail!.unitPrice)).toBe(40000);
    expect(detail!.bitcoinUnit).toBe('Bitcoin');
    expect(detail!.incomeType).toBe('Payment');
  });

  it('updating trade metadata updates the existing TradeDetail row', async () => {
    const acct = await createAccount();
    const custodian = await createCustodian('DetailUpdate');

    const createRes = await post('/transactions', {
      type: 'TRADE',
      name: 'Buy TSLA',
      amount: 1000,
      date: '2026-04-01',
      accountId: acct.id,
      tradeMetadata: stockMeta('BUY', 'TSLA', 5, custodian.id),
    });
    const { id } = (await createRes.json()) as { id: string };

    // Update the quantity via metadata
    const updRes = await put(`/transactions/${id}`, {
      type: 'TRADE',
      name: 'Buy TSLA',
      amount: 1400,
      date: '2026-04-01',
      accountId: acct.id,
      tradeMetadata: stockMeta('BUY', 'TSLA', 7, custodian.id),
    });
    expect(updRes.status).toBe(200);

    const detail = await prisma.tradeDetail.findUnique({ where: { transactionId: id } });
    expect(Number(detail!.quantity)).toBe(7);
  });

  it('BUY/SELL trades move the account balance via the TradeDetail relation (not the JSON blob)', async () => {
    const acct = await createAccount();
    const custodian = await createCustodian('DetailBalance');
    const start = Number(
      (await prisma.account.findUniqueOrThrow({ where: { id: acct.id } })).balance,
    );

    // BUY 5 @ 100 = 1500 leaves the account
    const buy = await post('/transactions', {
      type: 'TRADE',
      name: 'Buy NVDA',
      amount: 1500,
      date: '2026-04-01',
      accountId: acct.id,
      tradeMetadata: stockMeta('BUY', 'NVDA', 5, custodian.id),
    });
    expect(buy.status).toBe(201);
    const afterBuy = Number(
      (await prisma.account.findUniqueOrThrow({ where: { id: acct.id } })).balance,
    );
    expect(afterBuy).toBe(Math.round((start - 1500) * 100) / 100);

    // SELL 2 @ 100 = 800 enters the account
    const sell = await post('/transactions', {
      type: 'TRADE',
      name: 'Sell NVDA',
      amount: 800,
      date: '2026-04-02',
      accountId: acct.id,
      tradeMetadata: stockMeta('SELL', 'NVDA', 2, custodian.id),
    });
    expect(sell.status).toBe(201);
    const afterSell = Number(
      (await prisma.account.findUniqueOrThrow({ where: { id: acct.id } })).balance,
    );
    expect(afterSell).toBe(Math.round((start - 1500 + 800) * 100) / 100);
  });

  it('serializes tradeMetadata from the TradeDetail relation (no JSON column involved)', async () => {
    const acct = await createAccount();
    const custodian = await createCustodian('DetailSerialize');

    const res = await post('/transactions', {
      type: 'TRADE',
      name: 'Buy MSFT',
      amount: 1200,
      date: '2026-04-01',
      accountId: acct.id,
      tradeMetadata: stockMeta('BUY', 'MSFT', 4, custodian.id),
    });
    const { id } = (await res.json()) as { id: string };

    const listRes = await get('/transactions?limit=100');
    const { transactions } = (await listRes.json()) as {
      transactions: Array<{ id: string; tradeMetadata: Record<string, unknown> | null }>;
    };
    const found = transactions.find((t) => t.id === id);
    expect(found).toBeDefined();
    expect(found!.tradeMetadata).toMatchObject({
      direction: 'BUY',
      assetType: 'Stock',
      ticker: 'MSFT',
      quantity: 4,
      unitPrice: 100,
      custodianId: custodian.id,
    });
  });
});
