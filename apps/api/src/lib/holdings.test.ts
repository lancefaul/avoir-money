/**
 * Integration tests for holdings.ts database functions.
 *
 * Tests applyTradeToHolding and applyBitcoinToHolding — the functions
 * that modify InvestmentHolding records in the database.
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { applyTradeToHolding, applyBitcoinToHolding } from './holdings.js';
import { createCustodian, createWallet } from '../test/helpers.js';

describe('applyTradeToHolding', () => {
  describe('BUY with no existing holding', () => {
    it('creates new stock holding with custodian name', async () => {
      const custodian = await createCustodian({ name: 'Fidelity' });

      await applyTradeToHolding(
        {
          direction: 'BUY',
          assetType: 'Stock',
          ticker: 'AAPL',
          unitPrice: 150,
          quantity: 10,
          custodianId: custodian.id,
        },
        1500, // usdAmount
        1, // multiplier
      );

      const holding = await prisma.investmentHolding.findFirst({
        where: { custodianId: custodian.id, ticker: 'AAPL' },
      });

      expect(holding).toBeTruthy();
      expect(holding?.name).toBe('Fidelity');
      expect(holding?.type).toBe('STOCK');
      expect(holding?.ticker).toBe('AAPL');
      expect(Number(holding?.quantity)).toBe(10);
      expect(Number(holding?.costBasis)).toBe(1500);
    });

    it('creates new bitcoin holding with wallet name', async () => {
      const wallet = await createWallet({ name: 'Cold Storage' });

      await applyTradeToHolding(
        {
          direction: 'BUY',
          assetType: 'Bitcoin',
          unitPrice: 60000,
          quantity: 0.5,
          walletId: wallet.id,
        },
        30000, // usdAmount
        1, // multiplier
      );

      const holding = await prisma.investmentHolding.findFirst({
        where: { walletId: wallet.id, type: 'BITCOIN' },
      });

      expect(holding).toBeTruthy();
      expect(holding?.name).toBe('Cold Storage');
      expect(holding?.type).toBe('BITCOIN');
      expect(holding?.ticker).toBeNull();
      expect(Number(holding?.quantity)).toBe(0.5);
      expect(Number(holding?.costBasis)).toBe(30000);
    });
  });

  describe('SELL reversal (multiplier=-1)', () => {
    it('increments holding quantity and cost basis', async () => {
      const custodian = await createCustodian();

      // Create initial holding
      const holding = await prisma.investmentHolding.create({
        data: {
          name: custodian.name,
          type: 'STOCK',
          ticker: 'TSLA',
          quantity: 5,
          costBasis: 1000,
          custodianId: custodian.id,
        },
      });

      // Apply SELL with multiplier=-1 (reversal)
      await applyTradeToHolding(
        {
          direction: 'SELL',
          assetType: 'Stock',
          ticker: 'TSLA',
          unitPrice: 200,
          quantity: 3,
          custodianId: custodian.id,
        },
        600, // usdAmount
        -1, // multiplier (reversal)
      );

      const updated = await prisma.investmentHolding.findUnique({
        where: { id: holding.id },
      });

      // SELL reversal acts like BUY: increments quantity and cost basis
      expect(Number(updated?.quantity)).toBe(8); // 5 + 3
      expect(Number(updated?.costBasis)).toBe(1600); // 1000 + 600
    });
  });

  describe('BUY with Sats unit', () => {
    it('converts quantity to BTC before applying', async () => {
      const wallet = await createWallet();

      // Buy 50,000,000 sats (0.5 BTC)
      await applyTradeToHolding(
        {
          direction: 'BUY',
          assetType: 'Bitcoin',
          unitPrice: 60000,
          quantity: 50_000_000,
          bitcoinUnit: 'Sats',
          walletId: wallet.id,
        },
        30000, // usdAmount
        1, // multiplier
      );

      const holding = await prisma.investmentHolding.findFirst({
        where: { walletId: wallet.id, type: 'BITCOIN' },
      });

      expect(holding).toBeTruthy();
      // Quantity should be stored as BTC, not sats
      expect(Number(holding?.quantity)).toBe(0.5);
      expect(Number(holding?.costBasis)).toBe(30000);
    });
  });
});

describe('applyBitcoinToHolding', () => {
  describe('EXPENSE with no existing holding', () => {
    it('does not create a new holding (no-op)', async () => {
      const wallet = await createWallet();

      // Try to spend from a wallet with no holding
      await applyBitcoinToHolding(
        {
          walletId: wallet.id,
          quantity: 0.1,
          bitcoinUnit: 'Bitcoin',
          unitPrice: 60000,
        },
        'EXPENSE',
        6000, // usdAmount
        1, // multiplier
      );

      const holding = await prisma.investmentHolding.findFirst({
        where: { walletId: wallet.id, type: 'BITCOIN' },
      });

      // No holding should be created for EXPENSE with no existing holding
      expect(holding).toBeNull();
    });
  });

  describe('INCOME with no existing holding', () => {
    it('creates new holding with wallet name', async () => {
      const wallet = await createWallet({ name: 'Hot Wallet' });

      await applyBitcoinToHolding(
        {
          walletId: wallet.id,
          quantity: 0.25,
          bitcoinUnit: 'Bitcoin',
          unitPrice: 60000,
        },
        'INCOME',
        15000, // usdAmount
        1, // multiplier
      );

      const holding = await prisma.investmentHolding.findFirst({
        where: { walletId: wallet.id, type: 'BITCOIN' },
      });

      expect(holding).toBeTruthy();
      expect(holding?.name).toBe('Hot Wallet');
      expect(holding?.type).toBe('BITCOIN');
      expect(holding?.ticker).toBeNull();
      expect(Number(holding?.quantity)).toBe(0.25);
      expect(Number(holding?.costBasis)).toBe(15000);
    });
  });

  describe('REFUND with no existing holding', () => {
    it('creates new holding with wallet name', async () => {
      const wallet = await createWallet({ name: 'Refund Wallet' });

      await applyBitcoinToHolding(
        {
          walletId: wallet.id,
          quantity: 0.1,
          bitcoinUnit: 'Bitcoin',
          unitPrice: 60000,
        },
        'REFUND',
        6000, // usdAmount
        1, // multiplier
      );

      const holding = await prisma.investmentHolding.findFirst({
        where: { walletId: wallet.id, type: 'BITCOIN' },
      });

      expect(holding).toBeTruthy();
      expect(holding?.name).toBe('Refund Wallet');
      expect(Number(holding?.quantity)).toBe(0.1);
      expect(Number(holding?.costBasis)).toBe(6000);
    });
  });

  describe('EXPENSE with existing holding', () => {
    it('decrements quantity and proportional cost basis', async () => {
      const wallet = await createWallet();

      // Create initial holding
      const holding = await prisma.investmentHolding.create({
        data: {
          name: wallet.name,
          type: 'BITCOIN',
          ticker: null,
          quantity: 1.0,
          costBasis: 60000,
          walletId: wallet.id,
        },
      });

      // Spend 0.5 BTC
      await applyBitcoinToHolding(
        {
          walletId: wallet.id,
          quantity: 0.5,
          bitcoinUnit: 'Bitcoin',
          unitPrice: 65000,
        },
        'EXPENSE',
        32500, // usdAmount (not used for decrement, proportional cost basis is used)
        1, // multiplier
      );

      const updated = await prisma.investmentHolding.findUnique({
        where: { id: holding.id },
      });

      // Quantity should be decremented
      expect(Number(updated?.quantity)).toBe(0.5);
      // Cost basis should be proportionally reduced (0.5 / 1.0 * 60000 = 30000)
      expect(Number(updated?.costBasis)).toBe(30000);
    });
  });

  describe('INCOME with existing holding', () => {
    it('increments quantity and cost basis', async () => {
      const wallet = await createWallet();

      // Create initial holding
      const holding = await prisma.investmentHolding.create({
        data: {
          name: wallet.name,
          type: 'BITCOIN',
          ticker: null,
          quantity: 0.5,
          costBasis: 30000,
          walletId: wallet.id,
        },
      });

      // Receive 0.25 BTC
      await applyBitcoinToHolding(
        {
          walletId: wallet.id,
          quantity: 0.25,
          bitcoinUnit: 'Bitcoin',
          unitPrice: 60000,
        },
        'INCOME',
        15000, // usdAmount
        1, // multiplier
      );

      const updated = await prisma.investmentHolding.findUnique({
        where: { id: holding.id },
      });

      expect(Number(updated?.quantity)).toBe(0.75); // 0.5 + 0.25
      expect(Number(updated?.costBasis)).toBe(45000); // 30000 + 15000
    });
  });
});
