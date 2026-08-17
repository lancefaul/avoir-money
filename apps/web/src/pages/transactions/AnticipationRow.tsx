import { Sensitive } from '@budget-tracker/ui';
import { Clock, TriangleAlert, CircleAlert, Check, MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  Badge,
  badgeStyles,
  IconButton,
  Tooltip,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { formatCurrency } from '../../lib/utils.js';
import * as tl from './transaction-list.css.js';

interface Anticipation {
  id: string;
  sourceType: 'expense' | 'income';
  sourceId: string;
  name: string;
  amount: number;
  occurrenceDate: Date;
  status: string;
  budgetId: string;
  accountId: string | null;
  isAutomatic: boolean;
  frequency: string;
}

interface AnticipationRowProps {
  anticipation: Anticipation;
  categoryInfo: (
    id: string | null,
  ) => { icon: string | null; name: string; groupColor?: string } | null;
  accountDisplay: (id: string | null) => string;
  narrow: boolean;
  compactActions: boolean;
  onMarkAsPaid: (id: string) => void;
  onConfirmPaidEarly: (a: { id: string; name: string; amount: number }) => void;
  onSnooze: (id: string, days: number) => void;
  markAsPaidPending: boolean;
}

export default function AnticipationRow({
  anticipation: a,
  categoryInfo,
  accountDisplay,
  narrow,
  compactActions,
  onMarkAsPaid,
  onConfirmPaidEarly,
  onSnooze,
  markAsPaidPending,
}: AnticipationRowProps) {
  const isOverdue = a.status === 'OVERDUE';
  const isUpcoming = a.status === 'UPCOMING';
  const isSkipped = a.status === 'SKIPPED';
  const cat = categoryInfo(a.budgetId);

  const handleMarkPaid = () => {
    if (isUpcoming && a.sourceType === 'income') {
      onConfirmPaidEarly({ id: a.id, name: a.name, amount: a.amount });
    } else {
      onMarkAsPaid(a.id);
    }
  };

  return (
    <tr key={a.id} className={tl.row} style={{ height: '2.5rem' }}>
      <td className={`${tl.cell} ${tl.cellCheck}`}>
        <Tooltip content={isOverdue ? 'Overdue' : isUpcoming ? 'Upcoming' : 'Due'}>
          <span
            className={`${badgeStyles.badge} ${badgeStyles.badgeXl} ${badgeStyles.badgeIconOnly} ${
              isOverdue
                ? badgeStyles.badgeNegative
                : isUpcoming
                  ? badgeStyles.badgeInfo
                  : badgeStyles.badgeWarning
            }`}
          >
            {isOverdue ? (
              <CircleAlert size={14} />
            ) : isUpcoming ? (
              <Clock size={14} />
            ) : (
              <TriangleAlert size={14} />
            )}
          </span>
        </Tooltip>
      </td>
      <td className={`${tl.cell} ${tl.nameCell}`}>
        <Tooltip content={a.name} truncate>
          <span>{a.name}</span>
        </Tooltip>
      </td>
      <td className={`${tl.cell} ${tl.secondaryCell}`}>
        {cat ? (
          <Badge
            variant="neutral"
            truncate
            background={
              cat.groupColor
                ? ((vars.color as Record<string, string>)[cat.groupColor] ?? cat.groupColor)
                : undefined
            }
          >
            {cat.icon} {cat.name}
          </Badge>
        ) : (
          <span className={tl.noBudget}>–</span>
        )}
      </td>
      {!narrow && (
        <td className={`${tl.cell} ${tl.tertiaryCell}`}>{accountDisplay(a.accountId)}</td>
      )}
      <td
        className={`${tl.cell} ${tl.amountCell} ${a.sourceType === 'income' ? tl.amountPositive : tl.amountNegative}`}
      >
        {a.sourceType === 'income' ? '+' : '-'}
        <Sensitive label="amount">{formatCurrency(Math.abs(a.amount))}</Sensitive>
      </td>
      <td className={`${tl.cell} ${tl.actionsCell}`}>
        {compactActions ? (
          !isSkipped && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton icon={<MoreVertical size={14} />} tooltip="Actions" size="sm" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    icon={<Check size={13} />}
                    disabled={markAsPaidPending}
                    onSelect={handleMarkPaid}
                  >
                    {isUpcoming ? 'Paid Early' : 'Mark as Paid'}
                  </DropdownMenuItem>
                  {a.sourceType !== 'income' && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger icon={<Clock size={13} />}>
                        Snooze
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                          <DropdownMenuItem key={d} onSelect={() => onSnooze(a.id, d)}>
                            {d} day{d > 1 ? 's' : ''}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: vars.space['1'],
            }}
          >
            {a.sourceType !== 'income' && !isSkipped && (
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
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <DropdownMenuItem key={d} onSelect={() => onSnooze(a.id, d)}>
                      {d} day{d > 1 ? 's' : ''}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {!isSkipped && (
              <IconButton
                icon={<Check size={14} />}
                tooltip={isUpcoming ? 'Paid Early' : 'Mark as Paid'}
                size="sm"
                variant="primary"
                disabled={markAsPaidPending}
                onClick={handleMarkPaid}
              />
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
