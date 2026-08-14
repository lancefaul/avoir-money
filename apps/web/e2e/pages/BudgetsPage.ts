import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

/**
 * BudgetsPage page object.
 *
 * Budget items are displayed in groups with progress bars.
 * Add/Edit uses BudgetItemForm dialog. Delete uses BudgetItemDeleteDialog.
 * Groups are managed via NewGroupModal.
 */
export class BudgetsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async goto() {
    await super.goto('/budgets');
    await this.waitForData();
  }

  get addBudgetButton(): Locator {
    return this.page.getByRole('button', { name: 'Add Budget' });
  }

  get newGroupButton(): Locator {
    return this.page.getByRole('button', { name: 'New Group' });
  }

  async openAddBudget() {
    await this.addBudgetButton.click();
    await expect(this.page.getByRole('heading', { name: 'Add Budget' })).toBeVisible();
  }

  async createBudget(data: { name: string }) {
    await this.openAddBudget();
    await this.page.getByLabel('Name').fill(data.name);
    // Pick the first emoji
    await this.page.locator('button[aria-label="Pick an emoji"]').click();
    await this.page
      .locator('[role="dialog"][aria-label="Emoji picker"] .grid button')
      .first()
      .click();
    await this.page.getByRole('button', { name: 'Create', exact: true }).click();
    await this.page.waitForLoadState('networkidle');
  }

  async editBudget(name: string, newData: { name?: string }) {
    await this.page.getByRole('button', { name: `Edit ${name}` }).click();
    await expect(this.page.getByText('Edit Budget')).toBeVisible();
    if (newData.name) {
      await this.page.locator('input[name="name"]').fill(newData.name);
    }
    await this.page.getByRole('button', { name: 'Save' }).click();
    await this.page.waitForLoadState('networkidle');
  }

  async deleteBudget(name: string) {
    await this.page.getByRole('button', { name: `Delete ${name}` }).click();
    await this.page.waitForLoadState('networkidle');
  }

  async createGroup(name: string) {
    await this.newGroupButton.click();
    await expect(this.page.getByText('New Budget Group')).toBeVisible();
    await this.page.locator('input[name="name"]').fill(name);
    await this.page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(this.page.getByText('New Budget Group')).not.toBeVisible({ timeout: 5_000 });
    await this.page.waitForLoadState('networkidle');
  }

  async expectBudgetVisible(name: string) {
    await expect(this.page.getByText(name, { exact: true }).first()).toBeVisible({
      timeout: 5_000,
    });
  }

  async expectBudgetRemoved(name: string) {
    await expect(this.page.getByText(name, { exact: true })).not.toBeVisible({ timeout: 5_000 });
  }
}
