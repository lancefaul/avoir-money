import { useState, useId, useRef } from 'react';
import { Trash2, Download, Upload } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Checkbox,
  Modal,
  IconButton,
  TypeToConfirmInput,
  buttonStyles,
  DisplayHeading,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { contentHeader, contentBody, modalBodyFlush } from '../../components/settings-modal.css.js';
import { api } from '../../lib/api.js';
import { useToastStore } from '../../store/toast.js';
import type { DataCounts } from '../../lib/api/data-management.js';
import TransactionImportExport from '../transactions/TransactionImportExport.js';
import { exportCategory } from './dataManagementExport.js';

interface DataCategory {
  key: string;
  label: string;
  countKey: keyof DataCounts;
}

const DATA_CATEGORIES: DataCategory[] = [
  { key: 'all-transactions', label: 'Transactions', countKey: 'allTransactions' },
  { key: 'recurring-expenses', label: 'Recurring Expenses', countKey: 'recurringExpenses' },
  { key: 'recurring-income', label: 'Recurring Income', countKey: 'recurringIncome' },
  { key: 'accounts', label: 'Accounts', countKey: 'accounts' },
  { key: 'budgets', label: 'Budgets', countKey: 'budgets' },
  { key: 'debts', label: 'Debts', countKey: 'debts' },
  { key: 'utilities', label: 'Utilities', countKey: 'utilities' },
  { key: 'healthcare-policies', label: 'Healthcare Policies', countKey: 'healthcarePolicies' },
  {
    key: 'investments',
    label: 'Investments (Holdings, Custodians, Wallets)',
    countKey: 'investments',
  },
  {
    key: 'scheduled-transactions',
    label: 'Scheduled Transactions',
    countKey: 'scheduledTransactions',
  },
  { key: 'pay-schedules', label: 'Pay Schedules & Pay Periods', countKey: 'paySchedules' },
];

