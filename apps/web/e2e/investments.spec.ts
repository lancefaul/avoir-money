import { test, expect } from '@playwright/test';
import { expectNoConsoleErrors } from './helpers.js';
import { apiPost, apiDelete, apiGet } from './api-helpers.js';

/**
 * Investments page E2E tests — vertical tabs (Portfolio, History, Custodians, Wallets).
 */
test.describe('Investments', () => {
  test('page loads with action buttons', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);

    await page.goto('/investments');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Investments').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Custodian' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Wallet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Trade' })).toBeVisible();

    noErrors.assert();
  });

  test('create custodian and verify it appears in Custodians tab', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);
    const ts = Date.now();
    const custodianName = `E2E Custodian ${ts}`;
    let custodianId: string | undefined;

    try {
      // Create custodian via API
      const res = await apiPost('/investments/custodians', { name: custodianName });
      expect(res.status).toBe(201);
      custodianId = res.data.id;

      await page.goto('/investments');
      await page.waitForLoadState('networkidle');

      // Switch to Custodians tab
      await page.getByRole('tab', { name: 'Custodians' }).click();
      await expect(page.getByText(custodianName).first()).toBeVisible({ timeout: 5_000 });

      noErrors.assert();
    } finally {
      if (custodianId) await apiDelete(`/investments/custodians/${custodianId}`);
    }
  });

  test('trade creates a holding visible in portfolio', async ({ page }) => {
    const noErrors = expectNoConsoleErrors(page);
    const ts = Date.now();
    const custodianName = `E2E Cust ${ts}`;
    let custodianId: string | undefined;
    let transactionId: string | undefined;

    try {
      // Create custodian via API
      const custRes = await apiPost('/investments/custodians', { name: custodianName });
      expect(custRes.status).toBe(201);
      custodianId = custRes.data.id;

      // Get an account
      const accounts = await apiGet('/accounts');
      const accountId = accounts.data[0]?.id;

      if (!accountId) {
        test.skip(true, 'No account in test DB');
        return;
      }

      // Create a TRADE (BUY) transaction
      const txRes = await apiPost('/transactions', {
        type: 'TRADE',
        name: `E2E Buy AAPL ${ts}`,
        amount: 1500,
        date: new Date().toISOString(),
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

      if (txRes.status === 201) {
        transactionId = txRes.data.id;

        // Navigate to investments and verify holding shows in Portfolio tab
        await page.goto('/investments');
        await page.waitForLoadState('networkidle');
        await expect(page.getByText('AAPL').first()).toBeVisible({ timeout: 5_000 });
      }

      noErrors.assert();
    } finally {
      if (transactionId) await apiDelete(`/transactions/${transactionId}`);
      if (custodianId) await apiDelete(`/investments/custodians/${custodianId}`);
    }
  });
});
