import { Fragment, useMemo } from 'react';
import { Scissors, ArrowRight, Wallet, Repeat } from 'lucide-react';
import { InfoLink, Checkbox, Badge, Tooltip, Select, type SelectOption } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { formatCurrency, formatDate, localToday } from '../../lib/utils.js';
import { LoadMoreTrigger } from '../../components/LoadMoreTrigger.js';
import { collapsePurchaseGroups } from './collapsePurchaseGroups.js';
import AnticipationRow from './AnticipationRow.js';
import TransactionActionsMenu, {
  type TransactionActionsMenuProps,
} from './TransactionActionsMenu.js';
import { AdjustmentBadge } from './TransactionName.js';
import * as tl from './transaction-list.css.js';
import { useIsNarrow } from '../../hooks/useIsNarrow.js';
import type { TransactionLogEntry } from '@budget-tracker/core';
import type { TradeMetadataJson, Category, Account, NamedEntity } from './types.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

/**
 * At/below this width, the payment-method (account) column is removed entirely
 * — both its <col> and every <td> — so the auto-width name column absorbs the
 * freed space. Rendering is conditional (real cell count changes), not a CSS
 * visibility trick, so the fixed-layout column model never desyncs.
 */
const NARROW_BREAKPOINT = below.md;

/**
 * At/below this width, the anticipation row's inline Snooze + Mark-as-Paid
 * buttons collapse into a single overflow (⋯) menu, matching the transaction
 * rows. Snooze becomes a nested submenu.
 */
const COMPACT_ACTIONS_BREAKPOINT = below.xl;

