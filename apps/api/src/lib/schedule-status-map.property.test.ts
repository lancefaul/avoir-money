/**
 * Property-Based Test for Status Mapping
 *
 * Feature: transaction-schedule, Property 11: Status Mapping Correctness
 * Tests the pure mapScheduleStatus function across all combinations of
 * ScheduleStatus, dueDate vs today, and snoozedUntil.
 *
 * No DB needed — this is a pure function test.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { mapScheduleStatus } from './schedule-status-map.js';
import { makeDate } from './dates.js';

// ─── Generators ───

type ScheduleStatus = 'PENDING' | 'PAID' | 'PARTIAL' | 'SNOOZED' | 'SKIPPED';
type DisplayStatus = 'DUE' | 'OVERDUE' | 'PAID' | 'PARTIAL' | 'SNOOZED' | 'SKIPPED' | 'UPCOMING';

/** Arbitrary UTC-midnight date in a reasonable range */
const dateArb = fc
  .integer({ min: 2020, max: 2030 })
  .chain((year) =>
    fc
      .integer({ min: 0, max: 11 })
      .chain((month) => fc.integer({ min: 1, max: 28 }).map((day) => makeDate(year, month, day))),
  );

const scheduleStatusArb: fc.Arbitrary<ScheduleStatus> = fc.constantFrom(
  'PENDING',
  'PAID',
  'PARTIAL',
  'SNOOZED',
  'SKIPPED',
);

// ─── Property 11: Status Mapping Correctness ───
// Feature: transaction-schedule, Property 11: Status Mapping Correctness

describe('Feature: transaction-schedule, Property 11: Status Mapping Correctness', () => {
  /**
   * Validates: Requirements 5.2, 6.4, 6.5
   *
   * Pure function returns correct display status for all combinations of
   * ScheduleStatus, dueDate vs today, and snoozedUntil.
   */
  it('maps every ScheduleStatus to the correct DisplayStatus', () => {
    fc.assert(
      fc.property(
        scheduleStatusArb,
        dateArb,
        dateArb,
        dateArb,
        (status, dueDate, snoozedUntil, today) => {
          const result = mapScheduleStatus(status, dueDate, snoozedUntil, today);

          switch (status) {
            case 'PAID':
              expect(result).toBe('PAID');
              break;
            case 'PARTIAL':
              expect(result).toBe('PARTIAL');
              break;
            case 'SKIPPED':
              expect(result).toBe('SKIPPED');
              break;
            case 'PENDING':
              if (dueDate < today) {
                expect(result).toBe('OVERDUE');
              } else if (dueDate > today) {
                expect(result).toBe('UPCOMING');
              } else {
                expect(result).toBe('DUE');
              }
              break;
            case 'SNOOZED':
              if (snoozedUntil > today) {
                expect(result).toBe('SNOOZED');
              } else if (dueDate < today) {
                expect(result).toBe('OVERDUE');
              } else if (dueDate > today) {
                expect(result).toBe('UPCOMING');
              } else {
                expect(result).toBe('DUE');
              }
              break;
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('PENDING + dueDate == today returns DUE', () => {
    fc.assert(
      fc.property(dateArb, (today) => {
        const result = mapScheduleStatus('PENDING', today, null, today);
        expect(result).toBe('DUE');
      }),
      { numRuns: 20 },
    );
  });

  it('SNOOZED with null snoozedUntil falls back to due/overdue/upcoming logic', () => {
    fc.assert(
      fc.property(dateArb, dateArb, (dueDate, today) => {
        const result = mapScheduleStatus('SNOOZED', dueDate, null, today);
        // null snoozedUntil is not > today, so treat as expired snooze
        if (dueDate < today) {
          expect(result).toBe('OVERDUE');
        } else if (dueDate > today) {
          expect(result).toBe('UPCOMING');
        } else {
          expect(result).toBe('DUE');
        }
      }),
      { numRuns: 20 },
    );
  });

  it('return type is always a valid DisplayStatus', () => {
    const validStatuses: DisplayStatus[] = [
      'DUE',
      'OVERDUE',
      'PAID',
      'PARTIAL',
      'SNOOZED',
      'SKIPPED',
      'UPCOMING',
    ];
    fc.assert(
      fc.property(
        scheduleStatusArb,
        dateArb,
        fc.option(dateArb, { nil: null }),
        dateArb,
        (status, dueDate, snoozedUntil, today) => {
          const result = mapScheduleStatus(status, dueDate, snoozedUntil, today);
          expect(validStatuses).toContain(result);
        },
      ),
      { numRuns: 20 },
    );
  });
});
