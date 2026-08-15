import {
  MoreHorizontal,
  Pencil,
  Trash2,
  Archive,
  ArchiveRestore,
  History,
  EyeOff,
  Eye,
  Scale,
  Sparkles,
  Plus,
  Minus,
} from 'lucide-react';
import {
  IconButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@budget-tracker/ui';
import * as s from './account-card.css.js';

/* Shared props + the overflow action menu used by every account card layout.
   Extracted from AccountCard.tsx. */

export interface AccountCardProps {
  account: {
    id: string;
    name: string;
    type: string;
    balance: number;
    archived: boolean;
    hasRewards: boolean;
    /** Card art, chosen by the user. Absent means the generic layout for `type`. */
    brand?: string | null;
  };
  onEdit: () => void;
  onDelete: () => void;
  onToggleArchive: () => void;
  onHide?: () => void;
  isHidden?: boolean;
  onLedger?: () => void;
  onReconcile?: () => void;
  /**
   * The card's nested Rewards account (rewards-as-child-account model), if one
   * exists. Present → the card shows a tappable on-card rewards row reading this
   * balance; absent → no rewards row.
   */
  rewardsAccount?: { id: string; balance: number } | null;
  /** Tap the on-card rewards row → open the rewards account's ledger. */
  onRewardsRowClick?: () => void;
  /** New model: add earned rewards (an INCOME row on the rewards account). */
  onEarnRewards?: () => void;
  /**
   * Record a decrease that is not a redemption — expiry, clawback, correction.
   * An EXPENSE row on the rewards account, the mirror of onEarnRewards.
   */
  onAdjustRewards?: () => void;
  /** New model: create the card's rewards account when it has none yet. */
  onAddRewardsAccount?: () => void;
}

export function ActionButtons({
  account,
  onEdit,
  onDelete,
  onToggleArchive,
  onHide,
  isHidden,
  onLedger,
  onReconcile,
  onEarnRewards,
  onAdjustRewards,
  onAddRewardsAccount,
  onDark,
}: {
  account: AccountCardProps['account'];
  onEdit: () => void;
  onDelete: () => void;
  onToggleArchive: () => void;
  onHide?: () => void;
  isHidden?: boolean;
  onLedger?: () => void;
  onReconcile?: () => void;
  onEarnRewards?: () => void;
  onAdjustRewards?: () => void;
  onAddRewardsAccount?: () => void;
  onDark?: boolean;
}) {
  const ghostVariant = onDark ? ('onDark' as const) : ('trueGhost' as const);

  return (
    <div className={s.actions}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            icon={<MoreHorizontal size={16} />}
            tooltip="Actions"
            size="sm"
            variant={ghostVariant}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon={<Pencil size={14} />} onSelect={onEdit}>
            Edit
          </DropdownMenuItem>
          {(onLedger || onReconcile || onEarnRewards || onAdjustRewards || onAddRewardsAccount) && (
            <DropdownMenuSeparator />
          )}
          {onReconcile && (
            <DropdownMenuItem icon={<Scale size={14} />} onSelect={onReconcile}>
              Reconcile with statement
            </DropdownMenuItem>
          )}
          {onLedger && (
            <DropdownMenuItem icon={<History size={14} />} onSelect={onLedger}>
              Balance History
            </DropdownMenuItem>
          )}
          {onEarnRewards && (
            <DropdownMenuItem icon={<Plus size={14} />} onSelect={onEarnRewards}>
              Add rewards earned
            </DropdownMenuItem>
          )}
          {onAdjustRewards && (
            <DropdownMenuItem icon={<Minus size={14} />} onSelect={onAdjustRewards}>
              Adjust rewards
            </DropdownMenuItem>
          )}
          {onAddRewardsAccount && (
            <DropdownMenuItem icon={<Sparkles size={14} />} onSelect={onAddRewardsAccount}>
              Add rewards account
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {onHide && (
            <DropdownMenuItem
              icon={isHidden ? <Eye size={14} /> : <EyeOff size={14} />}
              onSelect={onHide}
            >
              {isHidden ? 'Unhide' : 'Hide'}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            icon={account.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            onSelect={onToggleArchive}
          >
            {account.archived ? 'Unarchive' : 'Archive'}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Trash2 size={14} />} variant="danger" onSelect={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
