import { useState, useEffect, useMemo } from 'react';
import { Plus, CalendarClock } from 'lucide-react';
import {
  useExpenses,
  useCreateExpense,
  useUpdateExpense,
  useDeleteExpense,
  useArchiveExpense,
  useRestoreExpense,
  useIncome,
  useCreateIncome,
  useUpdateIncome,
  useDeleteIncome,
  useArchiveIncome,
  useRestoreIncome,
  useBudgetItems,
  useAccounts,
  useDebts,
  type DebtRecord,
} from '../hooks/useApi.js';
import { SearchInput, Badge, BadgeCount, buttonStyles } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import PageHeader from '../components/PageHeader.js';
import EmptyState from '../components/EmptyState.js';
import PauseModal from '../components/PauseModal.js';
import ResumeDialog from '../components/ResumeDialog.js';
import { formatCount, frequencyLabel } from '../lib/utils.js';
import { useUIStore } from '../store/ui.js';
import { useIsNarrow } from '../hooks/useIsNarrow.js';
import * as tl from './transactions/transaction-list.css.js';
import * as ss from './transactions/search-summary.css.js';
import type { ExpenseRecord, Category, Account } from './expenses/types.js';
import type { IncomeRecord } from './income/types.js';
import { useExpenseForm } from './expenses/useExpenseForm.js';
import { useIncomeForm } from './income/useIncomeForm.js';
import RecurringFilterMenu from './recurring/RecurringFilterMenu.js';
import ViewScheduleModal from './recurring/ViewScheduleModal.js';
import RecurringTable from './recurring/RecurringTable.js';
import RecurringFormDrawer from './recurring/RecurringFormDrawer.js';
import RecurringConfirmDialogs from './recurring/RecurringConfirmDialogs.js';
import { useRecurringItems } from './recurring/useRecurringItems.js';
import { useRecurringMutations } from './recurring/useRecurringMutations.js';
import type { RecurringItem } from './recurring/types.js';
import { buildRecurringFilterOptions } from './recurring/recurringFilterOptions.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

// ─── Component ───────────────────────────────────────────────────────────────

