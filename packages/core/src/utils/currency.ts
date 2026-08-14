const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const USD_COMPACT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Format a number as "$1,234.56" */
export function formatCurrency(amount: number): string {
  return USD.format(amount);
}

/** Format a number as "$1.2K", "$34.5K", "$1.2M" etc. */
export function formatCurrencyCompact(amount: number): string {
  return USD_COMPACT.format(amount);
}

/**
 * Parse a user-entered currency string to a number.
 * Strips "$", commas, and whitespace. Throws if unparseable.
 */
export function parseCurrency(value: string): number {
  const cleaned = value.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) {
    throw new Error(`Cannot parse as currency: "${value}"`);
  }
  return num;
}

/* ─── Bitcoin formatters ─── */

const BTC = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 8,
  maximumFractionDigits: 8,
});

const SATS = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Format a number as BTC with 8 decimal places: "0.00123456", "1,234.56780000" */
export function formatBtc(amount: number): string {
  return BTC.format(amount);
}

/** Format a number as sats (integer, commas): "123,456" */
export function formatSats(amount: number): string {
  return SATS.format(Math.round(amount));
}

/* ─── Currency math helpers ─── */

/** Round to 2 decimal places (avoids floating-point drift). */
export function roundCurrency(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** Add two currency amounts with correct rounding. */
export function addCurrency(a: number, b: number): number {
  return roundCurrency(a + b);
}

/** Sum an array of currency amounts. */
export function sumCurrency(amounts: number[]): number {
  return amounts.reduce((acc, n) => roundCurrency(acc + n), 0);
}
