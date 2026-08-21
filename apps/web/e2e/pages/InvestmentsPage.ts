import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

/**
 * InvestmentsPage page object.
 *
 * Investments page has tabs: Portfolio, History, Custodians, Wallets.
 * Actions: Add Custodian, Add Wallet, New Trade.
 * Holdings are displayed in a table within the Portfolio tab.
 */
export class InvestmentsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async goto() {
    await super.goto('/investments');
    await this.waitForData();
  }

  get addCustodianButton(): Locator {
    return this.page.getByRole('button', { name: 'Add Custodian' });
  }

  get addWalletButton(): Locator {
    return this.page.getByRole('button', { name: 'Add Wallet' });
  }

  get newTradeButton(): Locator {
    return this.page.getByRole('button', { name: 'New Trade' });
  }

  async selectTab(tab: 'Portfolio' | 'History' | 'Custodians' | 'Wallets') {
    await this.page.getByRole('tab', { name: tab }).click();
  }

  async createCustodian(name: string) {
    await this.addCustodianButton.click();
    await expect(this.page.getByRole('heading', { name: 'Add Custodian' })).toBeVisible();
    await this.page.locator('[role="dialog"]').locator('input').first().fill(name);
    await this.page.getByRole('button', { name: 'Add' }).click();
    await this.page.waitForLoadState('networkidle');
  }

  async createWallet(name: string) {
    await this.addWalletButton.click();
    await expect(this.page.getByRole('heading', { name: 'Add Wallet' })).toBeVisible();
    await this.page.locator('[role="dialog"]').locator('input').first().fill(name);
    await this.page.getByRole('button', { name: 'Add' }).click();
    await this.page.waitForLoadState('networkidle');
  }

  async expectHoldingVisible(ticker: string) {
    await expect(this.page.getByText(ticker).first()).toBeVisible({ timeout: 5_000 });
  }

  async expectCustodianVisible(name: string) {
    await expect(this.page.getByText(name).first()).toBeVisible({ timeout: 5_000 });
  }
}
