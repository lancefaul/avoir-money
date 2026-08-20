import { Sensitive, useMasked, REDACTED } from '@budget-tracker/ui';
import { useMemo } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import type { z } from 'zod';
import type { IncomeTrendDataPointSchema } from '@budget-tracker/core';
import { vars, spinnerStyles } from '@budget-tracker/ui';
import { formatCurrency } from '../lib/utils.js';
import EmptyState from './EmptyState.js';
import * as s from './net-savings-chart.css.js';

type IncomeTrendDataPoint = z.infer<typeof IncomeTrendDataPointSchema>;

interface Props {
  data: IncomeTrendDataPoint[];
  isLoading: boolean;
  isError: boolean;
}

interface ChartRow {
  periodLabel: string;
  net: number;
  projected: boolean;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload;
  const positive = row.net >= 0;
  return (
    <div className={s.tooltip}>
      <p className={s.tooltipLabel}>
        {row.periodLabel}
        {row.projected ? ' (projected)' : ''}
      </p>
      <p className={positive ? s.tooltipPositive : s.tooltipNegative}>
        {positive ? '+' : ''}
        <Sensitive label="amount">{formatCurrency(row.net)}</Sensitive>
      </p>
    </div>
  );
}

export default function NetSavingsBarChart({ data, isLoading, isError }: Props) {
  const masked = useMasked();
  const chartData = useMemo<ChartRow[]>(
    () =>
      data.map((d) => ({
        periodLabel: d.periodLabel,
        net: Math.round((d.income - d.expenses - d.budgetExpenses) * 100) / 100,
        projected: d.projected,
      })),
    [data],
  );

  const projectedSavings = useMemo(
    () => chartData.filter((d) => d.projected && d.net > 0).reduce((sum, d) => sum + d.net, 0),
    [chartData],
  );

  const maxNet = useMemo(() => Math.max(...chartData.map((d) => d.net), 0), [chartData]);
  const minNet = useMemo(() => Math.min(...chartData.map((d) => d.net), 0), [chartData]);

  if (isLoading) {
    return (
      <div className={s.loadingWrap}>
        <Loader2
          size={24}
          className={spinnerStyles.spinIcon}
          style={{ color: vars.color.textTertiary }}
        />
      </div>
    );
  }

  if (isError) {
    return (
      <div className={s.loadingWrap}>
        <p className={s.errorText}>Failed to load data.</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 size={32} />}
        message="Add income and expenses to see your savings outlook"
      />
    );
  }

  return (
    <div>
      <p className={s.title}>Savings Outlook</p>
      <p className={s.amount}>
        <Sensitive label="projected savings">
          {projectedSavings > 0 ? formatCurrency(projectedSavings) : '$0'}
        </Sensitive>
      </p>
      <div style={{ height: '14rem' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 8, bottom: 20, left: 8 }}>
            <XAxis dataKey="periodLabel" hide />
            <YAxis hide />
            <ReferenceLine y={0} stroke={vars.color.neutral300} strokeWidth={1} />
            {maxNet > 0 && (
              <ReferenceLine
                y={maxNet}
                stroke={vars.color.neutral300}
                strokeDasharray="4 3"
                strokeWidth={1}
                label={{
                  value: masked ? REDACTED : formatCurrency(maxNet),
                  position: 'top',
                  fontSize: 13,
                  fontWeight: 500,
                  fill: vars.color.textTertiary,
                }}
              />
            )}
            {minNet < 0 && (
              <ReferenceLine
                y={minNet}
                stroke={vars.color.neutral300}
                strokeDasharray="4 3"
                strokeWidth={1}
                label={{
                  value: masked ? REDACTED : formatCurrency(minNet),
                  position: 'bottom',
                  fontSize: 13,
                  fontWeight: 500,
                  fill: vars.color.textTertiary,
                }}
              />
            )}
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <Bar dataKey="net" radius={0}>
              {chartData.map((row) => {
                let color: string;
                if (row.projected) {
                  color = row.net >= 0 ? vars.color.textPrimary : vars.color.warning400;
                } else {
                  color = row.net >= 0 ? vars.color.accent400 : vars.color.danger400;
                }
                return <Cell key={row.periodLabel} fill={color} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
