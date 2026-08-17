import { Sensitive } from '@budget-tracker/ui';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Clock, CircleAlert, TriangleAlert, AlarmClock, MoreVertical } from 'lucide-react';
import {
  Modal,
  IconButton,
  badgeStyles,
  Tooltip,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { api } from '../../lib/api.js';
import { useMarkAsPaid, useSnooze } from '../../hooks/useScheduledTransactions.js';
import { formatCurrency } from '../../lib/utils.js';
import { useIsNarrow } from '../../hooks/useIsNarrow.js';
import * as tl from '../transactions/transaction-list.css.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

interface ViewScheduleModalProps {
  open: boolean;
  onClose: () => void;
  sourceId: string;
  sourceType: 'EXPENSE' | 'INCOME';
  name: string;
}

// Below 800px the Paid date/amount collapse into sublines under the Due
// date/amount columns, and the two standalone Paid columns are dropped.
const STACK_PAID_BREAKPOINT = below.lg;

// Below 540px the Snooze + Mark-as-Paid buttons collapse into a single ⋯ menu.
const COMPACT_ACTIONS_BREAKPOINT = below.sm;

export default function ViewScheduleModal({
  open,
  onClose,
  sourceId,
  sourceType,
  name,
}: ViewScheduleModalProps) {
  const periodStart = '2020-01-01';
  const periodEnd = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 5);
    return d.toISOString().split('T')[0]!;
  })();

  const { data: scheduledTxs } = useQuery({
    queryKey: ['scheduled-transactions', sourceType, sourceId, periodStart, periodEnd],
    queryFn: () => api.scheduledTransactions.list({ periodStart, periodEnd, sourceType, sourceId }),
    enabled: open,
  });

  const markAsPaid = useMarkAsPaid();
  const snooze = useSnooze();
  const narrow = useIsNarrow(STACK_PAID_BREAKPOINT);
  const compactActions = useIsNarrow(COMPACT_ACTIONS_BREAKPOINT);

  const rows = useMemo(() => {
    if (!scheduledTxs) return [];
    return scheduledTxs.toSorted(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
    );
  }, [scheduledTxs]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function statusBadge(status: string, dueDate: Date) {
    const due = new Date(dueDate);
    const isOverdue = status === 'PENDING' && due < today;

    if (status === 'PAID' || status === 'PARTIAL') {
      return (
        <Tooltip content={status === 'PAID' ? 'Paid' : 'Partial'}>
          <span
            className={`${badgeStyles.badge} ${badgeStyles.badgeXl} ${badgeStyles.badgeIconOnly} ${badgeStyles.badgePositive}`}
          >
            <Check size={14} />
          </span>
        </Tooltip>
      );
    }
    if (status === 'SNOOZED') {
      return (
        <Tooltip content="Snoozed">
          <span
            className={`${badgeStyles.badge} ${badgeStyles.badgeXl} ${badgeStyles.badgeIconOnly} ${badgeStyles.badgeInfo}`}
          >
            <AlarmClock size={14} />
          </span>
        </Tooltip>
      );
    }
    if (isOverdue) {
      return (
        <Tooltip content="Overdue">
          <span
            className={`${badgeStyles.badge} ${badgeStyles.badgeXl} ${badgeStyles.badgeIconOnly} ${badgeStyles.badgeNegative}`}
          >
            <CircleAlert size={14} />
          </span>
        </Tooltip>
      );
    }
    // PENDING (future)
    return (
      <Tooltip content="Pending">
        <span
          className={`${badgeStyles.badge} ${badgeStyles.badgeXl} ${badgeStyles.badgeIconOnly} ${badgeStyles.badgeWarning}`}
        >
          <TriangleAlert size={14} />
        </span>
      </Tooltip>
    );
  }

  function formatDate(d: Date) {
    const date = new Date(d);
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }

  function handleMarkAsPaid(id: string) {
    markAsPaid.mutate({ id });
  }

  function handleSnooze(id: string, days: number) {
    snooze.mutate({ id, days });
  }

  // Find the first actionable row (next scheduled item that can be paid/snoozed)
  const nextActionableId = useMemo(() => {
    const pending = rows.find((r) => r.status === 'PENDING' || r.status === 'SNOOZED');
    return pending?.id ?? null;
  }, [rows]);

  return (
    <Modal open={open} onClose={onClose} title={`Schedule — ${name}`} variant="pinned">
      <div style={{ overflow: 'auto', maxHeight: '100%' }}>
        <div className={tl.card}>
          <table className={tl.table}>
            <colgroup>
              <col style={{ width: '3rem' }} />
              <col style={{ width: '10rem' }} />
              <col />
              {!narrow && <col style={{ width: '10rem' }} />}
              {!narrow && <col />}
              <col style={{ width: compactActions ? '3rem' : '6rem' }} />
            </colgroup>
            <tbody>
              {rows.map((row) => {
                const isActionable = row.id === nextActionableId;
                const isPaid = row.transactionId != null && row.status === 'PAID';
                const paidPositive =
                  row.actualAmount != null && row.actualAmount >= row.expectedAmount;
                return (
                  <tr key={row.id} className={tl.row}>
                    <td className={tl.cell}>{statusBadge(row.status, row.dueDate)}</td>
                    <td className={`${tl.cell} ${tl.nameCell}`}>
                      Due {formatDate(row.dueDate)}
                      {row.status === 'SNOOZED' && row.snoozedUntil && (
                        <span
                          style={{
                            fontSize: vars.font.xs,
                            color: vars.color.textTertiary,
                            marginLeft: vars.space['2'],
                          }}
                        >
                          (until {formatDate(row.snoozedUntil)})
                        </span>
                      )}
                      {narrow && isPaid && (
                        <span
                          style={{
                            display: 'block',
                            fontSize: vars.font.xs,
                            color: vars.color.textTertiary,
                          }}
                        >
                          Paid {formatDate(row.updatedAt)}
                        </span>
                      )}
                    </td>
                    <td className={`${tl.cell} ${tl.amountCell} ${tl.amountNeutral}`}>
                      <Sensitive label="amount">{formatCurrency(row.expectedAmount)}</Sensitive>
                      {narrow && row.actualAmount != null && (
                        <span
                          className={paidPositive ? tl.amountPositive : tl.amountNegative}
                          style={{ display: 'block', fontSize: vars.font.xs }}
                        >
                          <Sensitive label="amount">{formatCurrency(row.actualAmount)}</Sensitive>
                        </span>
                      )}
                    </td>
                    {!narrow && (
                      <td
                        className={`${tl.cell} ${tl.secondaryCell}`}
                        style={{ textAlign: 'right' }}
                      >
                        {isPaid ? `Paid ${formatDate(row.updatedAt)}` : '–'}
                      </td>
                    )}
                    {!narrow && (
                      <td
                        className={`${tl.cell} ${tl.amountCell} ${row.actualAmount != null ? (paidPositive ? tl.amountPositive : tl.amountNegative) : tl.amountNeutral}`}
                      >
                        {row.actualAmount != null ? formatCurrency(row.actualAmount) : '–'}
                      </td>
                    )}
                    <td className={`${tl.cell} ${tl.actionsCell}`}>
                      {isActionable &&
                        (compactActions ? (
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
                                  icon={<Check size={13} />}
                                  disabled={markAsPaid.isPending}
                                  onSelect={() => handleMarkAsPaid(row.id)}
                                >
                                  Mark as Paid
                                </DropdownMenuItem>
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger icon={<Clock size={13} />}>
                                    Snooze
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent>
                                    {[1, 2, 3, 5, 7, 14, 30].map((d) => (
                                      <DropdownMenuItem
                                        key={d}
                                        onSelect={() => handleSnooze(row.id, d)}
                                      >
                                        {d} day{d > 1 ? 's' : ''}
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuSubContent>
                                </DropdownMenuSub>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        ) : (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                              gap: vars.space['1'],
                            }}
                          >
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <IconButton
                                  icon={<Clock size={14} />}
                                  tooltip="Snooze"
                                  size="sm"
                                  variant="secondary"
                                />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {[1, 2, 3, 5, 7, 14, 30].map((d) => (
                                  <DropdownMenuItem
                                    key={d}
                                    onSelect={() => handleSnooze(row.id, d)}
                                  >
                                    {d} day{d > 1 ? 's' : ''}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <IconButton
                              icon={<Check size={14} />}
                              tooltip="Mark as Paid"
                              size="sm"
                              variant="primary"
                              disabled={markAsPaid.isPending}
                              onClick={() => handleMarkAsPaid(row.id)}
                            />
                          </div>
                        ))}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={narrow ? 4 : 6}
                    style={{
                      textAlign: 'center',
                      padding: vars.space['8'],
                      color: vars.color.textTertiary,
                      fontSize: vars.font.base,
                    }}
                  >
                    No scheduled transactions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
