import { describe, it, expect } from 'vitest';
import { generatePayPeriods, findPeriodForDate } from './dates.js';
import type { GeneratedPeriod } from './dates.js';

function d(s: string): Date {
  return new Date(s + 'T00:00:00');
}

describe('generatePayPeriods', () => {
  describe('BIWEEKLY', () => {
    const anchor = d('2026-03-20');

    it('generates correct number of periods for a year', () => {
      const periods = generatePayPeriods({
        scheduleType: 'BIWEEKLY',
        anchorDate: anchor,
        rangeStart: d('2026-01-01'),
        rangeEnd: d('2026-12-31'),
      });
      expect(periods.length).toBeGreaterThanOrEqual(26);
      expect(periods.length).toBeLessThanOrEqual(27);
    });

    it('each period spans 14 days', () => {
      const periods = generatePayPeriods({
        scheduleType: 'BIWEEKLY',
        anchorDate: anchor,
        rangeStart: d('2026-01-01'),
        rangeEnd: d('2026-06-30'),
      });
      for (const p of periods) {
        const diff = Math.round(
          (p.endDate.getTime() - p.startDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        expect(diff).toBe(13);
      }
    });

    it('periods are sequential and non-overlapping', () => {
      const periods = generatePayPeriods({
        scheduleType: 'BIWEEKLY',
        anchorDate: anchor,
        rangeStart: d('2026-01-01'),
        rangeEnd: d('2026-12-31'),
      });
      for (let i = 1; i < periods.length; i++) {
        expect(periods[i]!.startDate.getTime()).toBeGreaterThan(periods[i - 1]!.endDate.getTime());
      }
    });

    it('periodNum increments within year', () => {
      const periods = generatePayPeriods({
        scheduleType: 'BIWEEKLY',
        anchorDate: anchor,
        rangeStart: d('2026-01-01'),
        rangeEnd: d('2026-12-31'),
      });
      const nums = periods.map((p) => p.periodNum);
      for (let i = 1; i < nums.length; i++) {
        expect(nums[i]).toBeGreaterThan(nums[i - 1]!);
      }
    });

    it('throws without anchorDate', () => {
      expect(() =>
        generatePayPeriods({
          scheduleType: 'BIWEEKLY',
          rangeStart: d('2026-01-01'),
          rangeEnd: d('2026-12-31'),
        }),
      ).toThrow();
    });

    it('returns empty for reversed range', () => {
      expect(
        generatePayPeriods({
          scheduleType: 'BIWEEKLY',
          anchorDate: anchor,
          rangeStart: d('2026-12-31'),
          rangeEnd: d('2026-01-01'),
        }),
      ).toEqual([]);
    });
  });

  describe('WEEKLY', () => {
    const anchor = d('2026-03-20');

    it('generates ~52 periods for a year', () => {
      const periods = generatePayPeriods({
        scheduleType: 'WEEKLY',
        anchorDate: anchor,
        rangeStart: d('2026-01-01'),
        rangeEnd: d('2026-12-31'),
      });
      expect(periods.length).toBeGreaterThanOrEqual(52);
      expect(periods.length).toBeLessThanOrEqual(53);
    });

    it('each period spans 7 days', () => {
      const periods = generatePayPeriods({
        scheduleType: 'WEEKLY',
        anchorDate: anchor,
        rangeStart: d('2026-03-01'),
        rangeEnd: d('2026-04-30'),
      });
      for (const p of periods) {
        const diff = Math.round(
          (p.endDate.getTime() - p.startDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        expect(diff).toBe(6);
      }
    });
  });

  describe('MONTHLY', () => {
    it('generates 12 periods for a year', () => {
      const periods = generatePayPeriods({
        scheduleType: 'MONTHLY',
        firstPayDay: 1,
        rangeStart: d('2026-01-01'),
        rangeEnd: d('2026-12-31'),
      });
      expect(periods.length).toBe(12);
    });

    it('periodNum matches calendar month', () => {
      const periods = generatePayPeriods({
        scheduleType: 'MONTHLY',
        firstPayDay: 15,
        rangeStart: d('2026-01-01'),
        rangeEnd: d('2026-12-31'),
      });
      periods.forEach((p) => {
        expect(p.periodNum).toBe(p.payDate.getUTCMonth() + 1);
      });
    });

    it('clamps day 31 in short months', () => {
      const periods = generatePayPeriods({
        scheduleType: 'MONTHLY',
        firstPayDay: 31,
        rangeStart: d('2026-02-01'),
        rangeEnd: d('2026-02-28'),
      });
      expect(periods.length).toBe(1);
      expect(periods[0]!.payDate.getUTCDate()).toBe(28); // Feb 2026 has 28 days
    });

    it('throws without firstPayDay', () => {
      expect(() =>
        generatePayPeriods({
          scheduleType: 'MONTHLY',
          rangeStart: d('2026-01-01'),
          rangeEnd: d('2026-12-31'),
        }),
      ).toThrow();
    });
  });

  describe('SEMI_MONTHLY', () => {
    it('generates 24 periods for a year', () => {
      const periods = generatePayPeriods({
        scheduleType: 'SEMI_MONTHLY',
        firstPayDay: 1,
        secondPayDay: 15,
        rangeStart: d('2026-01-01'),
        rangeEnd: d('2026-12-31'),
      });
      expect(periods.length).toBe(24);
    });

    it('first period ends on 14th, second ends on last day', () => {
      const periods = generatePayPeriods({
        scheduleType: 'SEMI_MONTHLY',
        firstPayDay: 1,
        secondPayDay: 15,
        rangeStart: d('2026-03-01'),
        rangeEnd: d('2026-03-31'),
      });
      expect(periods.length).toBe(2);
      expect(periods[0]!.endDate.getUTCDate()).toBe(14);
      expect(periods[1]!.endDate.getUTCDate()).toBe(31);
    });

    it('throws without both pay days', () => {
      expect(() =>
        generatePayPeriods({
          scheduleType: 'SEMI_MONTHLY',
          firstPayDay: 1,
          rangeStart: d('2026-01-01'),
          rangeEnd: d('2026-12-31'),
        }),
      ).toThrow();
    });
  });
});

describe('findPeriodForDate', () => {
  const periods: GeneratedPeriod[] = [
    {
      startDate: d('2026-01-01'),
      endDate: d('2026-01-14'),
      payDate: d('2026-01-01'),
      year: 2026,
      periodNum: 1,
    },
    {
      startDate: d('2026-01-15'),
      endDate: d('2026-01-28'),
      payDate: d('2026-01-15'),
      year: 2026,
      periodNum: 2,
    },
  ];

  it('finds period containing date', () => {
    const result = findPeriodForDate(d('2026-01-10'), periods);
    expect(result?.periodNum).toBe(1);
  });

  it('finds period on start boundary', () => {
    expect(findPeriodForDate(d('2026-01-15'), periods)?.periodNum).toBe(2);
  });

  it('finds period on end boundary', () => {
    expect(findPeriodForDate(d('2026-01-14'), periods)?.periodNum).toBe(1);
  });

  it('returns null for date outside all periods', () => {
    expect(findPeriodForDate(d('2026-02-01'), periods)).toBeNull();
  });
});
