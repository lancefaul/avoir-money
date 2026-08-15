import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

/**
 * RecurringPage page object — handles both Expenses (/recurring) and Income (/income).
 *
 * The Expenses and Income pages share a similar structure:
 * - Table rows grouped by frequency (Weekly, Biweekly, Monthly, etc.)
 * - "Add Expense" / "Add Income" button opens a drawer/modal form
 * - Each row has an overflow menu (⋮) with Edit, Pause, Archive, Delete actions
 * - Delete shows a ConfirmDialog
 */
export class RecurringPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ── Navigation ──

  async gotoExpenses() {
    await super.goto('/recurring');
    await this.waitForData();
  }

  async gotoIncome() {
    await super.goto('/recurring');
    await this.waitForData();
    // Switch to Income tab
    await this.page.getByRole('tab', { name: 'Income' }).click();
  }

  // ── Add buttons ──

  async openAddExpense() {
    await this.page.getByRole('button', { name: 'Add Expense' }).click();
  }

  async openAddIncome() {
    await this.page.getByRole('button', { name: 'Add Income' }).click();
  }

  // ── Create expense ──

  async createExpense(data: { name: string; amount: string; frequency: string; dueDay?: string }) {
    await this.openAddExpense();

    await this.page.locator('input[name="name"]').fill(data.name);
    await this.page.locator('input[name="amount"]').first().fill(data.amount);
    await this.page.locator('select[name="frequency"]').selectOption(data.frequency);

    if (data.dueDay) {
      await this.page.locator('input[name="dueDay"]').fill(data.dueDay);
    } else {
      await this.page.locator('input[name="dueDay"]').fill('1');
    }

    // Select the first available budget category
    const categorySelect = this.page.locator('select[name="categoryId"]');
    const firstOption = categorySelect.locator('option:not([value=""])');
    const firstValue = await firstOption.first().getAttribute('value');
    if (firstValue) await categorySelect.selectOption(firstValue);

    const createBtn = this.page.getByRole('button', { name: 'Create' });
    await createBtn.scrollIntoViewIfNeeded();
    await createBtn.click();

    // Wait for form to close
    await expect(this.page.getByRole('heading', { name: 'Add Expense' })).not.toBeVisible({
      timeout: 5_000,
    });
    await this.page.waitForLoadState('networkidle');
  }

  // ── Create income ──

  async createIncome(data: { name: string; amount: string; frequency: string }) {
    await this.openAddIncome();

    await this.page.locator('input[name="name"]').fill(data.name);
    await this.page.locator('input[name="amount"]').first().fill(data.amount);
    await this.page.locator('select[name="frequency"]').selectOption(data.frequency);

    const createBtn = this.page.getByRole('button', { name: 'Create' });
    await createBtn.scrollIntoViewIfNeeded();
    await createBtn.click();

    // Wait for form to close
    await expect(this.page.getByRole('heading', { name: 'Add Income' })).not.toBeVisible({
      timeout: 5_000,
    });
    await this.page.waitForLoadState('networkidle');
  }

  // ── Edit expense ──

  async editExpense(name: string, newData: { name?: string; amount?: string }) {
    await this.openOverflowMenu(name);
    await this.page.getByRole('menuitem', { name: 'Edit' }).click();

    if (newData.name) {
      await this.page.locator('input[name="name"]').fill(newData.name);
    }
    if (newData.amount) {
      await this.page.locator('input[name="amount"]').first().fill(newData.amount);
    }

    await this.page.getByRole('button', { name: 'Save' }).click();
    await this.page.waitForLoadState('networkidle');
  }

  // ── Edit income ──

  async editIncome(name: string, newData: { name?: string; amount?: string }) {
    await this.openOverflowMenu(name);
    await this.page.getByRole('menuitem', { name: 'Edit' }).click();

    if (newData.name) {
      await this.page.locator('input[name="name"]').fill(newData.name);
    }
    if (newData.amount) {
      await this.page.locator('input[name="amount"]').first().fill(newData.amount);
    }

    await this.page.getByRole('button', { name: 'Save' }).click();
    await this.page.waitForLoadState('networkidle');
  }

  // ── Delete expense ──

  async deleteExpense(name: string) {
    await this.openOverflowMenu(name);
    await this.page.getByRole('menuitem', { name: 'Delete' }).click();

    // Handle the ConfirmDialog
    const confirmBtn = this.page.getByRole('button', { name: 'Delete' }).last();
    await expect(confirmBtn).toBeVisible({ timeout: 3_000 });
    await confirmBtn.click();
    await this.page.waitForLoadState('networkidle');
  }

  // ── Delete income ──

  async deleteIncome(name: string) {
    await this.openOverflowMenu(name);
    await this.page.getByRole('menuitem', { name: 'Delete' }).click();

    // Handle the ConfirmDialog
    const confirmBtn = this.page.getByRole('button', { name: 'Delete' }).last();
    await expect(confirmBtn).toBeVisible({ timeout: 3_000 });
    await confirmBtn.click();
    await this.page.waitForLoadState('networkidle');
  }

  // ── Helpers ──

  /** Open the overflow menu (⋮) for a row containing the given text */
  private async openOverflowMenu(name: string) {
    const row = this.page.locator('tr', { hasText: name }).first();
    // The overflow menu trigger is the last button in the row
    await row.locator('button').last().click();
  }

  /** Assert an expense/income row is visible */
  async expectRowVisible(name: string) {
    await expect(this.page.locator('table tr', { hasText: name }).first()).toBeVisible({
      timeout: 5_000,
    });
  }

  /** Assert an expense/income row is NOT visible */
  async expectRowRemoved(name: string) {
    await expect(this.page.locator('table tr', { hasText: name })).not.toBeVisible({
      timeout: 5_000,
    });
  }
}
