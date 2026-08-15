import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { formatCurrency, cn } from '../../lib/utils.js';
import * as pp from '../dashboard/payPeriodCard.css.js';

interface Props {
  costsPaid: number;
  costsCovered: number;
  totalPaid: number;
}

/**
 * Dashboard-style cost summary for a policy: one card with label/amount rows
 * (same visual language as the Pay Period cards). Premiums live on the virtual
 * insurance card modal, not here. Total Paid sits in the bordered footer row.
 */
export default function CostSummaryCard({ costsPaid, costsCovered, totalPaid }: Props) {
  const rows: { label: string; value: number }[] = [
    { label: 'Costs Paid', value: costsPaid },
    { label: 'Costs Covered', value: costsCovered },
  ];

  return (
    <div className={pp.card}>
      <div className={pp.cardHeader}>
        <div className={pp.cardTitle}>Cost Summary</div>
      </div>
      <table className={pp.table} aria-label="Policy cost summary">
        <colgroup>
          <col />
          <col style={{ width: '40%' }} />
        </colgroup>
        <tbody>
          {rows.map(({ label, value }, i) => (
            <tr
              key={label}
              className={cn(pp.row, i === rows.length - 1 ? pp.sectionLastRow : undefined)}
            >
              <td
                className={cn(pp.cell, pp.secondaryCell)}
                style={{ paddingLeft: vars.space['5'] }}
              >
                {label}
              </td>
              <td className={cn(pp.cell, pp.amountCell)} style={{ paddingRight: vars.space['5'] }}>
                {formatCurrency(value)}
              </td>
            </tr>
          ))}
          <tr className={pp.footerRow}>
            <td
              className={cn(pp.cell, pp.sectionTotalLabel)}
              style={{ paddingLeft: vars.space['5'] }}
            >
              Total Paid
            </td>
            <td className={pp.sectionTotalAmount} style={{ paddingRight: vars.space['5'] }}>
              {formatCurrency(totalPaid)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
