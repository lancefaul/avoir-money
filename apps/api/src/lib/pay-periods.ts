/**
 * Shared pay period generation utilities.
 *
 * - ensurePeriodsExist: ensures periods cover 2 years from now for the default schedule
 * - extendByOne: adds one more period at the end of the existing range
 */
import { prisma } from '@budget-tracker/db';
import { generatePayPeriods } from '@budget-tracker/core';

/**
 * Ensure pay periods exist from the start of the current year through either:
 * - The income/expense end date (if provided), or
 * - 2 years from now (if no end date — ongoing)
 * Uses the default pay schedule. Idempotent — skips periods that already exist.
 */
export async function ensurePeriodsExist(endDate?: Date | null): Promise<number> {
  const schedule = await prisma.paySchedule.findFirst({ where: { isDefault: true } });
  if (!schedule) return 0;

  const now = new Date();
  // UTC year — a local getter would shift this generation window by a year near
  // the Jan 1 boundary.
  const rangeStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const defaultEnd = new Date(Date.UTC(now.getUTCFullYear() + 2, 11, 31));
  const rangeEnd = endDate && endDate < defaultEnd ? endDate : defaultEnd;

  const generated = generatePayPeriods({
    scheduleType: schedule.type,
    anchorDate: schedule.anchorDate,
    firstPayDay: schedule.firstPayDay ?? undefined,
    secondPayDay: schedule.secondPayDay ?? undefined,
    rangeStart,
    rangeEnd,
  });

  let created = 0;
  for (const p of generated) {
    const existing = await prisma.payPeriod.findUnique({
      where: {
        scheduleId_year_periodNum: {
          scheduleId: schedule.id,
          year: p.year,
          periodNum: p.periodNum,
        },
      },
    });
    if (!existing) {
      await prisma.payPeriod.create({
        data: {
          scheduleId: schedule.id,
          startDate: p.startDate,
          endDate: p.endDate,
          payDate: p.payDate,
          year: p.year,
          periodNum: p.periodNum,
        },
      });
      created++;
    }
  }
  return created;
}

/**
 * Extend pay periods by one beyond the current latest period.
 * Called when a recurring transaction is recorded.
 */
export async function extendByOne(): Promise<boolean> {
  const schedule = await prisma.paySchedule.findFirst({ where: { isDefault: true } });
  if (!schedule) return false;

  // Find the latest existing period
  const latest = await prisma.payPeriod.findFirst({
    where: { scheduleId: schedule.id },
    orderBy: { endDate: 'desc' },
  });
  if (!latest) return false;

  // Generate one period starting the day after the latest ends
  const nextStart = new Date(latest.endDate);
  nextStart.setUTCDate(nextStart.getUTCDate() + 1);
  const nextEnd = new Date(nextStart);
  nextEnd.setUTCDate(nextEnd.getUTCDate() + 60); // generous range to capture at least 1 period

  const generated = generatePayPeriods({
    scheduleType: schedule.type,
    anchorDate: schedule.anchorDate,
    firstPayDay: schedule.firstPayDay ?? undefined,
    secondPayDay: schedule.secondPayDay ?? undefined,
    rangeStart: nextStart,
    rangeEnd: nextEnd,
  });

  if (generated.length === 0) return false;

  const next = generated[0]!;
  const existing = await prisma.payPeriod.findUnique({
    where: {
      scheduleId_year_periodNum: {
        scheduleId: schedule.id,
        year: next.year,
        periodNum: next.periodNum,
      },
    },
  });
  if (existing) return false;

  await prisma.payPeriod.create({
    data: {
      scheduleId: schedule.id,
      startDate: next.startDate,
      endDate: next.endDate,
      payDate: next.payDate,
      year: next.year,
      periodNum: next.periodNum,
    },
  });
  return true;
}
