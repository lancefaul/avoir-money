import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

/**
 * AccountsPage page object — card-based layout.
 *
 * Accounts are displayed as cards grouped by type.
 * Add/Edit uses a Modal. Delete uses a Dialog with optional "Archive Instead".
 */
export class AccountsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async goto() {
    await super.goto('/accounts');
    await this.waitForData();
  }

  get addButton(): Locator {
    return this.page.getByRole('button', { name: 'Add Account' });
  }

  async openAddForm() {
    await this.addButton.click();
    await expect(this.page.getByRole('heading', { name: 'Add Account' })).toBeVisible();
  }

  async createAccount(data: { name: string; type: string; balance?: string }) {
    await this.openAddForm();
    await this.page.getByLabel('Name').fill(data.name);
    // Type uses a DS Select component
    await this.page.getByLabel('Type').click();
    await this.page.getByRole('option', { name: data.type }).click();
    if (data.balance) {
      await this.page.getByLabel('Starting Balance').fill(data.balance);
    }
    await this.page.getByRole('button', { name: 'Add' }).click();
    await this.page.waitForLoadState('networkidle');
  }

  async editAccount(name: string, newData: { name?: string }) {
    const card = this.page.locator('[class*="rounded"]', { hasText: name }).first();
    await card.getByRole('button', { name: 'Edit' }).click();
    if (newData.name) {
      await this.page.getByLabel('Name').fill(newData.name);
    }
    await this.page.getByRole('button', { name: 'Save' }).click();
    await this.page.waitForLoadState('networkidle');
  }

  async deleteAccount(name: string) {
    const card = this.page.locator('[class*="rounded"]', { hasText: name }).first();
    await card.getByRole('button', { name: 'Delete' }).click();
    // Confirm in the dialog
    await expect(this.page.getByText('Delete Account')).toBeVisible();
    await this.page.getByRole('button', { name: 'Delete' }).last().click();
    await this.page.waitForLoadState('networkidle');
  }

  async expectAccountVisible(name: string) {
    await expect(this.page.getByText(name).first()).toBeVisible({ timeout: 5_000 });
  }

  async expectAccountRemoved(name: string) {
    await expect(this.page.getByText(name, { exact: true })).not.toBeVisible({ timeout: 5_000 });
  }
}
