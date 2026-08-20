import { describe, it, expect } from 'vitest';
import { localDate, today, sameDay, makeDate, monthRange, dayAfter } from '../dates.js';
import { prisma } from '@budget-tracker/db';
import { createAccount, createTransaction } from '../../test/helpers.js';

describe('dates utility', () => {
  describe('localDate', () => {
    it('extracts UTC components from a Prisma-style UTC midnight date', () => {
      // Prisma stores "2026-04-01" as 2026-04-01T00:00:00.000Z
      const d = new Date('2026-04-01T00:00:00.000Z');
      const result = localDate(d);
      expect(result).toEqual({ year: 2026, month: 3, day: 1 }); // month is 0-indexed
    });

    it('handles end-of-month dates correctly', () => {
      const d = new Date('2026-02-28T00:00:00.000Z');
      expect(localDate(d)).toEqual({ year: 2026, month: 1, day: 28 });
    });

    it('handles Dec 31 / year boundary', () => {
      const d = new Date('2025-12-31T00:00:00.000Z');
      expect(localDate(d)).toEqual({ year: 2025, month: 11, day: 31 });
    });

    it('handles Jan 1', () => {
      const d = new Date('2026-01-01T00:00:00.000Z');
      expect(localDate(d)).toEqual({ year: 2026, month: 0, day: 1 });
    });
  });

  describe('today', () => {
    it('returns a date at UTC midnight', () => {
      const t = today();
      expect(t.getUTCHours()).toBe(0);
      expect(t.getUTCMinutes()).toBe(0);
      expect(t.getUTCSeconds()).toBe(0);
      expect(t.getMilliseconds()).toBe(0);
    });

    it('matches the current calendar date', () => {
      const t = today();
      const now = new Date();
      expect(t.getUTCFullYear()).toBe(now.getFullYear());
      expect(t.getUTCMonth()).toBe(now.getMonth());
      expect(t.getUTCDate()).toBe(now.getDate());
    });
  });

  describe('sameDay', () => {
    it('returns true for identical UTC dates', () => {
      const a = new Date('2026-04-01T00:00:00.000Z');
      const b = new Date('2026-04-01T00:00:00.000Z');
      expect(sameDay(a, b)).toBe(true);
    });

    it('returns false for different days', () => {
      const a = new Date('2026-04-01T00:00:00.000Z');
      const b = new Date('2026-04-02T00:00:00.000Z');
      expect(sameDay(a, b)).toBe(false);
    });

    it('returns true for same UTC day with different times', () => {
      const a = new Date('2026-04-01T00:00:00.000Z');
      const b = new Date('2026-04-01T23:59:59.000Z');
      expect(sameDay(a, b)).toBe(true);
    });

    it('returns false for different months same day number', () => {
      const a = new Date('2026-03-15T00:00:00.000Z');
      const b = new Date('2026-04-15T00:00:00.000Z');
      expect(sameDay(a, b)).toBe(false);
    });
  });

  describe('makeDate', () => {
    it('creates a UTC midnight date', () => {
      const d = makeDate(2026, 3, 15); // April 15
      expect(d.getUTCFullYear()).toBe(2026);
      expect(d.getUTCMonth()).toBe(3);
      expect(d.getUTCDate()).toBe(15);
      expect(d.getUTCHours()).toBe(0);
    });
  });

  describe('monthRange', () => {
    it('returns start and end of a month', () => {
      const { start, end } = monthRange(2026, 3); // April
      expect(start.getUTCFullYear()).toBe(2026);
      expect(start.getUTCMonth()).toBe(3);
      expect(start.getUTCDate()).toBe(1);
      expect(end.getUTCFullYear()).toBe(2026);
      expect(end.getUTCMonth()).toBe(4); // May 1 (exclusive end)
      expect(end.getUTCDate()).toBe(1);
    });

    it('handles December (wraps to next year)', () => {
      const { start, end } = monthRange(2026, 11);
      expect(start.getUTCMonth()).toBe(11);
      expect(end.getUTCFullYear()).toBe(2027);
      expect(end.getUTCMonth()).toBe(0); // Jan 1
    });
  });

  describe('dayAfter', () => {
    it('returns next calendar day at UTC midnight for a UTC midnight date', () => {
      const d = new Date(Date.UTC(2026, 5, 15)); // June 15
      const result = dayAfter(d);
      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(5);
      expect(result.getUTCDate()).toBe(16);
      expect(result.getUTCHours()).toBe(0);
      expect(result.getUTCMinutes()).toBe(0);
      expect(result.getUTCSeconds()).toBe(0);
      expect(result.getUTCMilliseconds()).toBe(0);
    });

    it('returns first day of next month for last day of month', () => {
      const d = new Date(Date.UTC(2026, 0, 31)); // January 31
      const result = dayAfter(d);
      expect(result.getUTCFullYear()).toBe(2026);
      expect(result.getUTCMonth()).toBe(1); // February
      expect(result.getUTCDate()).toBe(1);
    });

    it('returns January 1 of next year for December 31', () => {
      const d = new Date(Date.UTC(2026, 11, 31)); // December 31
      const result = dayAfter(d);
      expect(result.getUTCFullYear()).toBe(2027);
      expect(result.getUTCMonth()).toBe(0); // January
      expect(result.getUTCDate()).toBe(1);
      expect(result.getUTCHours()).toBe(0);
    });
  });
});

describe('dayAfter boundary fix in Prisma queries', () => {
  it('includes a non-midnight transaction when querying with lt: dayAfter(endDate)', async () => {
    const account = await createAccount();
    // Create a transaction at 2026-06-15T14:30:00Z (non-midnight)
    const txn = await createTransaction(account.id, {
      date: new Date('2026-06-15T14:30:00.000Z'),
    });

    // Query using the dayAfter pattern: lt: dayAfter(endDate) where endDate is June 15
    const endDate = new Date(Date.UTC(2026, 5, 15)); // June 15 at UTC midnight
    const results = await prisma.transaction.findMany({
      where: {
        accountId: account.id,
        date: { gte: new Date(Date.UTC(2026, 5, 1)), lt: dayAfter(endDate) },
      },
    });

    // The non-midnight transaction should be included because
    // lt: dayAfter(June 15) = lt: June 16 00:00:00Z, which includes June 15 14:30:00Z
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(txn.id);
  });

  it('would miss non-midnight transaction with naive lte: endDate (midnight) pattern', async () => {
    const account = await createAccount();
    // Create a transaction at 2026-06-15T14:30:00Z (non-midnight)
    await createTransaction(account.id, {
      date: new Date('2026-06-15T14:30:00.000Z'),
    });

    // Query using the naive pattern: lte: endDate where endDate is June 15 at midnight
    // lte: June 15 00:00:00Z does NOT include June 15 14:30:00Z because 14:30 > 00:00
    const endDateMidnight = new Date(Date.UTC(2026, 5, 15)); // June 15 at midnight
    const results = await prisma.transaction.findMany({
      where: {
        accountId: account.id,
        date: { gte: new Date(Date.UTC(2026, 5, 1)), lte: endDateMidnight },
      },
    });

    // lte: June 15 00:00:00Z does NOT include June 15 14:30:00Z
    expect(results).toHaveLength(0);
  });
});
