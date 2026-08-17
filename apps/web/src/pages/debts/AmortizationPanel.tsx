import { Sensitive } from '@budget-tracker/ui';
import { AlertTriangle } from 'lucide-react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { useDebtAmortization, type AmortizationSchedule } from '../../hooks/useApi.js';
import { formatCurrency } from '../../lib/utils.js';
import { useIsNarrow } from '../../hooks/useIsNarrow.js';
import { FREQUENCY_LABELS } from './types.js';
import * as tl from '../transactions/transaction-list.css.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

interface AmortizationPanelProps {
  debtId: string;
  frequency: string;
  escrowEnabled: boolean;
  extraPayment?: number;
}

// Below 800px the Payment column is dropped — Principal + Interest (+ Escrow)
// already tell the story, and Payment is the widest redundant column.
const HIDE_PAYMENT_BREAKPOINT = below.lg;

// Below 640px the summary cards stack into one column and the Principal /
// Interest columns merge into a single "P&I" column.
const NARROW_BREAKPOINT = below.md;

export default function AmortizationPanel({
  debtId,
  frequency,
  escrowEnabled,
  extraPayment = 0,
}: AmortizationPanelProps) {
  const { data, isLoading } = useDebtAmortization(debtId, extraPayment);
  const schedule = data as AmortizationSchedule | undefined;
  const labels = FREQUENCY_LABELS[frequency] ?? {
    period: 'Month',
    extra: 'Extra Monthly Payment',
    remaining: 'Months Remaining',
  };

  const showPayment = !useIsNarrow(HIDE_PAYMENT_BREAKPOINT);
  const narrow = useIsNarrow(NARROW_BREAKPOINT);

  // Column weights, normalized to 100% over whichever columns are visible, so
  // the table always fills its width regardless of which columns are present.
  const cols = [
    { key: 'period', w: escrowEnabled ? 8 : 10 },
    ...(showPayment ? [{ key: 'payment', w: escrowEnabled ? 18 : 21 }] : []),
    ...(narrow
      ? [{ key: 'pi', w: escrowEnabled ? 30 : 36 }]
      : [
          { key: 'principal', w: escrowEnabled ? 20 : 22 },
          { key: 'interest', w: escrowEnabled ? 20 : 22 },
        ]),
    ...(escrowEnabled ? [{ key: 'escrow', w: narrow ? 16 : 12 }] : []),
    { key: 'balance', w: narrow ? (escrowEnabled ? 26 : 28) : escrowEnabled ? 18 : 20 },
  ];
  const colTotal = cols.reduce((sum, c) => sum + c.w, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
      {isLoading ? (
        <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary }}>Loading schedule…</p>
      ) : !schedule ? (
        <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary }}>
          No schedule available.
        </p>
      ) : (
        <>
          {schedule.isNegativelyAmortizing && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: vars.space['2'],
                padding: `${vars.space['2']} ${vars.space['3']}`,
                borderRadius: vars.radius.sm,
                background: vars.color.danger50,
                border: `1px solid ${vars.color.danger300}`,
                fontSize: vars.font.sm,
                color: vars.color.danger600,
              }}
            >
              <AlertTriangle size={14} />
              This debt is negatively amortizing. Your minimum payment does not cover the interest.
            </div>
          )}

          {/* Summary stats */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: narrow ? '1fr' : 'repeat(3, 1fr)',
              gap: vars.space['4'],
            }}
          >
            <div
              style={{
                background: vars.color.neutral0,
                border: `1px solid ${vars.color.border}`,
                borderRadius: vars.radius.lg,
                padding: vars.space['4'],
              }}
            >
              <p
                style={{
                  fontSize: vars.font.xs,
                  color: vars.color.textTertiary,
                  marginBottom: vars.space['0.5'],
                }}
              >
                Total Interest
              </p>
              <p
                style={{
                  fontSize: vars.font.base,
                  fontWeight: vars.font.medium,
                  color: vars.color.textPrimary,
                }}
              >
                <Sensitive label="amount">{formatCurrency(schedule.totalInterest)}</Sensitive>
              </p>
            </div>
            <div
              style={{
                background: vars.color.neutral0,
                border: `1px solid ${vars.color.border}`,
                borderRadius: vars.radius.lg,
                padding: vars.space['4'],
              }}
            >
              <p
                style={{
                  fontSize: vars.font.xs,
                  color: vars.color.textTertiary,
                  marginBottom: vars.space['0.5'],
                }}
              >
                Total Payments
              </p>
              <p
                style={{
                  fontSize: vars.font.base,
                  fontWeight: vars.font.medium,
                  color: vars.color.textPrimary,
                }}
              >
                <Sensitive label="amount">{formatCurrency(schedule.totalPayments)}</Sensitive>
              </p>
            </div>
            <div
              style={{
                background: vars.color.neutral0,
                border: `1px solid ${vars.color.border}`,
                borderRadius: vars.radius.lg,
                padding: vars.space['4'],
              }}
            >
              <p
                style={{
                  fontSize: vars.font.xs,
                  color: vars.color.textTertiary,
                  marginBottom: vars.space['0.5'],
                }}
              >
                {labels.remaining}
              </p>
              <p
                style={{
                  fontSize: vars.font.base,
                  fontWeight: vars.font.medium,
                  color: vars.color.textPrimary,
                }}
              >
                {schedule.monthsRemaining}
              </p>
            </div>
          </div>

          {/* Schedule table */}
          <div className={tl.card}>
            <table className={tl.table} aria-label="Amortization schedule">
              <colgroup>
                {cols.map((c) => (
                  <col key={c.key} style={{ width: `${((c.w / colTotal) * 100).toFixed(2)}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr className={tl.row}>
                  <th
                    className={`${tl.cell} ${tl.secondaryCell}`}
                    style={{ paddingLeft: vars.space['3'], textAlign: 'left' }}
                  >
                    {labels.period}
                  </th>
                  {showPayment && <th className={`${tl.cell} ${tl.amountCell}`}>Payment</th>}
                  {narrow ? (
                    <th className={`${tl.cell} ${tl.amountCell}`}>{'P&I'}</th>
                  ) : (
                    <>
                      <th className={`${tl.cell} ${tl.amountCell}`}>Principal</th>
                      <th className={`${tl.cell} ${tl.amountCell}`}>Interest</th>
                    </>
                  )}
                  {escrowEnabled && <th className={`${tl.cell} ${tl.amountCell}`}>Escrow</th>}
                  <th
                    className={`${tl.cell} ${tl.amountCell}`}
                    style={{ paddingRight: vars.space['3'] }}
                  >
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedule.entries.map((e) => (
                  <tr key={e.month} className={tl.row}>
                    <td
                      className={`${tl.cell} ${tl.nameCell}`}
                      style={{ paddingLeft: vars.space['3'] }}
                    >
                      {e.month}
                    </td>
                    {showPayment && (
                      <td className={`${tl.cell} ${tl.amountCell} ${tl.amountNeutral}`}>
                        <Sensitive label="amount">{formatCurrency(e.paymentAmount)}</Sensitive>
                      </td>
                    )}
                    {narrow ? (
                      <td className={`${tl.cell} ${tl.amountCell} ${tl.amountNeutral}`}>
                        <Sensitive label="amount">{formatCurrency(e.principalAmount)}</Sensitive> +{' '}
                        <Sensitive label="amount">{formatCurrency(e.interestAmount)}</Sensitive>
                      </td>
                    ) : (
                      <>
                        <td className={`${tl.cell} ${tl.amountCell} ${tl.amountNeutral}`}>
                          <Sensitive label="amount">{formatCurrency(e.principalAmount)}</Sensitive>
                        </td>
                        <td className={`${tl.cell} ${tl.amountCell} ${tl.amountNegative}`}>
                          <Sensitive label="amount">{formatCurrency(e.interestAmount)}</Sensitive>
                        </td>
                      </>
                    )}
                    {escrowEnabled && (
                      <td className={`${tl.cell} ${tl.amountCell} ${tl.amountNeutral}`}>
                        <Sensitive label="amount">{formatCurrency(e.escrowAmount)}</Sensitive>
                      </td>
                    )}
                    <td
                      className={`${tl.cell} ${tl.amountCell} ${tl.amountNeutral}`}
                      style={{ paddingRight: vars.space['3'] }}
                    >
                      <Sensitive label="amount">{formatCurrency(e.remainingBalance)}</Sensitive>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
