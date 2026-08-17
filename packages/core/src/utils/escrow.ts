export type EscrowDirection = 'up' | 'down' | 'flat';

export interface EscrowChange {
  dollarDiff: number;
  percentChange: number;
  direction: EscrowDirection;
}

export interface EscrowRecordInput {
  monthlyAmount: number;
  periodStartDate: Date;
  periodEndDate: Date;
}

export function computeEscrowChange(current: number, previous: number): EscrowChange {
  const dollarDiff = current - previous;
  const percentChange = previous > 0 ? (dollarDiff / previous) * 100 : 0;
  const direction: EscrowDirection = dollarDiff > 0 ? 'up' : dollarDiff < 0 ? 'down' : 'flat';
  return { dollarDiff, percentChange, direction };
}

export function getActiveEscrowRecord<T extends EscrowRecordInput>(
  records: T[],
  currentDate?: Date,
): T | null {
  if (records.length === 0) return null;
  const now = currentDate ?? new Date();
  const active = records.find((r) => r.periodStartDate <= now && r.periodEndDate >= now);
  if (active) return active;
  const sorted = [...records].sort(
    (a, b) => b.periodStartDate.getTime() - a.periodStartDate.getTime(),
  );
  return sorted[0] ?? null;
}

export function shouldShowEscrowReminder<T extends EscrowRecordInput>(
  records: T[],
  currentDate: Date,
): boolean {
  if (records.length === 0) return false;
  const sorted = [...records].sort(
    (a, b) => b.periodStartDate.getTime() - a.periodStartDate.getTime(),
  );
  const mostRecent = sorted[0]!;
  if (currentDate >= mostRecent.periodEndDate) {
    const hasNewerRecord = sorted.some(
      (r) => r !== mostRecent && r.periodStartDate >= mostRecent.periodEndDate,
    );
    return !hasNewerRecord;
  }
  return false;
}
