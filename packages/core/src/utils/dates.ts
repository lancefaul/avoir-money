import type { PayScheduleType } from '../types/index.js';

// ─── Types ───

export type GeneratePeriodsInput = {
  scheduleType: PayScheduleType;
  /** Required for WEEKLY and BIWEEKLY. A known pay date to step from. */
  anchorDate?: Date;
  /** Required for SEMI_MONTHLY and MONTHLY. First pay day of month (1–31). */
  firstPayDay?: number;
  /** Required for SEMI_MONTHLY. Second pay day of month (1–31). */
  secondPayDay?: number;
  rangeStart: Date;
  rangeEnd: Date;
};

export type GeneratedPeriod = {
  startDate: Date;
  endDate: Date;
  payDate: Date;
  year: number;
  periodNum: number;
};

// ─── Pure date helpers (no external deps) ───
// ALL helpers use UTC to match Prisma's UTC-midnight storage.

function norm(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function lastDayOfMonth(year: number, month: number): Date {
  // month is 0-indexed; day 0 of next month = last day of current month
  return new Date(Date.UTC(year, month + 1, 0));
}

function clampDay(year: number, month: number, day: number): Date {
  const last = lastDayOfMonth(year, month).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last)));
}

// ─── WEEKLY ───

function generateWeekly(anchor: Date, start: Date, end: Date): GeneratedPeriod[] {
  // Extend generation to the start of anchor's year (for correct periodNum)
  const genFrom = new Date(Date.UTC(start.getUTCFullYear(), 0, 1));
  const genTo = addDays(end, 7);

  // Walk back from anchor to before genFrom
  let probe = norm(anchor);
  while (probe > genFrom) probe = addDays(probe, -7);
  while (probe < genFrom) probe = addDays(probe, 7);
  // probe is the first pay date on or after genFrom

  // Back up one to ensure we don't miss anything
  probe = addDays(probe, -7);

  // Collect all pay dates in [genFrom, genTo] grouped by year
  const byYear = new Map<number, Date[]>();
  let pd = probe;
  while (pd <= genTo) {
    if (pd >= genFrom) {
      const y = pd.getUTCFullYear();
      const bucket = byYear.get(y) ?? [];
      bucket.push(new Date(pd.getTime()));
      byYear.set(y, bucket);
    }
    pd = addDays(pd, 7);
  }

  // Build periods, filtering to [start, end]
  const result: GeneratedPeriod[] = [];
  for (const [year, payDates] of byYear) {
    payDates.sort((a, b) => a.getTime() - b.getTime());
    payDates.forEach((payDate, idx) => {
      if (payDate >= start && payDate <= end) {
        result.push({
          startDate: payDate,
          endDate: addDays(payDate, 6),
          payDate,
          year,
          periodNum: idx + 1,
        });
      }
    });
  }

  return result.sort((a, b) => a.payDate.getTime() - b.payDate.getTime());
}

// ─── BIWEEKLY ───

function generateBiweekly(anchor: Date, start: Date, end: Date): GeneratedPeriod[] {
  const genFrom = new Date(Date.UTC(start.getUTCFullYear(), 0, 1));
  const genTo = addDays(end, 14);

  let probe = norm(anchor);
  while (probe > genFrom) probe = addDays(probe, -14);
  while (probe < genFrom) probe = addDays(probe, 14);
  probe = addDays(probe, -14); // one step back for safety

  const byYear = new Map<number, Date[]>();
  let pd = probe;
  while (pd <= genTo) {
    if (pd >= genFrom) {
      const y = pd.getUTCFullYear();
      const bucket = byYear.get(y) ?? [];
      bucket.push(new Date(pd.getTime()));
      byYear.set(y, bucket);
    }
    pd = addDays(pd, 14);
  }

  const result: GeneratedPeriod[] = [];
  for (const [year, payDates] of byYear) {
    payDates.sort((a, b) => a.getTime() - b.getTime());
    payDates.forEach((payDate, idx) => {
      if (payDate >= start && payDate <= end) {
        result.push({
          startDate: payDate,
          endDate: addDays(payDate, 13),
          payDate,
          year,
          periodNum: idx + 1,
        });
      }
    });
  }

  return result.sort((a, b) => a.payDate.getTime() - b.payDate.getTime());
}

// ─── SEMI_MONTHLY ───

