import { useState, useEffect, useMemo } from 'react';
import { Scale } from 'lucide-react';
import { SearchInput, DisplayHeading, buttonStyles } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { useTransactions } from '../../hooks/useTransactions.js';
import LedgerFilterMenu from './LedgerFilterMenu.js';
import LedgerTable from './LedgerTable.js';
import { useTransactionRowActions } from '../transactions/useTransactionRowActions.js';
import * as s from './accounts-page.css.js';

interface BalanceLedgerInlineProps {
  accountId: string;
  accountName: string;
  /** Opens the reconcile flow for this account. Absent when not reconcilable. */
  onReconcile?: () => void;
}

export default function BalanceLedgerInline({
  accountId,
  accountName,
  onReconcile,
}: BalanceLedgerInlineProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState<string | undefined>(undefined);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterDatePreset, setFilterDatePreset] = useState<string | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [filterLinkedToRecurring, setFilterLinkedToRecurring] = useState<boolean | undefined>(
    undefined,
  );

  // Reset filters when account changes
  useEffect(() => {
    setSearchQuery('');
    setDebouncedSearch(undefined);
    setFilterTypes([]);
    setFilterDatePreset(undefined);
    setSortOrder('newest');
    setFilterLinkedToRecurring(undefined);
  }, [accountId]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery || undefined), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const datePresets = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    const fmt = (dt: Date) =>
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(y, m, d + mondayOffset);
    const sunday = new Date(y, m, d + mondayOffset + 6);

    return [
      { key: 'this-week', label: 'This week', dateFrom: fmt(monday), dateTo: fmt(sunday) },
      {
        key: 'this-month',
        label: 'This month',
        dateFrom: fmt(new Date(y, m, 1)),
        dateTo: fmt(new Date(y, m + 1, 0)),
      },
      {
        key: 'last-3-months',
        label: 'Last 3 months',
        dateFrom: fmt(new Date(y, m - 2, 1)),
        dateTo: fmt(now),
      },
      {
        key: 'last-6-months',
        label: 'Last 6 months',
        dateFrom: fmt(new Date(y, m - 5, 1)),
        dateTo: fmt(now),
      },
      {
        key: 'last-year',
        label: 'Last year',
        dateFrom: fmt(new Date(y - 1, m, d)),
        dateTo: fmt(now),
      },
      { key: 'ytd', label: 'Year to date', dateFrom: fmt(new Date(y, 0, 1)), dateTo: fmt(now) },
    ];
  }, []);

  const activeDateRange = useMemo(
    () => (filterDatePreset ? datePresets.find((p) => p.key === filterDatePreset) : undefined),
    [filterDatePreset, datePresets],
  );

  const {
    data: txData,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useTransactions({
    accountId: accountId || undefined,
    search: debouncedSearch,
    sortOrder: sortOrder !== 'newest' ? sortOrder : undefined,
    dateFrom: activeDateRange?.dateFrom,
    dateTo: activeDateRange?.dateTo,
    linkedToRecurring: filterLinkedToRecurring,
    skipGenerate: true,
    enabled: !!accountId,
  });

  const rawTransactions = useMemo(
    () => txData?.pages.flatMap((p) => p.transactions) ?? [],
    [txData],
  );

  // Client-side type filter
  const filteredTransactions = useMemo(() => {
    if (!filterTypes.length) return rawTransactions;
    return rawTransactions.filter((tx) => filterTypes.includes(tx.type));
  }, [rawTransactions, filterTypes]);

  // Group by date
  const groups = useMemo(() => {
    const result: { dateKey: string; txs: typeof filteredTransactions }[] = [];
    for (const tx of filteredTransactions) {
      const raw = tx.date instanceof Date ? tx.date.toISOString() : String(tx.date);
      const dk = raw.split('T')[0]!;
      const last = result[result.length - 1];
      if (last && last.dateKey === dk) {
        last.txs.push(tx);
      } else {
        result.push({ dateKey: dk, txs: [tx] });
      }
    }
    return result;
  }, [filteredTransactions]);

  const rowActions = useTransactionRowActions({ transactions: filteredTransactions });

  const activeFilterCount =
    filterTypes.length +
    (filterDatePreset ? 1 : 0) +
    (filterLinkedToRecurring !== undefined ? 1 : 0);

  return (
    <div className={s.main}>
      {/* Search header */}
      <div
        style={{
          paddingTop: vars.space['4'],
          paddingBottom: vars.space['4'],
          borderBottom: `1px solid ${vars.color.border}`,
          flexShrink: 0,
          overflowY: 'hidden',
          scrollbarGutter: 'stable',
        }}
      >
        <div style={{ maxWidth: '75rem', margin: '0 auto', padding: `0 ${vars.space['5']}` }}>
          <div className={s.ledgerTitleRow}>
            <DisplayHeading size="sm" as="h2">
              {accountName}
            </DisplayHeading>
            {onReconcile && (
              <button
                type="button"
                onClick={onReconcile}
                className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnSecondary}`}
              >
                <Scale size={14} /> Reconcile with statement
              </button>
            )}
          </div>
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            aria-label="Search transactions"
            actions={
              <LedgerFilterMenu
                filterTypes={filterTypes}
                setFilterTypes={setFilterTypes}
                filterDatePreset={filterDatePreset}
                setFilterDatePreset={setFilterDatePreset}
                filterLinkedToRecurring={filterLinkedToRecurring}
                setFilterLinkedToRecurring={setFilterLinkedToRecurring}
                sortOrder={sortOrder}
                setSortOrder={setSortOrder}
                datePresets={datePresets}
                activeFilterCount={activeFilterCount}
              />
            }
          />
        </div>
      </div>

      {/* Scrollable transaction list */}
      <div className={s.content}>
        <div
          className={s.contentInner}
          style={{ padding: `${vars.space['4']} ${vars.space['5']} 0` }}
        >
          <LedgerTable
            groups={groups}
            isLoading={isLoading}
            accountId={accountId}
            rowActions={rowActions.menuProps}
            hasNextPage={hasNextPage ?? false}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={() => fetchNextPage()}
          />
        </div>
      </div>

      {rowActions.modals}
    </div>
  );
}
