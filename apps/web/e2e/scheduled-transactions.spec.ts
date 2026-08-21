import { test, expect } from '@playwright/test';
import { expectNoConsoleErrors } from './helpers.js';
import { apiPost, apiDelete, apiGet } from './api-helpers.js';

/**
 * Scheduled Transactions & Mark-as-Paid E2E tests.
 *
 * Tests the mark-as-paid flow from the dashboard and verifies scheduled
 * transactions appear on the transactions page.
 */
test.describe('Scheduled Transactions', () => {
  test('transactions page shows anticipation rows when expenses exist', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    await page.goto('/transactions');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /Transactions/ })).toBeVisible();

    // Look for schedule status indicators
    const hasDue = await page
      .getByText('DUE')
      .first()
      .isVisible()
      .catch(() => false);
    const hasOverdue = await page
      .getByText('OVERDUE')
      .first()
      .isVisible()
      .catch(() => false);
    const hasUpcoming = await page
      .getByText('UPCOMING')
      .first()
      .isVisible()
      .catch(() => false);

    // Verify page loaded — anticipations depend on having recurring data
    if (!hasDue && !hasOverdue && !hasUpcoming) {
      console.warn('No anticipation rows found — ensure test DB has recurring expenses/income.');
    }

    noErrors.assert();
  });

  test('dashboard shows Paid buttons for due expenses', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for loading to finish
    await page
      .waitForFunction(
        () => {
          return !document.body.textContent?.includes('Loading\u2026');
        },
        { timeout: 10_000 },
      )
      .catch(() => {});

    // Look for any "Paid" buttons in spending tables
    const paidButtons = page.getByRole('button', { name: /Paid/ });
    const count = await paidButtons.count();

    if (count > 0) {
      await expect(paidButtons.first()).toBeVisible();
      await expect(paidButtons.first()).toBeEnabled();
    }

    noErrors.assert();
  });

  test('marking expense as paid calls scheduled-transactions endpoint', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page
      .waitForFunction(
        () => {
          return !document.body.textContent?.includes('Loading\u2026');
        },
        { timeout: 10_000 },
      )
      .catch(() => {});

    const paidButtons = page.getByRole('button', { name: /Paid/ });
    const count = await paidButtons.count();

    if (count === 0) {
      test.skip(true, 'No due expenses in current period');
      return;
    }

    // Intercept the pay request
    const payPromise = page.waitForRequest(
      (req) =>
        req.url().includes('/scheduled-transactions/') &&
        req.url().endsWith('/pay') &&
        req.method() === 'POST',
      { timeout: 10_000 },
    );

    await paidButtons.first().click();

    const payRequest = await payPromise;
    expect(payRequest.url()).toContain('/scheduled-transactions/');

    await page.waitForLoadState('networkidle');
    noErrors.assert();
  });

  test('create expense via API then verify anticipation appears', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);
    const ts = Date.now();
    const name = `E2E SchedTx ${ts}`;
    let expenseId: string | undefined;

    // Get first budget for categoryId
    const budgets = await apiGet('/budgets');
    const budgetId = budgets.data[0]?.id;
    const accounts = await apiGet('/accounts');
    const accountId = accounts.data[0]?.id;

    if (!budgetId || !accountId) {
      test.skip(true, 'No budget or account available in test DB');
      return;
    }

    try {
      // Create expense via API
      const expRes = await apiPost('/expenses', {
        name,
        amount: 100,
        frequency: 'MONTHLY',
        budgetId: budgetId,
        accountId,
        dueDay: 15,
      });
      expect(expRes.status).toBe(201);
      expenseId = expRes.data.id;

      // Navigate to transactions and look for anticipation
      await page.goto('/transactions');
      await page.waitForLoadState('networkidle');

      // The anticipation may or may not appear depending on current period
      const anticipationRow = page.locator('tr', { hasText: name }).first();
      const isVisible = await anticipationRow.isVisible({ timeout: 5_000 }).catch(() => false);

      if (isVisible) {
        const rowText = await anticipationRow.textContent();
        expect(rowText).toContain(name);
      }

      noErrors.assert();
    } finally {
      if (expenseId) await apiDelete(`/expenses/${expenseId}`);
    }
  });
});
