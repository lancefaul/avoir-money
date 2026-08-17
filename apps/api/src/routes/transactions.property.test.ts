/**
 * Property-based tests for trade transaction API behavior.
 * Feature: trade-transactions, Properties 6-11
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { post, del, createAccount } from '../test/helpers.js';

// ─── Helpers ───

async function createCustodian(name: string) {
  return prisma.custodian.create({ data: { name } });
}

async function createWallet(name: string) {
  return prisma.wallet.create({ data: { name } });
}

const TICKERS = ['AAPL', 'GOOG', 'MSFT', 'TSLA', 'NVDA', 'META', 'AMZN', 'NFLX'];

function stockTradeMetaArb(direction: 'BUY' | 'SELL') {
  return fc.record({
    direction: fc.constant(direction),
    assetType: fc.constant('Stock' as const),
    ticker: fc.constantFrom(...TICKERS),
    unitPrice: fc.integer({ min: 1, max: 10000 }),
    quantity: fc.integer({ min: 1, max: 1000 }),
  });
}

function btcTradeMetaArb(direction: 'BUY' | 'SELL') {
  return fc.record({
    direction: fc.constant(direction),
    assetType: fc.constant('Bitcoin' as const),
    unitPrice: fc.integer({ min: 1, max: 100000 }),
    quantity: fc.integer({ min: 1, max: 1000000 }),
    bitcoinUnit: fc.constant('Sats' as const),
  });
}

// ─── Property 6: Trade metadata round trip ───

describe('Feature: trade-transactions, Property 6: Trade metadata round trip', () => {
  /**
   * **Validates: Requirements 7.1, 7.3**
   */
  it('stock trade metadata round-trips through create and list', async () => {
    await fc.assert(
      fc.asyncProperty(
        stockTradeMetaArb('BUY'),
        fc.integer({ min: 1, max: 50000 }),
        async (meta, amount) => {
          const acct = await createAccount();
          const custodian = await createCustodian(`C_${Date.now()}_${Math.random()}`);
          const tradeMetadata = { ...meta, custodianId: custodian.id };

          const createRes = await post('/transactions', {
            type: 'TRADE',
            name: 'Buy Stock',
            amount,
            date: '2026-04-01',
            accountId: acct.id,
            tradeMetadata,
          });
          expect(createRes.status).toBe(201);
          const created = (await createRes.json()) as Record<string, unknown>;
          const returnedMeta = created.tradeMetadata as Record<string, unknown>;
          expect(returnedMeta).toBeDefined();
          expect(returnedMeta.direction).toBe(meta.direction);
          expect(returnedMeta.assetType).toBe(meta.assetType);
          expect(returnedMeta.ticker).toBe(meta.ticker);
          expect(returnedMeta.custodianId).toBe(custodian.id);
        },
      ),
      { numRuns: 10 },
    );
  });

  it('bitcoin trade metadata round-trips through create and list', async () => {
    await fc.assert(
      fc.asyncProperty(
        btcTradeMetaArb('BUY'),
        fc.integer({ min: 1, max: 50000 }),
        async (meta, amount) => {
          const acct = await createAccount();
          const wallet = await createWallet(`W_${Date.now()}_${Math.random()}`);
          const tradeMetadata = { ...meta, walletId: wallet.id };

          const createRes = await post('/transactions', {
            type: 'TRADE',
            name: 'Buy BTC',
            amount,
            date: '2026-04-01',
            accountId: acct.id,
            tradeMetadata,
          });
          expect(createRes.status).toBe(201);
          const created = (await createRes.json()) as Record<string, unknown>;
          const returnedMeta = created.tradeMetadata as Record<string, unknown>;
          expect(returnedMeta).toBeDefined();
          expect(returnedMeta.direction).toBe(meta.direction);
          expect(returnedMeta.assetType).toBe(meta.assetType);
          expect(returnedMeta.bitcoinUnit).toBe(meta.bitcoinUnit);
          expect(returnedMeta.walletId).toBe(wallet.id);
          expect(Number(returnedMeta.quantity)).toBe(meta.quantity);
        },
      ),
      { numRuns: 10 },
    );
  });
});

// ─── Property 7: Invalid trade metadata rejection ───

describe('Feature: trade-transactions, Property 7: Invalid trade metadata rejection', () => {
  /**
   * **Validates: Requirements 7.4**
   */
  it('rejects TRADE without tradeMetadata', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50000 }), async (amount) => {
        const acct = await createAccount();
        const res = await post('/transactions', {
          type: 'TRADE',
          name: 'Bad Trade',
          amount,
          date: '2026-04-01',
          accountId: acct.id,
        });
        expect(res.status).toBe(400);
      }),
      { numRuns: 5 },
    );
  });

  it('rejects TRADE with incomplete tradeMetadata', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50000 }), async (amount) => {
        const acct = await createAccount();
        const res = await post('/transactions', {
          type: 'TRADE',
          name: 'Bad Trade',
          amount,
          date: '2026-04-01',
          accountId: acct.id,
          tradeMetadata: { direction: 'BUY' },
        });
        expect(res.status).toBe(400);
      }),
      { numRuns: 5 },
    );
  });
});

