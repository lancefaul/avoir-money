import { Plus, FolderPlus, ListFilter } from 'lucide-react';
import {
  buttonStyles,
  IconButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import type { ViewMode } from './types.js';
import { VIEW_MODE_OPTIONS, SORT_OPTIONS, type SortOption } from './budgetsPageShared.js';

interface BudgetsHeaderActionsProps {
  sortBy: SortOption;
  setSortBy: (v: SortOption) => void;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  /** Collapse the Add buttons to icon-only at narrow widths. */
  iconActions: boolean;
  disabled: boolean;
  onCreateGroup: () => void;
  onCreateBudget: () => void;
}

/** Sort/view dropdown + Add Group / Add Budget actions for the Budgets page header. */
export default function BudgetsHeaderActions({
  sortBy,
  setSortBy,
  viewMode,
  setViewMode,
  iconActions,
  disabled,
  onCreateGroup,
  onCreateBudget,
}: BudgetsHeaderActionsProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: vars.space['4'] }}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            icon={<ListFilter size={14} />}
            tooltip="Sort & view options"
            size="md"
            variant="secondary"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Sort</DropdownMenuLabel>
          {SORT_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.value}
              checked={sortBy === opt.value}
              checkStyle="check"
              onSelect={() => setSortBy(opt.value as SortOption)}
            >
              {opt.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>View</DropdownMenuLabel>
          {VIEW_MODE_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.value}
              checked={viewMode === opt.value}
              checkStyle="check"
              onSelect={() => setViewMode(opt.value as ViewMode)}
            >
              {opt.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {iconActions ? (
        <>
          <IconButton
            icon={<FolderPlus size={15} />}
            tooltip="Add Group"
            size="md"
            variant="secondary"
            onClick={onCreateGroup}
            disabled={disabled}
          />
          <IconButton
            icon={<Plus size={15} />}
            tooltip="Add Budget"
            size="md"
            variant="primary"
            onClick={onCreateBudget}
            disabled={disabled}
          />
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={onCreateGroup}
            disabled={disabled}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
          >
            <FolderPlus size={15} /> Add Group
          </button>
          <button
            type="button"
            onClick={onCreateBudget}
            disabled={disabled}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            <Plus size={15} /> Add Budget
          </button>
        </>
      )}
    </div>
  );
}
