/**
 * Pure status mapping: ScheduleStatus → dashboard display status.
 *
 * Feature: transaction-schedule
 * Requirements: 5.2, 6.5
 */

type ScheduleStatus = 'PENDING' | 'PAID' | 'PARTIAL' | 'SNOOZED' | 'SKIPPED';
type DisplayStatus = 'DUE' | 'OVERDUE' | 'PAID' | 'PARTIAL' | 'SNOOZED' | 'SKIPPED' | 'UPCOMING';

/**
 * Map a ScheduledTransaction's persisted status to the display status
 * shown on the dashboard.
 *
 * @param status      - The persisted ScheduleStatus
 * @param dueDate     - The occurrence due date (UTC midnight)
 * @param snoozedUntil - When the snooze expires (nullable)
 * @param today       - The current date (UTC midnight)
 */
export function mapScheduleStatus(
  status: ScheduleStatus,
  dueDate: Date,
  snoozedUntil: Date | null,
  today: Date,
): DisplayStatus {
  switch (status) {
    case 'PAID':
      return 'PAID';
    case 'PARTIAL':
      return 'PARTIAL';
    case 'SKIPPED':
      return 'SKIPPED';
    case 'SNOOZED':
      // If snooze has expired, treat as PENDING (fall through to due/overdue logic)
      if (snoozedUntil != null && snoozedUntil > today) {
        return 'SNOOZED';
      }
      // Expired snooze → treat as PENDING
      return dueDate < today ? 'OVERDUE' : dueDate > today ? 'UPCOMING' : 'DUE';
    case 'PENDING':
      return dueDate < today ? 'OVERDUE' : dueDate > today ? 'UPCOMING' : 'DUE';
  }
}
