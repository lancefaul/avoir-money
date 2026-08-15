import { ProgressBar } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { formatCurrency } from '../../lib/utils.js';
import { convertToFrequency } from './budget-utils.js';
import type { DisplayFrequency, ViewMode } from './types.js';

interface GrandTotalCardProps {
  overallTotals: { totalActual: number; totalBudgeted: number; totalRemaining: number };
  viewMode: ViewMode;
  effectiveFrequency: DisplayFrequency;
}

/**
 * Grand total bar — same anatomy as the group summary rows, same values the
 * three stat cards used to track (spent, budget, remaining). Extracted from
 * Budgets.tsx.
 */
export default function GrandTotalCard({
  overallTotals,
  viewMode,
  effectiveFrequency,
}: GrandTotalCardProps) {
  const totalSpent = overallTotals.totalActual;
  const totalBudget =
    viewMode === 'PAY_PERIOD'
      ? overallTotals.totalBudgeted
      : convertToFrequency(overallTotals.totalBudgeted, effectiveFrequency);
  const remaining =
    viewMode === 'PAY_PERIOD' ? overallTotals.totalRemaining : totalBudget - totalSpent;
  const progressPct = totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;

  return (
    <div
      style={{
        padding: `${vars.space['3']} ${vars.space['4']}`,
        border: `1px solid ${vars.color.border}`,
        borderRadius: vars.radius.lg,
        background: vars.color.neutral0,
        marginBottom: vars.space['8'],
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: vars.space['1'],
        }}
      >
        <span
          style={{
            fontSize: vars.font.base,
            fontWeight: vars.font.semibold,
            color: vars.color.textPrimary,
          }}
        >
          Grand Total
        </span>
        <span
          style={{
            fontSize: vars.font.base,
            fontWeight: vars.font.medium,
            color: vars.color.textSecondary,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatCurrency(totalSpent)} / {formatCurrency(totalBudget)}
        </span>
      </div>

      <ProgressBar value={progressPct} size="lg" striped autoColor />

      <div style={{ marginTop: vars.space['1'] }}>
        <span
          style={{
            fontSize: vars.font.base,
            fontWeight: vars.font.medium,
            color: remaining >= 0 ? vars.color.textTertiary : vars.color.danger400,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {remaining >= 0
            ? `${formatCurrency(remaining)} remaining`
            : `${formatCurrency(Math.abs(remaining))} over budget`}
        </span>
      </div>
    </div>
  );
}
