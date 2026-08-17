import { test, expect } from '@playwright/test';
import { expectNoConsoleErrors } from './helpers.js';
import { apiPost, apiDelete } from './api-helpers.js';

/**
 * Debts page E2E CRUD tests — card-based layout with overflow menu.
 *
 * Tests focus on reliable CI assertions:
 * - Page loads without errors
 * - API-created debts appear on the page
 * - Add button opens the form drawer
 *
 * DropdownMenu interactions (delete) are conditional.
 */
test.describe('Debts CRUD', () => {
  test('page loads with Add Debt button', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    await page.goto('/debts');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: 'Add Debt' }).first()).toBeVisible();

    noErrors.assert();
  });

  test('create debt via API and verify it appears on page', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);
    const ts = Date.now();
    const name = `E2E Debt ${ts}`;
    let debtId: string | undefined;

    try {
      const res = await apiPost('/debts', {
        name,
        type: 'CREDIT_CARD',
        originalBalance: 5000,
        currentBalance: 3500,
        apr: 18.99,
        minimumPayment: 75,
        frequency: 'MONTHLY',
        startDate: new Date(Date.UTC(2024, 0, 15)).toISOString(),
        maturityDate: new Date(Date.UTC(2029, 0, 15)).toISOString(),
      });
      expect(res.status).toBe(201);
      debtId = res.data.id;

      await page.goto('/debts');
      await page.waitForLoadState('networkidle');

      // Verify the debt appears
      await expect(page.getByText(name).first()).toBeVisible({ timeout: 5_000 });

      noErrors.assert();
    } finally {
      if (debtId) await apiDelete(`/debts/${debtId}`);
    }
  });

  test('Add Debt button opens form drawer', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    await page.goto('/debts');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Add Debt' }).first().click();
    await expect(page.getByRole('heading', { name: 'Add Debt' })).toBeVisible();

    // Form fields should be present
    await expect(page.locator('input[name="name"]')).toBeVisible();

    // Close drawer
    await page.getByRole('button', { name: 'Cancel' }).click();

    noErrors.assert();
  });
});
