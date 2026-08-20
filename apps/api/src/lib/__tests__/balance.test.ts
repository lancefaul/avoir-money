import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { applyTransactionToBalances } from '../balance.js';

describe('applyTransactionToBalances', () => {
  async function createAcct(balance = 1000) {
    return prisma.account.create({
      data: { name: `BAL_${Date.now()}`, type: 'CHECKING', balance },
    });
  }

  async function getBalance(id: string) {
    const acct = await prisma.account.findUnique({ where: { id } });
    return Number(acct!.balance);
  }

  describe('INCOME', () => {
    it('increments account balance', async () => {
      const acct = await createAcct(1000);
      await applyTransactionToBalances({
        type: 'INCOME',
        amount: 500,
        accountId: acct.id,
        toAccountId: null,
      });
      expect(await getBalance(acct.id)).toBe(1500);
    });

    it('reverses with multiplier -1', async () => {
      const acct = await createAcct(1000);
      await applyTransactionToBalances(
        { type: 'INCOME', amount: 500, accountId: acct.id, toAccountId: null },
        -1,
      );
      expect(await getBalance(acct.id)).toBe(500);
    });
  });

  describe('REFUND', () => {
    it('increments account balance like income', async () => {
      const acct = await createAcct(1000);
      await applyTransactionToBalances({
        type: 'REFUND',
        amount: 200,
        accountId: acct.id,
        toAccountId: null,
      });
      expect(await getBalance(acct.id)).toBe(1200);
    });
  });

  describe('EXPENSE', () => {
    it('decrements account balance', async () => {
      const acct = await createAcct(1000);
      await applyTransactionToBalances({
        type: 'EXPENSE',
        amount: 300,
        accountId: acct.id,
        toAccountId: null,
      });
      expect(await getBalance(acct.id)).toBe(700);
    });

    it('reverses with multiplier -1', async () => {
      const acct = await createAcct(1000);
      await applyTransactionToBalances(
        { type: 'EXPENSE', amount: 300, accountId: acct.id, toAccountId: null },
        -1,
      );
      expect(await getBalance(acct.id)).toBe(1300);
    });
  });

  describe('TRANSFER', () => {
    it('decrements source and increments destination', async () => {
      const from = await createAcct(1000);
      const to = await createAcct(500);
      await applyTransactionToBalances({
        type: 'TRANSFER',
        amount: 200,
        accountId: from.id,
        toAccountId: to.id,
      });
      expect(await getBalance(from.id)).toBe(800);
      expect(await getBalance(to.id)).toBe(700);
    });

    it('reverses transfer with multiplier -1', async () => {
      const from = await createAcct(1000);
      const to = await createAcct(500);
      await applyTransactionToBalances(
        { type: 'TRANSFER', amount: 200, accountId: from.id, toAccountId: to.id },
        -1,
      );
      expect(await getBalance(from.id)).toBe(1200);
      expect(await getBalance(to.id)).toBe(300);
    });
  });

  describe('TRADE', () => {
    it('BUY decrements account balance', async () => {
      const acct = await createAcct(5000);
      await applyTransactionToBalances({
        type: 'TRADE',
        amount: 1000,
        accountId: acct.id,
        toAccountId: null,
        tradeDetail: { direction: 'BUY' },
      });
      expect(await getBalance(acct.id)).toBe(4000);
    });

    it('SELL increments account balance', async () => {
      const acct = await createAcct(5000);
      await applyTransactionToBalances({
        type: 'TRADE',
        amount: 1000,
        accountId: acct.id,
        toAccountId: null,
        tradeDetail: { direction: 'SELL' },
      });
      expect(await getBalance(acct.id)).toBe(6000);
    });
  });

  describe('Decimal amount support', () => {
    it('handles Decimal-like objects with toNumber()', async () => {
      const acct = await createAcct(1000);
      await applyTransactionToBalances({
        type: 'INCOME',
        amount: { toNumber: () => 250 },
        accountId: acct.id,
        toAccountId: null,
      });
      expect(await getBalance(acct.id)).toBe(1250);
    });
  });

  describe('null accountId', () => {
    it('skips balance update when accountId is null', async () => {
      await applyTransactionToBalances({
        type: 'EXPENSE',
        amount: 500,
        accountId: null,
        toAccountId: null,
      });
      // No error thrown — early return
    });
  });

  describe('TRANSFER with null toAccountId', () => {
    it('decrements source but does not throw when toAccountId is null', async () => {
      const from = await createAcct(1000);
      await applyTransactionToBalances({
        type: 'TRANSFER',
        amount: 200,
        accountId: from.id,
        toAccountId: null,
      });
      expect(await getBalance(from.id)).toBe(800);
    });
  });

  describe('TRADE with no direction', () => {
    it('does nothing when tradeDetail has an unrecognized direction', async () => {
      const acct = await createAcct(1000);
      await applyTransactionToBalances({
        type: 'TRADE',
        amount: 500,
        accountId: acct.id,
        toAccountId: null,
        tradeDetail: { direction: '' },
      });
      expect(await getBalance(acct.id)).toBe(1000);
    });

    it('does nothing when tradeDetail is null', async () => {
      const acct = await createAcct(1000);
      await applyTransactionToBalances({
        type: 'TRADE',
        amount: 500,
        accountId: acct.id,
        toAccountId: null,
        tradeDetail: null,
      });
      expect(await getBalance(acct.id)).toBe(1000);
    });
  });

  describe('netAmount support', () => {
    it('uses netAmount when provided as a number', async () => {
      const acct = await createAcct(1000);
      await applyTransactionToBalances({
        type: 'EXPENSE',
        amount: 500,
        netAmount: 400,
        accountId: acct.id,
        toAccountId: null,
      });
      // Should use netAmount (400) instead of amount (500)
      expect(await getBalance(acct.id)).toBe(600);
    });

    it('uses netAmount when provided as a Decimal-like object', async () => {
      const acct = await createAcct(1000);
      await applyTransactionToBalances({
        type: 'INCOME',
        amount: 500,
        netAmount: { toNumber: () => 300 },
        accountId: acct.id,
        toAccountId: null,
      });
      // Should use netAmount (300) instead of amount (500)
      expect(await getBalance(acct.id)).toBe(1300);
    });
  });

  describe('unknown transaction type', () => {
    it('does nothing for an unrecognized type', async () => {
      const acct = await createAcct(1000);
      await applyTransactionToBalances({
        type: 'UNKNOWN',
        amount: 500,
        accountId: acct.id,
        toAccountId: null,
      });
      expect(await getBalance(acct.id)).toBe(1000);
    });
  });
});
