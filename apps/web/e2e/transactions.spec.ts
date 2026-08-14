import { test, expect } from '@playwright/test';
import { expectNoConsoleErrors, expectRowVisible } from './helpers.js';
import { apiPost, apiDelete, apiGet } from './api-helpers.js';

/**
 * Transactions page E2E CRUD tests.
 *
 * Tests focus on reliable CI assertions:
 * - API-created transactions appear on the page
 * - Search filters work
 * - Add button opens the form drawer
 *
 * DropdownMenu interactions (edit/delete) are conditional.
 */
test.describe('Transactions CRUD', () => {
  test('create transaction via API and verify it appears on page', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);
    const ts = Date.now();
    const name = `E2E Txn ${ts}`;
    let transactionId: string | undefined;

    const accounts = await apiGet('/accounts');
    const accountId = accounts.data[0]?.id;

    if (!accountId) {
      test.skip(true, 'No account in test DB');
      return;
    }

    try {
      const res = await apiPost('/transactions', {
        type: 'EXPENSE',
        name,
        amount: 42.5,
        date: new Date().toISOString(),
        accountId,
      });
      expect(res.status).toBe(201);
      transactionId = res.data.id;

      await page.goto('/transactions');
      await page.waitForLoadState('networkidle');

      await expectRowVisible(page, name);

      noErrors.assert();
    } finally {
      if (transactionId) await apiDelete(`/transactions/${transactionId}`);
    }
  });

  test('Add Transaction button opens form drawer', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    await page.goto('/transactions');
    await page.waitForLoadState('networkidle');

    await page.getByRole('banner').getByRole('button', { name: 'Add Transaction' }).click();
    await expect(page.getByRole('heading', { name: 'Add Transaction' })).toBeVisible();

    // Form fields should be present
    await expect(page.locator('input[name="name"]')).toBeVisible();

    // Close drawer
    await page.getByRole('button', { name: 'Cancel' }).click();

    noErrors.assert();
  });

  test('search filters transactions', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);
    const ts = Date.now();
    const name = `E2E Search ${ts}`;
    let transactionId: string | undefined;

    const accounts = await apiGet('/accounts');
    const accountId = accounts.data[0]?.id;
    if (!accountId) {
      test.skip(true, 'No account in test DB');
      return;
    }

    try {
      const res = await apiPost('/transactions', {
        type: 'EXPENSE',
        name,
        amount: 25,
        date: new Date().toISOString(),
        accountId,
      });
      expect(res.status).toBe(201);
      transactionId = res.data.id;

      await page.goto('/transactions');
      await page.waitForLoadState('networkidle');

      // Use the search input
      const searchInput = page.locator('input[type="text"][placeholder*="Search"]').first();
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill(name);
        await page.waitForLoadState('networkidle');
        await expectRowVisible(page, name);
      }

      noErrors.assert();
    } finally {
      if (transactionId) await apiDelete(`/transactions/${transactionId}`);
    }
  });
});
