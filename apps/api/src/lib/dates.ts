/**
 * Centralized date utilities — the anti-UTC module.
 *
 * Prisma stores DateTime as UTC midnight. ALL dates created for Prisma
 * queries must also be UTC midnight to avoid timezone boundary mismatches.
 *
 * Rules:
 *   1. Use `localDate()` to extract year/month/day from any Date (Prisma or JS)
 *   2. Use `today()` for the current date — returns UTC midnight
 *   3. Use `makeDate()` to build dates — returns UTC midnight
 *   4. Use `monthRange()` for month boundaries — returns UTC midnight
 *   5. Use `sameDay()` for date-only comparison
 *   6. Never pass local-midnight dates into Prisma queries
 */

/** Extract year/month/day from any Date, treating it as a UTC calendar date.
 *  For Prisma dates stored as UTC midnight, this correctly reads the intended date. */
export function localDate(d: Date): { year: number; month: number; day: number } {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

/** Get today as UTC midnight — safe for Prisma queries */
export function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** Create a UTC midnight Date from year/month/day — safe for Prisma queries */
export function makeDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

/** Compare two dates by calendar day only (ignoring time and timezone) */
export function sameDay(a: Date, b: Date): boolean {
  const la = localDate(a);
  const lb = localDate(b);
  return la.year === lb.year && la.month === lb.month && la.day === lb.day;
}

/** Return the next calendar day at UTC midnight — useful for exclusive upper bounds in date range queries.
 *  Converts `lte: endDate` (which misses non-midnight times) to `lt: dayAfter(endDate)`. */
export function dayAfter(d: Date): Date {
  const { year, month, day } = localDate(d);
  return new Date(Date.UTC(year, month, day + 1));
}

/** Create a Date range for a given month — both boundaries are UTC midnight.
 *  Returns [start, end) where start is 1st of month and end is 1st of next month. */
export function monthRange(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
  };
}
