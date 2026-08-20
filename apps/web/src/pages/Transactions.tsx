import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { Plus, Receipt } from 'lucide-react';
import {
  buttonStyles,
  Badge,
  BadgeCount,
  type SelectOption,
  SearchInput,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import { type Anticipation } from '@budget-tracker/core';
import PageHeader from '../components/PageHeader.js';
import EmptyState from '../components/EmptyState.js';
import { formatCurrency, formatCount } from '../lib/utils.js';
import { useUIStore } from '../store/ui.js';
import { useMarkAsPaid, useSnooze } from '../hooks/useScheduledTransactions.js';
import { useCurrentPeriod } from '../hooks/useApi.js';
import { useTransactions } from '../hooks/useTransactions.js';
import type { Transaction } from './transactions/types.js';
import { useTransactionRowActions } from './transactions/useTransactionRowActions.js';
import { useTransactionEntries } from './transactions/useTransactionEntries.js';
import { buildDatePresets, renderSummaryStats } from './transactions/transactionsPageUtils.js';
import TransactionList from './transactions/TransactionList.js';
import BulkActionsToolbar from './transactions/BulkActionsToolbar.js';
import TransactionFilterMenu from './transactions/TransactionFilterMenu.js';
import * as ss from './transactions/search-summary.css.js';
import { useIsNarrow } from '../hooks/useIsNarrow.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

/** Breakpoint at/below which the search field and summary move out of the header into the page body. */
const HEADER_COLLAPSE_BREAKPOINT = below.md;

export default function TransactionsPage() {
  const narrow = useIsNarrow(HEADER_COLLAPSE_BREAKPOINT);
  // `?purchase=<groupId>` scopes the list to one payment-split purchase — the
  // "Manage purchase" deep-link from a split leg on the account ledger. The
  // filter returns the Anchor + its legs, which collapse to the single Anchor.
  const { purchase } = useSearch({ from: '/transactions' });
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState<string | undefined>(undefined);
  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([]);
  const [filterAccountIds, setFilterAccountIds] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterLinkedToRecurring, setFilterLinkedToRecurring] = useState<boolean | undefined>(
    undefined,
  );
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [filterDatePreset, setFilterDatePreset] = useState<string | undefined>(undefined);
  const [budgetSearch, setBudgetSearch] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  // Persisted preferences rather than page state: these describe how the user
  // reads this page and should survive a reload.
  const showAnticipations = useUIStore((s) => s.showAnticipations);
  const setShowAnticipations = useUIStore((s) => s.setShowAnticipations);
  const showSnoozed = useUIStore((s) => s.showSnoozed);
  const setShowSnoozed = useUIStore((s) => s.setShowSnoozed);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmPaidEarly, setConfirmPaidEarly] = useState<{
    id: string;
    name: string;
    amount: number;
  } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery || undefined), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const periodQuery = useCurrentPeriod();
  const currentPeriod = periodQuery.data as
    | {
        payPeriod: { startDate: string | Date; endDate: string | Date };
        schedule: { type: string };
      }
    | undefined;

  const datePresets = useMemo(() => buildDatePresets(currentPeriod), [currentPeriod]);

  const activeDateRange = useMemo(() => {
    if (!filterDatePreset) return undefined;
    return datePresets.find((p) => p.key === filterDatePreset);
  }, [filterDatePreset, datePresets]);

  const txQueryParams = {
    search: debouncedSearch,
    linkedToRecurring: filterLinkedToRecurring,
    sortOrder: sortOrder !== 'newest' ? sortOrder : undefined,
    dateFrom: activeDateRange?.dateFrom,
    dateTo: activeDateRange?.dateTo,
    budgetIds: filterCategoryIds.length > 0 ? filterCategoryIds.join(',') : undefined,
    purchaseGroupId: purchase,
    // Both are decided server-side, so they belong in the request rather than
    // being filtered out of the response — a snoozed row is not returned at all
    // unless asked for. They are part of the query key, so toggling refetches.
    showAnticipations,
    showSnoozed,
  };
  const {
    data: txData,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useTransactions(txQueryParams);

  const markAsPaid = useMarkAsPaid();
  const snoozeMutation = useSnooze();

  const rawTransactions = useMemo(
    () => (txData?.pages.flatMap((p) => p.transactions) ?? []) as Transaction[],
    [txData],
  );
  const rawAnticipations = useMemo(() => {
    const fresh = txData?.pages[0]?.anticipations as Anticipation[] | undefined;
    return fresh ?? [];
  }, [txData]);
  // Keep a stable reference to the last non-empty anticipations to avoid UI flash during refetch
  const anticipationsRef = useRef<Anticipation[]>([]);
  if (rawAnticipations.length > 0) {
    anticipationsRef.current = rawAnticipations;
  }
  const stableAnticipations =
    rawAnticipations.length > 0 ? rawAnticipations : anticipationsRef.current;
  const totalCount = txData?.pages[0]?.totalCount ?? 0;

  // Row actions (menu handlers), the supporting reference data, the transaction
  // form and the split/delete modals all live in this one shared hook — the same
  // one the account ledger uses.
  const rowActions = useTransactionRowActions({ transactions: rawTransactions });
  const { accounts, categories, custodians, wallets, form } = rowActions;

  const handleLoadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  const { filteredEntries, transactions, searchSummary } = useTransactionEntries({
    rawTransactions,
    stableAnticipations,
    sortOrder,
    filterCategoryIds,
    filterAccountIds,
    filterTypes,
    filterLinkedToRecurring,
    filterDatePreset,
    searchQuery,
    debouncedSearch,
    txData,
  });

  const setPageSubBar = useUIStore((s) => s.setPageSubBar);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  const selectAll = () => setSelected(new Set(transactions.map((tx) => tx.id)));
  const unselectAll = () => setSelected(new Set());

  const budgetOptions = useMemo<SelectOption[]>(
    () => categories.map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name}`.trim() })),
    [categories],
  );

  const accountOptions = useMemo<SelectOption[]>(
    () => accounts.map((a) => ({ value: a.id, label: a.name })),
    [accounts],
  );

  const typeOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'EXPENSE', label: 'Expense' },
      { value: 'REFUND', label: 'Refund' },
      { value: 'TRANSFER', label: 'Transfer' },
      { value: 'INCOME', label: 'Income' },
      { value: 'TRADE', label: 'Trade' },
    ],
    [],
  );

  const filteredBudgetOptions = useMemo(
    () =>
      budgetSearch
        ? budgetOptions.filter((o) => o.label.toLowerCase().includes(budgetSearch.toLowerCase()))
        : budgetOptions,
    [budgetSearch, budgetOptions],
  );

  const filteredAccountOptions = useMemo(
    () =>
      accountSearch
        ? accountOptions.filter((o) => o.label.toLowerCase().includes(accountSearch.toLowerCase()))
        : accountOptions,
    [accountSearch, accountOptions],
  );

  // Memoized so its identity is stable across renders — it is a dependency of
  // the sub-bar effect below, which would otherwise re-run on every render.
  const searchField = useMemo(
    () => (
      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        aria-label="Search transactions"
        style={{ maxWidth: '75rem', width: '100%', minWidth: '10rem' }}
        actions={
          <TransactionFilterMenu
            filterTypes={filterTypes}
            setFilterTypes={setFilterTypes}
            filterCategoryIds={filterCategoryIds}
            setFilterCategoryIds={setFilterCategoryIds}
            filterAccountIds={filterAccountIds}
            setFilterAccountIds={setFilterAccountIds}
            filterLinkedToRecurring={filterLinkedToRecurring}
            setFilterLinkedToRecurring={setFilterLinkedToRecurring}
            filterDatePreset={filterDatePreset}
            setFilterDatePreset={setFilterDatePreset}
            sortOrder={sortOrder}
            setSortOrder={setSortOrder}
            budgetSearch={budgetSearch}
            setBudgetSearch={setBudgetSearch}
            accountSearch={accountSearch}
            setAccountSearch={setAccountSearch}
            typeOptions={typeOptions}
            filteredBudgetOptions={filteredBudgetOptions}
            filteredAccountOptions={filteredAccountOptions}
            datePresets={datePresets}
            showAnticipations={showAnticipations}
            setShowAnticipations={setShowAnticipations}
            showSnoozed={showSnoozed}
            setShowSnoozed={setShowSnoozed}
          />
        }
      />
    ),
    [
      searchQuery,
      filterTypes,
      filterCategoryIds,
      filterAccountIds,
      filterLinkedToRecurring,
      filterDatePreset,
      sortOrder,
      budgetSearch,
      accountSearch,
      typeOptions,
      filteredBudgetOptions,
      filteredAccountOptions,
      datePresets,
      showAnticipations,
      setShowAnticipations,
      showSnoozed,
      setShowSnoozed,
    ],
  );

  // At narrow widths, the search + summary move into the (non-scrolling) header
  // sub-bar so they stay pinned, span edge-to-edge, and sit above <main>'s
  // scrollbar. On wider widths only the summary bar renders here.
  useEffect(() => {
    if (narrow) {
      setPageSubBar(
        <>
          <div className={searchSummary ? `${ss.searchRow} ${ss.searchRowDivider}` : ss.searchRow}>
            {searchField}
          </div>
          {searchSummary && <div className={ss.grid}>{renderSummaryStats(searchSummary)}</div>}
        </>,
      );
    } else if (searchSummary) {
      setPageSubBar(<div className={ss.bar}>{renderSummaryStats(searchSummary)}</div>);
    } else {
      setPageSubBar(null);
    }
    return () => setPageSubBar(null);
  }, [narrow, searchSummary, searchField, setPageSubBar]);

  return (
    <div style={narrow ? { marginTop: vars.space['2'] } : undefined}>
      <PageHeader
        title={
          <>
            Transactions <BadgeCount>{formatCount(totalCount)}</BadgeCount>
          </>
        }
        search={narrow ? undefined : searchField}
        action={
          <button
            type="button"
            onClick={() => form.openCreate()}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            <Plus size={15} /> Add Transaction
          </button>
        }
      />

      {purchase && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: vars.space['3'],
            marginBottom: vars.space['4'],
          }}
        >
          <Badge variant="info">Showing 1 purchase</Badge>
          <button
            type="button"
            onClick={() => navigate({ to: '/transactions', search: {} })}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnSecondary}`}
          >
            Clear
          </button>
        </div>
      )}

      {isLoading ? (
        <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary }}>Loading…</p>
      ) : filteredEntries.length === 0 ? (
        <EmptyState
          icon={<Receipt size={32} />}
          message="No transactions yet — add one to get started"
          action={
            <button
              type="button"
              onClick={() => form.openCreate()}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              <Plus size={15} /> Add Transaction
            </button>
          }
        />
      ) : (
        <TransactionList
          filteredEntries={filteredEntries}
          selected={selected}
          onToggleSelect={toggleSelect}
          categories={categories}
          accounts={accounts}
          custodians={custodians}
          wallets={wallets}
          rowActions={rowActions.menuProps}
          onChangeBudget={rowActions.onChangeBudget}
          onMarkAsPaid={(id) => markAsPaid.mutate({ id })}
          onConfirmPaidEarly={setConfirmPaidEarly}
          onSnooze={(id, days) => snoozeMutation.mutate({ id, days })}
          markAsPaidPending={markAsPaid.isPending}
          onLoadMore={handleLoadMore}
          hasNextPage={hasNextPage ?? false}
          isFetchingNextPage={isFetchingNextPage}
        />
      )}

      <BulkActionsToolbar
        selected={selected}
        transactionIds={transactions.map((tx) => tx.id)}
        categories={categories}
        accounts={accounts}
        onSelectAll={selectAll}
        onUnselectAll={unselectAll}
        onBulkComplete={unselectAll}
      />

      {/* Transaction form + split and delete-confirm modals */}
      {rowActions.modals}

      <ConfirmDialog
        open={confirmPaidEarly !== null}
        title="Confirm Early Payment"
        message={
          confirmPaidEarly
            ? `Are you sure you want to mark ${confirmPaidEarly.name} as paid early? This will create a transaction for ${formatCurrency(confirmPaidEarly.amount)}.`
            : ''
        }
        confirmLabel="Yes, mark as paid"
        cancelLabel="Cancel"
        confirmColor="green"
        onConfirm={() => {
          if (confirmPaidEarly) markAsPaid.mutate({ id: confirmPaidEarly.id });
          setConfirmPaidEarly(null);
        }}
        onCancel={() => setConfirmPaidEarly(null)}
      />
    </div>
  );
}
