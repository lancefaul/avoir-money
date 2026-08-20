import { describe, it, expect } from 'vitest';
import { get, createAccount } from '../test/helpers.js';
import { prisma } from '@budget-tracker/db';
import type { HistoryEntry } from '@budget-tracker/core';

interface HistoryResponse {
  entries: HistoryEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Task 2.3: Unit tests for asset type casing mapping
 * Validates: Requirements 4.1, 4.2, 5.1, 5.2
 */
describe('Investment History - assetType filtering', () => {
  // ─── Trade filtering (Requirements 4.1, 4.2) ───

  describe('trade assetType filter', () => {
    it('BITCOIN maps to tradeMetadata.assetType === "Bitcoin"', async () => {
      const account = await createAccount();

      // Create a Bitcoin trade
      await prisma.transaction.create({
        data: {
          type: 'TRADE',
          name: 'Buy BTC',
          amount: 5000,
          date: new Date('2026-01-15'),
          accountId: account.id,
          tradeDetail: {
            create: { direction: 'BUY', assetType: 'Bitcoin', quantity: 0.05, unitPrice: 100000 },
          },
        },
      });

      // Create a Stock trade (should be excluded)
      await prisma.transaction.create({
        data: {
          type: 'TRADE',
          name: 'Buy AAPL',
          amount: 1500,
          date: new Date('2026-01-16'),
          accountId: account.id,
          tradeDetail: {
            create: {
              direction: 'BUY',
              assetType: 'Stock',
              ticker: 'AAPL',
              quantity: 10,
              unitPrice: 150,
            },
          },
        },
      });

      const res = await get('/investments/history?type=TRADE&assetType=BITCOIN');
      expect(res.status).toBe(200);
      const body = (await res.json()) as HistoryResponse;

      expect(body.entries.length).toBe(1);
      expect(body.entries[0]!.assetType).toBe('BITCOIN');
      expect(body.entries[0]!.description).toContain('BTC');
    });

    it('STOCK maps to tradeMetadata.assetType === "Stock"', async () => {
      const account = await createAccount();

      // Create a Stock trade
      await prisma.transaction.create({
        data: {
          type: 'TRADE',
          name: 'Buy AAPL',
          amount: 1500,
          date: new Date('2026-01-16'),
          accountId: account.id,
          tradeDetail: {
            create: {
              direction: 'BUY',
              assetType: 'Stock',
              ticker: 'AAPL',
              quantity: 10,
              unitPrice: 150,
            },
          },
        },
      });

      // Create a Bitcoin trade (should be excluded)
      await prisma.transaction.create({
        data: {
          type: 'TRADE',
          name: 'Buy BTC',
          amount: 5000,
          date: new Date('2026-01-15'),
          accountId: account.id,
          tradeDetail: {
            create: { direction: 'BUY', assetType: 'Bitcoin', quantity: 0.05, unitPrice: 100000 },
          },
        },
      });

      const res = await get('/investments/history?type=TRADE&assetType=STOCK');
      expect(res.status).toBe(200);
      const body = (await res.json()) as HistoryResponse;

      expect(body.entries.length).toBe(1);
      expect(body.entries[0]!.assetType).toBe('STOCK');
      expect(body.entries[0]!.ticker).toBe('AAPL');
    });
  });

  // ─── Transfer filtering (Requirements 5.1, 5.2) ───

  describe('transfer assetType filter', () => {
    it('BITCOIN filters transfers by type directly', async () => {
      // Create wallets and holdings for bitcoin transfer
      const w1 = await prisma.wallet.create({ data: { name: 'Wallet A' } });
      const w2 = await prisma.wallet.create({ data: { name: 'Wallet B' } });
      const btcHolding1 = await prisma.investmentHolding.create({
        data: { name: 'BTC W1', type: 'BITCOIN', quantity: 1, walletId: w1.id },
      });
      const btcHolding2 = await prisma.investmentHolding.create({
        data: { name: 'BTC W2', type: 'BITCOIN', quantity: 0, walletId: w2.id },
      });

      // Create a BITCOIN transfer
      await prisma.investmentTransfer.create({
        data: {
          type: 'BITCOIN',
          fromHoldingId: btcHolding1.id,
          toHoldingId: btcHolding2.id,
          quantity: 0.1,
          ticker: null,
          createdAt: new Date('2026-02-01'),
        },
      });

      // Create custodians and holdings for stock transfer
      const c1 = await prisma.custodian.create({ data: { name: 'Custodian A' } });
      const c2 = await prisma.custodian.create({ data: { name: 'Custodian B' } });
      const stockHolding1 = await prisma.investmentHolding.create({
        data: { name: 'AAPL C1', type: 'STOCK', ticker: 'AAPL', quantity: 10, custodianId: c1.id },
      });
      const stockHolding2 = await prisma.investmentHolding.create({
        data: { name: 'AAPL C2', type: 'STOCK', ticker: 'AAPL', quantity: 0, custodianId: c2.id },
      });

      // Create a STOCK transfer (should be excluded)
      await prisma.investmentTransfer.create({
        data: {
          type: 'STOCK',
          fromHoldingId: stockHolding1.id,
          toHoldingId: stockHolding2.id,
          quantity: 5,
          ticker: 'AAPL',
          createdAt: new Date('2026-02-02'),
        },
      });

      const res = await get('/investments/history?type=TRANSFER&assetType=BITCOIN');
      expect(res.status).toBe(200);
      const body = (await res.json()) as HistoryResponse;

      expect(body.entries.length).toBe(1);
      expect(body.entries[0]!.assetType).toBe('BITCOIN');
      expect(body.entries[0]!.entryType).toBe('TRANSFER');
    });

    it('STOCK filters transfers by type directly', async () => {
      // Create wallets and holdings for bitcoin transfer
      const w1 = await prisma.wallet.create({ data: { name: 'Wallet A' } });
      const w2 = await prisma.wallet.create({ data: { name: 'Wallet B' } });
      const btcHolding1 = await prisma.investmentHolding.create({
        data: { name: 'BTC W1', type: 'BITCOIN', quantity: 1, walletId: w1.id },
      });
      const btcHolding2 = await prisma.investmentHolding.create({
        data: { name: 'BTC W2', type: 'BITCOIN', quantity: 0, walletId: w2.id },
      });

      // Create a BITCOIN transfer (should be excluded)
      await prisma.investmentTransfer.create({
        data: {
          type: 'BITCOIN',
          fromHoldingId: btcHolding1.id,
          toHoldingId: btcHolding2.id,
          quantity: 0.1,
          ticker: null,
          createdAt: new Date('2026-02-01'),
        },
      });

      // Create custodians and holdings for stock transfer
      const c1 = await prisma.custodian.create({ data: { name: 'Custodian A' } });
      const c2 = await prisma.custodian.create({ data: { name: 'Custodian B' } });
      const stockHolding1 = await prisma.investmentHolding.create({
        data: { name: 'AAPL C1', type: 'STOCK', ticker: 'AAPL', quantity: 10, custodianId: c1.id },
      });
      const stockHolding2 = await prisma.investmentHolding.create({
        data: { name: 'AAPL C2', type: 'STOCK', ticker: 'AAPL', quantity: 0, custodianId: c2.id },
      });

      // Create a STOCK transfer
      await prisma.investmentTransfer.create({
        data: {
          type: 'STOCK',
          fromHoldingId: stockHolding1.id,
          toHoldingId: stockHolding2.id,
          quantity: 5,
          ticker: 'AAPL',
          createdAt: new Date('2026-02-02'),
        },
      });

      const res = await get('/investments/history?type=TRANSFER&assetType=STOCK');
      expect(res.status).toBe(200);
      const body = (await res.json()) as HistoryResponse;

      expect(body.entries.length).toBe(1);
      expect(body.entries[0]!.assetType).toBe('STOCK');
      expect(body.entries[0]!.entryType).toBe('TRANSFER');
    });
  });
});
