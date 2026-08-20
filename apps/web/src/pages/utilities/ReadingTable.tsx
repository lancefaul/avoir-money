import { Sensitive } from '@budget-tracker/ui';
import { Fragment } from 'react';
import { Pencil, Trash2, MoreVertical } from 'lucide-react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import {
  IconButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@budget-tracker/ui';
import { formatCurrency, formatDate, cn } from '../../lib/utils.js';
import { useIsNarrow } from '../../hooks/useIsNarrow.js';
import type { Reading } from './types.js';
import { totalBill, toDateString } from './types.js';
import * as s from '../dashboard/payPeriodCard.css.js';
import * as u from './utilities-table.css.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

/**
 * Below this width the standalone "Due" column is dropped and the due date is
 * stacked under the bill date in the first column instead.
 *
 * The <col>, the data-row <td>, the total-row spacer <td>, and the year-header
 * colSpan are all switched together — column count, cell count and colSpan must
 * always agree, or cells shift into the wrong columns (see ERRORS.md).
 */
export const NARROW_BREAKPOINT = below.md;

function BillColgroup({ metered, narrow }: { metered: boolean; narrow: boolean }) {
  if (metered) {
    return narrow ? (
      <colgroup>
        <col style={{ width: '42%' }} />
        <col style={{ width: '16%' }} />
        <col style={{ width: '28%' }} />
        <col style={{ width: '14%' }} />
      </colgroup>
    ) : (
      <colgroup>
        <col style={{ width: '30%' }} />
        <col style={{ width: '18%' }} />
        <col style={{ width: '12%' }} />
        <col style={{ width: '18%' }} />
        <col style={{ width: '12%' }} />
      </colgroup>
    );
  }
  return narrow ? (
    <colgroup>
      <col style={{ width: '50%' }} />
      <col style={{ width: '30%' }} />
      <col style={{ width: '20%' }} />
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

interface ReadingTableProps {
  readings: Reading[];
  isMetered: boolean;
  onEdit: (r: Reading) => void;
  onDelete: (r: Reading) => void;
}

function getYear(d: Date | string) {
  return Number(toDateString(d).split('-')[0]);
}

export default function ReadingTable({ readings, isMetered, onEdit, onDelete }: ReadingTableProps) {
  const narrow = useIsNarrow(NARROW_BREAKPOINT);

  const sorted = [...readings].toSorted(
    (a, b) => new Date(a.billDate).getTime() - new Date(b.billDate).getTime(),
  );

  const years = [...new Set(sorted.map((r) => getYear(r.billDate)))].toSorted((a, b) => b - a);

  return (
    <table className={s.table} aria-label="Utility bill readings">
      <BillColgroup metered={isMetered} narrow={narrow} />
      <tbody>
        {years.map((year, yi) => {
          const yearReadings = sorted
            .filter((r) => getYear(r.billDate) === year)
            .slice()
            .reverse();
          const yearTotal = yearReadings.reduce((sum, r) => sum + totalBill(r), 0);
          const yearUsage = isMetered
            ? yearReadings.reduce((sum, r) => sum + (r.usage ?? 0), 0)
            : 0;
          // Must track BillColgroup: the "Due" column is dropped when narrow.
          const colCount = (isMetered ? 5 : 4) - (narrow ? 1 : 0);

          return (
            <Fragment key={year}>
              {/* Year section label */}
              <tr>
                <td
                  colSpan={colCount}
                  className={cn(s.sectionLabel, yi > 0 && s.sectionLabelSpaced, s.cellFirst)}
                >
                  {year}
                </td>
              </tr>

              {/* Reading rows */}
              {yearReadings.map((r, idx) => {
                const isLast = idx === yearReadings.length - 1;
                return (
                  <tr key={r.id} className={cn(s.row, isLast && s.sectionLastRow)}>
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
                    {isMetered && (
                      <td className={cn(s.cell, s.amountCell)}>
                        {r.usage != null ? r.usage.toLocaleString() : '–'}
                      </td>
                    )}
                    <td className={cn(s.cell, s.amountCell, s.textOverdue)}>
                      -<Sensitive label="amount">{formatCurrency(totalBill(r))}</Sensitive>
                    </td>
                    <td className={cn(s.cell, s.actionsCell, u.actionsCellLast)}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              icon={<MoreVertical size={14} />}
                              tooltip="Actions"
                              size="sm"
                              variant="trueGhost"
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              icon={<Pencil size={13} />}
                              onSelect={() => onEdit(r)}
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              icon={<Trash2 size={13} />}
                              variant="danger"
                              onSelect={() => onDelete(r)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* Year total */}
              <tr className={yi === years.length - 1 ? s.footerRow : s.sectionTotalRow}>
                <td
                  className={cn(s.cell, s.sectionTotalLabel)}
                  style={{ paddingLeft: vars.space['5'] }}
                >
                  Total
                </td>
                {/* Spacer under the "Due" column — dropped with it when narrow. */}
                {!narrow && <td className={s.cell} />}
                {isMetered && (
                  <td
                    className={cn(s.cell, s.amountCell)}
                    style={{ fontWeight: vars.font.semibold }}
                  >
                    {yearUsage.toLocaleString()}
                  </td>
                )}
                <td className={cn(s.sectionTotalAmount, s.totalNegative)}>
                  -<Sensitive label="amount">{formatCurrency(yearTotal)}</Sensitive>
                </td>
                <td className={cn(s.cell, s.cellLast)} />
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
