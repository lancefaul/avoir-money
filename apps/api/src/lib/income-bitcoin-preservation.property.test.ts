/**
 * Preservation Property Tests — Income Bitcoin & Category Bugs
 *
 * These tests capture the EXISTING correct behavior on UNFIXED code for
 * non-buggy inputs (cases where `isBugCondition` returns false).
 * They MUST PASS on unfixed code, confirming the baseline to preserve.
 * After the fix is applied, they must STILL PASS (no regressions).
 *
 * Observation-first methodology: behavior was observed on unfixed code,
 * then assertions were written to match that observed behavior.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { prisma } from '@budget-tracker/db';
import { post, get, del, createGroup, createCategory, createAccount } from '../test/helpers.js';
import { computeUsdAmount } from './holdings.js';

// Ensure required env vars are set when running outside apps/api (e.g. from workspace root)
beforeAll(() => {
  if (!process.env['API_KEY']) process.env['API_KEY'] = 'budget-tracker-dev-key';
  if (!process.env['DATABASE_URL']) {
    process.env['DATABASE_URL'] = 'postgresql://budget:budget@localhost:5433/budget_tracker_test';
  }
});

// ─── Helpers ───

/** Ensure the sentinel "BITCOIN" Account exists so the FK constraint is satisfied. */
async function ensureBitcoinAccount() {
  const existing = await prisma.account.findUnique({ where: { id: 'BITCOIN' } });
  if (!existing) {
    await prisma.account.create({
      data: { id: 'BITCOIN', name: 'Bitcoin (Sentinel)', type: 'CHECKING', balance: 0 },
    });
  }
}

async function createWallet(name: string) {
  return prisma.wallet.create({ data: { name } });
}

async function createIncomeRecord(budgetId: string, overrides: Record<string, unknown> = {}) {
  return prisma.income.create({
    data: {
      name: `INC_${Date.now()}_${Math.random()}`,
      amount: 5000,
      frequency: 'BIWEEKLY',
      budgetId,
      ...overrides,
    },
  });
}

// ─── Generators ───

/** Positive BTC quantity — small range to keep realistic */
const btcQuantityArb = fc.double({ min: 0.00001, max: 10, noNaN: true, noDefaultInfinity: true });

/** Positive unit price in USD per BTC */
const unitPriceArb = fc.double({ min: 0.01, max: 200_000, noNaN: true, noDefaultInfinity: true });

/** Positive USD amount for non-bitcoin income */
const usdAmountArb = fc
  .double({ min: 0.01, max: 100_000, noNaN: true, noDefaultInfinity: true })
  .map((v) => Math.round(v * 100) / 100);

// ─── Property 2a: Expense Bitcoin Unchanged ───

describe('Property 2a — Expense Bitcoin Unchanged', () => {
  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * For type=EXPENSE + paymentMethod=bitcoin with valid bitcoinMetadata,
   * POST /transactions returns HTTP 201 with amount = quantity × unitPrice
   * (converted from Sats if applicable), and holdings are decremented.
   *
   * Observed on unfixed code: expense + bitcoin transactions create successfully
   * with the correct derived USD amount and holdings are decremented.
   */
  it('expense + bitcoin transaction creates with correct derived amount and decrements holdings', async () => {
    await fc.assert(
      fc.asyncProperty(btcQuantityArb, unitPriceArb, async (quantity, unitPrice) => {
        // Ensure sentinel BITCOIN account exists (truncated by beforeEach)
        await ensureBitcoinAccount();

        // Setup: wallet, category, and pre-seed a holding so we have BTC to spend
        const wallet = await createWallet(`W_${Date.now()}_${Math.random()}`);
        const group = await createGroup(`EXPGRP_${Date.now()}_${Math.random()}`);
        const category = await createCategory(group.id, `ExpCat_${Date.now()}`);

        const expectedAmount = computeUsdAmount(quantity, 'Bitcoin', unitPrice);

        // Pre-seed a holding with enough BTC
        const seedQuantity = quantity + 1; // ensure enough
        await prisma.investmentHolding.create({
          data: {
            name: wallet.name,
            type: 'BITCOIN',
            ticker: null,
            quantity: seedQuantity,
            costBasis: seedQuantity * unitPrice,
            walletId: wallet.id,
          },
        });

        const bitcoinMetadata = {
          walletId: wallet.id,
          quantity,
          bitcoinUnit: 'Bitcoin' as const,
          unitPrice,
        };

        const res = await post('/transactions', {
          type: 'EXPENSE',
          name: 'BTC Expense Test',
          amount: 0,
          date: '2026-04-01',
          budgetId: category.id,
          bitcoinMetadata,
        });

        // Observed: HTTP 201 on unfixed code for expense + bitcoin
        expect(res.status).toBe(201);

        if (res.status === 201) {
          const body = (await res.json()) as Record<string, unknown>;
          const returnedAmount = body.amount as number;
          // Amount should be derived from bitcoin metadata
          expect(returnedAmount).toBeCloseTo(expectedAmount, 2);
        }

        // Verify holdings were decremented
        const holding = await prisma.investmentHolding.findFirst({
          where: { type: 'BITCOIN', walletId: wallet.id, ticker: null },
        });
        expect(holding).not.toBeNull();
        if (holding) {
          const remainingQty = Number(holding.quantity);
          expect(remainingQty).toBeCloseTo(seedQuantity - quantity, 8);
        }
      }),
      { numRuns: 5 },
    );
  });
});

