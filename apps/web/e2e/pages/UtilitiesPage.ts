import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class UtilitiesPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async goto() {
    await super.goto('/utilities');
    await this.waitForData();
  }

  /** Click a utility type tab */
  async selectTab(type: 'Electric' | 'Gas' | 'Water' | 'Sewage' | 'Garbage') {
    await this.page.getByRole('button', { name: type, exact: true }).click();
    await this.page.waitForLoadState('networkidle');
  }

  /** Get the active tab */
  get activeTab(): Locator {
    return this.page.locator('button.border-blue-600');
  }

  /** Get the readings table */
  get readingsTable(): Locator {
    return this.page.locator('table').first();
  }

  /** Open add reading form */
  async openAddReading() {
    await this.page.getByRole('button', { name: 'Add Reading' }).click();
    await expect(
      this.page.locator('h2', { hasText: /Add Utility Reading|Edit Reading/ }),
    ).toBeVisible();
  }

  /** Check for empty state */
  async expectEmptyState(type: string) {
    await expect(this.page.getByText(`No readings for ${type}`)).toBeVisible();
  }
}
