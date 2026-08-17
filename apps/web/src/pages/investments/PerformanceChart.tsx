import { Sensitive } from '@budget-tracker/ui';
import { useState, useMemo } from 'react';
import { LineChart, RefreshCw } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { ButtonGroup, IconButton } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { usePortfolioHistory, useRegenerateSnapshots } from '../../hooks/useApi.js';
import { formatCurrency } from '../../lib/utils.js';
import { useIsNarrow } from '../../hooks/useIsNarrow.js';
import { format } from 'date-fns';
import EmptyState from '../../components/EmptyState.js';
import * as s from './PerformanceChart.css.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

/** Below this width the range filter moves below the chart (still inside the card). */
const RANGE_BELOW_CHART_BREAKPOINT = below.md;

type Period = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

const PERIOD_OPTIONS = [
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: 'ALL', label: 'ALL' },
];

const PERIOD_LABELS: Record<Period, string> = {
  '1W': 'Past week',
  '1M': 'Past month',
  '3M': 'Past 3 months',
  '6M': 'Past 6 months',
  '1Y': 'Past year',
  ALL: 'All time',
};

interface ChartPoint {
  timestamp: number;
  label: string;
  value: number;
}

interface Holding {
  costBasis: number | null;
  latestSnapshot: { date: string; value: number | null } | null;
}

interface Props {
  currentValue: number;
  totalCostBasis: number;
  holdings: Holding[];
}

export default function PerformanceChart({ currentValue, totalCostBasis, holdings }: Props) {
  const [period, setPeriod] = useState<Period>('ALL');
  const rangeBelowChart = useIsNarrow(RANGE_BELOW_CHART_BREAKPOINT);
  const { data, isLoading } = usePortfolioHistory(period);
  const regenerate = useRegenerateSnapshots();

  // Build chart points: prefer snapshot history, fall back to cost-basis → current-value
  const points = useMemo<ChartPoint[]>(() => {
    // If we have snapshot history, use it
    if (data?.entries?.length && data.entries.length >= 2) {
      return data.entries.map((e) => {
        const d = new Date(e.date);
        return {
          timestamp: d.getTime(),
          label: format(d, 'MMM d, yyyy'),
          value: e.totalValue,
        };
      });
    }

    // Fallback: build from holdings data
    // Find the earliest snapshot date across all holdings as the "start" date
    const snapshotDates: Date[] = [];
    for (const h of holdings) {
      if (h.latestSnapshot?.date) snapshotDates.push(new Date(h.latestSnapshot.date));
    }
    const earliestDate =
      snapshotDates.length > 0
        ? new Date(Math.min(...snapshotDates.map((d) => d.getTime())))
        : null;

    if (totalCostBasis > 0 && currentValue > 0) {
      const startDate = earliestDate ?? new Date();
      const now = new Date();
      return [
        {
          timestamp: startDate.getTime(),
          label: format(startDate, 'MMM d, yyyy'),
          value: totalCostBasis,
        },
        { timestamp: now.getTime(), label: format(now, 'MMM d, yyyy'), value: currentValue },
      ];
    }

    return [];
  }, [data, holdings, totalCostBasis, currentValue]);

  const firstValue = points.length > 0 ? points[0]!.value : 0;
  const latestValue = points.length > 0 ? points[points.length - 1]!.value : currentValue;
  const displayValue = currentValue;
  const change = latestValue - firstValue;
  const changePct = firstValue > 0 ? (change / firstValue) * 100 : 0;
  const isPositive = change >= 0;

  // One instance, rendered either beside the value or below the chart — never both.
  const rangeFilter = (
    <ButtonGroup
      options={PERIOD_OPTIONS}
      value={period}
      onChange={(v) => setPeriod(v as Period)}
      size="sm"
    />
  );

  return (
    <div className={s.card}>
      <div className={s.header}>
        <div className={s.valueSection}>
          {points.length >= 2 && (
            <div className={s.changeRow}>
              <span className={isPositive ? s.changePositive : s.changeNegative}>
                {isPositive ? '+' : ''}
                <Sensitive label="amount">{formatCurrency(change)}</Sensitive> (
                {isPositive ? '+' : ''}
                <Sensitive label="percent change">{changePct.toFixed(2)}%</Sensitive>)
              </span>
              <span className={s.periodLabel}>{PERIOD_LABELS[period]}</span>
            </div>
          )}
          <div className={s.totalValue}>
            <Sensitive label="amount">{formatCurrency(displayValue)}</Sensitive>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: vars.space['2'] }}>
          <IconButton
            icon={<RefreshCw size={14} />}
            tooltip="Regenerate snapshots"
            size="sm"
            variant="trueGhost"
            onClick={() => regenerate.mutate()}
            disabled={regenerate.isPending}
          />
          {!rangeBelowChart && rangeFilter}
        </div>
      </div>

      {isLoading ? (
        <div className={s.emptyState}>Loading…</div>
      ) : points.length < 2 ? (
        <EmptyState
          icon={<LineChart size={32} />}
          message="Add investments to see portfolio performance"
        />
      ) : (
        <div className={s.chartWrap}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={vars.color.brand600} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={vars.color.brand600} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(ts: number) => format(new Date(ts), 'MMM d, yyyy')}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={60}
                tick={{ fontSize: 11, fill: vars.color.textTertiary }}
                padding={{ left: 10, right: 10 }}
              />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip
                labelFormatter={(ts: number) => format(new Date(ts), 'MMM d, yyyy')}
                formatter={(v: number) => [formatCurrency(v), 'Portfolio']}
                labelStyle={{
                  fontSize: vars.font.sm,
                  color: vars.color.textPrimary,
                }}
                contentStyle={{
                  background: vars.color.neutral0,
                  border: `${vars.border.thin} solid ${vars.color.border}`,
                  borderRadius: vars.radius.md,
                  fontSize: vars.font.sm,
                  color: vars.color.textPrimary,
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={vars.color.brand600}
                fill="url(#portfolioGradient)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: vars.color.brand600 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Narrow: the range filter lives below the chart instead of beside the value. */}
      {rangeBelowChart && <div className={s.rangeFooter}>{rangeFilter}</div>}
    </div>
  );
}