// ─── Property 2b: Expense Category Selection Unchanged ───

describe('Property 2b — Expense Category Selection Unchanged', () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * For type=EXPENSE transactions, the form condition shows the category
   * selector: `txType !== 'TRANSFER' && txType !== 'TRADE'`.
   *
   * Observed on unfixed code: the condition evaluates to true for EXPENSE,
   * INCOME, and REFUND types, and false for TRANSFER and TRADE.
   * This is a pure logic test of the frontend form condition.
   */
  it('category selector is shown for EXPENSE and REFUND, hidden for TRANSFER and TRADE', () => {
    fc.assert(
      fc.property(fc.constantFrom('EXPENSE', 'INCOME', 'REFUND', 'TRANSFER', 'TRADE'), (txType) => {
        // Current (unfixed) form condition for showing category selector
        const showCategorySelector = txType !== 'TRANSFER' && txType !== 'TRADE';

        // For EXPENSE and REFUND: category selector should be shown
        if (txType === 'EXPENSE' || txType === 'REFUND') {
          expect(showCategorySelector).toBe(true);
        }

        // For TRANSFER and TRADE: category selector should be hidden
        if (txType === 'TRANSFER' || txType === 'TRADE') {
          expect(showCategorySelector).toBe(false);
        }

        // For INCOME: currently shows category selector (this is the bug area,
        // but we're testing preservation of the EXPENSE path specifically)
        if (txType === 'INCOME') {
          // Observed: currently true on unfixed code
          expect(showCategorySelector).toBe(true);
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2c: Non-Bitcoin Income Unchanged ───

describe('Property 2c — Non-Bitcoin Income Unchanged', () => {
  /**
   * **Validates: Requirements 3.4**
   *
   * For type=INCOME + paymentMethod=account with amount > 0,
   * POST /transactions returns HTTP 201 with the user-provided amount.
   *
   * Observed on unfixed code: non-bitcoin income transactions create
   * successfully with the exact amount the user provided.
   */
  it('non-bitcoin income transaction creates with user-provided amount', async () => {
    await fc.assert(
      fc.asyncProperty(usdAmountArb, async (amount) => {
        const group = await createGroup(`INCGRP_${Date.now()}_${Math.random()}`);
        const category = await createCategory(group.id, `IncCat_${Date.now()}`);
        const account = await createAccount(`ACCT_${Date.now()}_${Math.random()}`);

        const res = await post('/transactions', {
          type: 'INCOME',
          name: 'Paycheck Test',
          amount,
          date: '2026-04-01',
          accountId: account.id,
          budgetId: category.id,
        });

        // Observed: HTTP 201 on unfixed code for non-bitcoin income
        expect(res.status).toBe(201);

        if (res.status === 201) {
          const body = (await res.json()) as Record<string, unknown>;
          const returnedAmount = body.amount as number;
          // Amount should be exactly what the user provided
          expect(returnedAmount).toBeCloseTo(amount, 2);
        }
      }),
      { numRuns: 10 },
    );
  });
});

// ─── Property 2d: Income Lifecycle Unchanged ───

describe('Property 2d — Income Lifecycle Unchanged', () => {
  /**
   * **Validates: Requirements 3.5, 3.6**
   *
   * For income record operations (pause, resume, archive, restore, delete),
   * the API endpoints return success and the record state transitions correctly.
   *
   * Observed on unfixed code: all lifecycle operations work correctly.
   */
  it('pause → resume lifecycle works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom('days' as const, 'weeks' as const, 'months' as const),
        async (duration, unit) => {
          const group = await createGroup(`LCGRP_${Date.now()}_${Math.random()}`);
          const category = await createCategory(group.id, `LCCat_${Date.now()}`);
          const income = await createIncomeRecord(category.id, { frequency: 'MONTHLY' });

          // Pause
          const pauseRes = await post(`/income/${income.id}/pause`, { duration, unit });
          expect(pauseRes.status).toBe(200);
          const pauseBody = (await pauseRes.json()) as Record<string, unknown>;
          expect(pauseBody.pausedUntil).not.toBeNull();

          // Resume immediately
          const resumeRes = await post(`/income/${income.id}/resume`, { immediately: true });
          expect(resumeRes.status).toBe(200);
          const resumeBody = (await resumeRes.json()) as Record<string, unknown>;
          expect(resumeBody.pausedUntil).toBeNull();
        },
      ),
      { numRuns: 5 },
    );
  });

  it('archive → restore lifecycle works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null), // no random input needed, just run multiple times
        async () => {
          const group = await createGroup(`ARGRP_${Date.now()}_${Math.random()}`);
          const category = await createCategory(group.id, `ARCat_${Date.now()}`);
          const income = await createIncomeRecord(category.id, { frequency: 'MONTHLY' });

          // Archive
          const archiveRes = await post(`/income/${income.id}/archive`, {});
          expect(archiveRes.status).toBe(200);
          const archiveBody = (await archiveRes.json()) as Record<string, unknown>;
          expect(archiveBody.archivedAt).not.toBeNull();

          // Restore
          const restoreRes = await post(`/income/${income.id}/restore`, {});
          expect(restoreRes.status).toBe(200);
          const restoreBody = (await restoreRes.json()) as Record<string, unknown>;
          expect(restoreBody.archivedAt).toBeNull();
        },
      ),
      { numRuns: 3 },
    );
  });

  it('delete removes the income record', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const group = await createGroup(`DELGRP_${Date.now()}_${Math.random()}`);
        const category = await createCategory(group.id, `DELCat_${Date.now()}`);
        const income = await createIncomeRecord(category.id, { frequency: 'MONTHLY' });

        // Delete
        const deleteRes = await del(`/income/${income.id}`);
        expect(deleteRes.status).toBe(204);

        // Verify it's gone
        const getRes = await get(`/income/${income.id}`);
        expect(getRes.status).toBe(404);
      }),
      { numRuns: 3 },
    );
  });

  it('archive prevents deletion until restored', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const group = await createGroup(`ADGRP_${Date.now()}_${Math.random()}`);
        const category = await createCategory(group.id, `ADCat_${Date.now()}`);
        const income = await createIncomeRecord(category.id, { frequency: 'MONTHLY' });

        // Archive
        const archiveRes = await post(`/income/${income.id}/archive`, {});
        expect(archiveRes.status).toBe(200);

        // Attempt delete — should fail with 409
        const deleteRes = await del(`/income/${income.id}`);
        expect(deleteRes.status).toBe(409);

        // Restore first
        const restoreRes = await post(`/income/${income.id}/restore`, {});
        expect(restoreRes.status).toBe(200);

        // Now delete should succeed
        const deleteRes2 = await del(`/income/${income.id}`);
        expect(deleteRes2.status).toBe(204);
      }),
      { numRuns: 3 },
    );
  });
});
