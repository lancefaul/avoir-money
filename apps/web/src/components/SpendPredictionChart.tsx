import { Sensitive } from '@budget-tracker/ui';
import { useCallback, useMemo, useState } from 'react';
import { LineChart, Line, ResponsiveContainer, ReferenceDot, XAxis, YAxis } from 'recharts';
import { vars } from '@budget-tracker/ui';
import { formatCurrency } from '../lib/utils.js';
import type { z } from 'zod';
import type { SpendPredictionResponseSchema } from '@budget-tracker/core';
import * as s from './spend-prediction-chart.css.js';

type SpendPredictionResponse = z.infer<typeof SpendPredictionResponseSchema>;

interface Props {
  data: SpendPredictionResponse;
}

interface DayPoint {
  dayNumber: number;
  expectedCumulative: number;
  actualCumulative: number | null;
}

function OverUnderLabel({ data }: { data: SpendPredictionResponse }) {
  const amount = data.overUnderAmount;
  if (amount > 0)
    return (
      <span className={s.overLabel}>
        <Sensitive label="amount">{formatCurrency(amount)}</Sensitive> over
      </span>
    );
  if (amount < 0)
    return (
      <span className={s.underLabel}>
        <Sensitive label="amount">{formatCurrency(Math.abs(amount))}</Sensitive> under
      </span>
    );
  return <span className={s.onTrackLabel}>$0.00 on track</span>;
}

function PinnedTooltipLabel(props: Record<string, unknown>) {
  const {
    viewBox,
    predictionData,
    chartWidth,
    chartHeight: _chartHeight,
  } = props as {
    viewBox: { x: number; y: number };
    predictionData: SpendPredictionResponse;
    chartWidth: number;
    chartHeight: number;
  };
  const width = 160;
  const height = 34;
  const pad = 4;

  let x = viewBox.x - width / 2;
  if (x < pad) x = pad;
  if (x + width > chartWidth - pad) x = chartWidth - width - pad;

  let y = viewBox.y - height - 12;
  if (y < pad) y = viewBox.y + 12;

  return (
    <foreignObject x={x} y={y} width={width} height={height}>
      <div className={s.pinnedLabel}>
        <OverUnderLabel data={predictionData} />
      </div>
    </foreignObject>
  );
}

/**
 * Build gradient stops for the actual spend line.
 * Under budget → green, near the line → yellow, over → orange, far over → red.
 */
function useSpendGradientStops(chartData: DayPoint[]): Array<{ offset: string; color: string }> {
  return useMemo(() => {
    const pointsWithActual = chartData.filter((d) => d.actualCumulative != null);
    if (pointsWithActual.length === 0) return [{ offset: '0%', color: vars.color.success400 }];

    const lastActualIdx = (() => {
      for (let i = chartData.length - 1; i >= 0; i--) {
        if (chartData[i]!.actualCumulative != null) return i;
      }
      return -1;
    })();
    if (lastActualIdx <= 0) return [{ offset: '0%', color: vars.color.success400 }];

    const firstDay = chartData[0]!.dayNumber;
    const lastDay = chartData[lastActualIdx]!.dayNumber;
    const dayRange = lastDay - firstDay;

    const stops: Array<{ offset: string; color: string }> = [];

    for (const pt of pointsWithActual) {
      const expected = pt.expectedCumulative;
      const actual = pt.actualCumulative!;
      const deviation = expected > 0 ? (actual - expected) / expected : 0;
      const offset = dayRange > 0 ? (pt.dayNumber - firstDay) / dayRange : 0;

      let color: string;
      if (deviation <= -0.05) {
        color = vars.color.success400;
      } else if (deviation <= 0.02) {
        color = vars.color.warning400;
      } else if (deviation <= 0.1) {
        color = vars.color.brand400;
      } else {
        color = vars.color.danger400;
      }

      stops.push({ offset: `${Math.round(offset * 100)}%`, color });
    }

    return stops;
  }, [chartData]);
}

export default function SpendPredictionChart({ data }: Props) {
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const handleResize = useCallback(
    (w: number, h: number) => setChartSize({ width: w, height: h }),
    [],
  );

  const remaining =
    data.expectedPeriodSpend - (data.dailyData[data.currentDayNumber - 1]?.actualCumulative ?? 0);
  const isOverspent = remaining < 0;

  const chartData: DayPoint[] = data.dailyData.map((d) => ({
    dayNumber: d.dayNumber,
    expectedCumulative: d.expectedCumulative,
    actualCumulative: d.actualCumulative,
  }));

  const gradientStops = useSpendGradientStops(chartData);

  let lastActualValue: number | null = null;
  let lastActualDay: number | null = null;
  for (let i = chartData.length - 1; i >= 0; i--) {
    if (chartData[i]!.actualCumulative != null) {
      lastActualValue = chartData[i]!.actualCumulative;
      lastActualDay = chartData[i]!.dayNumber;
      break;
    }
  }

  const dotColor =
    gradientStops.length > 0
      ? gradientStops[gradientStops.length - 1]!.color
      : vars.color.success400;

  return (
    <>
      <p className={s.title}>Left to Spend</p>
      <div className={s.amountRow}>
        <span className={`${s.amount} ${isOverspent ? s.amountOver : s.amountOk}`}>
          <Sensitive label="amount">{formatCurrency(Math.abs(remaining))}</Sensitive>
        </span>
        <span className={s.separator}>/</span>
        <span className={s.budgetAmount}>
          <Sensitive label="amount">{formatCurrency(data.expectedPeriodSpend)}</Sensitive>
        </span>
      </div>
      <p className={s.subtitle}>
        <Sensitive label="amount">
          {formatCurrency(data.expectedPeriodSpend / data.totalDays)}
        </Sensitive>
        /day
      </p>

      <ResponsiveContainer width="100%" height={220} onResize={handleResize}>
        <LineChart data={chartData}>
          <defs>
            <linearGradient id="spendGradient" x1="0" y1="0" x2="1" y2="0">
              {gradientStops.map((stop) => (
                <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
              ))}
            </linearGradient>
          </defs>
          <XAxis dataKey="dayNumber" type="number" domain={['dataMin', 'dataMax']} hide />
          <YAxis type="number" hide />
          <Line
            type="monotone"
            dataKey="expectedCumulative"
            stroke={vars.color.neutral300}
            strokeDasharray="4 3"
            strokeWidth={2}
            dot={false}
            activeDot={false}
            name="Expected"
          />
          <Line
            type="monotone"
            dataKey="actualCumulative"
            stroke="url(#spendGradient)"
            strokeWidth={2.5}
            dot={false}
            activeDot={false}
            name="Actual"
            connectNulls={false}
          />
          {lastActualDay != null && lastActualValue != null && (
            <ReferenceDot
              x={lastActualDay}
              y={lastActualValue}
              r={4}
              fill={dotColor}
              stroke={vars.color.neutral0}
              strokeWidth={2}
              isFront
              label={
                <PinnedTooltipLabel
                  predictionData={data}
                  chartWidth={chartSize.width}
                  chartHeight={chartSize.height}
                />
              }
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}
