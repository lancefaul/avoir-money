import { Sensitive } from '@budget-tracker/ui';
import { Pencil, Trash2, Pause, Play, Archive, RotateCcw, ExternalLink } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  badgeStyles,
  linkStyles,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { formatCurrency } from '../../lib/utils.js';
import * as tl from '../transactions/transaction-list.css.js';
import type { ExpenseRecord, Category } from './types.js';

interface ExpenseTableProps {
  items: ExpenseRecord[];
  isArchived?: boolean;
  nextDueMap: Map<string, Date>;
  categoryMap: Map<string, Category>;
  onEdit: (expense: ExpenseRecord) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onArchive: (expense: ExpenseRecord) => void;
  onDelete: (expense: ExpenseRecord) => void;
  onRestore: (id: string) => void;
}

export default function ExpenseTable({
  items,
  isArchived = false,
  nextDueMap,
  categoryMap,
  onEdit,
  onPause,
  onResume,
  onArchive,
  onDelete,
  onRestore,
}: ExpenseTableProps) {
  function catDisplay(id: string) {
    const c = categoryMap.get(id);
    return c ? { label: `${c.icon ?? ''} ${c.name}`, groupColor: c.groupColor } : null;
  }

  return (
    <div className={tl.card}>
      <table className={tl.table} aria-label="Recurring expenses">
        <colgroup>
          <col style={{ width: '32%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className={tl.row} style={{ height: '2.5rem' }}>
              <td className={`${tl.cell} ${tl.nameCell}`} style={{ paddingLeft: vars.space['3'] }}>
                {r.managementUrl ? (
                  <a
                    href={r.managementUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={linkStyles.linkExternal}
                  >
                    {r.name} <ExternalLink size={12} />
                  </a>
                ) : (
                  r.name
                )}
              </td>
              <td className={`${tl.cell} ${tl.secondaryCell}`}>
                {(() => {
                  const cat = catDisplay(r.budgetId);
                  if (!cat) return <span className={tl.noBudget}>–</span>;
                  return (
                    <span
                      className={`${badgeStyles.badge} ${badgeStyles.badgeNeutral}`}
                      style={
                        cat.groupColor
                          ? {
                              background:
                                (vars.color as Record<string, string>)[cat.groupColor] ??
                                cat.groupColor,
                            }
                          : undefined
                      }
                    >
                      {cat.label}
                    </span>
                  );
                })()}
              </td>
              <td className={`${tl.cell} ${tl.secondaryCell}`}>
                {(() => {
                  const due = nextDueMap.get(r.id);
                  if (!due) return '–';
                  const mm = String(due.getUTCMonth() + 1).padStart(2, '0');
                  const dd = String(due.getUTCDate()).padStart(2, '0');
                  const yyyy = due.getUTCFullYear();
                  return `Due ${mm}/${dd}/${yyyy}`;
                })()}
              </td>
              <td className={`${tl.cell} ${tl.amountCell} ${tl.amountNegative}`}>
                -<Sensitive label="amount">{formatCurrency(r.amount)}</Sensitive>
              </td>
              <td className={`${tl.cell} ${tl.actionsCell}`}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {isArchived ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          icon={<RotateCcw size={13} />}
                          onSelect={() => onRestore(r.id)}
                        >
                          Restore
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem icon={<Pencil size={13} />} onSelect={() => onEdit(r)}>
                          Edit
                        </DropdownMenuItem>
                        {r.frequency !== 'ONE_TIME' && !r.pausedUntil && (
                          <DropdownMenuItem
                            icon={<Pause size={13} />}
                            onSelect={() => onPause(r.id)}
                          >
                            Pause
                          </DropdownMenuItem>
                        )}
                        {r.pausedUntil && (
                          <DropdownMenuItem
                            icon={<Play size={13} />}
                            onSelect={() => onResume(r.id)}
                          >
                            Resume
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          icon={<Archive size={13} />}
                          onSelect={() => onArchive(r)}
                        >
                          Archive
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
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
