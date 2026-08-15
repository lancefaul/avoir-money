import {
  Pencil,
  Trash2,
  CalendarRange,
  DollarSign,
  Home,
  Car,
  CreditCard,
  GraduationCap,
  HandCoins,
  CircleDollarSign,
  MoreVertical,
} from 'lucide-react';
import {
  Badge,
  ProgressBar,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import type { DebtRecord } from '../../hooks/useApi.js';
import { formatCurrency, formatCurrencyWhole, formatDate, cn } from '../../lib/utils.js';
import * as pp from '../dashboard/payPeriodCard.css.js';

function debtTypeIcon(type: string) {
  switch (type) {
    case 'MORTGAGE':
      return <Home size={16} />;
    case 'AUTO_LOAN':
      return <Car size={16} />;
    case 'CREDIT_CARD':
      return <CreditCard size={16} />;
    case 'STUDENT_LOAN':
      return <GraduationCap size={16} />;
    case 'PERSONAL_LOAN':
      return <HandCoins size={16} />;
    default:
      return <CircleDollarSign size={16} />;
  }
}

function debtTypeBadgeVariant(
  type: string,
): 'info' | 'brand' | 'negative' | 'warning' | 'positive' | 'neutral' {
  switch (type) {
    case 'MORTGAGE':
      return 'info';
    case 'AUTO_LOAN':
      return 'brand';
    case 'CREDIT_CARD':
      return 'negative';
    case 'STUDENT_LOAN':
      return 'warning';
    case 'PERSONAL_LOAN':
      return 'positive';
    default:
      return 'neutral';
  }
}

/**
 * Detail-row text insets that line the row text up with the progress bar's
 * text above: left = card padding (1rem) + xl icon badge (2rem) + gap (1rem);
 * right = card padding (1rem) + md actions button (2.375rem) + gap (1rem).
 */
const TEXT_LINE_LEFT = '4rem';
const TEXT_LINE_RIGHT = '4.375rem';

interface DebtCardProps {
  debt: DebtRecord;
  roundValues: boolean;
  onEdit: (d: DebtRecord) => void;
  onViewSchedule: (d: DebtRecord) => void;
  onExtraPayment: (d: DebtRecord) => void;
  onDelete: (d: DebtRecord) => void;
}

export default function DebtCard({
  debt: d,
  roundValues,
  onEdit,
  onViewSchedule,
  onExtraPayment,
  onDelete,
}: DebtCardProps) {
  const paidPct =
    d.originalBalance > 0
      ? Math.min(100, ((d.originalBalance - d.currentBalance) / d.originalBalance) * 100)
      : 0;
  const remaining = d.currentBalance;
  const money = roundValues ? formatCurrencyWhole : formatCurrency;

  return (
    <div>
      {/* Top: progress card — rounded top, flat bottom */}
      <div
        style={{
          background: vars.color.surface,
          border: `1px solid ${vars.color.border}`,
          borderRadius: `${vars.radius.lg} ${vars.radius.lg} 0 0`,
          padding: vars.space['4'],
          display: 'flex',
          alignItems: 'center',
          gap: vars.space['4'],
        }}
      >
        {/* Icon badge */}
        <Badge variant={debtTypeBadgeVariant(d.type)} size="xl" iconOnly>
          {debtTypeIcon(d.type)}
        </Badge>

        {/* Progress bar area */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <ProgressBar
            value={paidPct}
            autoColor
            striped
            label={d.name}
            valueLabel={`${money(d.originalBalance - d.currentBalance)} / ${money(d.originalBalance)}`}
            helper={`${money(remaining)} remaining`}
          />
        </div>

        {/* Overflow menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton icon={<MoreVertical size={14} />} tooltip="Actions" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon={<Pencil size={13} />} onSelect={() => onEdit(d)}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem icon={<CalendarRange size={13} />} onSelect={() => onViewSchedule(d)}>
              View Schedule
            </DropdownMenuItem>
            <DropdownMenuItem icon={<DollarSign size={13} />} onSelect={() => onExtraPayment(d)}>
              Extra Payment
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<Trash2 size={13} />}
              variant="danger"
              onSelect={() => onDelete(d)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Bottom: detail rows — flat top (seam), rounded bottom */}
      <div
        style={{
          background: vars.color.surface,
          border: `1px solid ${vars.color.border}`,
          borderTop: 'none',
          borderRadius: `0 0 ${vars.radius.lg} ${vars.radius.lg}`,
          overflow: 'hidden',
        }}
      >
        <table className={pp.table} aria-label={`${d.name} details`}>
          {/* Amounts get the lion's share — labels are short and truncate */}
          <colgroup>
            <col />
            <col style={{ width: '60%' }} />
          </colgroup>
          <tbody>
            <tr className={pp.row}>
              <td className={cn(pp.cell, pp.secondaryCell)} style={{ paddingLeft: TEXT_LINE_LEFT }}>
                Monthly Payment
              </td>
              <td className={cn(pp.cell, pp.amountCell)} style={{ paddingRight: TEXT_LINE_RIGHT }}>
                {formatCurrency(d.monthlyPayment)}
              </td>
            </tr>
            <tr className={pp.row}>
              <td className={cn(pp.cell, pp.secondaryCell)} style={{ paddingLeft: TEXT_LINE_LEFT }}>
                Interest Rate
              </td>
              <td className={cn(pp.cell, pp.amountCell)} style={{ paddingRight: TEXT_LINE_RIGHT }}>
                {d.apr}%
              </td>
            </tr>
            <tr className={pp.row}>
              <td className={cn(pp.cell, pp.secondaryCell)} style={{ paddingLeft: TEXT_LINE_LEFT }}>
                Pay-off Date
              </td>
              <td className={cn(pp.cell, pp.amountCell)} style={{ paddingRight: TEXT_LINE_RIGHT }}>
                {d.estimatedPayoffDate ? formatDate(d.estimatedPayoffDate) : '–'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
