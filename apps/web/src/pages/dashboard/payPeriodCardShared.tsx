import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import type { CurrentPeriodSummary } from '@budget-tracker/core';
import {
  Check,
  AlertTriangle,
  Clock,
  SkipForward,
  Pause,
  CircleDashed,
  CircleAlert,
} from 'lucide-react';
import { IconButton, Badge, Tooltip } from '@budget-tracker/ui';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

export type AnticipationStatus =
  | 'DUE'
  | 'OVERDUE'
  | 'PAID'
  | 'PARTIAL'
  | 'SKIPPED'
  | 'SNOOZED'
  | 'UPCOMING'
  | null;

export type IncomeItem = CurrentPeriodSummary['incomeItems'][number];
export type ExpenseItem = CurrentPeriodSummary['expenseItems'][number];

export interface MarkAsPaidAction {
  mutate: (args: {
    id: string;
    body?: { amount?: number; date?: string; accountId?: string };
  }) => void;
  isPending: boolean;
}

export interface CashSpendingCardProps {
  startDate: string;
  endDate: string;
  incomeItems: IncomeItem[];
  cashExpenses: ExpenseItem[];
  previousPeriodCreditExpenses: number;
  previousPeriodCheckingBalance: number;
  previousPeriodSavingsBalance: number;
  /** Actual cash purchases this period not tied to a recurring/one-time expense. */
  adHocCashSpending: number;
  markAsPaid: MarkAsPaidAction;
  onPaidEarly: (item: { id: string; name: string; amount: number }) => void;
}

export interface CreditSpendingCardProps {
  startDate: string;
  endDate: string;
  creditExpenses: ExpenseItem[];
  markAsPaid: MarkAsPaidAction;
  onPaidEarly: (item: { id: string; name: string; amount: number }) => void;
}

/**
 * Below this viewport width, the credit (income) and debit (expense) amount
 * columns collapse into a single shared column. This is a STRUCTURAL change
 * (real cell count changes per row), not a CSS visibility trick — every row
 * always renders the same number of <td> elements as its colgroup, so table
 * column alignment can never desync between rows.
 */
export const NARROW_BREAKPOINT = below.md;

export function useIsNarrow(breakpoint: number): boolean {
  const [isNarrow, setIsNarrow] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia(`(max-width: ${breakpoint}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setIsNarrow(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return isNarrow;
}

function parseLocalParts(iso: string): [number, number, number] {
  const parts = iso.split('T')[0]!.split('-');
  return [Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])];
}

export function StatusBadgeIcon({ status }: { status: AnticipationStatus }) {
  switch (status) {
    case 'PAID':
      return (
        <Tooltip content="Paid">
          <Badge variant="positive" size="xl" iconOnly>
            <Check size={14} />
          </Badge>
        </Tooltip>
      );
    case 'PARTIAL':
      return (
        <Tooltip content="Partial">
          <Badge variant="warning" size="xl" iconOnly>
            <CircleDashed size={14} />
          </Badge>
        </Tooltip>
      );
    case 'OVERDUE':
      return (
        <Tooltip content="Overdue">
          <Badge variant="negative" size="xl" iconOnly>
            <CircleAlert size={14} />
          </Badge>
        </Tooltip>
      );
    case 'DUE':
      return (
        <Tooltip content="Due">
          <Badge variant="warning" size="xl" iconOnly>
            <AlertTriangle size={14} />
          </Badge>
        </Tooltip>
      );
    case 'UPCOMING':
      return (
        <Tooltip content="Upcoming">
          <Badge variant="info" size="xl" iconOnly>
            <Clock size={14} />
          </Badge>
        </Tooltip>
      );
    case 'SKIPPED':
      return (
        <Tooltip content="Skipped">
          <Badge variant="neutral" size="xl" iconOnly>
            <SkipForward size={14} />
          </Badge>
        </Tooltip>
      );
    case 'SNOOZED':
      return (
        <Tooltip content="Snoozed">
          <Badge variant="info" size="xl" iconOnly>
            <Pause size={14} />
          </Badge>
        </Tooltip>
      );
    default:
      return null;
  }
}

export function computeDueDateLabel(
  dueDay: number | null,
  startDate: string,
  endDate: string,
): string | null {
  if (dueDay == null) return null;
  const [sy, sm, sd] = parseLocalParts(startDate);
  const [ey, em, ed] = parseLocalParts(endDate);
  const start = new Date(sy, sm, sd);
  const end = new Date(ey, em, ed);
  for (let offset = 0; offset <= 1; offset++) {
    const m = sm + offset;
    const daysInMonth = new Date(sy, m + 1, 0).getDate();
    const candidate = new Date(sy, m, Math.min(dueDay, daysInMonth));
    if (candidate >= start && candidate <= end) {
      return format(candidate, 'MMM do');
    }
  }
  return `Day ${dueDay}`;
}

export function formatDateLabel(iso: string): string {
  const [y, m, d] = parseLocalParts(iso);
  return format(new Date(y, m, d), 'MMM do');
}

export function MarkAsPaidButton({
  anticipationId,
  anticipationStatus,
  name,
  amount,
  markAsPaid,
  onPaidEarly,
}: {
  anticipationId: string | null;
  anticipationStatus: AnticipationStatus;
  name: string;
  amount: number;
  markAsPaid: MarkAsPaidAction;
  onPaidEarly: (item: { id: string; name: string; amount: number }) => void;
}) {
  const canMarkPaid =
    (anticipationStatus === 'DUE' ||
      anticipationStatus === 'OVERDUE' ||
      anticipationStatus === 'PARTIAL' ||
      anticipationStatus === 'UPCOMING') &&
    anticipationId;
  if (!canMarkPaid) return null;
  const isUpcoming = anticipationStatus === 'UPCOMING';
  return (
    <IconButton
      icon={<Check size={14} />}
      tooltip={isUpcoming ? 'Paid Early' : 'Mark as Paid'}
      size="sm"
      variant="primary"
      disabled={markAsPaid.isPending}
      onClick={() => {
        if (isUpcoming) {
          onPaidEarly({ id: anticipationId, name, amount });
        } else {
          markAsPaid.mutate({ id: anticipationId });
        }
      }}
    />
  );
}

/**
 * Renders the <colgroup>. `narrow` controls whether the credit/debit amount
 * columns are merged into one — this must match the real <td> count each
 * row renders (see `!narrow && <td .../>` spacer pattern below).
 *
 * The table uses tableLayout: fixed, which makes these <col> widths literal
 * and final (not hints, unlike tableLayout: auto). This is what makes the
 * name column actually truncate instead of growing to fit its content.
 */
export function TableColgroup({ narrow }: { narrow: boolean }) {
  return (
    <colgroup>
      <col style={{ width: '4.5rem' }} />
      <col style={{ width: narrow ? '58%' : '41%' }} />
      <col style={{ width: narrow ? '0%' : '18%' }} />
      <col style={{ width: narrow ? '37.5%' : '20.5%' }} />
      {!narrow && <col style={{ width: '20.5%' }} />}
      <col style={{ width: '4.5rem' }} />
    </colgroup>
  );
}
