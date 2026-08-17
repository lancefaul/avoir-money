import { Sensitive } from '@budget-tracker/ui';
import { Pencil, Trash2, MoreVertical } from 'lucide-react';
import {
  badgeStyles,
  DisplayHeading,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton,
  ProgressBar,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { convertToFrequency } from './budget-utils.js';
import { formatCurrency } from '../../lib/utils.js';
import type {
  CategoryWithBudget,
  CategoryBudgetGroup,
  DisplayFrequency,
  ViewMode,
} from './types.js';

interface CatGroup {
  id: string;
  name: string;
  color: string;
}
interface Category {
  id: string;
  name: string;
  groupId: string;
  groupName?: string;
  groupColor?: string;
  icon: string | null;
  isCustom: boolean;
  isSystem: boolean;
}

interface BudgetCardViewProps {
  groups: CatGroup[];
  groupedData: CategoryBudgetGroup[];
  displayFrequency: DisplayFrequency;
  viewMode: ViewMode;
  categoryMap: Map<string, Category>;
  onEditCategory: (cat: Category) => void;
  onDeleteCategory: (cat: Category) => void;
  onEditGroup: (group: CatGroup) => void;
  onDeleteGroup: (group: CatGroup) => void;
  canDeleteGroup: boolean;
}

export default function BudgetCardView({
  groups,
  groupedData,
  displayFrequency,
  viewMode,
  categoryMap,
  onEditCategory,
  onDeleteCategory,
  onEditGroup,
  onDeleteGroup,
  canDeleteGroup,
}: BudgetCardViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['8'] }}>
      {groups.reduce<React.ReactNode[]>((acc, g) => {
        const budgetGroup = groupedData.find((gd) => gd.groupName === g.name);
        if (!budgetGroup || budgetGroup.rows.length === 0) return acc;

        acc.push(
          <div key={g.id}>
            {/* Group heading */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: vars.space['2'],
                marginBottom: vars.space['3'],
              }}
            >
              <DisplayHeading size="lg" as="h3" style={{ flex: 1 }}>
                {g.name}
              </DisplayHeading>
              <IconButton
                icon={<Pencil size={14} />}
                tooltip="Edit group"
                size="sm"
                variant="trueGhost"
                onClick={() => onEditGroup(g)}
              />
              <IconButton
                icon={<Trash2 size={14} />}
                tooltip="Delete group"
                size="sm"
                variant="trueGhostDanger"
                onClick={() => onDeleteGroup(g)}
                disabled={!canDeleteGroup}
              />
            </div>

            {/* Card container with divider borders */}
            <div
              style={{
                background: vars.color.surface,
                border: `1px solid ${vars.color.border}`,
                borderRadius: vars.radius.lg,
                overflow: 'hidden',
              }}
            >
              {budgetGroup.rows.map((row, idx) => (
                <BudgetCard
                  key={row.id}
                  row={row}
                  groupColor={g.color}
                  displayFrequency={displayFrequency}
                  viewMode={viewMode}
                  categoryMap={categoryMap}
                  onEdit={onEditCategory}
                  onDelete={onDeleteCategory}
                  showBorder={idx > 0}
                />
              ))}

              {/* Group summary row */}
              <GroupSummaryRow
                budgetGroup={budgetGroup}
                displayFrequency={displayFrequency}
                viewMode={viewMode}
              />
            </div>
          </div>,
        );
        return acc;
      }, [])}
    </div>
  );
}

// ─── Individual budget card row ───

interface BudgetCardProps {
  row: CategoryWithBudget;
  groupColor: string;
  displayFrequency: DisplayFrequency;
  viewMode: ViewMode;
  categoryMap: Map<string, Category>;
  onEdit: (cat: Category) => void;
  onDelete: (cat: Category) => void;
  showBorder: boolean;
}

