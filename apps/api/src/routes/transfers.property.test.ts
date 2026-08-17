/**
 * Property-based tests for bitcoin transfer API.
 * Feature: investment-transfers
 *
 * Properties tested:
 * - Property 1: Bitcoin transfer conservation (quantity + cost basis)
 * - Property 4: Insufficient balance rejection
 * - Property 7: Bitcoin transfers produce no transaction log entries
 */
import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { post } from '../test/helpers.js';

// ─── Cleanup helper ───

/** IDs accumulated during a test run, cleaned up in afterEach */
const createdTransferIds: string[] = [];
const createdHoldingIds: string[] = [];
const createdWalletIds: string[] = [];

afterEach(async () => {
  // Clean up InvestmentTransfer records (no FK cascade from truncate)
  if (createdTransferIds.length > 0) {
    await prisma.investmentTransfer.deleteMany({
      where: { id: { in: createdTransferIds } },
    });
    createdTransferIds.length = 0;
  }
  createdHoldingIds.length = 0;
  createdWalletIds.length = 0;
});

// ─── Helpers ───

async function createWallet(name: string) {
  const w = await prisma.wallet.create({ data: { name } });
  createdWalletIds.push(w.id);
  return w;
}

async function createBtcHolding(walletId: string, quantity: number, costBasis: number) {
  const h = await prisma.investmentHolding.create({
    data: {
      name: `BTC_${walletId.slice(0, 6)}`,
      ticker: 'BTC',
      type: 'BITCOIN',
      quantity,
      costBasis,
      walletId,
    },
  });
  createdHoldingIds.push(h.id);
  return h;
}

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Generators ───

/** Source holding quantity: reasonable BTC amounts (0.001 to 100 BTC) */
const sourceQtyArb = fc.double({ min: 0.001, max: 100, noNaN: true, noDefaultInfinity: true });

/** Cost basis: $0 to $10,000,000 */
const costBasisArb = fc.double({ min: 0, max: 10_000_000, noNaN: true, noDefaultInfinity: true });

/** Bitcoin price: $100 to $1,000,000 */
const btcPriceArb = fc.double({ min: 100, max: 1_000_000, noNaN: true, noDefaultInfinity: true });

// ─── Property 1: Bitcoin transfer conservation ───

