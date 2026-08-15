import type { PayScheduleType } from '../types/index.js';

/** Returns true if endDate is after or equal to startDate (or if either is absent). */
export function isValidDateRange(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
): boolean {
  if (startDate == null || endDate == null) return true;
  return endDate >= startDate;
}

/** Returns true if the pay schedule has the required day fields for its type. */
export function hasRequiredPayDays(
  type: PayScheduleType,
  firstPayDay: number | null | undefined,
  secondPayDay: number | null | undefined,
): boolean {
  if (type === 'MONTHLY') return firstPayDay != null;
  if (type === 'SEMI_MONTHLY') return firstPayDay != null && secondPayDay != null;
  return true; // WEEKLY and BIWEEKLY use anchorDate only
}

/** Returns true if a day number is valid for a given month (accounting for month length). */
export function isDayValidForMonth(day: number, month: number, year: number): boolean {
  // Day 0 of `month` (1-indexed) = last day of the previous 1-indexed month, i.e.
  // the length of month `month-1`. UTC form avoids any local-time / DST edge.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}
