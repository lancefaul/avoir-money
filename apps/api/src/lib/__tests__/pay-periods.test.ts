import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { ensurePeriodsExist, extendByOne } from '../pay-periods.js';

describe('pay-periods lib', () => {
  describe('ensurePeriodsExist', () => {
    it('returns 0 when no default schedule exists', async () => {
      const count = await ensurePeriodsExist();
      expect(count).toBe(0);
    });

    it('creates periods for the default schedule', async () => {
      await prisma.paySchedule.create({
        data: {
          name: 'Default',
          type: 'BIWEEKLY',
          anchorDate: new Date('2026-03-20'),
          isDefault: true,
        },
      });
      const count = await ensurePeriodsExist();
      expect(count).toBeGreaterThan(0);

      const periods = await prisma.payPeriod.findMany();
      expect(periods.length).toBe(count);
    });

    it('is idempotent — second call creates 0', async () => {
      await prisma.paySchedule.create({
        data: {
          name: 'Default',
          type: 'BIWEEKLY',
          anchorDate: new Date('2026-03-20'),
          isDefault: true,
        },
      });
      await ensurePeriodsExist();
      const secondCount = await ensurePeriodsExist();
      expect(secondCount).toBe(0);
    });

    it('respects endDate parameter', async () => {
      await prisma.paySchedule.create({
        data: {
          name: 'Default',
          type: 'BIWEEKLY',
          anchorDate: new Date('2026-03-20'),
          isDefault: true,
        },
      });
      const shortEnd = new Date(2026, 5, 30); // June 30
      const count = await ensurePeriodsExist(shortEnd);
      expect(count).toBeGreaterThan(0);

      const periods = await prisma.payPeriod.findMany({ orderBy: { endDate: 'desc' } });
      // The latest period should not extend far beyond the endDate
      const latestEnd = periods[0]!.endDate;
      // Allow some slack since periods are generated in fixed intervals
      expect(latestEnd.getFullYear()).toBeLessThanOrEqual(2027);
    });
  });

  describe('extendByOne', () => {
    it('returns false when no default schedule exists', async () => {
      const result = await extendByOne();
      expect(result).toBe(false);
    });

    it('returns false when no periods exist', async () => {
      await prisma.paySchedule.create({
        data: {
          name: 'Default',
          type: 'BIWEEKLY',
          anchorDate: new Date('2026-03-20'),
          isDefault: true,
        },
      });
      const result = await extendByOne();
      expect(result).toBe(false);
    });

    it('adds one period beyond the latest', async () => {
      const schedule = await prisma.paySchedule.create({
        data: {
          name: 'Default',
          type: 'BIWEEKLY',
          anchorDate: new Date('2026-03-20'),
          isDefault: true,
        },
      });
      await prisma.payPeriod.create({
        data: {
          scheduleId: schedule.id,
          startDate: new Date('2026-03-20'),
          endDate: new Date('2026-04-02'),
          payDate: new Date('2026-03-20'),
          year: 2026,
          periodNum: 1,
        },
      });

      const before = await prisma.payPeriod.count();
      const result = await extendByOne();
      expect(result).toBe(true);

      const after = await prisma.payPeriod.count();
      expect(after).toBe(before + 1);
    });

    it('each call adds exactly one more period', async () => {
      const schedule = await prisma.paySchedule.create({
        data: {
          name: 'Default',
          type: 'BIWEEKLY',
          anchorDate: new Date('2026-03-20'),
          isDefault: true,
        },
      });
      await prisma.payPeriod.create({
        data: {
          scheduleId: schedule.id,
          startDate: new Date('2026-03-20'),
          endDate: new Date('2026-04-02'),
          payDate: new Date('2026-03-20'),
          year: 2026,
          periodNum: 1,
        },
      });

      const before = await prisma.payPeriod.count();
      await extendByOne();
      expect(await prisma.payPeriod.count()).toBe(before + 1);
      await extendByOne();
      expect(await prisma.payPeriod.count()).toBe(before + 2);
    });
  });
});

describe('ensurePeriodsExist — endDate beyond default range', () => {
  it('uses default 2-year range when endDate is far in the future', async () => {
    await prisma.paySchedule.create({
      data: {
        name: 'Default',
        type: 'BIWEEKLY',
        anchorDate: new Date('2026-03-20'),
        isDefault: true,
      },
    });
    const farFuture = new Date(Date.UTC(2050, 11, 31));
    const count = await ensurePeriodsExist(farFuture);
    expect(count).toBeGreaterThan(0);

    // Should not generate periods all the way to 2050
    const periods = await prisma.payPeriod.findMany({ orderBy: { endDate: 'desc' } });
    const latestYear = periods[0]!.endDate.getUTCFullYear();
    const now = new Date();
    expect(latestYear).toBeLessThanOrEqual(now.getFullYear() + 3);
  });
});
