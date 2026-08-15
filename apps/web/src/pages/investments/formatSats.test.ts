import { describe, it, expect } from 'vitest';
import { formatSats, formatSatsCompact, SATS_PER_BTC } from './formatSats.js';

/** Holdings are stored in BTC; the formatters take BTC and render sats. */
const btc = (sats: number) => sats / SATS_PER_BTC;

describe('formatSats', () => {
  it('renders full precision with thousands separators', () => {
    expect(formatSats(btc(27_416_009))).toBe('27,416,009 sats');
    expect(formatSats(btc(0))).toBe('0 sats');
  });
});

describe('formatSatsCompact', () => {
  it('leaves values under 10,000 exact', () => {
    expect(formatSatsCompact(btc(0))).toBe('0 sats');
    expect(formatSatsCompact(btc(1))).toBe('1 sats');
    expect(formatSatsCompact(btc(9_999))).toBe('9,999 sats');
  });

  it('uses k from 10,000 to 999,999', () => {
    expect(formatSatsCompact(btc(10_000))).toBe('10.00k sats');
    expect(formatSatsCompact(btc(12_345))).toBe('12.35k sats');
    expect(formatSatsCompact(btc(999_499))).toBe('999.50k sats');
  });

  it('uses m from 1,000,000 up to (but not including) 1 BTC', () => {
    expect(formatSatsCompact(btc(1_000_000))).toBe('1.00m sats');
    expect(formatSatsCompact(btc(6_336_829))).toBe('6.34m sats');
    expect(formatSatsCompact(btc(27_416_009))).toBe('27.42m sats');
    expect(formatSatsCompact(btc(33_752_838))).toBe('33.75m sats');
  });

  it('uses BTC at and above one whole coin', () => {
    expect(formatSatsCompact(btc(SATS_PER_BTC))).toBe('1.000 BTC');
    expect(formatSatsCompact(btc(250_000_000))).toBe('2.500 BTC');
    expect(formatSatsCompact(1.23456789)).toBe('1.235 BTC');
  });

  // The boundaries the unit is chosen AFTER rounding, so a value never overflows
  // its own bucket. These are the cases that would read as "1000.00k" / "100.00m".
  it('promotes to the next unit when rounding overflows the bucket', () => {
    expect(formatSatsCompact(btc(999_999))).toBe('1.00m sats');
    expect(formatSatsCompact(btc(999_995))).toBe('1.00m sats');
    expect(formatSatsCompact(btc(99_999_999))).toBe('1.000 BTC');
    expect(formatSatsCompact(btc(99_999_500))).toBe('1.000 BTC');
  });

  it('never renders a four-digit mantissa or a 100+ m value', () => {
    for (const sats of [9_999, 10_000, 999_994, 999_999, 1_000_000, 99_999_999, 100_000_000]) {
      const out = formatSatsCompact(btc(sats));
      expect(out).not.toMatch(/\d{4}\.\d+k/);
      expect(out).not.toMatch(/(?:[1-9]\d{2,})\.\d+m/);
    }
  });
});
