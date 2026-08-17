import { Sensitive } from '@budget-tracker/ui';
import { Check, CircleDashed } from 'lucide-react';
import type { InsurancePolicyWithBalance } from '@budget-tracker/core';
import { Badge, SegmentedProgress, Tooltip, buttonStyles } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { formatCurrency, cn } from '../../lib/utils.js';
import * as pp from '../dashboard/payPeriodCard.css.js';

type PolicyBalance = InsurancePolicyWithBalance['balance'];

/**
 * Cost-row left inset that lines the row text up with the coverage row's text
 * above: row padding (1rem) + xl status badge (2rem) + gap (1rem). The right
 * side stays at the shared 1rem — the spent/limit value ends at the padding.
 */
const TEXT_LINE_LEFT = '4rem';

interface RowData {
  label: string;
  limit: number;
  spent: number;
  /** Dollars covered by secondary insurance (the striped bar segment). */
  covered: number;
  paidPct: number;
  coveredPct: number;
  met: boolean;
  override: boolean;
}

function deductibleRow(balance: PolicyBalance): RowData {
  const limit = balance.deductibleLimit ?? 0;
  const spent = balance.deductibleSpent ?? 0;
  const covered = balance.deductibleOverride ? Math.max(limit - spent, 0) : 0;
  return {
    label: 'Deductible',
    limit,
    spent,
    covered,
    paidPct: limit > 0 ? Math.min((spent / limit) * 100, 100) : 0,
    coveredPct: limit > 0 ? (covered / limit) * 100 : 0,
    met: balance.deductibleOverride || spent >= limit,
    override: balance.deductibleOverride,
  };
}

function coinsuranceRow(balance: PolicyBalance): RowData {
  const limit = (balance.oopmLimit ?? 0) - (balance.deductibleLimit ?? 0);
  const spent = Math.max(balance.oopmRaw - (balance.deductibleLimit ?? 0), 0);
  const covered = balance.oopmOverride ? Math.max(limit - spent, 0) : 0;
  return {
    label: 'Coinsurance',
    limit,
    spent,
    covered,
    paidPct: limit > 0 ? Math.min((spent / limit) * 100, 100) : 0,
    coveredPct: limit > 0 ? (covered / limit) * 100 : 0,
    met: balance.oopmOverride || (balance.oopmSpent ?? 0) >= (balance.oopmLimit ?? 0),
    override: balance.oopmOverride,
  };
}

interface Props {
  balance: PolicyBalance;
  kind: 'deductible' | 'coinsurance';
  /** When provided and the limit is unmet, renders the "Paid by secondary insurance" action. */
  onMarkPaidBySecondary?: () => void;
}

/**
 * One coverage limit as a composite card: a budget-category-style progress row
 * on top (rounded top, flat bottom) with the limit's Costs Paid / Costs
 * Covered rows attached beneath (flat top, rounded bottom) in the dashboard
 * summary-row style. The leading badge is a dashboard-style status badge —
 * met → positive check, in progress → warning dashed circle.
 */
export default function CoverageProgressCard({ balance, kind, onMarkPaidBySecondary }: Props) {
  const row = kind === 'deductible' ? deductibleRow(balance) : coinsuranceRow(balance);

  return (
    <div>
      {/* Top: coverage progress — rounded top, flat bottom */}
      <div className={pp.card} style={{ borderRadius: `${vars.radius.lg} ${vars.radius.lg} 0 0` }}>
        <CoverageRow row={row} onMarkPaidBySecondary={onMarkPaidBySecondary} />
      </div>

      {/* Bottom: this limit's cost rows — flat top (seam), rounded bottom */}
      <div
        className={pp.card}
        style={{ borderRadius: `0 0 ${vars.radius.lg} ${vars.radius.lg}`, borderTop: 'none' }}
      >
        <table className={pp.table} aria-label={`${row.label} cost breakdown`}>
          <colgroup>
            <col />
            <col style={{ width: '40%' }} />
          </colgroup>
          <tbody>
            <tr className={pp.row}>
              <td className={cn(pp.cell, pp.secondaryCell)} style={{ paddingLeft: TEXT_LINE_LEFT }}>
                Costs Paid
              </td>
              <td className={cn(pp.cell, pp.amountCell)} style={{ paddingRight: vars.space['4'] }}>
                <Sensitive label="amount">{formatCurrency(row.spent)}</Sensitive>
              </td>
            </tr>
            <tr className={pp.row}>
              <td className={cn(pp.cell, pp.secondaryCell)} style={{ paddingLeft: TEXT_LINE_LEFT }}>
                Costs Covered
              </td>
              <td className={cn(pp.cell, pp.amountCell)} style={{ paddingRight: vars.space['4'] }}>
                <Sensitive label="amount">{formatCurrency(row.covered)}</Sensitive>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ row }: { row: RowData }) {
  if (row.met) {
    const detail = row.override ? 'Paid by secondary insurance' : `${row.label} met`;
    return (
      <Tooltip content={detail} focusable>
        <Badge variant="positive" size="xl" iconOnly aria-label={`${row.label} met`}>
          <Check size={14} />
        </Badge>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={`${row.label} in progress`} focusable>
      <Badge variant="warning" size="xl" iconOnly aria-label={`${row.label} in progress`}>
        <CircleDashed size={14} />
      </Badge>
    </Tooltip>
  );
}

function CoverageRow({
  row,
  onMarkPaidBySecondary,
}: {
  row: RowData;
  onMarkPaidBySecondary?: () => void;
}) {
  const remaining = row.override ? 0 : Math.max(row.limit - row.spent, 0);

  return (
    <div
      style={{
        padding: `${vars.space['3']} ${vars.space['4']}`,
        display: 'flex',
        alignItems: 'center',
        gap: vars.space['4'],
      }}
    >
      {/* Column 1: Status badge */}
      <StatusBadge row={row} />

      {/* Column 2: Name, spent/total, progress bar, remaining */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Row above bar: name left, spent/total right */}
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
              fontWeight: vars.font.medium,
              color: vars.color.textPrimary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.label}
          </span>
          <span
            style={{
              fontSize: vars.font.base,
              fontWeight: vars.font.medium,
              color: vars.color.textSecondary,
              fontVariantNumeric: 'tabular-nums',
              flexShrink: 0,
              marginLeft: vars.space['2'],
            }}
          >
            <Sensitive label="amount">{formatCurrency(row.spent)}</Sensitive> /{' '}
            <Sensitive label="amount">{formatCurrency(row.limit)}</Sensitive>
          </span>
        </div>

        {/* Progress bar — insurance-covered portion striped */}
        <SegmentedProgress
          segments={[
            { value: row.paidPct, variant: 'default' as const },
            { value: row.coveredPct, variant: 'success' as const, striped: true },
          ]}
          size="md"
          ariaLabel={`${row.label} progress`}
        />

        {/* Remaining below bar */}
        <div style={{ marginTop: vars.space['1'] }}>
          <span
            style={{
              fontSize: vars.font.base,
              fontWeight: vars.font.medium,
              color: vars.color.textTertiary,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <Sensitive label="amount">{formatCurrency(remaining)}</Sensitive> remaining
          </span>
        </div>
      </div>

      {/* Column 3: secondary-insurance action (moved from the old StatCards) */}
      {!row.met && onMarkPaidBySecondary && (
        <button
          type="button"
          onClick={onMarkPaidBySecondary}
          className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnPrimary}`}
          style={{ flexShrink: 0 }}
        >
          <Check size={14} /> Paid by secondary insurance
        </button>
      )}
    </div>
  );
}
