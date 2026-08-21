import { useState, useMemo, useCallback, useEffect, useRef, useId } from 'react';
import { Plus, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  SegmentedProgress,
  Select,
  CurrencyInput,
  IconButton,
  buttonStyles,
  inputStyles,
} from '@budget-tracker/ui';
import type { SelectOption, ProgressSegment } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { api } from '../../lib/api.js';
import { formatCurrency } from '../../lib/utils.js';
import { useToastStore } from '../../store/toast.js';
import { invalidateTransactionCaches } from '../../lib/cache-invalidation.js';
import type { Category } from './types.js';
import * as dr from './transaction-form.css.js';

/*
 * Data viz colours ordered for maximum hue separation between ADJACENT splits —
 * the order matters more than the set, because two neighbouring segments are
 * what a reader has to tell apart.
 *
 * Re-derived 2026-08-09 for the Avoir palette, whose 12 hues are not the old
 * ones. Taking every 5th series around the 12-hue wheel (5 and 12 are coprime,
 * so it visits all twelve before repeating) keeps every consecutive pair at
 * least 125° apart, against 135° minimum before. The old order was written for
 * the tomato/chili/kiwi hues and would now put fern next to green.
 */
const VIZ_COLORS = [
  vars.color.dataViz1, // rose        12.5°
  vars.color.dataViz6, // green      165°
  vars.color.dataViz11, // violet     300°
  vars.color.dataViz4, // olive      120°
  vars.color.dataViz9, // slateBlue  245°
  vars.color.dataViz2, // clay        45°
  vars.color.dataViz7, // teal       200°
  vars.color.dataViz12, // plum       340°
  vars.color.dataViz5, // fern       142.5°
  vars.color.dataViz10, // indigo     272.5°
  vars.color.dataViz3, // brass       85°
  vars.color.dataViz8, // steel      222.5°
];

interface SplitRow {
  /** Stable key for React reconciliation */
  key: string;
  /** If set, this row represents an existing child transaction */
  existingId?: string;
  budgetId: string;
  amountCents: number;
}

interface SplitTransactionModalProps {
  open: boolean;
  onClose: () => void;
  parentId: string;
  parentAmount: number;
  parentBudgetId: string | null;
  categories: Category[];
}

/** Read-only wrapper — same pattern as BitcoinPaymentFields */
const readOnlyWrapStyle: React.CSSProperties = {
  pointerEvents: 'none',
  opacity: 0.7,
};