function generateSemiMonthly(
  firstPayDay: number,
  secondPayDay: number,
  start: Date,
  end: Date,
): GeneratedPeriod[] {
  const result: GeneratedPeriod[] = [];

  let year = start.getUTCFullYear();
  let month = start.getUTCMonth(); // 0-indexed
  let periodNum = month * 2 + 1; // start counting from Jan

  // Step back to Jan of start year for correct periodNum
  const startYear = start.getUTCFullYear();
  year = startYear;
  month = 0;
  periodNum = 1;

  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();

  while (year < endYear || (year === endYear && month <= endMonth)) {
    // First period of month: 1st → 14th, payDate = firstPayDay
    const p1Pay = clampDay(year, month, firstPayDay);
    const p1Start = new Date(Date.UTC(year, month, 1));
    const p1End = new Date(Date.UTC(year, month, 14));

    if (p1Pay >= start && p1Pay <= end) {
      result.push({
        startDate: p1Start,
        endDate: p1End,
        payDate: p1Pay,
        year,
        periodNum,
      });
    }
    periodNum++;

    // Second period of month: 15th → last day, payDate = secondPayDay
    const p2Pay = clampDay(year, month, secondPayDay);
    const p2Start = new Date(Date.UTC(year, month, 15));
    const p2End = lastDayOfMonth(year, month);

    if (p2Pay >= start && p2Pay <= end) {
      result.push({
        startDate: p2Start,
        endDate: p2End,
        payDate: p2Pay,
        year,
        periodNum,
      });
    }
    periodNum++;

    month++;
    if (month > 11) {
      month = 0;
      year++;
      periodNum = 1; // reset each year (1–24)
    }
  }

  return result;
}

// ─── MONTHLY ───

function generateMonthly(firstPayDay: number, start: Date, end: Date): GeneratedPeriod[] {
  const result: GeneratedPeriod[] = [];

  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();

  let year = startYear;
  let month = 0;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const payDate = clampDay(year, month, firstPayDay);
    const periodStart = new Date(Date.UTC(year, month, 1));
    const periodEnd = lastDayOfMonth(year, month);

    if (payDate >= start && payDate <= end) {
      result.push({
        startDate: periodStart,
        endDate: periodEnd,
        payDate,
        year,
        periodNum: month + 1, // 1–12 = calendar month
      });
    }

    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }

  return result;
}

// ─── Public API ───

/**
 * Generate pay periods for a given schedule configuration and date range.
 *
 * Pure function — no DB access, no side effects.
 * Used by the API for period generation and by the frontend for preview/display.
 *
 * @example
 * // Biweekly schedule, anchor 2026-03-20, all of 2026
 * generatePayPeriods({
 *   scheduleType: 'BIWEEKLY',
 *   anchorDate: new Date('2026-03-20'),
 *   rangeStart: new Date('2026-01-01'),
 *   rangeEnd: new Date('2026-12-31'),
 * });
 */
export function generatePayPeriods(input: GeneratePeriodsInput): GeneratedPeriod[] {
  const { scheduleType, anchorDate, firstPayDay, secondPayDay, rangeStart, rangeEnd } = input;

  const start = norm(rangeStart);
  const end = norm(rangeEnd);

  if (end < start) return [];

  switch (scheduleType) {
    case 'WEEKLY':
      if (!anchorDate) throw new Error('anchorDate is required for WEEKLY schedules');
      return generateWeekly(anchorDate, start, end);

    case 'BIWEEKLY':
      if (!anchorDate) throw new Error('anchorDate is required for BIWEEKLY schedules');
      return generateBiweekly(anchorDate, start, end);

    case 'SEMI_MONTHLY':
      if (firstPayDay == null || secondPayDay == null) {
        throw new Error('firstPayDay and secondPayDay are required for SEMI_MONTHLY schedules');
      }
      return generateSemiMonthly(firstPayDay, secondPayDay, start, end);

    case 'MONTHLY':
      if (firstPayDay == null) {
        throw new Error('firstPayDay is required for MONTHLY schedules');
      }
      return generateMonthly(firstPayDay, start, end);
  }
}

/**
 * Find the pay period that contains a given date.
 * Returns null if none of the provided periods cover the date.
 */
export function findPeriodForDate(date: Date, periods: GeneratedPeriod[]): GeneratedPeriod | null {
  const d = norm(date);
  return periods.find((p) => norm(p.startDate) <= d && d <= norm(p.endDate)) ?? null;
}
