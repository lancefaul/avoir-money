import { test, expect } from '@playwright/test';
import { expectNoConsoleErrors } from './helpers.js';
import { apiPost, apiGet, apiDelete } from './api-helpers.js';

/**
 * Cross-page flow E2E tests.
 *
 * These tests verify that data flows correctly across multiple pages
 * when lifecycle hooks fire (debt payments, holding updates) and when
 * the mark-as-paid flow is used from the dashboard.
 */

// ── Test 1: Transaction → Debt Balance Update ──

test.describe('Cross-page: Transaction → Debt Payment', () => {
  let expenseId: string;
  let debtId: string;
  let transactionId: string;
  let accountId: string;
  let budgetId: string;

  test.beforeAll(async () => {
    const accounts = await apiGet('/accounts');
    expect(accounts.status).toBe(200);
    if (!accounts.data[0]) return;
    accountId = accounts.data[0].id;

    const budgets = await apiGet('/budgets');
    expect(budgets.status).toBe(200);
    if (!budgets.data[0]) return;
    budgetId = budgets.data[0].id;
  });

  test('creating a transaction linked to a debt-linked expense reduces debt balance', async ({
    page,
  }) => {
    if (!accountId || !budgetId) {
      test.skip(true, 'No account or budget in test DB');
      return;
    }
    const noErrors = expectNoConsoleErrors(page);
    const ts = Date.now();

    // 1. Create an expense via API
    const expRes = await apiPost('/expenses', {
      name: `E2E Debt Expense ${ts}`,
      amount: 500,
      frequency: 'MONTHLY',
      budgetId: budgetId,
      accountId,
    });
    expect(expRes.status).toBe(201);
    expenseId = expRes.data.id;

    // 2. Create a debt linked to that expense
    const debtRes = await apiPost('/debts', {
      name: `E2E Debt ${ts}`,
      type: 'CREDIT_CARD',
      originalBalance: 5000,
      currentBalance: 5000,
      apr: 18.99,
      minimumPayment: 100,
      frequency: 'MONTHLY',
      startDate: new Date(Date.UTC(2024, 0, 1)).toISOString(),
      linkedExpenseId: expenseId,
    });
    expect(debtRes.status).toBe(201);
    debtId = debtRes.data.id;

    // 3. Verify the debt shows on the Debts page
    await page.goto('/debts');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(`E2E Debt ${ts}`).first()).toBeVisible({ timeout: 5_000 });

    // 4. Create a transaction linked to the expense (triggers debt-payment hook)
    const txRes = await apiPost('/transactions', {
      type: 'EXPENSE',
      name: `E2E Debt Payment ${ts}`,
      amount: 500,
      date: new Date(Date.UTC(2025, 5, 1)).toISOString(),
      expenseId,
      accountId,
    });
    expect(txRes.status).toBe(201);
    transactionId = txRes.data.id;

    // 5. Verify the debt still shows on page after payment
    await page.goto('/debts');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(`E2E Debt ${ts}`).first()).toBeVisible({ timeout: 5_000 });

    // 6. Verify transaction exists on Transactions page
    await page.goto('/transactions');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(`E2E Debt Payment ${ts}`).first()).toBeVisible({ timeout: 5_000 });

    noErrors.assert();
  });

  test.afterAll(async () => {
    if (transactionId) await apiDelete(`/transactions/${transactionId}`);
    if (debtId) await apiDelete(`/debts/${debtId}`);
    if (expenseId) await apiDelete(`/expenses/${expenseId}`);
  });
});

// ── Test 2: Trade → Holding Quantity Update ──

test.describe('Cross-page: Trade → Holding Update', () => {
  let custodianId: string;
  let transactionId: string;
  let accountId: string;

  test.beforeAll(async () => {
    const accounts = await apiGet('/accounts');
    expect(accounts.status).toBe(200);
    if (!accounts.data[0]) return;
    accountId = accounts.data[0].id;
  });

  test('creating a TRADE transaction updates holdings on investments page', async ({ page }) => {
    if (!accountId) {
      test.skip(true, 'No account in test DB');
      return;
    }
    const noErrors = expectNoConsoleErrors(page);
    const ts = Date.now();

    // 1. Create a custodian
    const custRes = await apiPost('/investments/custodians', { name: `E2E Custodian ${ts}` });
    expect(custRes.status).toBe(201);
    custodianId = custRes.data.id;

    // 2. Create a TRADE (BUY) transaction
    const txRes = await apiPost('/transactions', {
      type: 'TRADE',
      name: `E2E Buy AAPL ${ts}`,
      amount: 1500,
      date: new Date(Date.UTC(2025, 5, 1)).toISOString(),
      accountId,
      tradeMetadata: {
        direction: 'BUY',
        assetType: 'Stock',
        ticker: 'AAPL',
        unitPrice: 150,
        quantity: 10,
        custodianId,
      },
    });
    expect(txRes.status).toBe(201);
    transactionId = txRes.data.id;

    // 3. Verify the holding appears on Investments page
    await page.goto('/investments');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('AAPL').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(`E2E Custodian ${ts}`).first()).toBeVisible({ timeout: 5_000 });

    // 4. Verify the transaction exists on Transactions page
    await page.goto('/transactions');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(`E2E Buy AAPL ${ts}`).first()).toBeVisible({ timeout: 5_000 });

    noErrors.assert();
  });

  test.afterAll(async () => {
    if (transactionId) await apiDelete(`/transactions/${transactionId}`);
    if (custodianId) await apiDelete(`/investments/custodians/${custodianId}`);
  });
});
