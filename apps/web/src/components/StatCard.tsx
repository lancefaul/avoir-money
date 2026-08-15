import { type ReactNode } from 'react';
import { cn, formatCurrency } from '../lib/utils.js';
import * as s from './stat-card.css.js';

interface Props {
  label: string;
  value: number | string;
  sub?: string;
  color?: 'green' | 'red' | 'blue' | 'gray';
  currency?: boolean;
  action?: ReactNode;
  progress?: ReactNode;
}

const colorMap: Record<string, string> = {
  green: s.valueGreen,
  red: s.valueRed,
  blue: s.valueBlue,
  gray: s.valueGray,
};

export default function StatCard({
  label,
  value,
  sub,
  color = 'gray',
  currency = true,
  action,
  progress,
}: Props) {
  return (
    <div className={s.card}>
      {action && <div className={s.action}>{action}</div>}
      <p className={s.label}>{label}</p>
      <p className={cn(s.value, colorMap[color])}>
        {typeof value === 'string'
          ? value
          : currency
            ? formatCurrency(value)
            : value.toLocaleString()}
      </p>
      {sub && <p className={s.subtitle}>{sub}</p>}
      {progress && <div className={s.progress}>{progress}</div>}
    </div>
  );
}
