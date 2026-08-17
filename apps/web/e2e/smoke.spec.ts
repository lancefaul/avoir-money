import { test, expect } from '@playwright/test';
import { expectNoConsoleErrors } from './helpers.js';

/**
 * Smoke tests — verify all 10 routes load without errors.
 *
 * Each test: navigate, wait for data, assert no error boundary,
 * assert no console errors, assert page title visible, assert content visible.
 */

const routes = [
  { name: 'Dashboard', path: '/', title: 'Dashboard' },
  { name: 'Recurring', path: '/recurring', title: 'Recurring' },
  { name: 'Transactions', path: '/transactions', title: 'Transactions' },
  { name: 'Accounts', path: '/accounts', title: 'Accounts' },
  { name: 'Utilities', path: '/utilities', title: 'Utilities' },
  { name: 'Healthcare', path: '/healthcare', title: 'Health Insurance' },
  { name: 'Investments', path: '/investments', title: 'Investments' },
  { name: 'Budgets', path: '/budgets', title: 'Budgets' },
  { name: 'Debts', path: '/debts', title: 'Debts' },
];

test.describe('Smoke Tests', () => {
  for (const route of routes) {
    test(`${route.name} (${route.path}) loads without errors`, async ({ page }) => {
      const noErrors = expectNoConsoleErrors(page);

      await page.goto(route.path);
      await page.waitForLoadState('networkidle');

      // Wait for loading indicators to disappear
      await page
        .waitForFunction(
          () => {
            return !document.body.textContent?.includes('Loading\u2026');
          },
          { timeout: 10_000 },
        )
        .catch(() => {});

      // Assert no error boundary
      await expect(page.getByText('Runtime Error')).not.toBeVisible();
      await expect(page.getByText('Something went wrong')).not.toBeVisible();

      // Assert page title visible
      await expect(page.getByText(route.title).first()).toBeVisible();

      // Assert some content is rendered (not an empty page)
      const bodyText = await page.locator('body').textContent();
      expect(bodyText?.length).toBeGreaterThan(50);

      noErrors.assert();
    });
  }
});
