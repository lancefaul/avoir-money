export const SATS_PER_BTC = 100_000_000;

/** Full precision: "27,416,009 sats". */
export function formatSats(btcQuantity: number): string {
  const sats = Math.round(btcQuantity * SATS_PER_BTC);
  return `${sats.toLocaleString()} sats`;
}

/**
 * Abbreviated for narrow viewports.
 *
 *   < 10,000            exact          9,999 sats
 *   10,000 – 999,999    xxx.xxk        999.50k sats
 *   1,000,000 – <1 BTC  xxx.xxm        27.42m sats
 *   >= 1 BTC            xxx.xxx BTC    1.000 BTC
 *
 * The unit is chosen AFTER rounding, so a value never overflows its own bucket:
 * 999,999 sats renders "1.00m sats", not "1000.00k sats", and 99,999,999 renders
 * "1.000 BTC", not "100.00m sats". 100,000,000 sats is exactly 1 BTC, so a whole
 * coin is always denominated in BTC.
 *
 * Display only — never feed this back into a calculation.
 */
export function formatSatsCompact(btcQuantity: number): string {
  const sats = Math.round(btcQuantity * SATS_PER_BTC);

  if (sats < 10_000) return `${sats.toLocaleString()} sats`;

  if (sats < 1_000_000) {
    const k = (sats / 1_000).toFixed(2);
    if (Number(k) < 1_000) return `${k}k sats`;
    // rounded up into the next unit — fall through
  }

  if (sats < SATS_PER_BTC) {
    const m = (sats / 1_000_000).toFixed(2);
    if (Number(m) < 100) return `${m}m sats`;
    // rounded up to a whole coin — fall through
  }

  return `${(sats / SATS_PER_BTC).toFixed(3)} BTC`;
}
