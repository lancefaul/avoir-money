import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mail, Wallet, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToastStore } from '../../store/toast.js';
import { useUIStore } from '../../store/ui.js';
import { useIsNarrow } from '../../hooks/useIsNarrow.js';
import {
  buttonStyles,
  Select,
  type SelectOption,
  Modal,
  Checkbox,
  IconButton,
} from '@budget-tracker/ui';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import type { Category, Account } from './types.js';
import * as s from './bulk-actions-toolbar.css.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

interface BulkActionsToolbarProps {
  selected: Set<string>;
  transactionIds: string[];
  categories: Category[];
  accounts: Account[];
  onSelectAll: () => void;
  onUnselectAll: () => void;
  onBulkComplete: () => void;
}

export default function BulkActionsToolbar({
  selected,
  transactionIds,
  categories,
  accounts,
  onSelectAll,
  onUnselectAll,
  onBulkComplete,
}: BulkActionsToolbarProps) {
  const qc = useQueryClient();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const forceCollapsed = useIsNarrow(below.xl);
  const collapsed = sidebarCollapsed || forceCollapsed;
  const iconOnly = useIsNarrow(below.xs);
  const [bulkAction, setBulkAction] = useState<'category' | 'account' | null>(null);
  const [bulkValue, setBulkValue] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const categoryOptions: SelectOption[] = useMemo(
    () => categories.map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name}`.trim() })),
    [categories],
  );

  const accountOptions: SelectOption[] = useMemo(
    () =>
      accounts.reduce<SelectOption[]>((acc, a) => {
        if (!a.archived) acc.push({ value: a.id, label: a.name });
        return acc;
      }, []),
    [accounts],
  );

  async function bulkChangeCategory(catId: string) {
    const results = await Promise.allSettled(
      Array.from(selected).map((id) => api.transactions.update(id, { budgetId: catId })),
    );
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures > 0)
      useToastStore.getState().addToast('error', `${failures} transaction(s) failed to update`);
    setBulkAction(null);
    setBulkValue('');
    qc.invalidateQueries({ queryKey: ['transactions'] });
    onBulkComplete();
  }

  async function bulkChangeAccount(acctId: string) {
    const results = await Promise.allSettled(
      Array.from(selected).map((id) => api.transactions.update(id, { accountId: acctId })),
    );
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures > 0)
      useToastStore.getState().addToast('error', `${failures} transaction(s) failed to update`);
    setBulkAction(null);
    setBulkValue('');
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
    onBulkComplete();
  }

  async function bulkDelete() {
    const results = await Promise.allSettled(
      Array.from(selected).map((id) => api.transactions.delete(id)),
    );
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures > 0)
      useToastStore.getState().addToast('error', `${failures} transaction(s) failed to delete`);
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
    onBulkComplete();
  }

  const btnSm = `${buttonStyles.btnBase} ${buttonStyles.btnSm}`;

  if (selected.size === 0) return null;

  return (
    <>
      {/* Bulk action toolbar */}
      <div className={s.toolbarWrapper} style={{ left: collapsed ? '3.25rem' : '14rem' }}>
        <div className={s.toolbarInner}>
          <Checkbox
            standalone
            checked={selected.size === transactionIds.length}
            indeterminate={selected.size > 0 && selected.size < transactionIds.length}
            onChange={(checked) => {
              if (checked) onSelectAll();
              else onUnselectAll();
            }}
          />
          <span className={s.selectedCount}>{selected.size} selected</span>
          <div className={s.actions}>
            {iconOnly ? (
              <>
                <IconButton
                  icon={<Mail size={16} />}
                  tooltip="Change Budget"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setBulkAction('category');
                    setBulkValue('');
                  }}
                />
                <IconButton
                  icon={<Wallet size={16} />}
                  tooltip="Change Account"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setBulkAction('account');
                    setBulkValue('');
                  }}
                />
                <IconButton
                  icon={<Trash2 size={16} />}
                  tooltip="Delete"
                  variant="danger"
                  size="sm"
                  onClick={() => setConfirmDeleteOpen(true)}
                />
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setBulkAction('category');
                    setBulkValue('');
                  }}
                  className={`${btnSm} ${buttonStyles.btnSecondary}`}
                >
                  Change Budget
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBulkAction('account');
                    setBulkValue('');
                  }}
                  className={`${btnSm} ${buttonStyles.btnSecondary}`}
                >
                  Change Account
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(true)}
                  className={`${btnSm} ${buttonStyles.btnDanger}`}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bulk change modal */}
      <Modal
        open={bulkAction !== null}
        onClose={() => {
          setBulkAction(null);
          setBulkValue('');
        }}
        title={`Change ${bulkAction === 'category' ? 'Budget' : 'Account'} for ${selected.size} transactions`}
        variant="flat"
        closeButton="none"
        footer={
          <>
            <button
              type="button"
              onClick={() =>
                bulkAction === 'category'
                  ? bulkChangeCategory(bulkValue)
                  : bulkChangeAccount(bulkValue)
              }
              disabled={!bulkValue}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                setBulkAction(null);
                setBulkValue('');
              }}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              Cancel
            </button>
          </>
        }
      >
        <div className={s.selectWrapper}>
          <Select
            options={bulkAction === 'category' ? categoryOptions : accountOptions}
            value={bulkValue}
            onChange={(val) => setBulkValue(val)}
            placeholder="Select..."
            searchable
          />
        </div>
      </Modal>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete Transactions"
        message={`Delete ${selected.size} transactions? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmColor="red"
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          bulkDelete();
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  );
}
