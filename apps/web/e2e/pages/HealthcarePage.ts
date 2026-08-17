import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

/**
 * HealthcarePage page object.
 *
 * Healthcare page has:
 * - Tabs: Medical, Dental, Vision
 * - Year selector
 * - Policy cards with progress bars
 * - Transaction list per policy
 * - Add Policy button opens PolicyFormModal
 */
export class HealthcarePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async goto() {
    await super.goto('/healthcare');
    await this.waitForData();
  }

  get addPolicyButton(): Locator {
    return this.page.getByRole('button', { name: 'Add Policy' });
  }

  get yearSelect(): Locator {
    return this.page.locator('#year-select');
  }

  async selectTab(tab: 'Medical' | 'Dental' | 'Vision') {
    await this.page.locator('nav[aria-label="Policy type tabs"] button', { hasText: tab }).click();
  }

  async openAddPolicy() {
    await this.addPolicyButton.click();
  }

  async createPolicy(data: {
    type: 'MEDICAL' | 'DENTAL' | 'VISION';
    employer: string;
    premium: string;
    insurer: string;
    year?: string;
  }) {
    await this.openAddPolicy();
    await expect(this.page.getByText('New Insurance Policy')).toBeVisible();

    const modal = this.page.locator('[role="dialog"]').or(this.page.locator('.fixed'));
    await modal.locator('select').first().selectOption(data.type);

    if (data.year) {
      await this.page.getByLabel('Year').fill(data.year);
    }
    await this.page.getByLabel('Employer').fill(data.employer);
    await this.page.getByLabel('Premium').fill(data.premium);
    await this.page.getByLabel('Insurer').fill(data.insurer);

    await this.page.locator('form').getByRole('button', { name: 'Create Policy' }).click();
    await expect(this.page.getByText('New Insurance Policy')).not.toBeVisible({ timeout: 5_000 });
    await this.page.waitForLoadState('networkidle');
  }

  async expectPolicyVisible(text: string) {
    await expect(this.page.getByText(text).first()).toBeVisible({ timeout: 5_000 });
  }

  async expectEmptyState(type: string) {
    await expect(this.page.getByText(`No ${type.toLowerCase()} policies`)).toBeVisible();
  }
}
