import { useState, useMemo, useCallback, useRef } from 'react';
import { CalendarRange } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateBudgetGroupSchema } from '@budget-tracker/core';
import type { BudgetStatusResponse } from '@budget-tracker/core';
import { format } from 'date-fns';
import {
  useBudgetItems,
  useBudgetItemGroups,
  useCreateBudgetItemGroup,
  useUpdateBudgetItemGroup,
  useDeleteBudgetItemGroup,
  useDeleteBudgetItem,
  useReassignBudgetItem,
} from '../hooks/useBudgetItems.js';
import { useActivePlan, useBudgets } from '../hooks/useBudgets.js';
import { useCurrentPeriod } from '../hooks/useApi.js';
import PageHeader from '../components/PageHeader.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import EmptyState from '../components/EmptyState.js';
import BudgetItemForm from './budgets/BudgetItemForm.js';
import BudgetItemDeleteDialog from './budgets/BudgetItemDeleteDialog.js';
import BudgetCardView from './budgets/BudgetCardView.js';
import NewGroupModal from './budgets/NewGroupModal.js';
import type { ViewMode } from './budgets/types.js';
import YearPlanModal from './budgets/YearPlanModal.js';
import DraftBanner from './budgets/DraftBanner.js';
import EmptyBudgetsSection from './budgets/EmptyBudgetsSection.js';
import GrandTotalCard from './budgets/GrandTotalCard.js';
import BudgetsHeaderActions from './budgets/BudgetsHeaderActions.js';
import {
  type CatGroup,
  type Category,
  type GroupFormValues,
  type SortOption,
  INITIAL_DELETE_STATE,
  ICON_ACTIONS_BREAKPOINT,
  parseLocalDate,
} from './budgets/budgetsPageShared.js';
import {
  transformBudgetRow,
  groupCategoriesWithBudgets,
  computeOverallTotals,
} from './budgets/budget-utils.js';
import type { DisplayFrequency, DeleteDialogState, DeletionMode } from './budgets/types.js';
import { formatCount } from '../lib/utils.js';
import { useIsNarrow } from '../hooks/useIsNarrow.js';
import { buttonStyles, BadgeCount } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as ds from './dashboard.css.js';

// ─── Page Orchestrator ───

