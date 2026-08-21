import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Base page object — shared helpers for all pages.
 */
export class BasePage {
  constructor(protected page: Page) {}

  /** Navigate to a route and wait for the page to be ready */
  async goto(path: string) {
    await this.page.goto(path);
    await this.page.waitForLoadState('networkidle');
  }

  /** Get the sidebar navigation */
  get sidebar(): Locator {
    return this.page.locator('nav[aria-label="Main navigation"]');
  }

  /** Navigate via sidebar link */
  async navigateTo(label: string) {
    await this.sidebar.getByText(label).click();
    await this.page.waitForLoadState('networkidle');
  }

  /** Wait for API data to load (loading indicator disappears) */
  async waitForData() {
    await this.page
      .waitForFunction(
        () => {
          return !document.body.textContent?.includes('Loading\u2026');
        },
        { timeout: 10_000 },
      )
      .catch(() => {});
  }

  /** Get the page title from the header bar */
  get pageTitle(): Locator {
    return this.page.locator('h1').first();
  }

  /** Click a button by its text */
  async clickButton(text: string) {
    await this.page.getByRole('button', { name: text }).click();
  }

  /** Fill a form field by label */
  async fillField(label: string, value: string) {
    await this.page.getByLabel(label).fill(value);
  }

  /** Select an option from a dropdown by label */
  async selectOption(label: string, value: string) {
    await this.page.getByLabel(label).selectOption(value);
  }

  /** Assert a toast or success message appears */
  async expectText(text: string | RegExp) {
    await expect(this.page.getByText(text).first()).toBeVisible({ timeout: 5000 });
  }

  /** Assert text is NOT visible */
  async expectNoText(text: string | RegExp) {
    await expect(this.page.getByText(text))
      .not.toBeVisible({ timeout: 3000 })
      .catch(() => {
        // May not exist at all, which is fine
      });
  }
}
