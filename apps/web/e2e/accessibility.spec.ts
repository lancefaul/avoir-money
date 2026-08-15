import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Accessibility tests using axe-core.
 * Runs WCAG 2.1 AA checks on each major page.
 *
 * Rule exclusions:
 * - nested-interactive: account cards use div[role=button] with overflow menu inside
 * - color-contrast: some DS components (progress bars, badges) have contrast issues
 *   in specific states that are tracked separately
 */

const pages = [
  { name: 'Dashboard', path: '/' },
  { name: 'Recurring', path: '/recurring' },
  { name: 'Transactions', path: '/transactions' },
  { name: 'Accounts', path: '/accounts' },
  { name: 'Utilities', path: '/utilities' },
  { name: 'Healthcare', path: '/healthcare' },
  { name: 'Investments', path: '/investments' },
  { name: 'Budgets', path: '/budgets' },
  { name: 'Debts', path: '/debts' },
];

test.describe('Accessibility', () => {
  for (const { name, path } of pages) {
    test(`${name} page passes axe accessibility checks`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      // Wait for data to load (unicode ellipsis)
      await page
        .waitForFunction(() => !document.body.textContent?.includes('Loading\u2026'), {
          timeout: 10_000,
        })
        .catch(() => {});

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        // Exclude known third-party chart elements that may not be fully accessible
        .exclude('.recharts-wrapper')
        // nested-interactive: account cards use div[role=button] with overflow menu inside
        // color-contrast: progress bar segments and badge backgrounds in specific states
        //   have contrast ratios below 4.5:1 — tracked as DS-level fix
        // aria-progressbar-name: DS ProgressBar components lack explicit aria-label (DS fix)
        .disableRules(['nested-interactive', 'color-contrast', 'aria-progressbar-name'])
        .analyze();

      // Log violations for debugging
      if (results.violations.length > 0) {
        const summary = results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes.length,
        }));
        console.log(`Accessibility violations on ${name}:`, JSON.stringify(summary, null, 2));
      }

      // Assert no critical or serious violations
      const critical = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(critical, `Critical/serious a11y violations on ${name} page`).toHaveLength(0);
    });
  }
});
