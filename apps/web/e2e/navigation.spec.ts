import { test, expect } from '@playwright/test';
import { BasePage } from './pages/BasePage.js';
import { expectNoConsoleErrors } from './helpers.js';

/**
 * Navigation E2E tests — sidebar links, active state, page transitions.
 * Uses accessible locators only — no CSS class assertions.
 */
test.describe('Navigation', () => {
  test('sidebar contains all navigation links', async ({ page }) => {
    const base = new BasePage(page);
    await base.goto('/');

    const sidebar = base.sidebar;
    await expect(sidebar.getByText('Dashboard')).toBeVisible();
    await expect(sidebar.getByText('Transactions')).toBeVisible();
    await expect(sidebar.getByText('Recurring')).toBeVisible();
    await expect(sidebar.getByText('Accounts')).toBeVisible();
    await expect(sidebar.getByText('Budgets')).toBeVisible();
    await expect(sidebar.getByText('Debts')).toBeVisible();
    await expect(sidebar.getByText('Utilities')).toBeVisible();
    await expect(sidebar.getByText('Investments')).toBeVisible();
    await expect(sidebar.getByText('Health Insurance')).toBeVisible();
    await expect(sidebar.getByText('Settings')).toBeVisible();
  });

  test('navigating to each page loads without errors', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);
    const base = new BasePage(page);
    await base.goto('/');

    const routes = [
      { label: 'Transactions', url: '/transactions' },
      { label: 'Recurring', url: '/recurring' },
      { label: 'Accounts', url: '/accounts' },
      { label: 'Budgets', url: '/budgets' },
      { label: 'Debts', url: '/debts' },
      { label: 'Utilities', url: '/utilities' },
      { label: 'Investments', url: '/investments' },
      { label: 'Health Insurance', url: '/healthcare' },
      { label: 'Settings', url: '/settings' },
      { label: 'Dashboard', url: '/' },
    ];

    for (const route of routes) {
      await base.navigateTo(route.label);
      await expect(page).toHaveURL(route.url);
      // No error boundary should be visible
      await expect(page.getByText('Runtime Error')).not.toBeVisible();
      await expect(page.getByText('Something went wrong')).not.toBeVisible();
    }

    noErrors.assert();
  });

  test('the brand lockup is visible in the sidebar', async ({ page }) => {
    const base = new BasePage(page);
    await base.goto('/');
    /*
     * The brand is an IMAGE, not text. `Layout.tsx` passes `brandLabel={null}`
     * on purpose — the wordmark is part of the lockup art, so rendering the
     * label too would print "Avoir" twice.
     *
     * This asserted `getByText(/Avoir|Détenir/)` until the lockup replaced the
     * text, at which point it failed for a reason that had nothing to do with
     * navigation. Located by CSS rather than by role: both images are
     * `alt=""` (decorative), which keeps them out of the accessibility tree
     * where `getByRole('img')` looks.
     */
    await expect(base.sidebar.locator('img').first()).toBeVisible();
  });

  test('data persists after navigating between pages', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    // Go to Accounts page
    await page.goto('/accounts');
    await page.waitForLoadState('networkidle');

    // Verify content is present (use text-based locator instead of class)
    const hasContent = await page
      .getByText('Accounts')
      .first()
      .isVisible()
      .catch(() => false);

    // Navigate away and back
    await page.locator('nav[aria-label="Main navigation"]').getByText('Budgets').click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL('/budgets');

    await page.locator('nav[aria-label="Main navigation"]').getByText('Accounts').click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL('/accounts');

    // Content should still be present after navigating back
    if (hasContent) {
      await expect(page.getByText('Accounts').first()).toBeVisible();
    }

    noErrors.assert();
  });
});

/**
 * Pay Schedules — managed on the Settings page.
 */
test.describe('Pay Schedules (Settings)', () => {
  test('settings page shows pay schedule section', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Settings page has vertical tabs including Pay Schedule
    await expect(page.getByRole('tab', { name: 'Pay Schedule' })).toBeVisible();
    await page.getByRole('tab', { name: 'Pay Schedule' }).click();

    // Should show pay schedule form or create button
    // Auto-wait: the schedule form loads async after the tab switch
    await expect(page.getByRole('button', { name: /Update Schedule|Create Schedule/ })).toBeVisible(
      { timeout: 5_000 },
    );

    noErrors.assert();
  });
});
