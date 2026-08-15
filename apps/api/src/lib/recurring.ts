/**
 * Auto-generate missing recurring transactions up to today.
 * Called on transactions list and dashboard load.
 */
import { prisma } from '@budget-tracker/db';
import { nthWeekdayOfMonth, allWeekdaysOfMonth } from './weekday-calc.js';
import { makeDate } from './dates.js';
import { ledgerUpdate } from './lifecycle/index.js';

function clampDay(year: number, month: number, day: number): Date {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return makeDate(year, month, Math.min(day, last));
}

/**
 * Compute the total bill amount from a utility reading.
 * Total = cost + convenienceFee (dollar or percent) + otherFees.
 */
export function computeUtilityTotalBill(reading: {
  cost: number | { toNumber(): number };
  convenienceFee: number | { toNumber(): number } | null;
  convenienceFeeType: string | null;
  otherFees: number | { toNumber(): number } | null;
}): number {
  const cost = typeof reading.cost === 'number' ? reading.cost : reading.cost.toNumber();
  const fee =
    reading.convenienceFee != null
      ? typeof reading.convenienceFee === 'number'
        ? reading.convenienceFee
        : reading.convenienceFee.toNumber()
      : 0;
  const other =
    reading.otherFees != null
      ? typeof reading.otherFees === 'number'
        ? reading.otherFees
        : reading.otherFees.toNumber()
      : 0;
  const convenienceAmount = reading.convenienceFeeType === 'percent' ? (cost * fee) / 100 : fee;
  return cost + convenienceAmount + other;
}

/** If date falls on a weekend, shift to the next Monday.
 *  Uses UTC day-of-week to stay consistent with UTC midnight dates. */
function nextWeekday(d: Date): Date {
  const day = d.getUTCDay();
  if (day === 6) return makeDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 2); // Sat -> Mon
  if (day === 0) return makeDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); // Sun -> Mon
  return d;
}

/** Apply nextWeekday only when skipWeekend is true */
export function applyWeekendShift(date: Date, skipWeekend: boolean): Date {
  return skipWeekend ? nextWeekday(date) : date;
}

