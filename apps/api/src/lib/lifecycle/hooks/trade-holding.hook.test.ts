import { describe, it, expect } from 'vitest';
import { post } from '../../../test/helpers.js';
import {
  createCustodian,
  createWallet,
  createHolding,
  createAccount,
} from '../../../test/helpers.js';
import { prisma } from '@budget-tracker/db';

describe('Trade Holding Lifecycle Hook', () => {
  // ─── BUY trades ───

  describe('created event — BUY trade (Stock)', () => {
    it('increments holding quantity and cost basis at the correct custodian', async () => {
      const custodian = await createCustodian();
      const holding = await createHolding({
        type: 'STOCK',
        ticker: 'AAPL',
        quantity: 10,
        costBasis: 1500,
        custodianId: custodian.id,
        walletId: null,
      });

      const account = await createAccount();
      const res = await post('/transactions', {
        type: 'TRADE',
        name: 'Buy AAPL',
        amount: 750, // 5 shares × $150
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        accountId: account.id,
        tradeMetadata: {
          direction: 'BUY',
          assetType: 'Stock',
          ticker: 'AAPL',
          unitPrice: 150,
          quantity: 5,
          custodianId: custodian.id,
        },
      });

      expect(res.status).toBe(201);

      const updated = await prisma.investmentHolding.findUniqueOrThrow({
        where: { id: holding.id },
      });
      expect(Number(updated.quantity)).toBeCloseTo(15, 8); // 10 + 5
      expect(Number(updated.costBasis)).toBeCloseTo(2250, 2); // 1500 + 750
    });

    it('creates a new holding when none exists at the custodian', async () => {
      const custodian = await createCustodian();

      const account = await createAccount();
      const res = await post('/transactions', {
        type: 'TRADE',
        name: 'Buy MSFT',
        amount: 2000, // 10 shares × $200
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        accountId: account.id,
        tradeMetadata: {
          direction: 'BUY',
          assetType: 'Stock',
          ticker: 'MSFT',
          unitPrice: 200,
          quantity: 10,
          custodianId: custodian.id,
        },
      });

      expect(res.status).toBe(201);

      const holding = await prisma.investmentHolding.findFirst({
        where: { type: 'STOCK', custodianId: custodian.id, ticker: 'MSFT' },
      });
      expect(holding).not.toBeNull();
      expect(Number(holding!.quantity)).toBeCloseTo(10, 8);
      expect(Number(holding!.costBasis)).toBeCloseTo(2000, 2);
    });
  });

  describe('created event — BUY trade (Bitcoin)', () => {
    it('increments bitcoin holding quantity and cost basis at the correct wallet', async () => {
      const wallet = await createWallet();
      const holding = await createHolding({
        type: 'BITCOIN',
        ticker: null,
        quantity: 1.0,
        costBasis: 50000,
        walletId: wallet.id,
        custodianId: null,
      });

      const account = await createAccount();
      const res = await post('/transactions', {
        type: 'TRADE',
        name: 'Buy BTC',
        amount: 30000, // 0.5 BTC × $60000
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        accountId: account.id,
        tradeMetadata: {
          direction: 'BUY',
          assetType: 'Bitcoin',
          unitPrice: 60000,
          quantity: 0.5,
          bitcoinUnit: 'Bitcoin',
          walletId: wallet.id,
        },
      });

      expect(res.status).toBe(201);

      const updated = await prisma.investmentHolding.findUniqueOrThrow({
        where: { id: holding.id },
      });
      expect(Number(updated.quantity)).toBeCloseTo(1.5, 8); // 1.0 + 0.5
      expect(Number(updated.costBasis)).toBeCloseTo(80000, 2); // 50000 + 30000
    });

    it('converts Sats to BTC before incrementing holding quantity', async () => {
      const wallet = await createWallet();
      const holding = await createHolding({
        type: 'BITCOIN',
        ticker: null,
        quantity: 1.0,
        costBasis: 50000,
        walletId: wallet.id,
        custodianId: null,
      });

      const account = await createAccount();
      const res = await post('/transactions', {
        type: 'TRADE',
        name: 'Buy BTC in Sats',
        amount: 30000, // 50,000,000 sats = 0.5 BTC × $60000
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        accountId: account.id,
        tradeMetadata: {
          direction: 'BUY',
          assetType: 'Bitcoin',
          unitPrice: 60000,
          quantity: 50_000_000, // 50 million sats = 0.5 BTC
          bitcoinUnit: 'Sats',
          walletId: wallet.id,
        },
      });

      expect(res.status).toBe(201);

      const updated = await prisma.investmentHolding.findUniqueOrThrow({
        where: { id: holding.id },
      });
      // Quantity should be incremented by 0.5 BTC (50M sats / 100M)
      expect(Number(updated.quantity)).toBeCloseTo(1.5, 8); // 1.0 + 0.5
      expect(Number(updated.costBasis)).toBeCloseTo(80000, 2); // 50000 + 30000
    });
  });

  // ─── SELL trades ───

  describe('created event — SELL trade (Stock)', () => {
    it('decrements holding quantity and cost basis proportionally', async () => {
      const custodian = await createCustodian();
      const holding = await createHolding({
        type: 'STOCK',
        ticker: 'AAPL',
        quantity: 20,
        costBasis: 3000,
        custodianId: custodian.id,
        walletId: null,
      });

      const account = await createAccount();
      const res = await post('/transactions', {
        type: 'TRADE',
        name: 'Sell AAPL',
        amount: 1500, // 10 shares × $150
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        accountId: account.id,
        tradeMetadata: {
          direction: 'SELL',
          assetType: 'Stock',
          ticker: 'AAPL',
          unitPrice: 150,
          quantity: 10,
          custodianId: custodian.id,
        },
      });

      expect(res.status).toBe(201);

      const updated = await prisma.investmentHolding.findUniqueOrThrow({
        where: { id: holding.id },
      });
      expect(Number(updated.quantity)).toBeCloseTo(10, 8); // 20 - 10
      // Proportional cost basis: (10/20) * 3000 = 1500 reduction -> 3000 - 1500 = 1500
      expect(Number(updated.costBasis)).toBeCloseTo(1500, 2);
    });
  });

  describe('created event — SELL trade (Bitcoin)', () => {
    it('decrements bitcoin holding quantity and cost basis proportionally', async () => {
      const wallet = await createWallet();
      const holding = await createHolding({
        type: 'BITCOIN',
        ticker: null,
        quantity: 2.0,
        costBasis: 100000,
        walletId: wallet.id,
        custodianId: null,
      });

      const account = await createAccount();
      const res = await post('/transactions', {
        type: 'TRADE',
        name: 'Sell BTC',
        amount: 30000, // 0.5 BTC × $60000
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        accountId: account.id,
        tradeMetadata: {
          direction: 'SELL',
          assetType: 'Bitcoin',
          unitPrice: 60000,
          quantity: 0.5,
          bitcoinUnit: 'Bitcoin',
          walletId: wallet.id,
        },
      });

      expect(res.status).toBe(201);

      const updated = await prisma.investmentHolding.findUniqueOrThrow({
        where: { id: holding.id },
      });
      expect(Number(updated.quantity)).toBeCloseTo(1.5, 8); // 2.0 - 0.5
      // Proportional cost basis: (0.5/2.0) * 100000 = 25000 reduction -> 100000 - 25000 = 75000
      expect(Number(updated.costBasis)).toBeCloseTo(75000, 2);
    });
  });
});
