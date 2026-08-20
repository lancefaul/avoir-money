/**
 * Return all occurrences of a given weekday in a month (UTC midnight).
 */
export function allWeekdaysOfMonth(year: number, month: number, weekday: number): Date[] {
  const results: Date[] = [];
  const d = new Date(Date.UTC(year, month, 1));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCMonth() === month) {
    results.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return results;
}

/**
 * Calculate the date of the Nth weekday in a given month.
 * All dates are UTC midnight to stay consistent with Prisma storage.
 * @param year - Full year (e.g. 2026)
 * @param month - 0-indexed month (0=Jan)
 * @param weekday - 0=Sun, 1=Mon, ..., 6=Sat
 * @param ordinal - 0=every, 1=first, 2=second, 3=third, 4=fourth, -1=last
 * @returns Date (UTC midnight) or null if invalid
 */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  ordinal: number,
): Date | null {
  if (ordinal === -1) {
    // Last occurrence: start from end of month and walk back
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    const d = new Date(lastDay);
    while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }

  if (ordinal < 1 || ordinal > 4) return null;

  // Find the first occurrence of the weekday in the month
  const first = new Date(Date.UTC(year, month, 1));
  while (first.getUTCDay() !== weekday) first.setUTCDate(first.getUTCDate() + 1);

  // Add (ordinal - 1) weeks
  const result = new Date(first);
  result.setUTCDate(result.getUTCDate() + (ordinal - 1) * 7);

  // Verify it's still in the same month
  if (result.getUTCMonth() !== month) return null;
  return result;
}
