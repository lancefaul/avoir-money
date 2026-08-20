import { type Page, expect } from '@playwright/test';

/**
 * Shared E2E helpers for CRUD tests.
 *
 * These complement the page-object pattern in ./pages/ with
 * cross-cutting utilities that every CRUD spec needs.
 */

// ---------------------------------------------------------------------------
// Form filling
// ---------------------------------------------------------------------------

export type FieldEntry = {
  label: string;
  value: string;
  /** 'input' (default) fills a text/number input; 'select' picks an <option> */
  type?: 'input' | 'select';
};

/**
 * Fill multiple form fields by their `name` attribute.
 *
 * ```ts
 * await fillForm(page, [
 *   { label: 'Name', value: 'Rent' },
 *   { label: 'Amount', value: '1200' },
 *   { label: 'Frequency', value: 'MONTHLY', type: 'select' },
 * ]);
 * ```
 */
export async function fillForm(page: Page, fields: FieldEntry[]) {
  for (const { label, value, type = 'input' } of fields) {
    // Try getByLabel first; fall back to input[name] if label association is missing
    const byLabel = page.getByLabel(label);
    // Convert label to camelCase name attribute: "Original Balance" → "originalBalance", "APR" → "apr"
    const nameAttr = label
      .split(/\s+/)
      .map((w, i) =>
        i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      )
      .join('');
    const byName =
      type === 'select'
        ? page.locator(`select[name="${nameAttr}"]`)
        : page.locator(`input[name="${nameAttr}"]`);
    const locator = (await byLabel.count()) === 1 ? byLabel : byName;
    if (type === 'select') {
      await locator.selectOption(value);
    } else {
      await locator.fill(value);
    }
  }
}

// ---------------------------------------------------------------------------
// Console error collection
// ---------------------------------------------------------------------------

/**
 * Collect console errors emitted during a test and assert none occurred.
 *
 * Usage — call at the start of a test to begin collecting, then call the
 * returned `assert` function at the end:
 *
 * ```ts
 * const noErrors = expectNoConsoleErrors(page);
 * // ... interact with the page ...
 * noErrors.assert();
 * ```
 */
export function expectNoConsoleErrors(page: Page) {
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore expected 400 Bad Request errors from form validation
      if (text.includes('400') && text.includes('Bad Request')) return;
      // Ignore Vite HMR WebSocket connection errors in test environment
      if (text.includes('WebSocket') && (text.includes('vite') || text.includes('ws://'))) return;
      if (text.includes('[vite]')) return;
      // Ignore 404 resource loading errors (favicon, fonts in CI)
      if (text.includes('404') || text.includes('Failed to load resource')) return;
      errors.push(text);
    }
  });

  return {
    /** Assert that no console errors were recorded. */
    assert() {
      expect(errors, 'Expected no console errors').toEqual([]);
    },
    /** Access raw collected errors (for debugging). */
    errors,
  };
}

// ---------------------------------------------------------------------------
// CRUD verification helpers
// ---------------------------------------------------------------------------

/**
 * Assert a row containing `text` is visible inside a `<table>`.
 */
export async function expectRowVisible(page: Page, text: string) {
  await expect(page.locator('table tr', { hasText: text }).first()).toBeVisible({ timeout: 5_000 });
}

/**
 * Assert a row containing `text` is NOT visible inside a `<table>`.
 */
export async function expectRowRemoved(page: Page, text: string) {
  await expect(page.locator('table tr', { hasText: text })).not.toBeVisible({ timeout: 5_000 });
}
