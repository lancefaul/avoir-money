import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

/**
 * Dashboard page object — matches the v2 Dashboard layout.
 *
 * The Dashboard has:
 * - A greeting section
 * - Two chart cards (SpendPredictionChart, NetSavingsBarChart)
 * - A "Pay Period" section with start–end dates
 * - CashSpendingCard and CreditSpendingCard
 * - A "Year to Date" section with 3 StatCards (Income, Expenses, Net)
 */
export class DashboardPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async goto() {
    await super.goto('/');
    await this.waitForData();
  }

  // ── Greeting ──

  get greeting(): Locator {
    return this.page.getByText(/Good (morning|afternoon|evening), Lance\./);
  }

  // ── Charts ──

  get spendPredictionChart(): Locator {
    return this.page.locator('.recharts-wrapper').first();
  }

  get savingsOutlookChart(): Locator {
    return this.page.locator('.recharts-wrapper').nth(1);
  }

  // ── Pay Period ──

  get payPeriodLabel(): Locator {
    return this.page.getByText('Pay Period').first();
  }

  get payPeriodDate(): Locator {
    // The date range paragraph immediately after the "Pay Period" label
    return this.page.getByText(/\w+ \d+, \d{4}\s*[—–]\s*\w+ \d+, \d{4}/).first();
  }

  // ── Spending Cards ──

  get cashSpendingCard(): Locator {
    return this.page
      .getByText('Cash Spending')
      .first()
      .locator('xpath=ancestor::*[contains(@class, "card") or contains(@class, "rounded")]')
      .first();
  }

  get creditSpendingCard(): Locator {
    return this.page
      .getByText('Credit Spending')
      .first()
      .locator('xpath=ancestor::*[contains(@class, "card") or contains(@class, "rounded")]')
      .first();
  }

  // ── Year to Date ──

  get ytdStatCards(): Locator {
    return this.page
      .getByText('Year to Date')
      .first()
      .locator('..')
      .locator('..')
      .locator('[class*="rounded"]');
  }

  // ── Mark as Paid ──

  /**
   * Mark an expense as paid from the CashSpendingCard or CreditSpendingCard.
   * Finds the row containing the expense name and clicks its "Paid" button.
   */
  async markExpenseAsPaid(name: string) {
    const row = this.page.locator('tr', { hasText: name }).first();
    await row.getByRole('button', { name: /Paid/ }).click();
    await this.page.waitForLoadState('networkidle');
  }

  /** Assert that a chart is rendered */
  async expectChartVisible() {
    // Recharts renders SVG elements — wait for any SVG chart container
    const chart = this.page
      .locator('.recharts-wrapper')
      .or(this.page.locator('svg.recharts-surface'));
    await expect(chart.first()).toBeVisible({ timeout: 15_000 });
  }

  /** Assert the Year to Date section shows data */
  async expectYtdSection() {
    await expect(this.page.getByText('Year to Date')).toBeVisible();
    await expect(this.page.getByText('Income').first()).toBeVisible();
    await expect(this.page.getByText('Expenses').first()).toBeVisible();
    await expect(this.page.getByText('Net').first()).toBeVisible();
  }
}