export default function RecurringPage() {
  const narrow = useIsNarrow(below.md);
  const setPageSubBar = useUIStore((s) => s.setPageSubBar);

  // ── Data fetching ──
  const { data: activeExpenseData, isLoading: loadingActiveExp } = useExpenses({ limit: 200 });
  const { data: archivedExpenseData, isLoading: loadingArchivedExp } = useExpenses({
    limit: 200,
    archived: 'true',
  });
  const { data: activeIncomeData, isLoading: loadingActiveInc } = useIncome({ limit: 200 });
  const { data: archivedIncomeData, isLoading: loadingArchivedInc } = useIncome({
    limit: 200,
    archived: 'true',
  });
  const isLoading =
    loadingActiveExp || loadingArchivedExp || loadingActiveInc || loadingArchivedInc;

  const { data: cats } = useBudgetItems();
  const { data: accts } = useAccounts();
  const { data: debtData } = useDebts({ limit: 200 });
  const debts = ((debtData ?? []) as DebtRecord[]).filter((d) => !d.paidOff);

  const categories = useMemo(() => (cats ?? []) as Category[], [cats]);
  const accounts = useMemo(() => (accts ?? []) as Account[], [accts]);
  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // ── Mutations ──
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const archiveExpense = useArchiveExpense();
  const restoreExpense = useRestoreExpense();
  const createIncome = useCreateIncome();
  const updateIncome = useUpdateIncome();
  const deleteIncome = useDeleteIncome();
  const archiveIncome = useArchiveIncome();
  const restoreIncome = useRestoreIncome();

  // ── Pause/resume mutations (extracted hook) ──
  const { pauseExpenseMut, resumeExpenseMut, pauseIncomeMut, resumeIncomeMut } =
    useRecurringMutations({
      onPauseSuccess: () => setPauseTarget(null),
      onResumeSuccess: () => setResumeTarget(null),
    });

  // ── Filters ──
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAccount, setFilterAccount] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string[]>([]);
  const [filterBudgetIds, setFilterBudgetIds] = useState<string[]>([]);
  const [budgetSearch, setBudgetSearch] = useState('');
  const [accountSearch, setAccountSearch] = useState('');

  const { typeOptions, filteredBudgetOptions, filteredAccountOptions } =
    buildRecurringFilterOptions(categories, accounts, budgetSearch, accountSearch);

  // ── Dialog state ──
  const [newRecurringType, setNewRecurringType] = useState<'expense' | 'income'>('expense');
  const [pauseTarget, setPauseTarget] = useState<{ id: string; type: 'expense' | 'income' } | null>(
    null,
  );
  const [resumeTarget, setResumeTarget] = useState<{
    id: string;
    type: 'expense' | 'income';
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecurringItem | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<RecurringItem | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<RecurringItem | null>(null);

  // ── Form hooks ──
  const incomeCategories = categories.filter((c) => c.group === 'SYSTEM' && c.name === 'Income');
  const expenseForm = useExpenseForm({
    categories,
    accounts,
    debts,
    create: createExpense,
    update: updateExpense,
  });
  const incomeForm = useIncomeForm({
    categories: incomeCategories,
    create: createIncome,
    update: updateIncome,
  });

  // ── Unified items + filtering + next-due lookup (extracted hook) ──
  const { nextDueMap, filtered, paused, archived, activeByFrequency } = useRecurringItems({
    activeExpenseData,
    archivedExpenseData,
    activeIncomeData,
    archivedIncomeData,
    searchQuery,
    filterAccount,
    filterType,
    filterBudgetIds,
  });

  // ── Helpers ──
  function handleEdit(item: RecurringItem) {
    if (item.type === 'expense') {
      setNewRecurringType('expense');
      expenseForm.openEdit(item.original as ExpenseRecord);
    } else {
      setNewRecurringType('income');
      incomeForm.openEdit(item.original as IncomeRecord);
    }
  }

  function handlePause(item: RecurringItem) {
    setPauseTarget({ id: item.id, type: item.type });
  }

  function handleResume(item: RecurringItem) {
    setResumeTarget({ id: item.id, type: item.type });
  }

  function handleRestore(item: RecurringItem) {
    if (item.type === 'expense') restoreExpense.mutate(item.id);
    else restoreIncome.mutate(item.id);
  }

  const searchField = (
    <SearchInput
      value={searchQuery}
      onChange={setSearchQuery}
      aria-label="Search recurring items"
      style={{ maxWidth: '75rem', width: '100%', minWidth: '10rem' }}
      actions={
        <RecurringFilterMenu
          filterTypes={filterType}
          setFilterTypes={setFilterType}
          filterBudgetIds={filterBudgetIds}
          setFilterBudgetIds={setFilterBudgetIds}
          filterAccountIds={filterAccount}
          setFilterAccountIds={setFilterAccount}
          budgetSearch={budgetSearch}
          setBudgetSearch={setBudgetSearch}
          accountSearch={accountSearch}
          setAccountSearch={setAccountSearch}
          typeOptions={typeOptions}
          filteredBudgetOptions={filteredBudgetOptions}
          filteredAccountOptions={filteredAccountOptions}
        />
      }
    />
  );

  // At narrow widths the search moves into the (non-scrolling) header sub-bar so
  // it stays pinned, spans edge-to-edge, and sits above <main>'s scrollbar.
  useEffect(() => {
    if (narrow) {
      setPageSubBar(<div className={ss.searchRow}>{searchField}</div>);
    } else {
      setPageSubBar(null);
    }
    return () => setPageSubBar(null);
  }, [narrow, searchField, setPageSubBar]);

  return (
    <div style={narrow ? { marginTop: vars.space['2'] } : undefined}>
      <PageHeader
        title={
          <>
            Recurring <BadgeCount>{formatCount(filtered.length)}</BadgeCount>
          </>
        }
        search={narrow ? undefined : searchField}
        action={
          <button
            type="button"
            onClick={() => {
              setNewRecurringType('expense');
              expenseForm.openCreate();
            }}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            <Plus size={15} /> Add Recurring
          </button>
        }
      />

      {isLoading ? (
        <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary }}>Loading…</p>
      ) : (
        <div className={tl.listWrap}>
          {activeByFrequency.length === 0 && paused.length === 0 && archived.length === 0 && (
            <EmptyState
              icon={<CalendarClock size={32} />}
              message="No recurring items — add an expense or income to get started"
              action={
                <button
                  type="button"
                  onClick={() => expenseForm.openCreate()}
                  className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
                >
                  <Plus size={15} /> Add Recurring
                </button>
              }
            />
          )}

          {activeByFrequency.map(({ freq, items }) => (
            <div key={freq}>
              <p
                className={tl.dateHeading}
                style={{ display: 'flex', alignItems: 'center', gap: vars.space['2'] }}
              >
                {frequencyLabel(freq)}{' '}
                <Badge variant="neutral" size="sm">
                  {items.length}
                </Badge>
              </p>
              {
                <RecurringTable
                  items={items}
                  narrow={narrow}
                  nextDueMap={nextDueMap}
                  categoryMap={categoryMap}
                  onEdit={handleEdit}
                  onPause={handlePause}
                  onResume={handleResume}
                  onRestore={handleRestore}
                  onSchedule={setScheduleTarget}
                  onArchive={setArchiveTarget}
                  onDelete={setDeleteTarget}
                />
              }
            </div>
          ))}

          {paused.length > 0 && (
            <div>
              <p
                className={tl.dateHeading}
                style={{ display: 'flex', alignItems: 'center', gap: vars.space['2'] }}
              >
                Paused{' '}
                <Badge variant="neutral" size="sm">
                  {paused.length}
                </Badge>
              </p>
              {
                <RecurringTable
                  items={paused}
                  narrow={narrow}
                  nextDueMap={nextDueMap}
                  categoryMap={categoryMap}
                  onEdit={handleEdit}
                  onPause={handlePause}
                  onResume={handleResume}
                  onRestore={handleRestore}
                  onSchedule={setScheduleTarget}
                  onArchive={setArchiveTarget}
                  onDelete={setDeleteTarget}
                />
              }
            </div>
          )}

          {archived.length > 0 && (
            <div>
              <p
                className={tl.dateHeading}
                style={{ display: 'flex', alignItems: 'center', gap: vars.space['2'] }}
              >
                Archived{' '}
                <Badge variant="neutral" size="sm">
                  {archived.length}
                </Badge>
              </p>
              {
                <RecurringTable
                  items={archived}
                  isArchivedSection
                  narrow={narrow}
                  nextDueMap={nextDueMap}
                  categoryMap={categoryMap}
                  onEdit={handleEdit}
                  onPause={handlePause}
                  onResume={handleResume}
                  onRestore={handleRestore}
                  onSchedule={setScheduleTarget}
                  onArchive={setArchiveTarget}
                  onDelete={setDeleteTarget}
                />
              }
            </div>
          )}
        </div>
      )}

      {/*
       * Single Recurring Drawer — create and edit.
       *
       * Open state belongs to the form hooks alone. A separate page-level flag
       * used to be OR'd in here and set alongside `openCreate()`, but only the
       * hooks' own `closeForm()` ran on a successful save — so the flag stayed
       * true and the drawer sat open over a record it had already created.
       */}
      <RecurringFormDrawer
        open={expenseForm.showForm || incomeForm.showForm}
        onClose={() => {
          expenseForm.closeForm();
          incomeForm.closeForm();
        }}
        newRecurringType={newRecurringType}
        setNewRecurringType={setNewRecurringType}
        expenseForm={expenseForm}
        incomeForm={incomeForm}
        categories={categories}
        accounts={accounts}
        debts={debts}
        expensePending={createExpense.isPending || updateExpense.isPending}
        incomePending={createIncome.isPending || updateIncome.isPending}
      />

      <PauseModal
        open={pauseTarget !== null}
        onClose={() => setPauseTarget(null)}
        onConfirm={(body) => {
          if (!pauseTarget) return;
          if (pauseTarget.type === 'expense') pauseExpenseMut.mutate({ id: pauseTarget.id, body });
          else pauseIncomeMut.mutate({ id: pauseTarget.id, body });
        }}
      />
      <ResumeDialog
        open={resumeTarget !== null}
        onClose={() => setResumeTarget(null)}
        onConfirm={(body) => {
          if (!resumeTarget) return;
          if (resumeTarget.type === 'expense')
            resumeExpenseMut.mutate({ id: resumeTarget.id, body });
          else resumeIncomeMut.mutate({ id: resumeTarget.id, body });
        }}
      />

      <RecurringConfirmDialogs
        deleteTarget={deleteTarget}
        archiveTarget={archiveTarget}
        onConfirmDelete={(item) => {
          if (item.type === 'expense')
            deleteExpense.mutate(item.id, { onSuccess: () => setDeleteTarget(null) });
          else deleteIncome.mutate(item.id, { onSuccess: () => setDeleteTarget(null) });
        }}
        onCancelDelete={() => setDeleteTarget(null)}
        onConfirmArchive={(item) => {
          if (item.type === 'expense')
            archiveExpense.mutate(item.id, { onSuccess: () => setArchiveTarget(null) });
          else archiveIncome.mutate(item.id, { onSuccess: () => setArchiveTarget(null) });
        }}
        onCancelArchive={() => setArchiveTarget(null)}
      />

      <ViewScheduleModal
        open={scheduleTarget !== null}
        onClose={() => setScheduleTarget(null)}
        sourceId={scheduleTarget?.id ?? ''}
        sourceType={scheduleTarget?.type === 'income' ? 'INCOME' : 'EXPENSE'}
        name={scheduleTarget?.name ?? ''}
      />
    </div>
  );
}
