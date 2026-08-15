import { formatCurrency } from '../../lib/utils.js';
import * as ss from './search-summary.css.js';

export interface SearchSummaryData {
  totalSpent: number;
  avgSpent: number;
  totalEarned: number;
  avgEarned: number;
}

export interface DatePreset {
  key: string;
  label: string;
  dateFrom: string;
  dateTo: string;
}

interface CurrentPeriod {
  payPeriod: { startDate: string | Date; endDate: string | Date };
  schedule: { type: string };
}

/** The four summary stats, shared between the desktop header bar and the narrow 2x2 grid. */
export function renderSummaryStats(summary: SearchSummaryData) {
  return (
    <>
      <div className={ss.stat}>
        <span className={ss.statLabel}>Spent</span>
        <span className={`${ss.statValue} ${ss.statNegative}`}>
          {formatCurrency(summary.totalSpent)}
        </span>
      </div>
      <div className={ss.stat}>
        <span className={ss.statLabel}>Spent/mo</span>
        <span className={`${ss.statValue} ${ss.statNegative}`}>
          {formatCurrency(summary.avgSpent)}
        </span>
      </div>
      <div className={ss.stat}>
        <span className={ss.statLabel}>Earned</span>
        <span className={`${ss.statValue} ${ss.statPositive}`}>
          {formatCurrency(summary.totalEarned)}
        </span>
      </div>
      <div className={ss.stat}>
        <span className={ss.statLabel}>Earned/mo</span>
        <span className={`${ss.statValue} ${ss.statPositive}`}>
          {formatCurrency(summary.avgEarned)}
        </span>
      </div>
    </>
  );
}

/** Build the date-range filter presets, including pay-period presets when available. */
export function buildDatePresets(currentPeriod: CurrentPeriod | undefined): DatePreset[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const fmt = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

  // This week (Monday to Sunday)
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(y, m, d + mondayOffset);
  const sunday = new Date(y, m, d + mondayOffset + 6);

  const presets: DatePreset[] = [];

  // Pay period presets (only if data is available)
  if (currentPeriod) {
    const ppStart = new Date(currentPeriod.payPeriod.startDate);
    const ppEnd = new Date(currentPeriod.payPeriod.endDate);
    presets.push({
      key: 'this-pay-period',
      label: 'This pay period',
      dateFrom: fmt(ppStart),
      dateTo: fmt(ppEnd),
    });

    // Last pay period: compute from current period length
    const periodMs = ppEnd.getTime() - ppStart.getTime();
    const prevEnd = new Date(ppStart.getTime() - 1); // day before current start
    const prevStart = new Date(prevEnd.getTime() - periodMs);
    presets.push({
      key: 'last-pay-period',
      label: 'Last pay period',
      dateFrom: fmt(prevStart),
      dateTo: fmt(prevEnd),
    });
  }

  presets.push(
    { key: 'this-week', label: 'This week', dateFrom: fmt(monday), dateTo: fmt(sunday) },
    {
      key: 'this-month',
      label: 'This month',
      dateFrom: fmt(new Date(y, m, 1)),
      dateTo: fmt(new Date(y, m + 1, 0)),
    },
    {
      key: 'last-3-months',
      label: 'Last 3 months',
      dateFrom: fmt(new Date(y, m - 2, 1)),
      dateTo: fmt(now),
    },
    {
      key: 'last-6-months',
      label: 'Last 6 months',
      dateFrom: fmt(new Date(y, m - 5, 1)),
      dateTo: fmt(now),
    },
    {
      key: 'last-year',
      label: 'Last year',
      dateFrom: fmt(new Date(y - 1, m, d)),
      dateTo: fmt(now),
    },
    { key: 'ytd', label: 'Year to date', dateFrom: fmt(new Date(y, 0, 1)), dateTo: fmt(now) },
  );

  return presets;
}