export default function DataManagement() {
  const fid = useId();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const { data: counts } = useQuery({
    queryKey: ['data-management-counts'],
    queryFn: () => api.dataManagement.counts(),
  });

  const allSelected = selected.size === DATA_CATEGORIES.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(DATA_CATEGORIES.map((c) => c.key)));
    }
  }

  function toggleCategory(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function openConfirm() {
    setConfirmInput('');
    setShowConfirm(true);
  }

  async function handleDelete() {
    if (confirmInput !== 'DELETE') return;
    setDeleting(true);
    try {
      const categories = Array.from(selected);
      await api.dataManagement.deleteCategories(categories);
      useToastStore
        .getState()
        .addToast(
          'success',
          `Deleted data from ${categories.length} ${categories.length === 1 ? 'category' : 'categories'}.`,
        );
      // Invalidate all relevant caches
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['income'] });
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['category-budgets'] });
      qc.invalidateQueries({ queryKey: ['debts'] });
      qc.invalidateQueries({ queryKey: ['utilities'] });
      qc.invalidateQueries({ queryKey: ['healthcare'] });
      qc.invalidateQueries({ queryKey: ['investments'] });
      qc.invalidateQueries({ queryKey: ['investment-history'] });
      qc.invalidateQueries({ queryKey: ['scheduled-transactions'] });
      qc.invalidateQueries({ queryKey: ['pay-schedules'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['data-management-counts'] });
      setSelected(new Set());
    } catch (err) {
      useToastStore
        .getState()
        .addToast('error', `Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDeleting(false);
      setShowConfirm(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const categories = Array.from(selected);
      for (const cat of categories) {
        await exportCategory(cat);
      }
      useToastStore
        .getState()
        .addToast(
          'success',
          `Exported ${categories.length} ${categories.length === 1 ? 'category' : 'categories'}.`,
        );
    } catch (err) {
      useToastStore
        .getState()
        .addToast(
          'error',
          `Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      {/* Pinned header */}
      <div className={contentHeader}>
        <DisplayHeading size="sm" as="h1">
          Data Management
        </DisplayHeading>
        <p
          style={{
            fontSize: vars.font.base,
            color: vars.color.textSecondary,
            margin: 0,
          }}
        >
          Import, export, or delete data by category. Use the checkboxes for bulk actions.
        </p>
      </div>

      {/* Scrollable table */}
      <div className={contentBody}>
        <table
          style={{
            width: '100%',
            fontSize: vars.font.base,
            tableLayout: 'fixed',
            borderCollapse: 'collapse',
          }}
          aria-label="Data categories"
        >
          {/* One flexible column (category); the rest sized to content + padding (see ERRORS.md) */}
          <colgroup>
            <col />
            <col style={{ width: '6.5rem' }} />
            <col style={{ width: '9.5rem' }} />
          </colgroup>
          <thead>
            <tr
              style={{
                background: vars.color.neutral100,
                height: '2.5rem',
                borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
                position: 'sticky',
                top: 0,
              }}
            >
              <th
                style={{
                  padding: `0 ${vars.space['6']}`,
                  textAlign: 'left',
                  fontSize: vars.font.xs,
                  fontWeight: vars.font.semibold,
                  letterSpacing: vars.font.trackingLabel,
                  fontFamily: vars.font.label,
                  textTransform: 'uppercase',
                  color: vars.color.textPrimary,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: vars.space['2'] }}>
                  {/* flexShrink 0: the column heading must never crush the checkbox */}
                  <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={toggleAll}
                      aria-label="Select all categories"
                      standalone
                    />
                  </span>
                  Category
                </div>
              </th>
              <th
                style={{
                  padding: `0 ${vars.space['6']}`,
                  textAlign: 'right',
                  fontSize: vars.font.xs,
                  fontWeight: vars.font.semibold,
                  letterSpacing: vars.font.trackingLabel,
                  fontFamily: vars.font.label,
                  textTransform: 'uppercase',
                  color: vars.color.textPrimary,
                }}
              >
                Count
              </th>
              <th
                style={{
                  padding: `0 ${vars.space['6']}`,
                  textAlign: 'right',
                  fontSize: vars.font.xs,
                  fontWeight: vars.font.semibold,
                  letterSpacing: vars.font.trackingLabel,
                  fontFamily: vars.font.label,
                  textTransform: 'uppercase',
                  color: vars.color.textPrimary,
                }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {DATA_CATEGORIES.map((cat, i) => (
              <tr
                key={cat.key}
                style={{
                  height: '2.5rem',
                  background: vars.color.neutral0,
                  borderBottom:
                    i < DATA_CATEGORIES.length - 1
                      ? `${vars.border.hairline} solid ${vars.color.border}`
                      : undefined,
                }}
              >
                <td
                  style={{
                    padding: `${vars.space['2']} ${vars.space['6']}`,
                    color: vars.color.textPrimary,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: vars.space['2'],
                      minWidth: 0,
                    }}
                  >
                    {/* flexShrink 0: a long label wraps, but never crushes the checkbox */}
                    <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                      <Checkbox
                        checked={selected.has(cat.key)}
                        onChange={() => toggleCategory(cat.key)}
                        aria-label={`Select ${cat.label}`}
                        standalone
                      />
                    </span>
                    {/* These labels gate destructive actions — wrap, never truncate */}
                    <span style={{ minWidth: 0 }}>{cat.label}</span>
                  </div>
                </td>
                <td
                  style={{
                    padding: `0 ${vars.space['6']}`,
                    color: vars.color.textPrimary,
                    textAlign: 'right',
                  }}
                >
                  {counts ? counts[cat.countKey].toLocaleString() : '—'}
                </td>
                <td style={{ padding: `0 ${vars.space['6']}`, textAlign: 'right' }}>
                  <div
                    style={{ display: 'flex', justifyContent: 'flex-end', gap: vars.space['1'] }}
                  >
                    <IconButton
                      icon={<Upload size={14} />}
                      tooltip="Import"
                      size="sm"
                      variant="trueGhost"
                      disabled={cat.key !== 'all-transactions'}
                      onClick={() => importFileRef.current?.click()}
                    />
                    <IconButton
                      icon={<Download size={14} />}
                      tooltip="Export"
                      size="sm"
                      variant="trueGhost"
                      onClick={() => {
                        exportCategory(cat.key).catch((err) =>
                          useToastStore
                            .getState()
                            .addToast(
                              'error',
                              `Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                            ),
                        );
                      }}
                    />
                    <IconButton
                      icon={<Trash2 size={14} />}
                      tooltip="Delete"
                      size="sm"
                      variant="trueGhostDanger"
                      onClick={() => {
                        setSelected(new Set([cat.key]));
                        openConfirm();
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Action bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: vars.space['3'],
          padding: `${vars.space['4']} ${vars.space['6']}`,
          borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={handleExport}
          disabled={selected.size === 0 || exporting}
          className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          style={{ opacity: selected.size === 0 ? 0.5 : 1 }}
        >
          <Download size={15} /> {exporting ? 'Exporting…' : 'Export Data'}
        </button>
        <button
          type="button"
          onClick={openConfirm}
          disabled={selected.size === 0}
          className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnDanger}`}
          style={{ opacity: selected.size === 0 ? 0.5 : 1 }}
        >
          <Trash2 size={15} /> Delete Data
        </button>
      </div>

      {/* Confirm modal — type DELETE */}
      <Modal
        open={showConfirm}
        onClose={() => {
          setShowConfirm(false);
          setConfirmInput('');
        }}
        title="Delete Selected Data"
        closeButton="none"
        bodyClassName={modalBodyFlush}
        footer={
          <div style={{ display: 'flex', gap: vars.space['3'] }}>
            <button
              type="button"
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnDanger}`}
              onClick={handleDelete}
              disabled={confirmInput !== 'DELETE' || deleting}
            >
              {deleting ? 'Deleting…' : 'Delete Selected'}
            </button>
            <button
              type="button"
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
              onClick={() => {
                setShowConfirm(false);
                setConfirmInput('');
              }}
            >
              Cancel
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
          <p style={{ fontSize: vars.font.base, color: vars.color.textPrimary, margin: 0 }}>
            This will permanently delete all data in the selected{' '}
            {selected.size === 1 ? 'category' : `${selected.size} categories`}. This action cannot
            be undone.
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: vars.space['6'],
              fontSize: vars.font.base,
              color: vars.color.textPrimary,
              lineHeight: vars.font.leadingRelaxed,
              listStyleType: 'disc',
            }}
          >
            {DATA_CATEGORIES.filter((c) => selected.has(c.key)).map((c) => (
              <li key={c.key}>{c.label}</li>
            ))}
          </ul>
          <TypeToConfirmInput
            confirmWord="DELETE"
            value={confirmInput}
            onChange={setConfirmInput}
            id={`${fid}-confirm`}
          />
        </div>
      </Modal>

      {/* Hidden file input for import */}
      <input
        ref={importFileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        aria-label="Import transactions file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            setImportFile(file);
            setShowImport(true);
          }
          e.target.value = '';
        }}
      />

      <TransactionImportExport
        open={showImport}
        onClose={() => {
          setShowImport(false);
          setImportFile(null);
        }}
        file={importFile}
      />
    </>
  );
}
