import { Sensitive } from '@budget-tracker/ui';
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
        {/*
          Masked at the component, not at each of the ~40 call sites. A stat
          card exists to display one figure, so there is no case where its
          value should stay readable while the app is masked — and doing it
          here means a new StatCard cannot be added unmasked by omission.
        */}
        <Sensitive label="stat value">
          {typeof value === 'string'
            ? value
            : currency
              ? formatCurrency(value)
              : value.toLocaleString()}
        </Sensitive>
      </p>
      {/*
        The subtitle carries the comparison — "of $2,400 budgeted", "+12% vs
        last month" — so it discloses the same figure by another route.
      */}
      {sub && (
        <p className={s.subtitle}>
          <Sensitive label="stat subtitle">{sub}</Sensitive>
        </p>
      )}
      {progress && <div className={s.progress}>{progress}</div>}
    </div>
  );
}
