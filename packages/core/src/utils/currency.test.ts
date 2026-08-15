import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatCurrencyCompact,
  parseCurrency,
  roundCurrency,
  addCurrency,
  sumCurrency,
  formatBtc,
  formatSats,
} from './currency.js';

describe('formatCurrency', () => {
  it('formats positive amounts', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });
  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });
  it('formats negative amounts', () => {
    expect(formatCurrency(-50)).toBe('-$50.00');
  });
  it('rounds to 2 decimals', () => {
    expect(formatCurrency(1.999)).toBe('$2.00');
  });
});

describe('formatCurrencyCompact', () => {
  it('formats thousands', () => {
    expect(formatCurrencyCompact(1500)).toMatch(/\$1\.5K/);
  });
  it('formats millions', () => {
    expect(formatCurrencyCompact(2500000)).toMatch(/\$2\.5M/);
  });
  it('formats small amounts', () => {
    expect(formatCurrencyCompact(50)).toMatch(/\$50/);
  });
});

describe('parseCurrency', () => {
  it('parses plain number', () => {
    expect(parseCurrency('1234.56')).toBe(1234.56);
  });
  it('strips dollar sign', () => {
    expect(parseCurrency('$1,234.56')).toBe(1234.56);
  });
  it('strips commas and spaces', () => {
    expect(parseCurrency('$ 1,000')).toBe(1000);
  });
  it('throws on invalid input', () => {
    expect(() => parseCurrency('abc')).toThrow();
  });
  it('throws on empty string', () => {
    expect(() => parseCurrency('')).toThrow();
  });
});

describe('roundCurrency', () => {
  it('rounds to 2 decimals', () => {
    expect(roundCurrency(1.005)).toBe(1.01);
  });
  it('handles exact values', () => {
    expect(roundCurrency(1.5)).toBe(1.5);
  });
  it('handles negative', () => {
    expect(roundCurrency(-1.999)).toBe(-2.0);
  });
});

describe('addCurrency', () => {
  it('adds two amounts', () => {
    expect(addCurrency(1.1, 2.2)).toBe(3.3);
  });
  it('avoids floating point drift', () => {
    expect(addCurrency(0.1, 0.2)).toBe(0.3);
  });
});

describe('sumCurrency', () => {
  it('sums array', () => {
    expect(sumCurrency([1.1, 2.2, 3.3])).toBe(6.6);
  });
  it('returns 0 for empty', () => {
    expect(sumCurrency([])).toBe(0);
  });
  it('handles single item', () => {
    expect(sumCurrency([99.99])).toBe(99.99);
  });
});

describe('formatBtc', () => {
  it('formats small amounts with 8 decimals', () => {
    expect(formatBtc(0.00000001)).toBe('0.00000001');
  });
  it('formats fractional BTC', () => {
    expect(formatBtc(0.00123456)).toBe('0.00123456');
  });
  it('formats whole BTC with decimals', () => {
    expect(formatBtc(1)).toBe('1.00000000');
  });
  it('formats large amounts with commas', () => {
    expect(formatBtc(1234.5678)).toBe('1,234.56780000');
  });
  it('formats zero', () => {
    expect(formatBtc(0)).toBe('0.00000000');
  });
  it('formats negative', () => {
    expect(formatBtc(-0.5)).toBe('-0.50000000');
  });
});

describe('formatSats', () => {
  it('formats small sats', () => {
    expect(formatSats(1)).toBe('1');
  });
  it('formats with commas', () => {
    expect(formatSats(1234)).toBe('1,234');
  });
  it('formats large sats', () => {
    expect(formatSats(123456789)).toBe('123,456,789');
  });
  it('formats zero', () => {
    expect(formatSats(0)).toBe('0');
  });
  it('rounds fractional input', () => {
    expect(formatSats(1234.7)).toBe('1,235');
  });
  it('formats negative', () => {
    expect(formatSats(-50000)).toBe('-50,000');
  });
});