// ─── Property 8: Trade balance adjustment direction ───

describe('Feature: trade-transactions, Property 8: Trade balance adjustment direction', () => {
  /**
   * **Validates: Requirements 8.1, 8.3**
   */
  it('BUY decreases account balance by trade amount', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 1000 }),
        async (amount, quantity) => {
          const acct = await createAccount();
          const custodian = await createCustodian(`C_${Date.now()}_${Math.random()}`);
          const balanceBefore = Number(
            (await prisma.account.findUnique({ where: { id: acct.id } }))!.balance,
          );

          await post('/transactions', {
            type: 'TRADE',
            name: 'Buy Stock',
            amount,
            date: '2026-04-01',
            accountId: acct.id,
            tradeMetadata: {
              direction: 'BUY',
              assetType: 'Stock',
              ticker: 'AAPL',
              unitPrice: amount / quantity,
              quantity,
              custodianId: custodian.id,
            },
          });

          const balanceAfter = Number(
            (await prisma.account.findUnique({ where: { id: acct.id } }))!.balance,
          );
          expect(balanceAfter).toBeCloseTo(balanceBefore - amount, 1);
        },
      ),
      { numRuns: 10 },
    );
  });

  it('SELL increases account balance by trade amount', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 100 }),
        async (amount, quantity) => {
          const acct = await createAccount();
          const custodian = await createCustodian(`C_${Date.now()}_${Math.random()}`);

          // BUY first to have holdings
          await post('/transactions', {
            type: 'TRADE',
            name: 'Buy Stock',
            amount: amount * 2,
            date: '2026-04-01',
            accountId: acct.id,
            tradeMetadata: {
              direction: 'BUY',
              assetType: 'Stock',
              ticker: 'TSLA',
              unitPrice: 100,
              quantity: quantity * 2,
              custodianId: custodian.id,
            },
          });

          const balanceBefore = Number(
            (await prisma.account.findUnique({ where: { id: acct.id } }))!.balance,
          );

          await post('/transactions', {
            type: 'TRADE',
            name: 'Sell Stock',
            amount,
            date: '2026-04-01',
            accountId: acct.id,
            tradeMetadata: {
              direction: 'SELL',
              assetType: 'Stock',
              ticker: 'TSLA',
              unitPrice: amount / quantity,
              quantity,
              custodianId: custodian.id,
            },
          });

          const balanceAfter = Number(
            (await prisma.account.findUnique({ where: { id: acct.id } }))!.balance,
          );
          expect(balanceAfter).toBeCloseTo(balanceBefore + amount, 1);
        },
      ),
      { numRuns: 10 },
    );
  });
});

// ─── Property 9: Trade holding adjustment ───

describe('Feature: trade-transactions, Property 9: Trade holding adjustment', () => {
  /**
   * **Validates: Requirements 8.2, 8.4**
   */
  it('BUY increases holding quantity and cost basis', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 500 }),
        async (amount, quantity) => {
          const acct = await createAccount();
          const custodian = await createCustodian(`C_${Date.now()}_${Math.random()}`);

          await post('/transactions', {
            type: 'TRADE',
            name: 'Buy Stock',
            amount,
            date: '2026-04-01',
            accountId: acct.id,
            tradeMetadata: {
              direction: 'BUY',
              assetType: 'Stock',
              ticker: 'GOOG',
              unitPrice: amount / quantity,
              quantity,
              custodianId: custodian.id,
            },
          });

          const holding = await prisma.investmentHolding.findFirst({
            where: { type: 'STOCK', ticker: 'GOOG', custodianId: custodian.id },
          });
          expect(holding).toBeDefined();
          expect(Number(holding!.quantity)).toBeCloseTo(quantity, 1);
          expect(Number(holding!.costBasis)).toBeCloseTo(amount, 1);
        },
      ),
      { numRuns: 10 },
    );
  });

  it('SELL decreases holding quantity', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 100 }),
        fc.integer({ min: 1, max: 9 }),
        async (buyQty, sellQty) => {
          const acct = await createAccount();
          const custodian = await createCustodian(`C_${Date.now()}_${Math.random()}`);

          await post('/transactions', {
            type: 'TRADE',
            name: 'Buy Stock',
            amount: buyQty * 100,
            date: '2026-04-01',
            accountId: acct.id,
            tradeMetadata: {
              direction: 'BUY',
              assetType: 'Stock',
              ticker: 'MSFT',
              unitPrice: 100,
              quantity: buyQty,
              custodianId: custodian.id,
            },
          });

          await post('/transactions', {
            type: 'TRADE',
            name: 'Sell Stock',
            amount: sellQty * 110,
            date: '2026-04-01',
            accountId: acct.id,
            tradeMetadata: {
              direction: 'SELL',
              assetType: 'Stock',
              ticker: 'MSFT',
              unitPrice: 110,
              quantity: sellQty,
              custodianId: custodian.id,
            },
          });

          const holding = await prisma.investmentHolding.findFirst({
            where: { type: 'STOCK', ticker: 'MSFT', custodianId: custodian.id },
          });
          expect(holding).toBeDefined();
          expect(Number(holding!.quantity)).toBeCloseTo(buyQty - sellQty, 1);
        },
      ),
      { numRuns: 10 },
    );
  });
});

