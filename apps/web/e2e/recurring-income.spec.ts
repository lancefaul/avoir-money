import { test, expect } from '@playwright/test';
import { expectNoConsoleErrors } from './helpers.js';
import { apiPost, apiDelete, apiGet } from './api-helpers.js';

/**
 * Recurring Income E2E CRUD tests — unified Recurring page.
 *
 * Tests focus on reliable CI assertions:
 * - API-created income appears in the table
 * - Page shows frequency headings
 *
 * DropdownMenu interactions (edit/delete) are conditional.
 */
test.describe('Recurring Income CRUD', () => {
  test('create income via API and verify it appears on page', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);
    const ts = Date.now();
    const name = `E2E Income ${ts}`;
    let incomeId: string | undefined;

    const budgets = await apiGet('/budgets');
    const incomeBudget = budgets.data.find((b: { name: string }) => b.name === 'Income');
    const budgetId = incomeBudget?.id || budgets.data[0]?.id;

    if (!budgetId) {
      test.skip(true, 'No budget in test DB');
      return;
    }

    try {
      const res = await apiPost('/income', {
        name,
        amount: 3000,
        frequency: 'BIWEEKLY',
        budgetId,
      });
      expect(res.status).toBe(201);
      incomeId = res.data.id;

      await page.goto('/recurring');
      await page.waitForLoadState('networkidle');

      // Verify it appears in the table
      await expect(page.locator('table tr', { hasText: name }).first()).toBeVisible({
        timeout: 5_000,
      });

      noErrors.assert();
    } finally {
      if (incomeId) await apiDelete(`/income/${incomeId}`);
    }
  });

  test('income items appear with frequency heading', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    // Data-shape-agnostic: create a BIWEEKLY income so the heading must exist
    let incomeId: string | undefined;
    const budgets = await apiGet('/budgets');
    const budgetId = budgets.data[0]?.id;
    if (!budgetId) {
      test.skip(true, 'No budget in test DB');
      return;
    }
    const res = await apiPost('/income', {
      name: `E2E Income Freq ${Date.now()}`,
      amount: 100,
      frequency: 'BIWEEKLY',
      budgetId,
    });
    expect(res.status).toBe(201);
    incomeId = res.data.id;

    try {
      await page.goto('/recurring');
      await page.waitForLoadState('networkidle');

      await expect(page.getByText('Biweekly').first()).toBeVisible({ timeout: 5_000 });
    } finally {
      if (incomeId) await apiDelete(`/income/${incomeId}`);
    }

    noErrors.assert();
  });
});
