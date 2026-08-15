import { Fragment, useMemo } from 'react';
import { formatCurrency, formatDate, cn } from '../../lib/utils.js';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { useIsNarrow } from '../../hooks/useIsNarrow.js';
import type { Reading } from './types.js';
import { totalBill, toDateString } from './types.js';
import * as s from '../dashboard/payPeriodCard.css.js';
import * as u from './utilities-table.css.js';
import { NARROW_BREAKPOINT } from './ReadingTable.js';

interface Props {
  providerName: string;
  readings: Reading[];
}

interface SummaryRow {
  billDate: string;
  dueDate: string | null;
  total: number;
}

function getYear(d: string) {
  return Number(d.split('-')[0]);
}

function SummaryColgroup({ narrow }: { narrow: boolean }) {
  // Narrow drops the "Due" column — the due date stacks under the bill date.
  return narrow ? (
    <colgroup>
      <col style={{ width: '50%' }} />
      <col style={{ width: '38%' }} />
      <col style={{ width: '12%' }} />
    </colgroup>
  ) : (
    <colgroup>
      <col style={{ width: '30%' }} />
      <col style={{ width: '30%' }} />
      <col style={{ width: '18%' }} />
      <col style={{ width: '12%' }} />
    </colgroup>
  );
}

export default function SummaryCard({ providerName, readings }: Props) {
  const narrow = useIsNarrow(NARROW_BREAKPOINT);

  // Group readings by billDate, sum costs
  const rows = useMemo(() => {
    const map = new Map<string, SummaryRow>();
    for (const r of readings) {
      const key = toDateString(r.billDate);
      const existing = map.get(key);
      if (existing) {
        existing.total += totalBill(r);
        // Keep the earliest due date
        if (!existing.dueDate && r.dueDate) {
          existing.dueDate = toDateString(r.dueDate);
        }
      } else {
        map.set(key, {
          billDate: key,
          dueDate: r.dueDate ? toDateString(r.dueDate) : null,
          total: totalBill(r),
        });
      }
    }
    return Array.from(map.values()).toSorted(
      (a, b) => new Date(a.billDate).getTime() - new Date(b.billDate).getTime(),
    );
  }, [readings]);

  const years = useMemo(
    () => [...new Set(rows.map((r) => getYear(r.billDate)))].toSorted((a, b) => b - a),
    [rows],
  );

  if (rows.length === 0) return null;

  return (
    <div className={s.card}>
      <div className={s.cardHeader}>
        <div className={s.cardTitle}>{providerName} – Summary</div>
      </div>

      <table className={s.table} aria-label={`${providerName} yearly summary`}>
        <SummaryColgroup narrow={narrow} />
        <tbody>
          {years.map((year, yi) => {
            const yearRows = rows
              .filter((r) => getYear(r.billDate) === year)
              .slice()
              .reverse();
            const yearTotal = yearRows.reduce((sum, r) => sum + r.total, 0);

            return (
              <Fragment key={year}>
                <tr>
                  <td
                    colSpan={narrow ? 3 : 4}
                    className={cn(s.sectionLabel, yi > 0 && s.sectionLabelSpaced, s.cellFirst)}
                  >
                    {year}
                  </td>
                </tr>

                {yearRows.map((r) => {
                  return (
                    <tr key={r.billDate} className={cn(s.row, s.sectionLastRow)}>
                      <td className={cn(s.cell, s.nameCell, s.cellFirst)}>
                        <span className={s.nameCellPrimary}>{formatDate(r.billDate)}</span>
                        {narrow && (
                          <span className={u.dueSubline}>
                            {r.dueDate ? `Due ${formatDate(r.dueDate)}` : '–'}
                          </span>
                        )}
                      </td>
                      {!narrow && (
                        <td className={cn(s.cell, s.secondaryCell)}>
                          {r.dueDate ? `Due ${formatDate(r.dueDate)}` : '–'}
                        </td>
                      )}
                      <td className={cn(s.cell, s.amountCell, s.textOverdue)}>
                        -{formatCurrency(r.total)}
                      </td>
                      <td className={cn(s.cell, s.cellLast)} />
                    </tr>
                  );
                })}

                <tr className={yi === years.length - 1 ? s.footerRow : s.sectionTotalRow}>
                  <td
                    className={cn(s.cell, s.sectionTotalLabel)}
                    style={{ paddingLeft: vars.space['5'] }}
                  >
                    Total
                  </td>
                  {/* Spacer under the "Due" column — dropped with it when narrow. */}
                  {!narrow && <td className={s.cell} />}
                  <td className={cn(s.sectionTotalAmount, s.totalNegative)}>
                    -{formatCurrency(yearTotal)}
                  </td>
                  <td className={cn(s.cell, s.cellLast)} />
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