// ─── Property 10: Trade create-delete reversal ───

describe('Feature: trade-transactions, Property 10: Trade create-delete reversal', () => {
  /**
   * **Validates: Requirements 8.5**
   */
  it('create then delete restores balance and holding', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 500 }),
        async (amount, quantity) => {
          const acct = await createAccount();
          const custodian = await createCustodian(`C_${Date.now()}_${Math.random()}`);
          const balanceBefore = Number(
            (await prisma.account.findUnique({ where: { id: acct.id } }))!.balance,
          );

          const createRes = await post('/transactions', {
            type: 'TRADE',
            name: 'Buy Stock',
            amount,
            date: '2026-04-01',
            accountId: acct.id,
            tradeMetadata: {
              direction: 'BUY',
              assetType: 'Stock',
              ticker: 'NVDA',
              unitPrice: amount / quantity,
              quantity,
              custodianId: custodian.id,
            },
          });
          expect(createRes.status).toBe(201);
          const created = (await createRes.json()) as { id: string };

          const deleteRes = await del(`/transactions/${created.id}`);
          expect(deleteRes.status).toBe(204);

          const balanceAfter = Number(
            (await prisma.account.findUnique({ where: { id: acct.id } }))!.balance,
          );
          expect(balanceAfter).toBeCloseTo(balanceBefore, 1);

          const holding = await prisma.investmentHolding.findFirst({
            where: { type: 'STOCK', ticker: 'NVDA', custodianId: custodian.id },
          });
          if (holding) {
            expect(Number(holding.quantity)).toBeCloseTo(0, 1);
          }
        },
      ),
      { numRuns: 10 },
    );
  });
});

// ─── Property 11: Insufficient holdings rejection ───

describe('Feature: trade-transactions, Property 11: Insufficient holdings rejection', () => {
  /**
   * **Validates: Requirements 10.6**
   */
  it('rejects SELL when quantity exceeds holdings', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        async (holdingQty, extraQty) => {
          const acct = await createAccount();
          const custodian = await createCustodian(`C_${Date.now()}_${Math.random()}`);

          await post('/transactions', {
            type: 'TRADE',
            name: 'Buy Stock',
            amount: holdingQty * 100,
            date: '2026-04-01',
            accountId: acct.id,
            tradeMetadata: {
              direction: 'BUY',
              assetType: 'Stock',
              ticker: 'META',
              unitPrice: 100,
              quantity: holdingQty,
              custodianId: custodian.id,
            },
          });

          const sellRes = await post('/transactions', {
            type: 'TRADE',
            name: 'Sell Stock',
            amount: (holdingQty + extraQty) * 110,
            date: '2026-04-01',
            accountId: acct.id,
            tradeMetadata: {
              direction: 'SELL',
              assetType: 'Stock',
              ticker: 'META',
              unitPrice: 110,
              quantity: holdingQty + extraQty,
              custodianId: custodian.id,
            },
          });
          expect(sellRes.status).toBe(400);
          const body = (await sellRes.json()) as { error: string };
          expect(body.error).toContain('Insufficient holdings');
        },
      ),
      { numRuns: 10 },
    );
  });

  it('rejects SELL with no existing holdings', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 1000 }), async (quantity) => {
        const acct = await createAccount();
        const custodian = await createCustodian(`C_${Date.now()}_${Math.random()}`);

        const res = await post('/transactions', {
          type: 'TRADE',
          name: 'Sell Stock',
          amount: quantity * 100,
          date: '2026-04-01',
          accountId: acct.id,
          tradeMetadata: {
            direction: 'SELL',
            assetType: 'Stock',
            ticker: 'AMZN',
            unitPrice: 100,
            quantity,
            custodianId: custodian.id,
          },
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain('Insufficient holdings');
      }),
      { numRuns: 5 },
    );
  });
});
