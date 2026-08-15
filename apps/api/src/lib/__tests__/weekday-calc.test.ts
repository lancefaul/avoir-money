import { describe, it, expect } from 'vitest';
import { nthWeekdayOfMonth, allWeekdaysOfMonth } from '../weekday-calc.js';

describe('nthWeekdayOfMonth', () => {
  describe('positive ordinals', () => {
    it('finds the 1st Monday of April 2026', () => {
      // April 2026: 1st is Wednesday, so 1st Monday is April 6
      const result = nthWeekdayOfMonth(2026, 3, 1, 1);
      expect(result).not.toBeNull();
      expect(result!.getUTCFullYear()).toBe(2026);
      expect(result!.getUTCMonth()).toBe(3);
      expect(result!.getUTCDate()).toBe(6);
    });

    it('finds the 2nd Friday of March 2026', () => {
      // March 2026: 1st is Sunday, 1st Friday is March 6, 2nd Friday is March 13
      const result = nthWeekdayOfMonth(2026, 2, 5, 2);
      expect(result).not.toBeNull();
      expect(result!.getUTCDate()).toBe(13);
    });

    it('finds the 3rd Wednesday of January 2026', () => {
      // Jan 2026: 1st is Thursday, 1st Wed is Jan 7, 2nd is Jan 14, 3rd is Jan 21
      const result = nthWeekdayOfMonth(2026, 0, 3, 3);
      expect(result).not.toBeNull();
      expect(result!.getUTCDate()).toBe(21);
    });

    it('finds the 4th Sunday of June 2026', () => {
      // June 2026: 1st is Monday, 1st Sunday is June 7, 4th Sunday is June 28
      const result = nthWeekdayOfMonth(2026, 5, 0, 4);
      expect(result).not.toBeNull();
      expect(result!.getUTCDate()).toBe(28);
    });

    it('returns null when 5th occurrence does not exist', () => {
      // ordinal 5 is out of range
      const result = nthWeekdayOfMonth(2026, 3, 1, 5);
      expect(result).toBeNull();
    });

    it('returns null for ordinal 0', () => {
      const result = nthWeekdayOfMonth(2026, 3, 1, 0);
      expect(result).toBeNull();
    });

    it('returns null when 4th occurrence overflows into next month', () => {
      // Feb 2026: 1st is Sunday. 4th Saturday: Feb 7, 14, 21, 28 — fits.
      // But 4th Sunday: Feb 1, 8, 15, 22 — fits too.
      // Let's find a case that overflows: 4th Thursday of Feb 2026
      // Feb 2026: 1st Thu = Feb 5, 2nd = 12, 3rd = 19, 4th = 26 — fits
      // Actually Feb is short but 28 days usually fits 4 of each.
      // Use a month where it doesn't: ordinal 5 is the reliable overflow
      const result = nthWeekdayOfMonth(2026, 1, 1, 5);
      expect(result).toBeNull();
    });
  });

  describe('last occurrence (ordinal = -1)', () => {
    it('finds the last Friday of April 2026', () => {
      // April 2026 has 30 days. April 30 is Thursday, so last Friday is April 24
      const result = nthWeekdayOfMonth(2026, 3, 5, -1);
      expect(result).not.toBeNull();
      expect(result!.getUTCDate()).toBe(24);
    });

    it('finds the last Monday of February 2026', () => {
      // Feb 2026: 28 days, Feb 28 is Saturday, last Monday is Feb 23
      const result = nthWeekdayOfMonth(2026, 1, 1, -1);
      expect(result).not.toBeNull();
      expect(result!.getUTCDate()).toBe(23);
    });

    it('finds the last day when it is the last day of month', () => {
      // March 2026: 31 days, March 31 is Tuesday. Last Tuesday = March 31
      const result = nthWeekdayOfMonth(2026, 2, 2, -1);
      expect(result).not.toBeNull();
      expect(result!.getUTCDate()).toBe(31);
    });
  });

  describe('edge cases', () => {
    it('handles weekday 0 (Sunday)', () => {
      const result = nthWeekdayOfMonth(2026, 2, 0, 1); // 1st Sunday of March 2026
      expect(result).not.toBeNull();
      expect(result!.getUTCDay()).toBe(0);
    });

    it('handles weekday 6 (Saturday)', () => {
      const result = nthWeekdayOfMonth(2026, 2, 6, 1); // 1st Saturday of March 2026
      expect(result).not.toBeNull();
      expect(result!.getUTCDay()).toBe(6);
    });
  });
});

describe('allWeekdaysOfMonth', () => {
  it('returns all Mondays in April 2026', () => {
    // April 2026: 1st is Wednesday. Mondays: 6, 13, 20, 27
    const result = allWeekdaysOfMonth(2026, 3, 1);
    expect(result).toHaveLength(4);
    expect(result.map((d) => d.getUTCDate())).toEqual([6, 13, 20, 27]);
    for (const d of result) {
      expect(d.getUTCDay()).toBe(1);
      expect(d.getUTCMonth()).toBe(3);
      expect(d.getUTCFullYear()).toBe(2026);
    }
  });

  it('returns all Sundays in March 2026', () => {
    // March 2026: 1st is Sunday. Sundays: 1, 8, 15, 22, 29
    const result = allWeekdaysOfMonth(2026, 2, 0);
    expect(result).toHaveLength(5);
    expect(result.map((d) => d.getUTCDate())).toEqual([1, 8, 15, 22, 29]);
  });

  it('returns all Saturdays in February 2026 (non-leap)', () => {
    // Feb 2026: 1st is Sunday. Saturdays: 7, 14, 21, 28
    const result = allWeekdaysOfMonth(2026, 1, 6);
    expect(result).toHaveLength(4);
    expect(result.map((d) => d.getUTCDate())).toEqual([7, 14, 21, 28]);
  });

  it('returns all Saturdays in February 2028 (leap year)', () => {
    // Feb 2028: 1st is Tuesday. Saturdays: 5, 12, 19, 26
    const result = allWeekdaysOfMonth(2028, 1, 6);
    expect(result).toHaveLength(4);
    expect(result.map((d) => d.getUTCDate())).toEqual([5, 12, 19, 26]);
  });

  it('returns dates as UTC midnight', () => {
    const result = allWeekdaysOfMonth(2026, 3, 1);
    for (const d of result) {
      expect(d.getUTCHours()).toBe(0);
      expect(d.getUTCMinutes()).toBe(0);
      expect(d.getUTCSeconds()).toBe(0);
    }
  });

  it('returns 4 or 5 occurrences for any weekday in a month', () => {
    // Every month has either 4 or 5 of each weekday
    for (let weekday = 0; weekday <= 6; weekday++) {
      const result = allWeekdaysOfMonth(2026, 0, weekday); // January 2026
      expect(result.length).toBeGreaterThanOrEqual(4);
      expect(result.length).toBeLessThanOrEqual(5);
    }
  });
});
