import { Sensitive } from '@budget-tracker/ui';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { computeEscrowChange } from '@budget-tracker/core';
import { useEscrowHistory, type EscrowRecord } from '../../hooks/useApi.js';
import { formatCurrency, formatDate } from '../../lib/utils.js';
import EmptyState from '../../components/EmptyState.js';

interface EscrowHistoryPanelProps {
  debtId: string;
}

function ChangeIndicator({ current, previous }: { current: EscrowRecord; previous: EscrowRecord }) {
  const { dollarDiff, percentChange, direction } = computeEscrowChange(
    current.monthlyAmount,
    previous.monthlyAmount,
  );

  const iconColor =
    direction === 'up'
      ? vars.color.danger400
      : direction === 'down'
        ? vars.color.success700
        : vars.color.textTertiary;

  const icon =
    direction === 'up' ? (
      <TrendingUp size={14} style={{ color: iconColor }} />
    ) : direction === 'down' ? (
      <TrendingDown size={14} style={{ color: iconColor }} />
    ) : (
      <Minus size={14} style={{ color: iconColor }} />
    );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: vars.space['1'],
        fontSize: vars.font.xs,
      }}
    >
      {icon}
      <span style={{ color: iconColor }}>
        {dollarDiff > 0 ? '+' : ''}
        <Sensitive label="amount">{formatCurrency(dollarDiff)}</Sensitive>
      </span>
      {previous.monthlyAmount > 0 && (
        <span style={{ color: iconColor, opacity: 0.7 }}>
          ({percentChange > 0 ? '+' : ''}
          {percentChange.toFixed(1)}%)
        </span>
      )}
    </div>
  );
}

export default function EscrowHistoryPanel({ debtId }: EscrowHistoryPanelProps) {
  const { data, isLoading } = useEscrowHistory(debtId);
  const records = (data ?? []) as EscrowRecord[];

  if (isLoading)
    return (
      <p
        style={{
          fontSize: vars.font.sm,
          color: vars.color.textTertiary,
          padding: `${vars.space['4']} 0`,
        }}
      >
        Loading escrow history…
      </p>
    );
  if (records.length === 0) return <EmptyState message="No escrow records yet." />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['2'] }}>
      <h4
        style={{
          fontSize: vars.font.xs,
          fontWeight: vars.font.semibold,
          fontFamily: vars.font.label,
          textTransform: 'uppercase',
          letterSpacing: vars.font.trackingLabel,
          color: vars.color.textTertiary,
          margin: 0,
        }}
      >
        Escrow History
      </h4>
      <div
        style={{
          borderRadius: vars.radius.lg,
          border: `${vars.border.thin} solid ${vars.color.border}`,
          background: vars.color.neutral0,
          overflow: 'hidden',
        }}
      >
        {records.map((record, idx) => {
          const previous = idx < records.length - 1 ? records[idx + 1] : null;
          return (
            <div
              key={record.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: `${vars.space['3']} ${vars.space['4']}`,
                borderBottom:
                  idx < records.length - 1
                    ? `${vars.border.hairline} solid ${vars.color.border}`
                    : undefined,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <p
                  style={{
                    fontSize: vars.font.sm,
                    fontWeight: vars.font.medium,
                    color: vars.color.textPrimary,
                    margin: 0,
                  }}
                >
                  <Sensitive label="amount">{formatCurrency(record.monthlyAmount)}</Sensitive>
                  <span style={{ color: vars.color.textTertiary, fontWeight: vars.font.regular }}>
                    /mo
                  </span>
                </p>
                <p
                  style={{
                    fontSize: vars.font.xs,
                    color: vars.color.textTertiary,
                    margin: 0,
                  }}
                >
                  {formatDate(record.periodStartDate)} – {formatDate(record.periodEndDate)}
                </p>
              </div>
              {previous && <ChangeIndicator current={record} previous={previous} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
