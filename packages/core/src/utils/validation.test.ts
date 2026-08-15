import { describe, it, expect } from 'vitest';
import { isValidDateRange, hasRequiredPayDays, isDayValidForMonth } from './validation.js';

describe('isValidDateRange', () => {
  it('returns true when end >= start', () => {
    expect(isValidDateRange(new Date('2026-01-01'), new Date('2026-12-31'))).toBe(true);
  });
  it('returns true when dates are equal', () => {
    const d = new Date('2026-06-15');
    expect(isValidDateRange(d, d)).toBe(true);
  });
  it('returns false when end < start', () => {
    expect(isValidDateRange(new Date('2026-12-31'), new Date('2026-01-01'))).toBe(false);
  });
  it('returns true when start is null', () => {
    expect(isValidDateRange(null, new Date())).toBe(true);
  });
  it('returns true when end is null', () => {
    expect(isValidDateRange(new Date(), null)).toBe(true);
  });
  it('returns true when both null', () => {
    expect(isValidDateRange(null, null)).toBe(true);
  });
});

describe('hasRequiredPayDays', () => {
  it('WEEKLY needs nothing', () => {
    expect(hasRequiredPayDays('WEEKLY', null, null)).toBe(true);
  });
  it('BIWEEKLY needs nothing', () => {
    expect(hasRequiredPayDays('BIWEEKLY', null, null)).toBe(true);
  });
  it('MONTHLY needs firstPayDay', () => {
    expect(hasRequiredPayDays('MONTHLY', 1, null)).toBe(true);
    expect(hasRequiredPayDays('MONTHLY', null, null)).toBe(false);
  });
  it('SEMI_MONTHLY needs both', () => {
    expect(hasRequiredPayDays('SEMI_MONTHLY', 1, 15)).toBe(true);
    expect(hasRequiredPayDays('SEMI_MONTHLY', 1, null)).toBe(false);
    expect(hasRequiredPayDays('SEMI_MONTHLY', null, 15)).toBe(false);
  });
});

describe('isDayValidForMonth', () => {
  it('valid day in January', () => {
    expect(isDayValidForMonth(31, 1, 2026)).toBe(true);
  });
  it('invalid day 31 in February', () => {
    expect(isDayValidForMonth(31, 2, 2026)).toBe(false);
  });
  it('Feb 29 in leap year', () => {
    expect(isDayValidForMonth(29, 2, 2024)).toBe(true);
  });
  it('Feb 29 in non-leap year', () => {
    expect(isDayValidForMonth(29, 2, 2025)).toBe(false);
  });
  it('day 0 is invalid', () => {
    expect(isDayValidForMonth(0, 1, 2026)).toBe(false);
  });
  it('day 30 in April', () => {
    expect(isDayValidForMonth(30, 4, 2026)).toBe(true);
  });
  it('day 31 in April', () => {
    expect(isDayValidForMonth(31, 4, 2026)).toBe(false);
  });
});