describe('Feature: investment-transfers, Property 1: Bitcoin transfer conservation', () => {
  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * For any valid bitcoin transfer with quantity Q from a source holding with
   * quantity S and cost basis CB_s, and a destination holding with quantity D
   * and cost basis CB_d:
   * - After transfer: source.quantity + dest.quantity = S + D - fee (quantity conserved minus fee)
   * - After transfer: source.costBasis + dest.costBasis = CB_s + CB_d (cost basis conserved)
   */
  it('quantity and cost basis are conserved across bitcoin transfers', async () => {
    await fc.assert(
      fc.asyncProperty(
        sourceQtyArb,
        costBasisArb,
        btcPriceArb,
        async (sourceQty, sourceCostBasis, bitcoinPrice) => {
          // Transfer a fraction of the source (between 10% and 90%)
          const fraction = 0.1 + Math.random() * 0.8;
          const transferQty = sourceQty * fraction;

          // Create two wallets
          const srcWallet = await createWallet(`Src_${uid()}`);
          const dstWallet = await createWallet(`Dst_${uid()}`);

          // Create source holding with known quantity and cost basis
          await createBtcHolding(srcWallet.id, sourceQty, sourceCostBasis);

          // Destination starts with some existing BTC (or zero)
          const destInitialQty = 0.5;
          const destInitialCostBasis = 25000;
          await createBtcHolding(dstWallet.id, destInitialQty, destInitialCostBasis);

          const totalQtyBefore = sourceQty + destInitialQty;
          const totalCostBasisBefore = sourceCostBasis + destInitialCostBasis;

          // Execute transfer via API (no fee for conservation test)
          const res = await post('/investments/transfers/bitcoin', {
            fromWalletId: srcWallet.id,
            toWalletId: dstWallet.id,
            quantity: transferQty,
            bitcoinUnit: 'Bitcoin',
            bitcoinPrice,
          });

          expect(res.status).toBe(200);
          const body = (await res.json()) as { id: string };
          createdTransferIds.push(body.id);

          // Read holdings after transfer
          const srcHolding = await prisma.investmentHolding.findFirst({
            where: { walletId: srcWallet.id, ticker: 'BTC' },
          });
          const dstHolding = await prisma.investmentHolding.findFirst({
            where: { walletId: dstWallet.id, ticker: 'BTC' },
          });

          expect(srcHolding).not.toBeNull();
          expect(dstHolding).not.toBeNull();

          const srcQtyAfter = Number(srcHolding!.quantity);
          const dstQtyAfter = Number(dstHolding!.quantity);
          const srcCbAfter = Number(srcHolding!.costBasis ?? 0);
          const dstCbAfter = Number(dstHolding!.costBasis ?? 0);

          const totalQtyAfter = srcQtyAfter + dstQtyAfter;
          const totalCostBasisAfter = srcCbAfter + dstCbAfter;

          // Quantity conservation: total after = total before (no fee)
          expect(totalQtyAfter).toBeCloseTo(totalQtyBefore, 8);

          // Cost basis conservation: total cost basis is preserved
          expect(totalCostBasisAfter).toBeCloseTo(totalCostBasisBefore, 4);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('quantity conservation holds with fees (total = before - feeBtc)', async () => {
    await fc.assert(
      fc.asyncProperty(
        sourceQtyArb,
        costBasisArb,
        btcPriceArb,
        async (sourceQty, sourceCostBasis, bitcoinPrice) => {
          // Transfer 30% of source, fee is 1% of source
          const transferQty = sourceQty * 0.3;
          const feeAmount = sourceQty * 0.01;

          // Ensure source can cover transfer + fee
          if (transferQty + feeAmount > sourceQty) return;

          const srcWallet = await createWallet(`SrcF_${uid()}`);
          const dstWallet = await createWallet(`DstF_${uid()}`);

          await createBtcHolding(srcWallet.id, sourceQty, sourceCostBasis);

          const totalQtyBefore = sourceQty;

          const res = await post('/investments/transfers/bitcoin', {
            fromWalletId: srcWallet.id,
            toWalletId: dstWallet.id,
            quantity: transferQty,
            bitcoinUnit: 'Bitcoin',
            bitcoinPrice,
            feeAmount,
            feeUnit: 'Bitcoin',
          });

          expect(res.status).toBe(200);
          const body = (await res.json()) as { id: string };
          createdTransferIds.push(body.id);

          const srcHolding = await prisma.investmentHolding.findFirst({
            where: { walletId: srcWallet.id, type: 'BITCOIN' },
          });
          const dstHolding = await prisma.investmentHolding.findFirst({
            where: { walletId: dstWallet.id, type: 'BITCOIN' },
          });

          const srcQtyAfter = Number(srcHolding!.quantity);
          const dstQtyAfter = Number(dstHolding!.quantity);

          // Total after = total before - fee (fee is burned from source)
          expect(srcQtyAfter + dstQtyAfter).toBeCloseTo(totalQtyBefore - feeAmount, 8);

          // Cost basis is still conserved (fee doesn't affect cost basis)
          const srcCbAfter = Number(srcHolding!.costBasis ?? 0);
          const dstCbAfter = Number(dstHolding!.costBasis ?? 0);
          expect(srcCbAfter + dstCbAfter).toBeCloseTo(sourceCostBasis, 4);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 4: Insufficient balance rejection ───

describe('Feature: investment-transfers, Property 4: Insufficient balance rejection', () => {
  /**
   * **Validates: Requirements 1.4, 4.4**
   *
   * For any bitcoin transfer where quantity exceeds the source holding balance,
   * the Transfer_API rejects the request with a 400 status.
   */
  it('rejects bitcoin transfers exceeding source balance with 400', async () => {
    await fc.assert(
      fc.asyncProperty(sourceQtyArb, btcPriceArb, async (sourceQty, bitcoinPrice) => {
        // Transfer amount exceeds source by at least 0.001 BTC
        const excessQty = sourceQty + 0.001 + Math.random() * 10;

        const srcWallet = await createWallet(`SrcEx_${uid()}`);
        const dstWallet = await createWallet(`DstEx_${uid()}`);

        await createBtcHolding(srcWallet.id, sourceQty, 50000);

        const res = await post('/investments/transfers/bitcoin', {
          fromWalletId: srcWallet.id,
          toWalletId: dstWallet.id,
          quantity: excessQty,
          bitcoinUnit: 'Bitcoin',
          bitcoinPrice,
        });

        expect(res.status).toBe(400);

        const body = (await res.json()) as { error: string };
        expect(body.error).toContain('Insufficient balance');
      }),
      { numRuns: 20 },
    );
  });

  it('rejects bitcoin transfers where quantity + fee exceeds source balance', async () => {
    await fc.assert(
      fc.asyncProperty(sourceQtyArb, btcPriceArb, async (sourceQty, bitcoinPrice) => {
        // Transfer almost all, but fee pushes it over
        const transferQty = sourceQty * 0.95;
        const feeAmount = sourceQty * 0.1; // 10% fee on top of 95% transfer = 105% > 100%

        const srcWallet = await createWallet(`SrcFEx_${uid()}`);
        const dstWallet = await createWallet(`DstFEx_${uid()}`);

        await createBtcHolding(srcWallet.id, sourceQty, 50000);

        const res = await post('/investments/transfers/bitcoin', {
          fromWalletId: srcWallet.id,
          toWalletId: dstWallet.id,
          quantity: transferQty,
          bitcoinUnit: 'Bitcoin',
          bitcoinPrice,
          feeAmount,
          feeUnit: 'Bitcoin',
        });

        expect(res.status).toBe(400);

        const body = (await res.json()) as { error: string };
        expect(body.error).toContain('Insufficient balance');
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 7: Bitcoin transfers produce no transaction log entries ───

describe('Feature: investment-transfers, Property 7: Bitcoin transfers produce no transaction log entries', () => {
  /**
   * **Validates: Requirements 2.6**
   *
   * For any bitcoin transfer (with or without fees), the number of Transaction
   * records in the database does not change. Bitcoin fees are tracked within
   * the investments domain only.
   */
  it('bitcoin transfers do not create Transaction records', async () => {
    await fc.assert(
      fc.asyncProperty(
        sourceQtyArb,
        costBasisArb,
        btcPriceArb,
        fc.boolean(), // whether to include a fee
        async (sourceQty, sourceCostBasis, bitcoinPrice, includeFee) => {
          const transferQty = sourceQty * 0.5;
          const feeAmount = includeFee ? sourceQty * 0.01 : 0;

          // Ensure source can cover transfer + fee
          if (transferQty + feeAmount > sourceQty) return;

          const srcWallet = await createWallet(`SrcTx_${uid()}`);
          const dstWallet = await createWallet(`DstTx_${uid()}`);

          await createBtcHolding(srcWallet.id, sourceQty, sourceCostBasis);

          // Count transactions before
          const txCountBefore = await prisma.transaction.count();

          const payload: Record<string, unknown> = {
            fromWalletId: srcWallet.id,
            toWalletId: dstWallet.id,
            quantity: transferQty,
            bitcoinUnit: 'Bitcoin',
            bitcoinPrice,
          };

          if (includeFee && feeAmount > 0) {
            payload.feeAmount = feeAmount;
            payload.feeUnit = 'Bitcoin';
          }

          const res = await post('/investments/transfers/bitcoin', payload);
          expect(res.status).toBe(200);

          const body = (await res.json()) as { id: string };
          createdTransferIds.push(body.id);

          // Count transactions after
          const txCountAfter = await prisma.transaction.count();

          // No new Transaction records should have been created
          expect(txCountAfter).toBe(txCountBefore);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Stock Transfer Helpers ───

async function createCustodian(name: string) {
  const c = await prisma.custodian.create({ data: { name } });
  return c;
}

async function createStockHolding(
  custodianId: string,
  ticker: string,
  quantity: number,
  costBasis: number,
) {
  const h = await prisma.investmentHolding.create({
    data: {
      name: `${ticker}_${custodianId.slice(0, 6)}`,
      ticker,
      type: 'STOCK',
      quantity,
      costBasis,
      custodianId,
    },
  });
  return h;
}

async function createTestAccount(name: string, balance: number) {
  const a = await prisma.account.create({
    data: { name, type: 'CHECKING', balance },
  });
  return a;
}

async function createTestCategory(name: string) {
  const group = await prisma.budgetGroup.create({
    data: { name: `GRP_${name}`, color: '#000000' },
  });
  const cat = await prisma.budget.create({
    data: { name, groupId: group.id, isCustom: false },
  });
  return cat;
}

// ─── Stock Generators ───

/** Stock holding quantity: 1 to 10,000 shares */
const stockQtyArb = fc.double({ min: 1, max: 10_000, noNaN: true, noDefaultInfinity: true });

/** Stock cost basis: $100 to $1,000,000 */
const stockCostBasisArb = fc.double({
  min: 100,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Fee amount: $0.01 to $500 */
const feeAmountArb = fc.double({ min: 0.01, max: 500, noNaN: true, noDefaultInfinity: true });

/** Stock ticker: pick from a set of realistic tickers */
const tickerArb = fc.constantFrom(
  'AAPL',
  'GOOG',
  'MSFT',
  'AMZN',
  'TSLA',
  'META',
  'NVDA',
  'JPM',
  'TCKB',
  'TCKR',
);

// ─── Property 2: Stock transfer conservation ───

describe('Feature: investment-transfers, Property 2: Stock transfer conservation', () => {
  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * For any valid stock transfer, the total quantity and total cost basis
   * across source and destination holdings are conserved. Stock transfers
   * move the full holding quantity.
   */
  it('quantity and cost basis are conserved across stock transfers', async () => {
    await fc.assert(
      fc.asyncProperty(
        stockQtyArb,
        stockCostBasisArb,
        tickerArb,
        async (sourceQty, sourceCostBasis, ticker) => {
          const srcCustodian = await createCustodian(`SrcC_${uid()}`);
          const dstCustodian = await createCustodian(`DstC_${uid()}`);

          // Create source holding
          const srcHolding = await createStockHolding(
            srcCustodian.id,
            ticker,
            sourceQty,
            sourceCostBasis,
          );

          // Destination may have existing shares of same ticker
          const destInitialQty = 50;
          const destInitialCostBasis = 5000;
          await createStockHolding(dstCustodian.id, ticker, destInitialQty, destInitialCostBasis);

          const totalQtyBefore = sourceQty + destInitialQty;
          const totalCostBasisBefore = sourceCostBasis + destInitialCostBasis;

          // Execute stock transfer (full holding, no fee)
          const res = await post('/investments/transfers/stock', {
            fromCustodianId: srcCustodian.id,
            toCustodianId: dstCustodian.id,
            holdingId: srcHolding.id,
          });

          expect(res.status).toBe(200);
          const body = (await res.json()) as { id: string };
          createdTransferIds.push(body.id);

          // Read holdings after transfer
          const srcHoldingAfter = await prisma.investmentHolding.findFirst({
            where: { custodianId: srcCustodian.id, ticker },
          });
          const dstHoldingAfter = await prisma.investmentHolding.findFirst({
            where: { custodianId: dstCustodian.id, ticker },
          });

          expect(srcHoldingAfter).not.toBeNull();
          expect(dstHoldingAfter).not.toBeNull();

          const srcQtyAfter = Number(srcHoldingAfter!.quantity);
          const dstQtyAfter = Number(dstHoldingAfter!.quantity);
          const srcCbAfter = Number(srcHoldingAfter!.costBasis ?? 0);
          const dstCbAfter = Number(dstHoldingAfter!.costBasis ?? 0);

          // Quantity conservation
          expect(srcQtyAfter + dstQtyAfter).toBeCloseTo(totalQtyBefore, 4);

          // Cost basis conservation
          expect(srcCbAfter + dstCbAfter).toBeCloseTo(totalCostBasisBefore, 2);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('source holding is fully depleted after stock transfer', async () => {
    await fc.assert(
      fc.asyncProperty(
        stockQtyArb,
        stockCostBasisArb,
        tickerArb,
        async (sourceQty, sourceCostBasis, ticker) => {
          const srcCustodian = await createCustodian(`SrcD_${uid()}`);
          const dstCustodian = await createCustodian(`DstD_${uid()}`);

          const srcHolding = await createStockHolding(
            srcCustodian.id,
            ticker,
            sourceQty,
            sourceCostBasis,
          );

          const res = await post('/investments/transfers/stock', {
            fromCustodianId: srcCustodian.id,
            toCustodianId: dstCustodian.id,
            holdingId: srcHolding.id,
          });

          expect(res.status).toBe(200);
          const body = (await res.json()) as { id: string };
          createdTransferIds.push(body.id);

          // Source should be fully depleted (quantity = 0)
          const srcAfter = await prisma.investmentHolding.findFirst({
            where: { id: srcHolding.id },
          });
          expect(Number(srcAfter!.quantity)).toBeCloseTo(0, 8);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 8: Stock fee creates expense transaction iff fee > 0 ───

describe('Feature: investment-transfers, Property 8: Stock fee creates expense transaction iff fee > 0', () => {
  /**
   * **Validates: Requirements 5.1, 5.4**
   *
   * For any stock transfer, a Transaction record of type EXPENSE is created
   * if and only if the fee amount is greater than zero. When created, the
   * Transaction amount equals the fee amount. When fee is 0 or omitted,
   * no Transaction is created.
   */
  it('creates EXPENSE transaction when fee > 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        stockQtyArb,
        stockCostBasisArb,
        feeAmountArb,
        tickerArb,
        async (sourceQty, sourceCostBasis, feeAmount, ticker) => {
          const srcCustodian = await createCustodian(`SrcFee_${uid()}`);
          const dstCustodian = await createCustodian(`DstFee_${uid()}`);
          const srcHolding = await createStockHolding(
            srcCustodian.id,
            ticker,
            sourceQty,
            sourceCostBasis,
          );
          const account = await createTestAccount(`Acct_${uid()}`, 100_000);
          const category = await createTestCategory(`Cat_${uid()}`);

          const txCountBefore = await prisma.transaction.count();

          const res = await post('/investments/transfers/stock', {
            fromCustodianId: srcCustodian.id,
            toCustodianId: dstCustodian.id,
            holdingId: srcHolding.id,
            feeAmount,
            feeBudgetId: category.id,
            feeAccountId: account.id,
          });

          expect(res.status).toBe(200);
          const body = (await res.json()) as { id: string; feeTransactionId: string | null };
          createdTransferIds.push(body.id);

          // A new Transaction should have been created
          const txCountAfter = await prisma.transaction.count();
          expect(txCountAfter).toBe(txCountBefore + 1);

          // Verify the transaction details
          expect(body.feeTransactionId).not.toBeNull();
          const feeTx = await prisma.transaction.findUnique({
            where: { id: body.feeTransactionId! },
          });
          expect(feeTx).not.toBeNull();
          expect(feeTx!.type).toBe('EXPENSE');
          expect(Number(feeTx!.amount)).toBeCloseTo(feeAmount, 4);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('does NOT create transaction when fee is omitted', async () => {
    await fc.assert(
      fc.asyncProperty(
        stockQtyArb,
        stockCostBasisArb,
        tickerArb,
        async (sourceQty, sourceCostBasis, ticker) => {
          const srcCustodian = await createCustodian(`SrcNF_${uid()}`);
          const dstCustodian = await createCustodian(`DstNF_${uid()}`);
          const srcHolding = await createStockHolding(
            srcCustodian.id,
            ticker,
            sourceQty,
            sourceCostBasis,
          );

          const txCountBefore = await prisma.transaction.count();

          const res = await post('/investments/transfers/stock', {
            fromCustodianId: srcCustodian.id,
            toCustodianId: dstCustodian.id,
            holdingId: srcHolding.id,
          });

          expect(res.status).toBe(200);
          const body = (await res.json()) as { id: string; feeTransactionId: string | null };
          createdTransferIds.push(body.id);

          // No new Transaction should have been created
          const txCountAfter = await prisma.transaction.count();
          expect(txCountAfter).toBe(txCountBefore);

          // feeTransactionId should be null
          expect(body.feeTransactionId).toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 10: Stock fee deducts from account balance ───

describe('Feature: investment-transfers, Property 10: Stock fee deducts from account balance', () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * For any stock transfer with a fee amount F and a source account with
   * balance B, after the transfer the account balance equals B - F.
   */
  it('account balance decreases by fee amount', async () => {
    await fc.assert(
      fc.asyncProperty(
        stockQtyArb,
        stockCostBasisArb,
        feeAmountArb,
        tickerArb,
        fc.double({ min: 1000, max: 500_000, noNaN: true, noDefaultInfinity: true }), // initial balance
        async (sourceQty, sourceCostBasis, feeAmount, ticker, initialBalance) => {
          const srcCustodian = await createCustodian(`SrcBal_${uid()}`);
          const dstCustodian = await createCustodian(`DstBal_${uid()}`);
          const srcHolding = await createStockHolding(
            srcCustodian.id,
            ticker,
            sourceQty,
            sourceCostBasis,
          );
          const account = await createTestAccount(`AcctBal_${uid()}`, initialBalance);
          const category = await createTestCategory(`CatBal_${uid()}`);

          const res = await post('/investments/transfers/stock', {
            fromCustodianId: srcCustodian.id,
            toCustodianId: dstCustodian.id,
            holdingId: srcHolding.id,
            feeAmount,
            feeBudgetId: category.id,
            feeAccountId: account.id,
          });

          expect(res.status).toBe(200);
          const body = (await res.json()) as { id: string };
          createdTransferIds.push(body.id);

          // Verify account balance decreased by fee amount
          const accountAfter = await prisma.account.findUnique({
            where: { id: account.id },
          });
          expect(accountAfter).not.toBeNull();
          expect(Number(accountAfter!.balance)).toBeCloseTo(initialBalance - feeAmount, 4);
        },
      ),
      { numRuns: 20 },
    );
  });
});
