import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatCurrencyCompact,
  formatCurrencyWhole,
  formatDate,
  formatDateNumeric,
  formatShortDate,
  cn,
  frequencyLabel,
} from './utils.js';

describe('formatCurrencyWhole', () => {
  it('rounds to whole dollars without abbreviating', () => {
    expect(formatCurrencyWhole(14509.3)).toBe('$14,509');
    expect(formatCurrencyWhole(45678.25)).toBe('$45,678');
    expect(formatCurrencyWhole(1234567.89)).toBe('$1,234,568');
  });
  it('keeps the sign on negatives', () => {
    expect(formatCurrencyWhole(-50.5)).toBe('-$51');
  });
  it('clamps near-zero to $0', () => {
    expect(formatCurrencyWhole(-0.001)).toBe('$0');
  });
});

describe('formatCurrency', () => {
  it('formats positive', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });
  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });
  it('formats negative', () => {
    expect(formatCurrency(-50)).toBe('-$50.00');
  });
});

describe('formatDate', () => {
  it('formats ISO string', () => {
    expect(formatDate('2026-03-20')).toBe('Mar 20, 2026');
  });
  it('formats Date object', () => {
    expect(formatDate(new Date(2026, 2, 20))).toBe('Mar 20, 2026');
  });
});

describe('formatDateNumeric', () => {
  it('formats ISO string as MM-DD-YYYY', () => {
    expect(formatDateNumeric('2026-03-20')).toBe('03-20-2026');
  });

  it('formats a Date object', () => {
    expect(formatDateNumeric(new Date(2026, 2, 20))).toBe('03-20-2026');
  });

  it('zero-pads single-digit months and days', () => {
    expect(formatDateNumeric('2026-01-05')).toBe('01-05-2026');
  });

  it('does not slip a day on a UTC-midnight date', () => {
    // The API returns dates as UTC midnight. Read with local getters west of
    // Greenwich, 2026-03-20T00:00:00Z renders as the 19th — the whole reason
    // this goes through parseLocal.
    expect(formatDateNumeric(new Date('2026-03-20T00:00:00.000Z'))).toBe('03-20-2026');
  });
});

describe('formatShortDate', () => {
  it('formats short', () => {
    expect(formatShortDate('2026-03-20')).toBe('Mar 20');
  });
});

describe('cn', () => {
  it('joins classes', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });
  it('filters falsy', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
  it('returns empty for all falsy', () => {
    expect(cn(false, null)).toBe('');
  });
});

describe('frequencyLabel', () => {
  it('maps known frequencies', () => {
    expect(frequencyLabel('BIWEEKLY')).toBe('Biweekly');
    expect(frequencyLabel('MONTHLY')).toBe('Monthly');
    expect(frequencyLabel('ONE_TIME')).toBe('One-time');
    expect(frequencyLabel('ANNUAL')).toBe('Annual');
  });
  it('returns raw for unknown', () => {
    expect(frequencyLabel('CUSTOM')).toBe('CUSTOM');
  });
});

describe('formatCurrencyCompact', () => {
  it('renders whole dollars under $10,000', () => {
    expect(formatCurrencyCompact(0)).toBe('$0');
    expect(formatCurrencyCompact(121.2)).toBe('$121');
    expect(formatCurrencyCompact(1156.08)).toBe('$1,156');
    expect(formatCurrencyCompact(9999.49)).toBe('$9,999');
  });

  it('uses k from $10,000 to $999,999', () => {
    expect(formatCurrencyCompact(10_000)).toBe('$10.00k');
    expect(formatCurrencyCompact(16_432.89)).toBe('$16.43k');
    expect(formatCurrencyCompact(20_207.28)).toBe('$20.21k');
    expect(formatCurrencyCompact(999_499)).toBe('$999.50k');
  });

  it('uses m at and above $1,000,000', () => {
    expect(formatCurrencyCompact(1_000_000)).toBe('$1.00m');
    expect(formatCurrencyCompact(1_250_000)).toBe('$1.25m');
  });

  it('promotes to the next unit when rounding overflows the bucket', () => {
    // would otherwise render "$10,000" — a 5-digit value in the sub-10k bucket
    expect(formatCurrencyCompact(9999.99)).toBe('$10.00k');
    // would otherwise render "$1000.00k"
    expect(formatCurrencyCompact(999_999.99)).toBe('$1.00m');
  });

  it('keeps the sign on negative values', () => {
    expect(formatCurrencyCompact(-121.2)).toBe('-$121');
    expect(formatCurrencyCompact(-6085.58)).toBe('-$6,086');
    expect(formatCurrencyCompact(-16_432.89)).toBe('-$16.43k');
    expect(formatCurrencyCompact(-1_250_000)).toBe('-$1.25m');
  });

  it('clamps near-zero to zero like formatCurrency', () => {
    expect(formatCurrencyCompact(-0.001)).toBe('$0');
    expect(formatCurrencyCompact(0.004)).toBe('$0');
  });
});
