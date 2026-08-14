import {
  Pencil,
  Trash2,
  Pause,
  Play,
  Archive,
  RotateCcw,
  ExternalLink,
  CalendarDays,
  MoreVertical,
} from 'lucide-react';
import {
  IconButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Badge,
  Tooltip,
  linkStyles,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { formatCurrency } from '../../lib/utils.js';
import * as tl from '../transactions/transaction-list.css.js';
import type { Category } from '../expenses/types.js';
import type { RecurringItem } from './types.js';

interface RecurringTableProps {
  items: RecurringItem[];
  isArchivedSection?: boolean;
  narrow: boolean;
  nextDueMap: Map<string, { date: Date; amount: number }>;
  categoryMap: Map<string, Category>;
  onEdit: (item: RecurringItem) => void;
  onPause: (item: RecurringItem) => void;
  onResume: (item: RecurringItem) => void;
  onRestore: (item: RecurringItem) => void;
  onSchedule: (item: RecurringItem) => void;
  onArchive: (item: RecurringItem) => void;
  onDelete: (item: RecurringItem) => void;
}

/** One section table of recurring items — extracted verbatim from Recurring.tsx. */
export default function RecurringTable({
  items,
  isArchivedSection = false,
  narrow,
  nextDueMap,
  categoryMap,
  onEdit,
  onPause,
  onResume,
  onRestore,
  onSchedule,
  onArchive,
  onDelete,
}: RecurringTableProps) {
  function catDisplay(id: string) {
    const c = categoryMap.get(id);
    return c
      ? { label: `${c.icon ?? ''} ${c.name}`, groupColor: c.groupColor, name: c.name }
      : null;
  }

  return (
    <div className={tl.card}>
      <table className={tl.table} aria-label="Recurring items">
        <colgroup>
          <col style={{ width: narrow ? '40%' : '32%' }} />
          <col style={{ width: narrow ? '28%' : '22%' }} />
          {!narrow && <col style={{ width: '16%' }} />}
          <col style={{ width: narrow ? '22%' : '20%' }} />
          <col style={{ width: '10%' }} />
        </colgroup>
        <tbody>
          {items.map((r) => (
            <tr key={`${r.type}-${r.id}`} className={tl.row} style={{ height: '2.5rem' }}>
              <td className={`${tl.cell} ${tl.nameCell}`} style={{ paddingLeft: vars.space['3'] }}>
                <Tooltip content={r.name} truncate>
                  {r.managementUrl ? (
                    <a
                      href={r.managementUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={linkStyles.linkExternal}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: vars.space['1'],
                        overflow: 'hidden',
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                        }}
                      >
                        {r.name}
                      </span>
                      <ExternalLink size={12} style={{ flexShrink: 0 }} />
                    </a>
                  ) : (
                    <span>{r.name}</span>
                  )}
                </Tooltip>
              </td>
              <td className={`${tl.cell} ${tl.secondaryCell}`}>
                {(() => {
                  const cat = catDisplay(r.budgetId);
                  if (!cat) return <span className={tl.noBudget}>–</span>;
                  return (
                    <Badge
                      variant="neutral"
                      truncate
                      background={
                        cat.name === 'Uncategorized'
                          ? vars.color.danger100
                          : cat.groupColor
                            ? ((vars.color as Record<string, string>)[cat.groupColor] ??
                              cat.groupColor)
                            : undefined
                      }
                    >
                      {cat.label}
                    </Badge>
                  );
                })()}
              </td>
              {!narrow && (
                <td className={`${tl.cell} ${tl.secondaryCell}`}>
                  {(() => {
                    const due = nextDueMap.get(r.id)?.date;
                    if (!due) return '–';
                    const mm = String(due.getUTCMonth() + 1).padStart(2, '0');
                    const dd = String(due.getUTCDate()).padStart(2, '0');
                    const yyyy = due.getUTCFullYear();
                    return `Due ${mm}/${dd}/${yyyy}`;
                  })()}
                </td>
              )}
              <td
                className={`${tl.cell} ${tl.amountCell} ${r.type === 'income' ? tl.amountPositive : tl.amountNegative}`}
              >
                {r.type === 'income' ? '' : '-'}
                {formatCurrency(nextDueMap.get(r.id)?.amount ?? r.amount)}
              </td>
              <td className={`${tl.cell} ${tl.actionsCell}`}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {isArchivedSection ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton icon={<MoreVertical size={14} />} tooltip="Actions" size="sm" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          icon={<RotateCcw size={13} />}
                          onSelect={() => onRestore(r)}
                        >
                          Restore
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton icon={<MoreVertical size={14} />} tooltip="Actions" size="sm" />
                      </DropdownMenuTrigger>
                      {/*
                       * Three groups: the actions that change the item, the one
                       * that only looks at it, then the destructive one. View
                       * Schedule used to sit at the top, which put a read-only
                       * action ahead of the edits and left Delete sharing a
                       * group boundary with Archive. On its own it also keeps
                       * Delete visually isolated.
                       */}
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem icon={<Pencil size={13} />} onSelect={() => onEdit(r)}>
                          Edit
                        </DropdownMenuItem>
                        {!r.pausedUntil && (
                          <DropdownMenuItem icon={<Pause size={13} />} onSelect={() => onPause(r)}>
                            Pause
                          </DropdownMenuItem>
                        )}
                        {r.pausedUntil && (
                          <DropdownMenuItem icon={<Play size={13} />} onSelect={() => onResume(r)}>
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
                          icon={<CalendarDays size={13} />}
                          onSelect={() => onSchedule(r)}
                        >
                          View Schedule
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
