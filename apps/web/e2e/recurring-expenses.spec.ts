import { test, expect } from '@playwright/test';
import { expectNoConsoleErrors } from './helpers.js';
import { apiPost, apiDelete, apiGet } from './api-helpers.js';

/**
 * Recurring Expenses E2E CRUD tests — unified Recurring page.
 *
 * Tests focus on reliable CI assertions:
 * - API-created expenses appear in the table
 * - Page shows items grouped by frequency
 * - Add button opens the drawer form
 *
 * DropdownMenu interactions (edit/delete) are conditional.
 */
test.describe('Recurring Expenses CRUD', () => {
  test('create expense via API and verify it appears on page', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);
    const ts = Date.now();
    const name = `E2E Expense ${ts}`;
    let expenseId: string | undefined;

    const budgets = await apiGet('/budgets');
    const budgetId = budgets.data[0]?.id;
    const accounts = await apiGet('/accounts');
    const accountId = accounts.data[0]?.id;

    if (!budgetId || !accountId) {
      test.skip(true, 'No budget or account in test DB');
      return;
    }

    try {
      const res = await apiPost('/expenses', {
        name,
        amount: 150,
        frequency: 'MONTHLY',
        budgetId,
        accountId,
        dueDay: 15,
      });
      expect(res.status).toBe(201);
      expenseId = res.data.id;

      await page.goto('/recurring');
      await page.waitForLoadState('networkidle');

      // Verify it appears in the table
      await expect(page.locator('table tr', { hasText: name }).first()).toBeVisible({
        timeout: 5_000,
      });

      noErrors.assert();
    } finally {
      if (expenseId) await apiDelete(`/expenses/${expenseId}`);
    }
  });

  test('page shows items grouped by frequency', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    // Data-shape-agnostic: create a MONTHLY expense so the heading must exist
    let expenseId: string | undefined;
    const budgets = await apiGet('/budgets');
    const budgetId = budgets.data[0]?.id;
    if (!budgetId) {
      test.skip(true, 'No budget in test DB');
      return;
    }
    const res = await apiPost('/expenses', {
      name: `E2E Freq ${Date.now()}`,
      amount: 10,
      frequency: 'MONTHLY',
      budgetId,
      dueDay: 10,
    });
    expect(res.status).toBe(201);
    expenseId = res.data.id;

    try {
      await page.goto('/recurring');
      await page.waitForLoadState('networkidle');

      await expect(page.getByText('Monthly').first()).toBeVisible({ timeout: 5_000 });
    } finally {
      if (expenseId) await apiDelete(`/expenses/${expenseId}`);
    }

    noErrors.assert();
  });

  test('Add Recurring button opens the drawer form', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    await page.goto('/recurring');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Add Recurring' }).first().click();
    await expect(page.getByText('Add Recurring').first()).toBeVisible();

    // The form has a Type toggle (Expense/Income)
    await expect(page.getByText('Expense', { exact: true })).toBeVisible();
    await expect(page.getByText('Income', { exact: true })).toBeVisible();

    // Close the drawer
    await page.getByRole('button', { name: 'Cancel' }).click();

    noErrors.assert();
  });
});