export default function SplitTransactionModal({
  open,
  onClose,
  parentId,
  parentAmount,
  parentBudgetId,
  categories,
}: SplitTransactionModalProps) {
  const fid = useId();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const parentCents = Math.round(parentAmount * 100);

  const [rows, setRows] = useState<SplitRow[]>([]);
  const [originalRows, setOriginalRows] = useState<SplitRow[]>([]);
  const [modalState, setModalState] = useState({ prevOpen: open, initialized: false });
  const rowKeyCounter = useRef(0);

  const { data: childrenData } = useQuery({
    queryKey: ['transactions', parentId, 'children'],
    queryFn: () => api.transactions.listChildren(parentId),
    enabled: open,
  });

  // Reset initialized flag when modal closes (inline state adjustment — no useEffect)
  if (!open && modalState.prevOpen) {
    setModalState({ prevOpen: false, initialized: false });
  } else if (open && !modalState.prevOpen) {
    setModalState((s) => ({ ...s, prevOpen: true }));
  }

  // Initialize rows from fetched children data (async data — must remain as effect)
  useEffect(() => {
    if (!open || modalState.initialized || !childrenData) return;
    const existing = childrenData.children;
    if (existing.length > 0) {
      const loaded = existing.map((c) => ({
        key: c.id,
        existingId: c.id,
        budgetId: c.budgetId,
        amountCents: Math.round(c.lineTotal * 100),
      }));
      setRows(loaded);
      setOriginalRows(loaded);
    }
    setModalState((s) => ({ ...s, initialized: true }));
  }, [open, childrenData, modalState.initialized]);

  const allocatedCents = rows.reduce((sum, r) => sum + r.amountCents, 0);
  const row1Cents = parentCents - allocatedCents;

  /* Flat category options — no group headers */
  const categoryOptions: SelectOption[] = useMemo(
    () =>
      categories.map((c) => ({
        value: c.id,
        label: c.icon ? `${c.icon} ${c.name}` : c.name,
      })),
    [categories],
  );

  const [row1BudgetId, setRow1BudgetId] = useState(parentBudgetId ?? '');

  const segments = useMemo(() => {
    const segs: ProgressSegment[] = [];
    const row1Pct = parentCents > 0 ? (Math.max(row1Cents, 0) / parentCents) * 100 : 0;
    segs.push({ value: row1Pct, color: VIZ_COLORS[0] ?? '', striped: true });
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const pct = parentCents > 0 ? (row.amountCents / parentCents) * 100 : 0;
      segs.push({
        value: pct,
        color: VIZ_COLORS[(i + 1) % VIZ_COLORS.length] ?? '',
        striped: true,
      });
    }
    return segs;
  }, [rows, row1Cents, parentCents]);

  const helperParts: string[] = [];
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const row1Cat = categoryMap.get(row1BudgetId);
  helperParts.push(`${row1Cat?.name ?? 'Unassigned'} ${formatCurrency(row1Cents / 100)}`);
  for (const r of rows) {
    const cat = categoryMap.get(r.budgetId);
    helperParts.push(`${cat?.name ?? 'Unassigned'} ${formatCurrency(r.amountCents / 100)}`);
  }

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      { key: `new-${rowKeyCounter.current++}`, budgetId: '', amountCents: 0 },
    ]);
  }, []);
  const removeRow = useCallback((index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }, []);
  const updateRowCategory = useCallback((index: number, budgetId: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, budgetId } : r)));
  }, []);
  const updateRowAmount = useCallback(
    (index: number, amountCents: number) => {
      setRows((prev) => {
        const othersTotal = prev.reduce(
          (sum, r, i) => (i === index ? sum : sum + r.amountCents),
          0,
        );
        const maxForThisRow = parentCents - othersTotal;
        const clamped = Math.min(amountCents, Math.max(maxForThisRow, 0));
        return prev.map((r, i) => (i === index ? { ...r, amountCents: clamped } : r));
      });
    },
    [parentCents],
  );

  const createChild = useMutation({
    mutationFn: (body: { budgetId: string; preTaxAmount: number }) =>
      api.transactions.createChild(parentId, body),
    onSuccess: () => invalidateTransactionCaches(qc),
  });
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    const validRows = rows.filter((r) => r.budgetId && r.amountCents > 0);
    if (validRows.length === 0) {
      addToast('error', 'Add at least one category split with an amount');
      return;
    }
    setSaving(true);
    try {
      // 0. Update parent budgetId if the first row's category changed
      if (row1BudgetId && row1BudgetId !== (parentBudgetId ?? '')) {
        await api.transactions.update(parentId, { budgetId: row1BudgetId });
      }

      // 1. Delete removed existing children (independent — parallelize)
      const currentExistingIds = new Set<string>();
      for (const r of rows) {
        if (r.existingId) currentExistingIds.add(r.existingId);
      }
      const deletedRows = originalRows.filter(
        (r) => r.existingId && !currentExistingIds.has(r.existingId),
      );
      await Promise.all(
        deletedRows.map((row) => api.transactions.deleteChild(parentId, row.existingId!)),
      );

      // 2. Update changed existing children (independent — parallelize)
      const changedRows = validRows.filter((row) => {
        if (!row.existingId) return false;
        const orig = originalRows.find((r) => r.existingId === row.existingId);
        return orig && (orig.budgetId !== row.budgetId || orig.amountCents !== row.amountCents);
      });
      await Promise.all(
        changedRows.map((row) =>
          api.transactions.updateChild(parentId, row.existingId!, {
            budgetId: row.budgetId,
            preTaxAmount: row.amountCents / 100,
          }),
        ),
      );

      // 3. Create new children (independent — parallelize)
      const newRows = validRows.filter((r) => !r.existingId);
      await Promise.all(
        newRows.map((row) =>
          createChild.mutateAsync({ budgetId: row.budgetId, preTaxAmount: row.amountCents / 100 }),
        ),
      );

      invalidateTransactionCaches(qc);
      qc.invalidateQueries({ queryKey: ['transactions', parentId, 'children'] });
      const totalSplits = validRows.length + 1;
      addToast('success', `Split into ${totalSplits} categories`);
      setRows([]);
      setOriginalRows([]);
      onClose();
    } catch (err: unknown) {
      addToast('error', err instanceof Error ? err.message : 'Failed to save split');
    } finally {
      setSaving(false);
    }
  }, [rows, originalRows, parentId, createChild, qc, addToast, onClose]);

  const handleCancel = useCallback(() => {
    setRows([]);
    setOriginalRows([]);
    onClose();
  }, [onClose]);

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title="Split Transaction"
      closeButton="none"
      footer={
        <div className={dr.transferRow}>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || rows.length === 0}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={saving}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
          >
            Cancel
          </button>
        </div>
      }
    >
      <div className={inputStyles.formStack}>
        <SegmentedProgress
          label="Allocation"
          valueLabel={formatCurrency(parentAmount)}
          size="lg"
          segments={segments}
          helper={helperParts.join(' · ')}
        />

        {/* Row 1: Original category + calculated remainder — labels here only */}
        <div className={dr.transferRow}>
          <div className={inputStyles.field} style={{ flex: 1 }}>
            <label htmlFor={`${fid}-category`} className={inputStyles.fieldLabel}>
              Category
            </label>
            <Select
              id={`${fid}-category`}
              options={categoryOptions}
              value={row1BudgetId}
              onChange={setRow1BudgetId}
              searchable
              searchPlaceholder="Search categories…"
              placeholder="Select category"
            />
          </div>
          <div className={inputStyles.field} style={{ width: '9rem' }}>
            <label htmlFor={`${fid}-amount`} className={inputStyles.fieldLabel}>
              Amount
            </label>
            <div style={readOnlyWrapStyle} aria-disabled="true">
              <CurrencyInput id={`${fid}-amount`} value={Math.max(row1Cents, 0)} />
            </div>
          </div>
          {/* Placeholder spacer matching the X button width on added rows */}
          <div className={dr.transferArrow} style={{ width: '2.375rem', flexShrink: 0 }} />
        </div>

        {/* Additional split rows — no labels, aligned with row 1 */}
        {rows.map((row, i) => (
          <div key={row.key} className={dr.transferRow}>
            <div className={inputStyles.field} style={{ flex: 1 }}>
              <Select
                options={categoryOptions}
                value={row.budgetId}
                onChange={(v) => updateRowCategory(i, v)}
                searchable
                searchPlaceholder="Search categories…"
                placeholder="Select category"
              />
            </div>
            <div className={inputStyles.field} style={{ width: '9rem' }}>
              <CurrencyInput value={row.amountCents} onChange={(v) => updateRowAmount(i, v)} />
            </div>
            <IconButton
              icon={<X size={14} />}
              tooltip="Remove"
              variant="trueGhostDanger"
              onClick={() => removeRow(i)}
            />
          </div>
        ))}

        <button
          type="button"
          onClick={addRow}
          className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnTrueGhostBrand}`}
          style={{ alignSelf: 'flex-start' }}
        >
          <Plus size={14} /> Add Category
        </button>
      </div>
    </Modal>
  );
}
