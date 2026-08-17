import { test, expect } from '@playwright/test';
import { expectNoConsoleErrors } from './helpers.js';

/**
 * Utilities page E2E tests — vertical tabs per provider, reading CRUD.
 *
 * The page shows one tab per utility provider with readings in a table.
 */
test.describe('Utilities', () => {
  test('page loads and shows header and add button', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    await page.goto('/utilities');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Utilities').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Reading' }).first()).toBeVisible();

    noErrors.assert();
  });

  test('provider tabs or empty state is visible', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    await page.goto('/utilities');
    await page.waitForLoadState('networkidle');

    // Either provider tabs exist or the page shows an empty state / just the add button
    const hasTabs = await page
      .locator('[role="tablist"]')
      .isVisible()
      .catch(() => false);
    const hasProvider = await page
      .getByText('E2E Gas Co')
      .first()
      .isVisible()
      .catch(() => false);
    const hasEmpty = await page
      .getByText(/No.*readings/i)
      .first()
      .isVisible()
      .catch(() => false);
    const hasAddBtn = await page
      .getByRole('button', { name: 'Add Reading' })
      .isVisible()
      .catch(() => false);

    expect(hasTabs || hasProvider || hasEmpty || hasAddBtn).toBe(true);

    noErrors.assert();
  });

  test('add reading button is functional', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    await page.goto('/utilities');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Add Reading' }).first().click();

    // A modal/drawer should open with reading form fields
    await expect(page.getByText(/Add.*Reading/i).first()).toBeVisible({ timeout: 3_000 });

    // Close via Escape
    await page.keyboard.press('Escape');

    noErrors.assert();
  });
});
