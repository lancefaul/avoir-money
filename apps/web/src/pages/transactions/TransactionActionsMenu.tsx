import {
  Trash2,
  Pencil,
  Link2,
  Unlink,
  Scissors,
  Copy,
  CopySlash,
  MoreVertical,
  ArrowUpRight,
  Wallet,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuLabel,
  IconButton,
} from '@budget-tracker/ui';
import type { Transaction as CoreTransaction } from '@budget-tracker/core';
import type { Expense, Income } from './types.js';

/**
 * The transaction row overflow (⋯) menu — Edit / Copy & Change / Duplicate /
 * Split / Link to Recurring / Unlink / Delete. Shared between the Transactions
 * page list and the account ledger so the two never drift. All behaviour is
 * delegated to the handlers; the component only decides which items apply to a
 * given transaction (linked → Unlink instead of Copy/Duplicate/Link; only
 * EXPENSE/REFUND can Split).
 */
export interface TransactionActionsMenuProps {
  tx: CoreTransaction;
  expenses: Expense[];
  incomes: Income[];
  onEdit: (tx: CoreTransaction) => void;
  onDuplicate: (tx: CoreTransaction) => void;
  onInstantDuplicate: (tx: CoreTransaction) => void;
  onSplit: (id: string) => void;
  onLink: (id: string, body: { expenseId?: string; incomeId?: string }) => void;
  onUnlink: (id: string) => void;
  onDelete: (id: string) => void;
  /** Delete a whole purchase group (Anchor + every leg), reversing each balance. */
  onDeleteGroup: (groupId: string) => void;
  /** Jump to a purchase group's parent on the Transactions page (from a leg). */
  onManageGroup: (groupId: string) => void;
  /** Re-split a purchase group's payment legs (from its Anchor). */
  onResplit: (anchor: CoreTransaction) => void;
}

export default function TransactionActionsMenu({
  tx,
  expenses,
  incomes,
  onEdit,
  onDuplicate,
  onInstantDuplicate,
  onSplit,
  onLink,
  onUnlink,
  onDelete,
  onDeleteGroup,
  onManageGroup,
  onResplit,
}: TransactionActionsMenuProps) {
  const isLinked = !!(tx.expenseId || tx.incomeId);
  // A purchase group (payment-split, ADR-030) has two row shapes, each with its
  // own menu:
  //  • the Anchor (accountId === null) carries the budget but no account, so
  //    account-bound actions don't apply — only re-splitting its budget into
  //    categories and deleting the whole group. Seen collapsed on the
  //    Transactions page.
  //  • a leg (accountId !== null) is one account's payment. It must NEVER be
  //    edited in isolation — that would desync the group — so it offers only
  //    "Manage purchase" (jump to the parent) and a whole-group delete. Seen on
  //    the per-account ledger, where the Anchor is filtered out. Splitting a leg
  //    would split the leg's (system Payment) budget, not the purchase's — hence
  //    no Split here.
  const isGroup = !!tx.purchaseGroupId;
  const isAnchor = isGroup && tx.accountId === null;
  const isLeg = isGroup && tx.accountId !== null;
  const hasSplit = tx.type === 'EXPENSE' || tx.type === 'REFUND';

  if (isAnchor) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton icon={<MoreVertical size={14} />} tooltip="Actions" size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon={<Wallet size={13} />} onSelect={() => onResplit(tx)}>
            Edit payment split
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Scissors size={13} />} onSelect={() => onSplit(tx.id)}>
            Split into categories
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<Trash2 size={13} />}
            variant="danger"
            onSelect={() => onDeleteGroup(tx.purchaseGroupId!)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (isLeg) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton icon={<MoreVertical size={14} />} tooltip="Actions" size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            icon={<ArrowUpRight size={13} />}
            onSelect={() => onManageGroup(tx.purchaseGroupId!)}
          >
            Manage purchase
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<Trash2 size={13} />}
            variant="danger"
            onSelect={() => onDeleteGroup(tx.purchaseGroupId!)}
          >
            Delete purchase
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton icon={<MoreVertical size={14} />} tooltip="Actions" size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem icon={<Pencil size={13} />} onSelect={() => onEdit(tx)}>
          Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {!isLinked && (
          <DropdownMenuItem icon={<CopySlash size={13} />} onSelect={() => onDuplicate(tx)}>
            Copy &amp; Change
          </DropdownMenuItem>
        )}
        {!isLinked && (
          <DropdownMenuItem icon={<Copy size={13} />} onSelect={() => onInstantDuplicate(tx)}>
            Duplicate
          </DropdownMenuItem>
        )}
        {!isLinked && <DropdownMenuSeparator />}
        {hasSplit && (
          <DropdownMenuItem icon={<Scissors size={13} />} onSelect={() => onSplit(tx.id)}>
            Split
          </DropdownMenuItem>
        )}
        {!isLinked && (expenses.length > 0 || incomes.length > 0) && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger icon={<Link2 size={13} />}>
              Link to Recurring
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {expenses.length > 0 && (
                <>
                  <DropdownMenuLabel>Expenses</DropdownMenuLabel>
                  {expenses.map((e) => (
                    <DropdownMenuItem
                      key={e.id}
                      onSelect={() => onLink(tx.id, { expenseId: e.id })}
                    >
                      {e.name}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {expenses.length > 0 && incomes.length > 0 && <DropdownMenuSeparator />}
              {incomes.length > 0 && (
                <>
                  <DropdownMenuLabel>Income</DropdownMenuLabel>
                  {incomes.map((i) => (
                    <DropdownMenuItem key={i.id} onSelect={() => onLink(tx.id, { incomeId: i.id })}>
                      {i.name}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {isLinked && (
          <DropdownMenuItem icon={<Unlink size={13} />} onSelect={() => onUnlink(tx.id)}>
            Unlink
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Trash2 size={13} />}
          variant="danger"
          onSelect={() => onDelete(tx.id)}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