export function* occurrences(
  frequency: string,
  dueDay: number | null,
  dueWeekday: number | null,
  dueOrdinal: number | null,
  startDate: Date | null,
  endDate: Date | null,
  from: Date,
  to: Date,
): Generator<Date> {
  // Normalize Prisma UTC dates — extract calendar components via localDate, rebuild as UTC midnight
  const normStart = startDate
    ? makeDate(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
    : null;
  const normEnd = endDate
    ? makeDate(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())
    : null;
  const rangeStart = normStart && normStart > from ? normStart : from;
  const rangeEnd = normEnd && normEnd < to ? normEnd : to;
  if (rangeStart > rangeEnd) return;

  // Helper: resolve the due date(s) for a given month
  function monthlyDates(year: number, month: number): Date[] {
    if (dueWeekday != null && dueOrdinal != null) {
      if (dueOrdinal === 0) return allWeekdaysOfMonth(year, month, dueWeekday);
      const d = nthWeekdayOfMonth(year, month, dueWeekday, dueOrdinal);
      return d ? [d] : [];
    }
    if (dueDay != null) return [clampDay(year, month, dueDay)];
    return [];
  }

  switch (frequency) {
    case 'BIWEEKLY': {
      // Use the source's own start date as the biweekly anchor if available,
      // otherwise fall back to the global pay schedule anchor (March 20, 2026)
      const anchor = normStart ?? makeDate(2026, 2, 20);
      const d = new Date(anchor);
      while (d > rangeStart) d.setUTCDate(d.getUTCDate() - 14);
      while (d < rangeStart) d.setUTCDate(d.getUTCDate() + 14);
      while (d <= rangeEnd) {
        yield new Date(d);
        d.setUTCDate(d.getUTCDate() + 14);
      }
      break;
    }
    case 'WEEKLY': {
      const d = new Date(rangeStart);
      while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
      while (d <= rangeEnd) {
        yield new Date(d);
        d.setUTCDate(d.getUTCDate() + 7);
      }
      break;
    }
    case 'MONTHLY': {
      let year = rangeStart.getUTCFullYear();
      let month = rangeStart.getUTCMonth();
      while (
        year < rangeEnd.getUTCFullYear() ||
        (year === rangeEnd.getUTCFullYear() && month <= rangeEnd.getUTCMonth())
      ) {
        for (const d of monthlyDates(year, month)) {
          if (d >= rangeStart && d <= rangeEnd) yield d;
        }
        month++;
        if (month > 11) {
          month = 0;
          year++;
        }
      }
      break;
    }
    case 'QUARTERLY': {
      const startMonth = normStart ? normStart.getUTCMonth() : 0;
      const qMonths = [0, 3, 6, 9].map((o) => (startMonth + o) % 12);
      let year = rangeStart.getUTCFullYear();
      let month = rangeStart.getUTCMonth();
      while (
        year < rangeEnd.getUTCFullYear() ||
        (year === rangeEnd.getUTCFullYear() && month <= rangeEnd.getUTCMonth())
      ) {
        if (qMonths.includes(month)) {
          for (const d of monthlyDates(year, month)) {
            if (d >= rangeStart && d <= rangeEnd) yield d;
          }
        }
        month++;
        if (month > 11) {
          month = 0;
          year++;
        }
      }
      break;
    }
    case 'BIANNUAL': {
      const startMonth = normStart ? normStart.getUTCMonth() : 0;
      const biMonths = [0, 6].map((o) => (startMonth + o) % 12);
      let year = rangeStart.getUTCFullYear();
      let month = rangeStart.getUTCMonth();
      while (
        year < rangeEnd.getUTCFullYear() ||
        (year === rangeEnd.getUTCFullYear() && month <= rangeEnd.getUTCMonth())
      ) {
        if (biMonths.includes(month)) {
          for (const d of monthlyDates(year, month)) {
            if (d >= rangeStart && d <= rangeEnd) yield d;
          }
        }
        month++;
        if (month > 11) {
          month = 0;
          year++;
        }
      }
      break;
    }
    case 'ANNUAL': {
      if (!normStart) return;
      const mo = normStart.getUTCMonth();
      const day = dueDay ?? normStart.getUTCDate();
      for (let y = rangeStart.getUTCFullYear(); y <= rangeEnd.getUTCFullYear(); y++) {
        const d = clampDay(y, mo, day);
        if (d >= rangeStart && d <= rangeEnd) yield d;
      }
      break;
    }
    case 'SEMI_MONTHLY': {
      const d1 = dueDay ?? 1;
      let year = rangeStart.getUTCFullYear();
      let month = rangeStart.getUTCMonth();
      while (
        year < rangeEnd.getUTCFullYear() ||
        (year === rangeEnd.getUTCFullYear() && month <= rangeEnd.getUTCMonth())
      ) {
        const first = clampDay(year, month, d1);
        const second = clampDay(year, month, 15);
        if (first >= rangeStart && first <= rangeEnd) yield first;
        if (second >= rangeStart && second <= rangeEnd) yield second;
        month++;
        if (month > 11) {
          month = 0;
          year++;
        }
      }
      break;
    }
  }
}

/**
 * Sync transaction amounts for utility-linked expenses.
 * For each utility link, find readings and update the matching transaction
 * amount to match the reading cost. This ensures that after recurring
 * transaction generation, amounts reflect actual utility bills.
 */
export async function syncUtilityTransactionAmounts(): Promise<number> {
  const services = await prisma.utilityService.findMany({
    where: { expenseId: { not: null } },
  });
  if (services.length === 0) return 0;

  let updated = 0;
  for (const service of services) {
    const readings = await prisma.utilityReading.findMany({
      where: { serviceId: service.id },
    });
    for (const r of readings) {
      // Use dueDate to find the transaction closest in time (within ±15 days).
      const matchDate = r.dueDate ?? r.billDate;
      const windowStart = new Date(matchDate.getTime() - 15 * 86_400_000);
      const windowEnd = new Date(matchDate.getTime() + 15 * 86_400_000);
      const tx = await prisma.transaction.findFirst({
        where: {
          expenseId: service.expenseId!,
          date: { gte: windowStart, lte: windowEnd },
        },
        select: { id: true, amount: true },
      });
      if (tx && Number(tx.amount) !== computeUtilityTotalBill(r)) {
        await ledgerUpdate(tx.id, { amount: computeUtilityTotalBill(r) });
        updated++;
      }
    }
  }
  return updated;
}
