import { test, expect } from '@playwright/test';
import { expectNoConsoleErrors, expectRowVisible } from './helpers.js';
import { apiPost, apiDelete, apiGet } from './api-helpers.js';

/**
 * Multi-account payment splits (payment-split, ADR-030), end to end.
 *
 * A split writes a balance-neutral Anchor plus one leg per funding account. The
 * global transaction log collapses that group to a single row with an
 * account-count badge; each account's own ledger shows just its leg. This test
 * drives the split through the API (the create-group path task 4 covers with
 * integration tests) and asserts the two UI behaviors the web work adds.
 */
test.describe('Payment split', () => {
  test('a split collapses to one badged row in the log; each account keeps its leg', async ({
    page,
  }) => {
    const noErrors = expectNoConsoleErrors(page);
    const ts = Date.now();
    const name = `E2E Split ${ts}`;
    let groupId: string | undefined;
    const createdAccountIds: string[] = [];

    // Two dedicated funding accounts so the test is independent of seed data.
    for (const label of ['A', 'B']) {
      const res = await apiPost('/accounts', {
        name: `E2E Split Acct ${label} ${ts}`,
        type: 'Checking',
        balance: 100,
      });
      expect(res.status).toBe(201);
      createdAccountIds.push(res.data.id);
    }
    const [acctA, acctB] = createdAccountIds;

    try {
      const res = await apiPost('/purchases', {
        name,
        date: new Date().toISOString(),
        amount: 100,
        payments: [
          { accountId: acctA, amount: 60 },
          { accountId: acctB, amount: 40 },
        ],
      });
      expect(res.status).toBe(201);
      expect(res.data.purchaseGroupId).toBeTruthy();
      expect(res.data.transactionIds).toHaveLength(3); // anchor + 2 legs
      groupId = res.data.purchaseGroupId;

      // ── Global log: one collapsed row with a 2-account badge ──
      await page.goto('/transactions');
      await page.waitForLoadState('networkidle');

      await expectRowVisible(page, name);
      /*
       * The account-count badge (Wallet + leg count) is described by a DS
       * Tooltip, NOT a native `title` attribute — ADR-006 renders tooltips as a
       * portalled `role="tooltip"` shown on hover/focus, with `aria-describedby`
       * wiring it to the trigger.
       *
       * This assertion used to be `getByTitle('Paid from 2 accounts')`, written
       * when the badge did carry a raw title. Two days later that title was
       * migrated to the DS Tooltip (QUALITY.md requires it), which made the
       * assertion unsatisfiable — and it went unnoticed for two weeks because
       * the e2e job was gated behind a failing test job the whole time.
       */
      const badge = page.getByTestId('account-count-badge').first();
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText('2');

      // The tooltip NAMES the funding accounts rather than counting them —
      // "A purchase group lists all its funding accounts (truncated with a
      // tooltip) rather than a bare count" (TransactionList.tsx). Order follows
      // the group's leg order, so assert on membership, not on a joined string.
      await badge.hover();
      const tip = page.getByRole('tooltip');
      await expect(tip).toContainText('Paid from');
      await expect(tip).toContainText(`E2E Split Acct A ${ts}`);
      await expect(tip).toContainText(`E2E Split Acct B ${ts}`);

      // And the account cell lists both, so the legs are folded into this one
      // row rather than appearing as loose rows of their own.
      const accountCell = page.getByText(`E2E Split Acct`, { exact: false }).first();
      await expect(accountCell).toBeVisible();

      // ── Each account's ledger holds exactly its leg ──
      const legA = await apiGet(`/transactions?accountId=${acctA}`);
      const legsForA = legA.data.transactions.filter((t: { name: string }) => t.name === name);
      expect(legsForA).toHaveLength(1);
      expect(Number(legsForA[0].amount)).toBe(60);

      noErrors.assert();
    } finally {
      if (groupId) await apiDelete(`/purchases/${groupId}`);
      for (const id of createdAccountIds) await apiDelete(`/accounts/${id}`);
    }
  });
});
