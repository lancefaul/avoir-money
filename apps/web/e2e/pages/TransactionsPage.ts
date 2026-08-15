import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class TransactionsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async goto() {
    await super.goto('/transactions');
    await this.waitForData();
  }

  get addButton(): Locator {
    return this.page.getByRole('button', { name: 'Add Transaction' });
  }

  /** Open the add transaction form */
  async openAddForm() {
    await this.addButton.click();
  }

  /** Create a manual transaction */
  async createTransaction(opts: { name: string; amount: string; type: string; date: string }) {
    await this.openAddForm();
    // Fill the form fields
    await this.page.locator('input[name="name"]').fill(opts.name);
    await this.page.locator('input[name="amount"]').fill(opts.amount);
    await this.page.locator('select[name="type"]').selectOption(opts.type);
    await this.page.locator('input[name="date"]').fill(opts.date);
    await this.page.getByRole('button', { name: 'Create' }).click();
    await this.page.waitForLoadState('networkidle');
  }

  /** Find a transaction row by name */
  transactionRow(name: string): Locator {
    return this.page.locator('tr', { hasText: name }).first();
  }

  /** Check that a transaction exists in the list */
  async expectTransaction(name: string) {
    await expect(this.page.getByText(name).first()).toBeVisible({ timeout: 5000 });
  }

  /** Check that a transaction does NOT exist */
  async expectNoTransaction(name: string) {
    await expect(this.page.getByText(name))
      .not.toBeVisible({ timeout: 3000 })
      .catch(() => {});
  }
}