function BudgetCard({
  row,
  groupColor,
  displayFrequency,
  viewMode,
  categoryMap,
  onEdit,
  onDelete,
  showBorder,
}: BudgetCardProps) {
  const cat = categoryMap.get(row.id);
  const spent = row.actualSpending;
  const budgetFreqNormalized = row.budgetFrequency === 'YEARLY' ? 'ANNUAL' : row.budgetFrequency;
  const budget =
    viewMode === 'PAY_PERIOD'
      ? row.monthlyEquivalent
      : budgetFreqNormalized === displayFrequency
        ? row.nativeAmount
        : convertToFrequency(row.monthlyEquivalent, displayFrequency);

  const progressPct = budget > 0 ? Math.min(100, Math.max(0, (spent / budget) * 100)) : 0;
  const isExactMatch = budget > 0 && Math.abs(spent - budget) < 0.01;
  const remaining = budget - spent;

  // Resolve group color to a CSS value
  const badgeBg = groupColor
    ? ((vars.color as Record<string, string>)[groupColor] ?? groupColor)
    : vars.color.neutral200;

  return (
    <div
      style={{
        padding: `${vars.space['3']} ${vars.space['4']}`,
        display: 'flex',
        alignItems: 'center',
        gap: vars.space['4'],
        ...(showBorder ? { borderTop: `1px solid ${vars.color.border}` } : {}),
      }}
    >
      {/* Column 1: Emoji badge */}
      <span
        className={`${badgeStyles.badge} ${badgeStyles.badgeXl} ${badgeStyles.badgeIconOnly}`}
        style={{ background: badgeBg }}
      >
        {row.icon ?? '📋'}
      </span>

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
            {row.name}
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
            <Sensitive label="amount">{formatCurrency(spent)}</Sensitive> /{' '}
            <Sensitive label="budgeted">
              {row.nativeAmount === 0 && !row.seasonal ? '∞' : formatCurrency(budget)}
            </Sensitive>
          </span>
        </div>

        {/* Progress bar */}
        {row.nativeAmount === 0 && !row.seasonal ? (
          <div
            style={{
              width: '100%',
              height: '0.125rem',
              borderTop: `0.125rem dashed ${vars.color.neutral100}`,
            }}
          />
        ) : (
          <ProgressBar
            value={progressPct}
            size="md"
            striped
            autoColor={!isExactMatch}
            color={isExactMatch ? 'info400' : undefined}
          />
        )}

        {/* Remaining below bar */}
        <div style={{ marginTop: vars.space['1'] }}>
          <span
            style={{
              fontSize: vars.font.base,
              fontWeight: vars.font.medium,
              color: remaining >= 0 ? vars.color.textTertiary : vars.color.danger400,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <Sensitive label="remaining">
              {row.nativeAmount === 0 && !row.seasonal
                ? 'No limit'
                : remaining >= 0
                  ? `${formatCurrency(remaining)} remaining`
                  : `${formatCurrency(Math.abs(remaining))} over budget`}
            </Sensitive>
          </span>
        </div>
      </div>

      {/* Column 3: 3-dot menu */}
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
          <DropdownMenuItem icon={<Pencil size={13} />} onSelect={() => cat && onEdit(cat)}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<Trash2 size={13} />}
            variant="danger"
            onSelect={() => cat && onDelete(cat)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ─── Group summary row ───

interface GroupSummaryRowProps {
  budgetGroup: CategoryBudgetGroup;
  displayFrequency: DisplayFrequency;
  viewMode: ViewMode;
}

function GroupSummaryRow({ budgetGroup, displayFrequency, viewMode }: GroupSummaryRowProps) {
  const totalBudget =
    viewMode === 'PAY_PERIOD'
      ? budgetGroup.subtotalBudgeted
      : convertToFrequency(budgetGroup.subtotalBudgeted, displayFrequency);
  const totalSpent = budgetGroup.subtotalActual;
  const remaining = totalBudget - totalSpent;
  const progressPct = totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;

  return (
    <div
      style={{
        padding: `${vars.space['3']} ${vars.space['4']}`,
        borderTop: `1px solid ${vars.color.border}`,
        // One stop lighter than neutral50: against the white card the group
        // total sat 3% under it, which read as a heavier band than a subtotal
        // wants. neutral25 halves that to 1.5% and keeps the row distinct.
        background: vars.color.neutral25,
        display: 'flex',
        alignItems: 'center',
        gap: vars.space['4'],
      }}
    >
      {/* Spacer matching badge width */}
      <span style={{ width: vars.space['8'], flexShrink: 0 }} aria-hidden="true" />

      {/* Summary content */}
      <div style={{ flex: 1, minWidth: 0 }}>
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
            Group Total
          </span>
          <span
            style={{
              fontSize: vars.font.base,
              fontWeight: vars.font.medium,
              color: vars.color.textSecondary,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <Sensitive label="amount">{formatCurrency(totalSpent)}</Sensitive> /{' '}
            <Sensitive label="amount">{formatCurrency(totalBudget)}</Sensitive>
          </span>
        </div>

        <ProgressBar value={progressPct} size="md" striped autoColor />

        <div style={{ marginTop: vars.space['1'] }}>
          <span
            style={{
              fontSize: vars.font.base,
              fontWeight: vars.font.medium,
              color: remaining >= 0 ? vars.color.textTertiary : vars.color.danger400,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <Sensitive label="remaining">
              {remaining >= 0
                ? `${formatCurrency(remaining)} remaining`
                : `${formatCurrency(Math.abs(remaining))} over budget`}
            </Sensitive>
          </span>
        </div>
      </div>

      {/* Spacer matching menu button width */}
      <span style={{ width: vars.space['8'], flexShrink: 0 }} aria-hidden="true" />
    </div>
  );
}