export default function BudgetsPage() {
  // ── Data ──
  const { data: categoriesData } = useBudgetItems();
  const { data: groupsData } = useBudgetItemGroups();
  const { data: activePlan, currentYearPlan } = useActivePlan();
  const yearPlanIdRef = useRef(currentYearPlan?.id);
  if (currentYearPlan?.id) yearPlanIdRef.current = currentYearPlan.id;
  const yearPlanId = currentYearPlan?.id ?? yearPlanIdRef.current;
  const periodQuery = useCurrentPeriod();
  const periodData = periodQuery.data as
    | { payPeriod: { startDate: Date; endDate: Date } }
    | undefined;
  const [now] = useState(() => new Date());

  // ── View mode ──
  const [viewMode, setViewMode] = useState<ViewMode>('PAY_PERIOD');
  const iconActions = useIsNarrow(ICON_ACTIONS_BREAKPOINT);
  const [sortBy, setSortBy] = useState<SortOption>('spent-desc');

  // Derive period dates for the API query
  const periodStart =
    viewMode === 'PAY_PERIOD' && periodData
      ? periodData.payPeriod.startDate.toISOString()
      : viewMode === 'ANNUAL'
        ? new Date(Date.UTC(now.getFullYear(), 0, 1)).toISOString()
        : undefined;
  const periodEnd =
    viewMode === 'PAY_PERIOD' && periodData
      ? periodData.payPeriod.endDate.toISOString()
      : viewMode === 'ANNUAL'
        ? new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1)).toISOString()
        : undefined;

  const { data: budgetsData } = useBudgets(
    yearPlanId,
    now.getMonth() + 1,
    now.getFullYear(),
    true,
    periodStart,
    periodEnd,
    viewMode,
  );

  // ── Mutations ──
  const createGroup = useCreateBudgetItemGroup();
  const updateGroup = useUpdateBudgetItemGroup();
  const delGroup = useDeleteBudgetItemGroup();
  const delCat = useDeleteBudgetItem();
  const reassignCat = useReassignBudgetItem();

  // ── UI State ──
  const [showCatForm, setShowCatForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<CatGroup | null>(null);
  const [yearPlanModalOpen, setYearPlanModalOpen] = useState(false);
  const [deleteDialogState, setDeleteDialogState] =
    useState<DeleteDialogState>(INITIAL_DELETE_STATE);
  const [groupDeleteConfirm, setGroupDeleteConfirm] = useState<{
    open: boolean;
    group: CatGroup | null;
    catCount: number;
  }>({ open: false, group: null, catCount: 0 });

  const categories = useMemo(() => (categoriesData ?? []) as Category[], [categoriesData]);
  const groups = useMemo(() => (groupsData ?? []) as CatGroup[], [groupsData]);
  const budgets = useMemo(() => (budgetsData ?? []) as BudgetStatusResponse[], [budgetsData]);
  const nonSystemGroups = useMemo(() => groups.filter((g) => g.name !== 'SYSTEM'), [groups]);

  // ── Group form ──
  const groupForm = useForm<GroupFormValues>({
    resolver: zodResolver(CreateBudgetGroupSchema),
    mode: 'onBlur',
    defaultValues: { color: 'slateBlue500' },
  });

  // ── Budget merge ──
  const budgetMap = useMemo(() => {
    const map = new Map<string, BudgetStatusResponse>();
    for (const b of budgets) if (b.budgetId) map.set(b.budgetId, b);
    return map;
  }, [budgets]);

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const categoryBudgetRows = useMemo(
    () =>
      categories.reduce<ReturnType<typeof transformBudgetRow>[]>((acc, c) => {
        if (!c.isSystem) {
          acc.push(transformBudgetRow(c, budgetMap.get(c.id) ?? null));
        }
        return acc;
      }, []),
    [categories, budgetMap],
  );
  const groupedDataRaw = useMemo(
    () => groupCategoriesWithBudgets(categoryBudgetRows),
    [categoryBudgetRows],
  );
  const groupedData = useMemo(() => {
    return groupedDataRaw.map((g) => ({
      ...g,
      rows: [...g.rows].sort((a, b) => {
        const pctA = a.monthlyEquivalent > 0 ? a.actualSpending / a.monthlyEquivalent : 0;
        const pctB = b.monthlyEquivalent > 0 ? b.actualSpending / b.monthlyEquivalent : 0;
        switch (sortBy) {
          case 'spent-desc':
            return pctB - pctA;
          case 'spent-asc':
            return pctA - pctB;
          case 'name-asc':
            return a.name.localeCompare(b.name);
          case 'name-desc':
            return b.name.localeCompare(a.name);
        }
      }),
    }));
  }, [groupedDataRaw, sortBy]);
  const overallTotals = useMemo(() => computeOverallTotals(groupedData), [groupedData]);

  // ── Category callbacks ──
  const openCreateCat = useCallback(() => {
    setEditingCategory(null);
    setShowCatForm(true);
  }, []);
  const openEditCat = useCallback((c: Category) => {
    setEditingCategory(c);
    setShowCatForm(true);
  }, []);
  const closeCatForm = useCallback(() => {
    setShowCatForm(false);
    setEditingCategory(null);
  }, []);

  const openDeleteDialog = useCallback(
    (c: Category) => {
      const hasBudget = !!budgetMap.get(c.id);
      // No budget → just hard-delete directly, no dialog needed
      if (!hasBudget) {
        delCat.mutate({ id: c.id, mode: 'hard' });
        return;
      }
      setDeleteDialogState({
        open: true,
        categoryId: c.id,
        categoryName: c.name,
        step: 'choose',
        mode: null,
        targetCategoryId: null,
        transactionCount: 0,
        hasBudget,
      });
    },
    [budgetMap, delCat],
  );

  const closeDeleteDialog = useCallback(() => setDeleteDialogState(INITIAL_DELETE_STATE), []);

  const handleDeleteConfirm = useCallback(
    (mode: DeletionMode, targetCategoryId?: string) => {
      const { categoryId } = deleteDialogState;
      if (!categoryId) return;
      if (mode === 'reassign' && targetCategoryId) {
        reassignCat.mutate(
          { id: categoryId, targetBudgetId: targetCategoryId },
          { onSuccess: closeDeleteDialog },
        );
      } else if (mode === 'hard' || mode === 'soft') {
        delCat.mutate({ id: categoryId, mode }, { onSuccess: closeDeleteDialog });
      }
    },
    [deleteDialogState, delCat, reassignCat, closeDeleteDialog],
  );

  // ── Group callbacks ──
  const openCreateGroup = useCallback(() => {
    setEditingGroup(null);
    groupForm.reset({ color: 'slateBlue500' });
    setShowGroupForm(true);
  }, [groupForm]);
  const openEditGroup = useCallback(
    (g: CatGroup) => {
      setEditingGroup(g);
      groupForm.reset({ name: g.name, color: g.color });
      setShowGroupForm(true);
    },
    [groupForm],
  );
  const closeGroupForm = useCallback(() => {
    setShowGroupForm(false);
    setEditingGroup(null);
    groupForm.reset();
  }, [groupForm]);
  const onGroupSubmit = useCallback(
    (v: GroupFormValues) => {
      if (editingGroup) {
        updateGroup.mutate({ id: editingGroup.id, body: v }, { onSuccess: closeGroupForm });
      } else {
        createGroup.mutate(v, { onSuccess: closeGroupForm });
      }
    },
    [editingGroup, createGroup, updateGroup, closeGroupForm],
  );

  const tryDeleteGroup = useCallback(
    (g: CatGroup) => {
      const cats = categories.filter((c) => c.groupId === g.id);
      if (cats.length === 0) {
        delGroup.mutate(g.id);
        return;
      }
      setGroupDeleteConfirm({ open: true, group: g, catCount: cats.length });
    },
    [categories, delGroup],
  );

  const confirmGroupDelete = useCallback(async () => {
    const g = groupDeleteConfirm.group;
    if (!g) return;
    setGroupDeleteConfirm({ open: false, group: null, catCount: 0 });
    const cats = categories.filter((c) => c.groupId === g.id);
    for (const c of cats) {
      try {
        await delCat.mutateAsync({ id: c.id });
      } catch (err) {
        console.warn('[Budgets] Failed to delete budget item before group delete', c.id, err);
        openDeleteDialog(c);
        return;
      }
    }
    delGroup.mutate(g.id);
  }, [groupDeleteConfirm, categories, delCat, delGroup, openDeleteDialog]);

  const editingBudgetData = editingCategory ? (budgetMap.get(editingCategory.id) ?? null) : null;

  // ── Helpers ──
  const effectiveFrequency: DisplayFrequency =
    viewMode === 'PAY_PERIOD' ? 'BIWEEKLY' : viewMode === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY';

  // ── Render ──
  return (
    <div>
      <PageHeader
        title={
          <>
            Budgets <BadgeCount>{formatCount(categories.length)}</BadgeCount>
          </>
        }
        action={
          <BudgetsHeaderActions
            sortBy={sortBy}
            setSortBy={setSortBy}
            viewMode={viewMode}
            setViewMode={setViewMode}
            iconActions={iconActions}
            disabled={!activePlan && !currentYearPlan}
            onCreateGroup={openCreateGroup}
            onCreateBudget={openCreateCat}
          />
        }
      />

      {/* Year plan banner */}
      {!activePlan && !currentYearPlan && (
        <EmptyState
          icon={<CalendarRange size={32} />}
          message="Set up a year plan to start tracking budgets"
          action={
            <button
              type="button"
              onClick={() => setYearPlanModalOpen(true)}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              Create Plan
            </button>
          }
        />
      )}

      {/* Draft banner */}
      {!activePlan && currentYearPlan?.status === 'DRAFT' && (
        <div style={{ marginBottom: vars.space['4'] }}>
          <DraftBanner year={now.getFullYear()} planId={currentYearPlan.id} />
        </div>
      )}

      {/* Period heading */}
      {viewMode === 'PAY_PERIOD' && periodData && (
        <div style={{ marginBottom: vars.space['6'] }}>
          <p className={ds.payPeriodLabel}>Pay Period</p>
          <p className={ds.payPeriodDate}>
            {format(parseLocalDate(periodData.payPeriod.startDate), 'MMMM d, yyyy')} &mdash;{' '}
            {format(parseLocalDate(periodData.payPeriod.endDate), 'MMMM d, yyyy')}
          </p>
        </div>
      )}
      {viewMode === 'MONTHLY' && (
        <div style={{ marginBottom: vars.space['6'] }}>
          <p className={ds.payPeriodLabel}>Monthly</p>
          <p className={ds.payPeriodDate}>{format(now, 'MMMM yyyy')}</p>
        </div>
      )}
      {viewMode === 'ANNUAL' && (
        <div style={{ marginBottom: vars.space['6'] }}>
          <p className={ds.payPeriodLabel}>Annual</p>
          <p className={ds.payPeriodDate}>
            January 1, {now.getFullYear()} &mdash; December 31, {now.getFullYear()}
          </p>
        </div>
      )}

      {/* Grand total — same anatomy as the group summary rows, same values the
          three stat cards used to track (spent, budget, remaining) */}
      {(activePlan || currentYearPlan) && groupedData.length > 0 && (
        <GrandTotalCard
          overallTotals={overallTotals}
          viewMode={viewMode}
          effectiveFrequency={effectiveFrequency}
        />
      )}

      {/* Grouped budget item sections */}
      {(activePlan || currentYearPlan) && (
        <>
          {groupedData.length > 0 ? (
            <BudgetCardView
              groups={nonSystemGroups}
              groupedData={groupedData}
              displayFrequency={effectiveFrequency}
              viewMode={viewMode}
              categoryMap={categoryMap}
              onEditCategory={openEditCat}
              onDeleteCategory={openDeleteDialog}
              onEditGroup={openEditGroup}
              onDeleteGroup={tryDeleteGroup}
              canDeleteGroup={nonSystemGroups.length > 1}
            />
          ) : (
            <EmptyBudgetsSection
              groups={nonSystemGroups}
              onCreateBudget={openCreateCat}
              onEditGroup={openEditGroup}
              onDeleteGroup={tryDeleteGroup}
            />
          )}
        </>
      )}

      {/* New group modal */}
      {showGroupForm && (
        <NewGroupModal
          form={groupForm}
          onSubmit={onGroupSubmit}
          onClose={closeGroupForm}
          title={editingGroup ? 'Edit Budget Group' : undefined}
        />
      )}

      {/* Budget item form modal */}
      {showCatForm && (
        <BudgetItemForm
          editing={
            editingCategory
              ? {
                  id: editingCategory.id,
                  name: editingCategory.name,
                  icon: editingCategory.icon,
                  groupId: editingCategory.groupId,
                }
              : null
          }
          budgetData={editingBudgetData}
          groups={nonSystemGroups.map((g) => ({ id: g.id, name: g.name }))}
          yearPlanId={currentYearPlan?.id ?? null}
          onClose={closeCatForm}
          onSave={closeCatForm}
        />
      )}

      {/* Budget item delete dialog */}
      <BudgetItemDeleteDialog
        state={deleteDialogState}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        onClose={closeDeleteDialog}
        onConfirm={handleDeleteConfirm}
        isLoading={delCat.isPending || reassignCat.isPending}
      />

      {/* Group delete confirm dialog */}
      <ConfirmDialog
        open={groupDeleteConfirm.open}
        title={`Delete group "${groupDeleteConfirm.group?.name ?? ''}"?`}
        message={`This will delete the group and all ${groupDeleteConfirm.catCount} budgets in it. Budgets in use will need to be reassigned.`}
        confirmLabel="Delete All"
        confirmColor="red"
        onConfirm={confirmGroupDelete}
        onCancel={() => setGroupDeleteConfirm({ open: false, group: null, catCount: 0 })}
      />

      {/* Year plan modal */}
      <YearPlanModal open={yearPlanModalOpen} onClose={() => setYearPlanModalOpen(false)} />
    </div>
  );
}
