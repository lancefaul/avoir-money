import { describe, it, expect } from 'vitest';
import { post } from '../../../test/helpers.js';
import { createWallet, createHolding } from '../../../test/helpers.js';
import { prisma } from '@budget-tracker/db';

describe('Bitcoin Holding Lifecycle Hook', () => {
  async function seedWalletWithHolding(quantity = 2.0, costBasis = 100000) {
    const wallet = await createWallet();
    const holding = await createHolding({
      type: 'BITCOIN',
      ticker: null,
      quantity,
      costBasis,
      walletId: wallet.id,
    });
    return { wallet, holding };
  }

  describe('created event — EXPENSE payment', () => {
    it('decrements bitcoin holding quantity at the specified wallet', async () => {
      const { wallet, holding } = await seedWalletWithHolding(2.0, 100000);

      const res = await post('/transactions', {
        type: 'EXPENSE',
        name: 'BTC Purchase',
        amount: 0,
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        bitcoinMetadata: {
          walletId: wallet.id,
          quantity: 0.5,
          bitcoinUnit: 'Bitcoin',
          unitPrice: 60000,
        },
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();
      // Amount should be computed: 0.5 * 60000 = 30000
      expect(body.amount).toBe(30000);

      // Verify holding was decremented
      const updated = await prisma.investmentHolding.findUniqueOrThrow({
        where: { id: holding.id },
      });
      expect(Number(updated.quantity)).toBeCloseTo(1.5, 8); // 2.0 - 0.5
      // Cost basis should be decremented proportionally: (0.5/2.0) * 100000 = 25000
      expect(Number(updated.costBasis)).toBeCloseTo(75000, 2); // 100000 - 25000
    });
  });

  describe('created event — INCOME payment', () => {
    it('increments bitcoin holding quantity at the specified wallet', async () => {
      const { wallet, holding } = await seedWalletWithHolding(1.0, 50000);

      const res = await post('/transactions', {
        type: 'INCOME',
        name: 'BTC Received',
        amount: 0,
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        bitcoinMetadata: {
          walletId: wallet.id,
          quantity: 0.25,
          bitcoinUnit: 'Bitcoin',
          unitPrice: 60000,
        },
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();
      // Amount should be computed: 0.25 * 60000 = 15000
      expect(body.amount).toBe(15000);

      // Verify holding was incremented
      const updated = await prisma.investmentHolding.findUniqueOrThrow({
        where: { id: holding.id },
      });
      expect(Number(updated.quantity)).toBeCloseTo(1.25, 8); // 1.0 + 0.25
      // Cost basis should be incremented by the USD amount
      expect(Number(updated.costBasis)).toBeCloseTo(65000, 2); // 50000 + 15000
    });

    it('auto-creates holding when wallet has no existing holding', async () => {
      const wallet = await createWallet();

      const res = await post('/transactions', {
        type: 'INCOME',
        name: 'First BTC',
        amount: 0,
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        bitcoinMetadata: {
          walletId: wallet.id,
          quantity: 0.1,
          bitcoinUnit: 'Bitcoin',
          unitPrice: 65000,
        },
      });

      expect(res.status).toBe(201);

      // Verify a new holding was created
      const holding = await prisma.investmentHolding.findFirst({
        where: { type: 'BITCOIN', walletId: wallet.id, ticker: null },
      });
      expect(holding).not.toBeNull();
      expect(Number(holding!.quantity)).toBeCloseTo(0.1, 8);
      // Cost basis = 0.1 * 65000 = 6500
      expect(Number(holding!.costBasis)).toBeCloseTo(6500, 2);
    });
  });

  describe('created event — REFUND payment', () => {
    it('increments bitcoin holding quantity at the specified wallet (REFUND acts like INCOME)', async () => {
      const { wallet, holding } = await seedWalletWithHolding(1.0, 50000);

      const res = await post('/transactions', {
        type: 'REFUND',
        name: 'BTC Refund',
        amount: 0,
        date: new Date(Date.UTC(2026, 5, 15)).toISOString(),
        bitcoinMetadata: {
          walletId: wallet.id,
          quantity: 0.25,
          bitcoinUnit: 'Bitcoin',
          unitPrice: 60000,
        },
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();
      // Amount should be computed: 0.25 * 60000 = 15000
      expect(body.amount).toBe(15000);

      // Verify holding was incremented (REFUND acts like INCOME for holdings)
      const updated = await prisma.investmentHolding.findUniqueOrThrow({
        where: { id: holding.id },
      });
      expect(Number(updated.quantity)).toBeCloseTo(1.25, 8); // 1.0 + 0.25
      // Cost basis should be incremented by the USD amount
      expect(Number(updated.costBasis)).toBeCloseTo(65000, 2); // 50000 + 15000
    });
  });
});
