import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

/**
 * DebtsPage page object — card-based layout with overflow menu.
 *
 * Debts are displayed as cards with progress bars. Each card has an
 * OverflowMenu (⋮) with Edit and Delete actions. Delete uses ConfirmDialog.
 * Add/Edit uses the DebtForm modal.
 */
export class DebtsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async goto() {
    await super.goto('/debts');
    await this.waitForData();
  }

  get addButton(): Locator {
    return this.page.getByRole('button', { name: 'Add Debt' });
  }

  async openAddForm() {
    await this.addButton.click();
    await expect(this.page.getByRole('heading', { name: 'Add Debt' })).toBeVisible();
  }

  async createDebt(data: {
    name: string;
    type: string;
    originalBalance: string;
    currentBalance: string;
    apr: string;
    minimumPayment: string;
    frequency: string;
    startDate: string;
    maturityDate?: string;
  }) {
    await this.openAddForm();
    await this.page.getByLabel('Name').fill(data.name);
    await this.page.locator('select[name="type"]').selectOption(data.type);
    await this.page.locator('input[name="originalBalance"]').fill(data.originalBalance);
    await this.page.locator('input[name="currentBalance"]').fill(data.currentBalance);
    await this.page.locator('input[name="apr"]').fill(data.apr);
    await this.page.locator('input[name="minimumPayment"]').fill(data.minimumPayment);
    await this.page.locator('select[name="frequency"]').selectOption(data.frequency);
    await this.page.locator('input[name="startDate"]').fill(data.startDate);
    if (data.maturityDate) {
      await this.page.locator('input[name="maturityDate"]').fill(data.maturityDate);
    }
    const createBtn = this.page.getByRole('button', { name: 'Create' });
    await createBtn.scrollIntoViewIfNeeded();
    await createBtn.click();
    await this.page.waitForLoadState('networkidle');
  }

  async editDebt(name: string, newData: { name?: string }) {
    await this.openOverflowMenu(name);
    await this.page.getByRole('button', { name: 'Edit' }).click();
    await expect(this.page.getByText('Edit Debt')).toBeVisible();
    if (newData.name) {
      await this.page.locator('input[name="name"]').fill(newData.name);
    }
    await this.page.getByRole('button', { name: 'Save' }).click();
    await this.page.waitForLoadState('networkidle');
  }

  async deleteDebt(name: string) {
    await this.openOverflowMenu(name);
    await this.page.getByRole('button', { name: 'Delete' }).click();
    // Confirm in the ConfirmDialog
    await expect(this.page.getByText('Delete Debt')).toBeVisible();
    await this.page.getByRole('button', { name: 'Delete' }).last().click();
    await this.page.waitForLoadState('networkidle');
  }

  private async openOverflowMenu(name: string) {
    const card = this.page.locator('[class*="rounded-xl"]', { hasText: name }).first();
    await card
      .locator('button')
      .filter({ has: this.page.locator('svg') })
      .last()
      .click();
  }

  async expectDebtVisible(name: string) {
    await expect(this.page.getByText(name).first()).toBeVisible({ timeout: 5_000 });
  }

  async expectDebtRemoved(name: string) {
    await expect(this.page.getByText(name)).not.toBeVisible({ timeout: 5_000 });
  }

  async expandSchedule(name: string) {
    const card = this.page.locator('[class*="rounded-xl"]', { hasText: name }).first();
    await card.getByRole('button', { name: 'Schedule' }).click();
  }
}