interface TransactionListProps {
  filteredEntries: TransactionLogEntry[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  categories: Category[];
  accounts: Account[];
  custodians: NamedEntity[];
  wallets: NamedEntity[];
  /**
   * Everything the shared row actions menu needs except the per-row `tx`.
   * Supplied by `useTransactionRowActions`, which also owns the split and
   * delete modals — this component only renders the trigger.
   */
  rowActions: Omit<TransactionActionsMenuProps, 'tx'>;
  /** Quick budget-category switch from a row's budget badge (single-category rows). */
  onChangeBudget: (id: string, budgetId: string) => void;
  onMarkAsPaid: (id: string) => void;
  onConfirmPaidEarly: (a: { id: string; name: string; amount: number }) => void;
  onSnooze: (id: string, days: number) => void;
  markAsPaidPending: boolean;
  onLoadMore: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
}

export default function TransactionList({
  filteredEntries,
  selected,
  onToggleSelect,
  categories,
  accounts,
  custodians: _custodians,
  wallets,
  rowActions,
  onChangeBudget,
  onMarkAsPaid,
  onConfirmPaidEarly,
  onSnooze,
  markAsPaidPending,
  onLoadMore,
  hasNextPage,
  isFetchingNextPage,
}: TransactionListProps) {
  const today = localToday();

  const narrow = useIsNarrow(NARROW_BREAKPOINT);
  const compactActions = useIsNarrow(COMPACT_ACTIONS_BREAKPOINT);

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const categoryOptions = useMemo<SelectOption[]>(
    () => categories.map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name}`.trim() })),
    [categories],
  );
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const walletMap = useMemo(() => new Map(wallets.map((w) => [w.id, w])), [wallets]);

  // Collapse each visible purchase group (payment-split, ADR-030) into its Anchor
  // row; the per-account legs fold in behind an account-count badge. In an
  // account-filtered ledger the Anchor is absent, so nothing collapses.
  const { entries: collapsedEntries, groupMetaByAnchorId } = useMemo(
    () => collapsePurchaseGroups(filteredEntries),
    [filteredEntries],
  );

  const categoryInfo = (id: string | null) => {
    if (!id) return null;
    const c = categoryMap.get(id);
    return c ? { icon: c.icon, name: c.name, groupColor: c.groupColor } : null;
  };

  const accountName = (id: string | null) => (id ? (accountMap.get(id)?.name ?? '–') : '–');
  const walletName = (id: string | undefined) => (id ? (walletMap.get(id)?.name ?? '–') : null);

  const getDateKey = (e: TransactionLogEntry) => {
    if (e.kind === 'anticipation') {
      if (e.data.status === 'OVERDUE') return today;
      const od = e.data.occurrenceDate;
      return od instanceof Date ? od.toISOString().split('T')[0]! : String(od).split('T')[0]!;
    }
    if (e.kind === 'scheduled') {
      const dd = e.data.dueDate;
      return dd instanceof Date ? dd.toISOString().split('T')[0]! : String(dd).split('T')[0]!;
    }
    const tx = e.data;
    const d =
      tx.date instanceof Date
        ? tx.date.toISOString().split('T')[0]!
        : String(tx.date).split('T')[0]!;
    return d;
  };

  const groups: { dateKey: string; entries: TransactionLogEntry[] }[] = [];
  for (const entry of collapsedEntries) {
    const dk = getDateKey(entry);
    const last = groups[groups.length - 1];
    if (last && last.dateKey === dk) {
      last.entries.push(entry);
    } else {
      groups.push({ dateKey: dk, entries: [entry] });
    }
  }

  return (
    <div className={tl.listWrap}>
      {groups.map(({ dateKey, entries: groupEntries }) => (
        <div key={dateKey}>
          <p
            className={tl.dateHeading}
            style={{ display: 'flex', alignItems: 'center', gap: vars.space['2'] }}
          >
            {formatDate(dateKey)}{' '}
            <Badge variant="neutral" size="sm">
              {groupEntries.length}
            </Badge>
          </p>
          <div className={tl.card}>
            <table className={tl.table} aria-label="Transactions">
              <colgroup>
                <col style={{ width: '3rem' }} />
                <col style={narrow ? { width: '27%' } : undefined} />
                <col style={{ width: narrow ? '27%' : '22%' }} />
                {!narrow && <col style={{ width: '18%' }} />}
                <col style={{ width: narrow ? '27%' : '15%' }} />
                <col style={{ width: '9%' }} />
              </colgroup>
              <tbody>
                {groupEntries.map((entry) => {
                  if (entry.kind === 'anticipation') {
                    const a = entry.data;
                    return (
                      <AnticipationRow
                        key={a.id}
                        anticipation={a}
                        categoryInfo={categoryInfo}
                        accountDisplay={accountName}
                        narrow={narrow}
                        compactActions={compactActions}
                        onMarkAsPaid={onMarkAsPaid}
                        onConfirmPaidEarly={onConfirmPaidEarly}
                        onSnooze={onSnooze}
                        markAsPaidPending={markAsPaidPending}
                      />
                    );
                  }
                  if (entry.kind === 'scheduled') return null;

                  const tx = entry.data;
                  const isTrade = tx.type === 'TRADE';
                  const tradeMeta = tx.tradeMetadata as TradeMetadataJson | null | undefined;
                  const isBuy = tradeMeta?.direction === 'BUY';
                  const netAmount = Math.abs(Number(tx.netAmount ?? tx.amount));
                  const isZero = netAmount === 0;
                  const amtCls = isZero
                    ? tl.amountNeutral
                    : isTrade
                      ? isBuy
                        ? tl.amountNegative
                        : tl.amountPositive
                      : tx.type === 'INCOME' || tx.type === 'REFUND'
                        ? tl.amountPositive
                        : tx.type === 'EXPENSE'
                          ? tl.amountNegative
                          : tl.amountNeutral;
                  const amtPrefix = isZero
                    ? ''
                    : isTrade
                      ? isBuy
                        ? '-'
                        : '+'
                      : tx.type === 'INCOME' || tx.type === 'REFUND'
                        ? '+'
                        : tx.type === 'EXPENSE'
                          ? '-'
                          : '';
                  const btcWalletId =
                    tradeMeta?.assetType === 'Bitcoin'
                      ? tradeMeta.walletId
                      : (tx.bitcoinMetadata as { walletId?: string } | null)?.walletId;
                  const acctDisplay =
                    tx.type === 'TRANSFER' ? (
                      <>
                        {accountName(tx.accountId)}{' '}
                        <ArrowRight
                          size={12}
                          style={{
                            display: 'inline',
                            verticalAlign: 'middle',
                            marginBottom: vars.space['0.5'],
                          }}
                        />{' '}
                        {accountName(tx.toAccountId)}
                      </>
                    ) : btcWalletId ? (
                      (walletName(btcWalletId) ?? accountName(tx.accountId))
                    ) : (
                      accountName(tx.accountId)
                    );
                  const cat = categoryInfo(tx.budgetId);
                  const groupMeta = groupMetaByAnchorId.get(tx.id);
                  // A purchase group lists all its funding accounts (truncated with a
                  // tooltip) rather than a bare count. `accountText` is the plain-text
                  // form used for the truncation tooltip on every account row.
                  const groupAccountNames = groupMeta
                    ? groupMeta.legAccountIds.map((id) => accountName(id)).join(', ')
                    : null;
                  const accountText = groupAccountNames
                    ? groupAccountNames
                    : tx.type === 'TRANSFER'
                      ? `${accountName(tx.accountId)} → ${accountName(tx.toAccountId)}`
                      : btcWalletId
                        ? (walletName(btcWalletId) ?? accountName(tx.accountId))
                        : accountName(tx.accountId);
                  // A split parent's categorization lives in its children, so a
                  // parent budget of Uncategorized is by design (a merge leaves it
                  // there, remainder $0) — not a "needs categorizing" state. Such a
                  // row reads as "Split", never as the red Uncategorized flag.
                  const isSplit = (tx.childCount ?? 0) > 0;
                  const parentUncategorized = !cat || cat.name === 'Uncategorized';
                  const isUncategorized =
                    !isSplit &&
                    tx.type !== 'TRANSFER' &&
                    tx.type !== 'TRADE' &&
                    parentUncategorized;
                  // Quick-switch the budget category from the badge itself, but only
                  // for a single-category row: not a split (childCount) or purchase
                  // group (budget lives on the children), not a non-budget type, and
                  // not linked to a recurring expense. Changing an expense-linked
                  // transaction's budget cascades to the Expense (transactions.ts),
                  // so it must go through the full edit form's confirmation rather
                  // than a silent one-click switch. Income links don't cascade, so
                  // they keep the quick-switch.
                  const canSwitchBudget =
                    !tx.childCount &&
                    !tx.purchaseGroupId &&
                    !tx.expenseId &&
                    tx.type !== 'TRANSFER' &&
                    tx.type !== 'TRADE';
                  // A fully-allocated split parent (e.g. a reconcile merge) has no
                  // meaningful remainder category to show, so it reads "Split" with a
                  // neutral badge. A split that kept a real remainder category still
                  // shows that category.
                  const splitNoRemainder = isSplit && parentUncategorized;
                  const budgetBadgeBg = splitNoRemainder
                    ? undefined
                    : isUncategorized
                      ? vars.color.danger100
                      : cat?.groupColor
                        ? ((vars.color as Record<string, string>)[cat.groupColor] ?? cat.groupColor)
                        : undefined;
                  const budgetLabel = splitNoRemainder
                    ? 'Split'
                    : isUncategorized
                      ? `${cat?.icon ?? ''} Uncategorized`.trim()
                      : cat
                        ? `${cat.icon} ${cat.name}`
                        : null;
                  return (
                    <Fragment key={tx.id}>
                      <tr
                        className={`${tl.row} ${selected.has(tx.id) ? tl.rowSelected : isUncategorized ? tl.rowUncategorized : ''}`}
                        style={{ height: '2.5rem' }}
                      >
                        <td className={`${tl.cell} ${tl.cellCheck}`}>
                          <Checkbox
                            standalone
                            checked={selected.has(tx.id)}
                            onChange={() => onToggleSelect(tx.id)}
                          />
                        </td>
                        <td className={`${tl.cell} ${tl.nameCell}`}>
                          <span
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: vars.space['1'],
                              overflow: 'hidden',
                              minWidth: 0,
                            }}
                          >
                            <span
                              style={{
                                flex: '0 1 auto',
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {tx.note ? (
                                <InfoLink tooltip={tx.note} truncate>
                                  {tx.name}
                                </InfoLink>
                              ) : (
                                <Tooltip content={tx.name} truncate>
                                  <span>{tx.name}</span>
                                </Tooltip>
                              )}
                            </span>
                            {tx.childCount != null && tx.childCount > 0 && (
                              <span className={tl.splitCount} style={{ flexShrink: 0 }}>
                                <Scissors size={10} />
                                {tx.childCount}
                              </span>
                            )}
                            {(tx.expenseId || tx.incomeId) && (
                              <Tooltip content="Recurring">
                                <span className={tl.recurringBadge} style={{ flexShrink: 0 }}>
                                  <Repeat size={10} />R
                                </span>
                              </Tooltip>
                            )}
                            {groupMeta && (
                              <Tooltip content={`Paid from ${accountText}`}>
                                <span
                                  className={tl.accountCount}
                                  style={{ flexShrink: 0 }}
                                  data-testid="account-count-badge"
                                >
                                  <Wallet size={10} />
                                  {groupMeta.legCount}
                                </span>
                              </Tooltip>
                            )}
                            {tx.isReconciliationAdjustment && <AdjustmentBadge />}
                          </span>
                        </td>
                        <td className={`${tl.cell} ${tl.secondaryCell}`}>
                          {budgetLabel == null ? (
                            <span className={tl.noBudget}>–</span>
                          ) : canSwitchBudget ? (
                            <Select
                              searchable
                              // The trigger is a Badge sized to the budget name,
                              // so the panel would otherwise inherit that width
                              // and squeeze the category list.
                              menuWidth="16rem"
                              options={categoryOptions}
                              value={tx.budgetId ?? ''}
                              onChange={(budgetId) => onChangeBudget(tx.id, budgetId)}
                              searchPlaceholder="Search categories…"
                              aria-label="Change budget category"
                              trigger={
                                <Badge
                                  chevron
                                  variant="neutral"
                                  background={budgetBadgeBg}
                                  truncate
                                >
                                  {budgetLabel}
                                </Badge>
                              }
                            />
                          ) : (
                            <Badge variant="neutral" background={budgetBadgeBg} truncate>
                              {budgetLabel}
                            </Badge>
                          )}
                        </td>
                        {!narrow && (
                          <td className={`${tl.cell} ${tl.tertiaryCell}`}>
                            <Tooltip content={accountText} truncate>
                              <span>{groupMeta ? groupAccountNames : acctDisplay}</span>
                            </Tooltip>
                          </td>
                        )}
                        <td className={`${tl.cell} ${tl.amountCell} ${amtCls}`}>
                          {amtPrefix}
                          {formatCurrency(netAmount)}
                        </td>
                        <td className={`${tl.cell} ${tl.actionsCell}`}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <TransactionActionsMenu tx={tx} {...rowActions} />
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <LoadMoreTrigger
        onLoadMore={onLoadMore}
        hasMore={hasNextPage}
        isFetching={isFetchingNextPage}
      />
    </div>
  );
}
