import { Plus, PiggyBank, Pencil, Trash2 } from 'lucide-react';
import { buttonStyles, IconButton, DisplayHeading } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import EmptyState from '../../components/EmptyState.js';
import type { CatGroup } from './budgetsPageShared.js';

interface EmptyBudgetsSectionProps {
  groups: CatGroup[];
  onCreateBudget: () => void;
  onEditGroup: (g: CatGroup) => void;
  onDeleteGroup: (g: CatGroup) => void;
}

/**
 * Fallback rendered when a year plan exists but no budgets do yet: per-group
 * headings (with edit/delete) over an empty state, or a bare empty state when
 * there are no groups either. Extracted from Budgets.tsx.
 */
export default function EmptyBudgetsSection({
  groups,
  onCreateBudget,
  onEditGroup,
  onDeleteGroup,
}: EmptyBudgetsSectionProps) {
  const addBudgetAction = (
    <button
      type="button"
      onClick={onCreateBudget}
      className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
    >
      <Plus size={15} /> Add Budget
    </button>
  );

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<PiggyBank size={32} />}
        message="No budgets yet — add one to start tracking your spending"
        action={addBudgetAction}
      />
    );
  }

  return (
    <div>
      {groups.map((g) => (
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
              disabled={groups.length <= 1}
            />
          </div>
          {/* Empty state under group */}
          <EmptyState
            icon={<PiggyBank size={32} />}
            message="No budgets yet — add one to start tracking your spending"
            action={addBudgetAction}
          />
        </div>
      ))}
    </div>
  );
}
