import { describe, it, expect } from 'vitest';
import { occurrences, applyWeekendShift } from '../recurring.js';

describe('occurrences generator', () => {
  function collect(
    frequency: string,
    dueDay: number | null,
    dueWeekday: number | null,
    dueOrdinal: number | null,
    startDate: Date | null,
    endDate: Date | null,
    from: Date,
    to: Date,
  ): Date[] {
    return [
      ...occurrences(frequency, dueDay, dueWeekday, dueOrdinal, startDate, endDate, from, to),
    ];
  }

  describe('MONTHLY', () => {
    it('generates monthly occurrences with dueDay', () => {
      const from = new Date(Date.UTC(2026, 0, 1)); // Jan 1
      const to = new Date(Date.UTC(2026, 5, 30)); // Jun 30
      const result = collect('MONTHLY', 15, null, null, null, null, from, to);
      expect(result.length).toBe(6); // Jan-Jun
      expect(result[0]!.getUTCDate()).toBe(15);
      expect(result[0]!.getUTCMonth()).toBe(0); // Jan
      expect(result[5]!.getUTCMonth()).toBe(5); // Jun
    });

    it('clamps dueDay 31 in short months', () => {
      const from = new Date(Date.UTC(2026, 1, 1)); // Feb 1
      const to = new Date(Date.UTC(2026, 1, 28)); // Feb 28
      const result = collect('MONTHLY', 31, null, null, null, null, from, to);
      expect(result.length).toBe(1);
      expect(result[0]!.getUTCDate()).toBe(28); // clamped
    });

    it('respects startDate', () => {
      const from = new Date(Date.UTC(2026, 0, 1));
      const to = new Date(Date.UTC(2026, 5, 30));
      const startDate = new Date(Date.UTC(2026, 2, 1)); // March 1
      const result = collect('MONTHLY', 15, null, null, startDate, null, from, to);
      expect(result[0]!.getUTCMonth()).toBeGreaterThanOrEqual(2); // March or later
    });

    it('respects endDate', () => {
      const from = new Date(Date.UTC(2026, 0, 1));
      const to = new Date(Date.UTC(2026, 11, 31));
      const endDate = new Date(Date.UTC(2026, 3, 30)); // April 30
      const result = collect('MONTHLY', 15, null, null, null, endDate, from, to);
      const lastMonth = result[result.length - 1]!.getUTCMonth();
      expect(lastMonth).toBeLessThanOrEqual(3); // April or earlier
    });
  });

  describe('BIWEEKLY', () => {
    it('generates biweekly occurrences anchored to March 20 2026', () => {
      const from = new Date(Date.UTC(2026, 2, 6)); // Mar 6
      const to = new Date(Date.UTC(2026, 3, 17)); // Apr 17
      const result = collect('BIWEEKLY', null, null, null, null, null, from, to);
      expect(result.length).toBeGreaterThanOrEqual(2);
      // All occurrences should be 14 calendar days apart (use date math, not ms, to avoid DST drift)
      for (let i = 1; i < result.length; i++) {
        const prev = result[i - 1]!;
        const curr = result[i]!;
        const expected = new Date(
          Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate() + 14),
        );
        expect(curr.getUTCFullYear()).toBe(expected.getUTCFullYear());
        expect(curr.getUTCMonth()).toBe(expected.getUTCMonth());
        expect(curr.getUTCDate()).toBe(expected.getUTCDate());
      }
    });
  });

  describe('WEEKLY', () => {
    it('generates weekly occurrences on Sundays', () => {
      const from = new Date(Date.UTC(2026, 2, 1)); // Mar 1 (Sunday)
      const to = new Date(Date.UTC(2026, 2, 31)); // Mar 31
      const result = collect('WEEKLY', null, null, null, null, null, from, to);
      for (const d of result) {
        expect(d.getUTCDay()).toBe(0); // Sunday
      }
      expect(result.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('QUARTERLY', () => {
    it('generates quarterly occurrences', () => {
      const from = new Date(Date.UTC(2026, 0, 1));
      const to = new Date(Date.UTC(2026, 11, 31));
      const startDate = new Date(Date.UTC(2026, 0, 1)); // Jan start -> quarters at Jan, Apr, Jul, Oct
      const result = collect('QUARTERLY', 15, null, null, startDate, null, from, to);
      expect(result.length).toBe(4);
      const months = result.map((d) => d.getUTCMonth());
      expect(months).toEqual([0, 3, 6, 9]);
    });
  });

  describe('ANNUAL', () => {
    it('generates annual occurrence', () => {
      const from = new Date(Date.UTC(2026, 0, 1));
      const to = new Date(Date.UTC(2028, 11, 31));
      const startDate = new Date(Date.UTC(2026, 5, 15)); // June 15
      const result = collect('ANNUAL', 15, null, null, startDate, null, from, to);
      expect(result.length).toBe(3); // 2026, 2027, 2028
      for (const d of result) {
        expect(d.getUTCMonth()).toBe(5); // June
        expect(d.getUTCDate()).toBe(15);
      }
    });

    it('returns nothing without startDate', () => {
      const from = new Date(Date.UTC(2026, 0, 1));
      const to = new Date(Date.UTC(2026, 11, 31));
      const result = collect('ANNUAL', 15, null, null, null, null, from, to);
      expect(result.length).toBe(0);
    });
  });

  describe('SEMI_MONTHLY', () => {
    it('generates two occurrences per month', () => {
      const from = new Date(Date.UTC(2026, 3, 1)); // April 1
      const to = new Date(Date.UTC(2026, 3, 30)); // April 30
      const result = collect('SEMI_MONTHLY', 1, null, null, null, null, from, to);
      expect(result.length).toBe(2);
      expect(result[0]!.getUTCDate()).toBe(1);
      expect(result[1]!.getUTCDate()).toBe(15);
    });
  });

  describe('BIANNUAL', () => {
    it('defaults to January and July when no start date is provided', () => {
      const from = new Date(Date.UTC(2026, 0, 1));
      const to = new Date(Date.UTC(2026, 11, 31));
      const result = collect('BIANNUAL', 15, null, null, null, null, from, to);
      expect(result.length).toBe(2);
      const months = result.map((d) => d.getUTCMonth());
      expect(months).toEqual([0, 6]); // January and July
      for (const d of result) {
        expect(d.getUTCDate()).toBe(15);
      }
    });

    it('resolves dueWeekday/dueOrdinal correctly (2nd Tuesday of January and July)', () => {
      const from = new Date(Date.UTC(2026, 0, 1));
      const to = new Date(Date.UTC(2026, 11, 31));
      // dueWeekday=2 (Tuesday), dueOrdinal=2 (2nd)
      const result = collect('BIANNUAL', null, 2, 2, null, null, from, to);
      expect(result.length).toBe(2);
      // 2nd Tuesday of Jan 2026 = Jan 13
      expect(result[0]!.toISOString()).toBe('2026-01-13T00:00:00.000Z');
      // 2nd Tuesday of Jul 2026 = Jul 14
      expect(result[1]!.toISOString()).toBe('2026-07-14T00:00:00.000Z');
    });

    it('clamps dueDay=31 to Feb 28 in non-leap year and Feb 29 in leap year', () => {
      // Non-leap year: start in Feb → biannual months are Feb (1) and Aug (7)
      const from2026 = new Date(Date.UTC(2026, 0, 1));
      const to2026 = new Date(Date.UTC(2026, 11, 31));
      const startFeb = new Date(Date.UTC(2026, 1, 1)); // February start
      const result2026 = collect('BIANNUAL', 31, null, null, startFeb, null, from2026, to2026);
      expect(result2026.length).toBe(2);
      // Feb 2026 (non-leap): clamped to 28
      expect(result2026[0]!.getUTCMonth()).toBe(1);
      expect(result2026[0]!.getUTCDate()).toBe(28);
      // Aug 2026: 31 days, no clamping
      expect(result2026[1]!.getUTCMonth()).toBe(7);
      expect(result2026[1]!.getUTCDate()).toBe(31);

      // Leap year: 2028
      const from2028 = new Date(Date.UTC(2028, 0, 1));
      const to2028 = new Date(Date.UTC(2028, 11, 31));
      const startFeb2028 = new Date(Date.UTC(2028, 1, 1));
      const result2028 = collect('BIANNUAL', 31, null, null, startFeb2028, null, from2028, to2028);
      expect(result2028.length).toBe(2);
      // Feb 2028 (leap): clamped to 29
      expect(result2028[0]!.getUTCMonth()).toBe(1);
      expect(result2028[0]!.getUTCDate()).toBe(29);
      // Aug 2028: 31 days, no clamping
      expect(result2028[1]!.getUTCMonth()).toBe(7);
      expect(result2028[1]!.getUTCDate()).toBe(31);
    });
  });

  describe('MONTHLY with dueWeekday/dueOrdinal=0 (all weekdays)', () => {
    it('generates all occurrences of a weekday in each month when dueOrdinal is 0', () => {
      // dueOrdinal=0 triggers allWeekdaysOfMonth path
      // dueWeekday=1 (Monday), April 2026 has Mondays on 6, 13, 20, 27
      const from = new Date(Date.UTC(2026, 3, 1)); // April 1
      const to = new Date(Date.UTC(2026, 3, 30)); // April 30
      const result = collect('MONTHLY', null, 1, 0, null, null, from, to);
      expect(result.length).toBe(4);
      for (const d of result) {
        expect(d.getUTCDay()).toBe(1); // Monday
      }
      expect(result[0]!.getUTCDate()).toBe(6);
      expect(result[1]!.getUTCDate()).toBe(13);
      expect(result[2]!.getUTCDate()).toBe(20);
      expect(result[3]!.getUTCDate()).toBe(27);
    });
  });

  describe('MONTHLY with no dueDay and no dueWeekday', () => {
    it('returns nothing when neither dueDay nor dueWeekday/dueOrdinal is set', () => {
      const from = new Date(Date.UTC(2026, 0, 1));
      const to = new Date(Date.UTC(2026, 5, 30));
      const result = collect('MONTHLY', null, null, null, null, null, from, to);
      expect(result.length).toBe(0);
    });
  });

  describe('edge: empty range', () => {
    it('returns nothing when from > to', () => {
      const from = new Date(Date.UTC(2026, 5, 1));
      const to = new Date(Date.UTC(2026, 0, 1));
      const result = collect('MONTHLY', 15, null, null, null, null, from, to);
      expect(result.length).toBe(0);
    });
  });

  describe('edge: unknown frequency', () => {
    it('returns nothing for an unrecognized frequency', () => {
      const from = new Date(Date.UTC(2026, 0, 1));
      const to = new Date(Date.UTC(2026, 11, 31));
      const result = collect('DAILY', 15, null, null, null, null, from, to);
      expect(result.length).toBe(0);
    });
  });
});

describe('applyWeekendShift', () => {
  it('shifts Saturday to Monday', () => {
    // April 4, 2026 is a Saturday
    const sat = new Date(Date.UTC(2026, 3, 4));
    const result = applyWeekendShift(sat, true);
    expect(result.getUTCDay()).toBe(1); // Monday
    expect(result.getUTCDate()).toBe(6);
  });

  it('shifts Sunday to Monday', () => {
    // April 5, 2026 is a Sunday
    const sun = new Date(Date.UTC(2026, 3, 5));
    const result = applyWeekendShift(sun, true);
    expect(result.getUTCDay()).toBe(1); // Monday
    expect(result.getUTCDate()).toBe(6);
  });

  it('does not shift weekdays', () => {
    // April 6, 2026 is a Monday
    const mon = new Date(Date.UTC(2026, 3, 6));
    const result = applyWeekendShift(mon, true);
    expect(result.getTime()).toBe(mon.getTime());
  });

  it('returns original date when skipWeekend is false', () => {
    const sat = new Date(Date.UTC(2026, 3, 4));
    const result = applyWeekendShift(sat, false);
    expect(result.getTime()).toBe(sat.getTime());
  });

  it('does not shift Friday', () => {
    // April 3, 2026 is a Friday
    const fri = new Date(Date.UTC(2026, 3, 3));
    const result = applyWeekendShift(fri, true);
    expect(result.getTime()).toBe(fri.getTime());
  });
});
