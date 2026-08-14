import { useState } from 'react';
import { Loader2, ArrowRight, ArrowDown, ArrowUp, ArrowLeftRight, History } from 'lucide-react';
import { Select, Badge, Tooltip, spinnerStyles } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { useInvestmentHistory } from '../hooks/useApi.js';
import { formatDate, formatCurrency, formatCurrencyCompact } from '../lib/utils.js';
import { formatSats, formatSatsCompact } from '../pages/investments/formatSats.js';
import { useIsNarrow } from '../hooks/useIsNarrow.js';
import EmptyState from './EmptyState.js';
import { LoadMoreTrigger } from './LoadMoreTrigger.js';
import * as tl from '../pages/transactions/transaction-list.css.js';
import * as iv from '../pages/investments/investments-table.css.js';
import type { HistoryEntry } from '@budget-tracker/core';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

const TYPE_OPTIONS = [
  { value: 'TRADE', label: 'Trades' },
  { value: 'TRANSFER', label: 'Transfers' },
  { value: 'PAYMENT', label: 'Payments' },
];

const ASSET_OPTIONS = [
  { value: 'BITCOIN', label: 'Bitcoin' },
  { value: 'STOCK', label: 'Stock' },
];

type FilterType = 'TRADE' | 'TRANSFER' | 'PAYMENT' | undefined;
type AssetFilter = 'STOCK' | 'BITCOIN' | undefined;

/**
 * Below this width the custodian column merges into the symbol column: the
 * custodian is stacked under the symbol and its own column is dropped.
 *
 * The <col> and the body <td> are switched together — column count and cell
 * count must always agree, or cells shift into the wrong columns (see ERRORS.md).
 */
const MERGE_CUSTODIAN_BREAKPOINT = below.xl;

/**
 * Below this width sats and dollar values are abbreviated (27.42m sats, $16.43k)
 * with the exact value on hover. Sats abbreviation is Bitcoin-only — stock share
 * counts are short already and stay as-is.
 */
const COMPACT_BREAKPOINT = below.md;

/**
 * Below this width the table condenses to four columns: the Price column is
 * dropped entirely (price is amount ÷ quantity, so it stays inferable) and the
 * P/L column merges into Amount — amount on top, P/L stacked under it as a
 * subline, mirroring the symbol/custodian merge. Each removed column's <col>
 * and <td> switch together (see ERRORS.md).
 */
const CONDENSE_BREAKPOINT = below.sm;

function getDateKey(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().split('T')[0]!;
}

/**
 * Row-leading icon badge (same pattern as the dashboard's StatusBadgeIcon):
 * buy / sell / transfer conveyed by icon + variant color, with the full
 * description as the hover tooltip. The badge carries an aria-label and the
 * tooltip trigger is focusable, so the type is announced and the description
 * reachable without a mouse.
 */
function EntryBadge({ entry }: { entry: HistoryEntry }) {
  if (entry.direction === 'BUY') {
    return (
      <Tooltip content={entry.description} focusable>
        <Badge variant="positive" size="xl" iconOnly aria-label="Buy">
          <ArrowDown size={14} />
        </Badge>
      </Tooltip>
    );
  }
  if (entry.direction === 'SELL') {
    return (
      <Tooltip content={entry.description} focusable>
        <Badge variant="negative" size="xl" iconOnly aria-label="Sell">
          <ArrowUp size={14} />
        </Badge>
      </Tooltip>
    );
  }
  // TRANSFER and PAYMENT — the tooltip description carries the specifics
  return (
    <Tooltip content={entry.description} focusable>
      <Badge
        variant="neutral"
        size="xl"
        iconOnly
        aria-label={entry.entryType === 'PAYMENT' ? 'Payment' : 'Transfer'}
      >
        <ArrowLeftRight size={14} />
      </Badge>
    </Tooltip>
  );
}

/** "Custodian A → Cold Wallet" with the inline arrow icon, reused in cell and subline. */
function TransferRoute({ from, to }: { from: string; to: string }) {
  return (
    <>
      {from}{' '}
      <ArrowRight
        size={12}
        style={{ display: 'inline', verticalAlign: 'middle', marginBottom: vars.space['0.5'] }}
      />{' '}
      {to}
    </>
  );
}

/** Custodian display: account/wallet name; transfers show their route instead. */
function custodianContent(entry: HistoryEntry) {
  if (entry.entryType === 'TRANSFER' && entry.fromName && entry.toName) {
    return <TransferRoute from={entry.fromName} to={entry.toName} />;
  }
  return entry.custodianName ?? '–';
}

/** Plain-text twin of custodianContent, for the truncation tooltip. */
function custodianText(entry: HistoryEntry): string {
  if (entry.entryType === 'TRANSFER' && entry.fromName && entry.toName) {
    return `${entry.fromName} → ${entry.toName}`;
  }
  return entry.custodianName ?? '–';
}

function symbolContent(entry: HistoryEntry): string {
  return entry.ticker ?? (entry.assetType === 'BITCOIN' ? 'BTC' : entry.assetType);
}

function ProfitLossCell({ entry, compact }: { entry: HistoryEntry; compact: boolean }) {
  // Only show P/L for SELL trades with costBasisAllocated
  if (entry.direction !== 'SELL' || entry.costBasisAllocated == null || entry.amount == null) {
    return <span>–</span>;
  }

  const pl = entry.amount - entry.costBasisAllocated;
  const colorClass = pl >= 0 ? tl.amountPositive : tl.amountNegative;
  const plus = pl >= 0 ? '+' : '';
  const exact = `${plus}${formatCurrency(pl)}`;

  if (!compact) return <span className={colorClass}>{exact}</span>;
  return (
    <Tooltip content={exact}>
      <span className={colorClass}>{`${plus}${formatCurrencyCompact(pl)}`}</span>
    </Tooltip>
  );
}

export default function InvestmentHistoryPanel() {
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [assetFilter, setAssetFilter] = useState<string[]>([]);
  const merge = useIsNarrow(MERGE_CUSTODIAN_BREAKPOINT);
  const compact = useIsNarrow(COMPACT_BREAKPOINT);
  const condense = useIsNarrow(CONDENSE_BREAKPOINT);

  // API expects single values, so use first selected or undefined
  const activeType = (typeFilter.length === 1 ? typeFilter[0] : undefined) as FilterType;
  const activeAsset = (assetFilter.length === 1 ? assetFilter[0] : undefined) as AssetFilter;

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError } =
    useInvestmentHistory(activeType, activeAsset);

  const entries = data?.pages.flatMap((p) => p.entries) ?? [];

  // Group entries by date
  const groups: { dateKey: string; items: typeof entries }[] = [];
  for (const entry of entries) {
    const dk = getDateKey(entry.date);
    const last = groups[groups.length - 1];
    if (last && last.dateKey === dk) {
      last.items.push(entry);
    } else {
      groups.push({ dateKey: dk, items: [entry] });
    }
  }

  /** Sats abbreviated below 640px, with the exact value on hover. */
  const renderQuantity = (entry: HistoryEntry) => {
    if (entry.assetType !== 'BITCOIN') return entry.quantity.toLocaleString();
    if (!compact) return formatSats(entry.quantity);
    return (
      <Tooltip content={formatSats(entry.quantity)}>
        <span>{formatSatsCompact(entry.quantity)}</span>
      </Tooltip>
    );
  };

  /** Dollars abbreviated below 640px, with the exact value on hover. */
  const renderMoney = (amount: number) => {
    if (!compact) return formatCurrency(amount);
    return (
      <Tooltip content={formatCurrency(amount)}>
        <span>{formatCurrencyCompact(amount)}</span>
      </Tooltip>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: vars.space['3'] }}>
        <div style={{ minWidth: '10rem' }}>
          <Select
            options={TYPE_OPTIONS}
            value={typeFilter}
            onChange={setTypeFilter}
            multi
            showFooter={false}
            placeholder="All types"
          />
        </div>
        <div style={{ minWidth: '10rem' }}>
          <Select
            options={ASSET_OPTIONS}
            value={assetFilter}
            onChange={setAssetFilter}
            multi
            showFooter={false}
            placeholder="All assets"
          />
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: vars.space['8'] }}>
          <Loader2
            size={20}
            className={spinnerStyles.spinIcon}
            style={{ color: vars.color.textTertiary }}
          />
        </div>
      )}

      {/* Error */}
      {isError && <EmptyState icon={<History size={32} />} message="Could not load history" />}

      {/* Empty */}
      {!isLoading && !isError && entries.length === 0 && (
        <EmptyState icon={<History size={32} />} message="No investment history yet" />
      )}

      {/* Grouped entries */}
      {!isLoading && !isError && groups.length > 0 && (
        <div className={tl.listWrap}>
          {groups.map(({ dateKey, items }) => (
            <div key={dateKey}>
              <p className={tl.dateHeading}>{formatDate(dateKey)}</p>
              <div className={tl.card}>
                <table className={tl.table} aria-label="Investment history">
                  {/*
                   * Three width tiers. The badge column is a fixed rem width; exactly
                   * one column per tier carries no width and flexes (custodian at
                   * desktop, the merged symbol column below 1024 — see ERRORS.md).
                   *
                   *   >=1024   badge symbol custodian price qty amount P/L   (7)
                   *   <1024    badge symbol+custodian  price qty amount P/L  (6)
                   *   <540     badge symbol+custodian        qty amount+P/L  (4)
                   */}
                  <colgroup>
                    {/* badge — 3rem, the same leading column the transactions log uses */}
                    <col style={{ width: '3rem' }} />
                    {/* symbol — flexes below 1024 where the custodian stacks under it */}
                    {merge ? <col /> : <col style={{ width: '5.5rem' }} />}
                    {/* custodian — its own (flexible) column only at >=1024 */}
                    {!merge && <col />}
                    {/* price — dropped below 540px */}
                    {!condense && <col style={{ width: '14%' }} />}
                    {/* quantity: full sats run long ("33,752,838 sats") and need room */}
                    <col style={{ width: condense ? '30%' : '20%' }} />
                    {/* amount — P/L stacks under it below 540px */}
                    <col style={{ width: condense ? '26%' : '14%' }} />
                    {/* P/L — its own column only at >=540 */}
                    {!condense && <col style={{ width: '14%' }} />}
                  </colgroup>
                  <tbody>
                    {items.map((entry) => (
                      <tr key={entry.id} className={tl.row}>
                        {/* Col 1: Type icon badge — description on hover */}
                        {/*
                         * No padding override: the base `cell` is 0.25rem, which is exactly
                         * what `cellCheck` applies to the transactions log's leading cell,
                         * so the badge lands on the same x as a transaction row's checkbox.
                         * The old space[3] inset pushed it 8px further right than every
                         * other leading column in the app.
                         */}
                        <td className={tl.cell}>
                          <EntryBadge entry={entry} />
                        </td>
                        {/* Col 2: Symbol. Narrow: custodian stacks under it. */}
                        <td className={tl.cell} style={{ overflow: 'hidden' }}>
                          <span className={tl.nameCell}>{symbolContent(entry)}</span>
                          {merge && <span className={iv.subline}>{custodianContent(entry)}</span>}
                        </td>
                        {/* Col 3: Custodian — merged into col 2 when narrow */}
                        {!merge && (
                          <td
                            className={`${tl.cell} ${tl.secondaryCell}`}
                            style={{ overflow: 'hidden' }}
                          >
                            <Tooltip content={custodianText(entry)} truncate>
                              <span>{custodianContent(entry)}</span>
                            </Tooltip>
                          </td>
                        )}
                        {/* Col 4: Price — dropped below 540px */}
                        {!condense && (
                          <td
                            className={`${tl.cell} ${tl.secondaryCell}`}
                            style={{ textAlign: 'right' }}
                          >
                            {entry.amount != null && entry.quantity > 0
                              ? renderMoney(entry.amount / entry.quantity)
                              : '–'}
                          </td>
                        )}
                        {/* Col 5: Quantity — sats abbreviated below 640px */}
                        <td
                          className={`${tl.cell} ${tl.secondaryCell}`}
                          style={{ textAlign: 'right' }}
                        >
                          {renderQuantity(entry)}
                        </td>
                        {/* Col 6: Amount. Narrow: P/L stacks under it. */}
                        <td
                          className={`${tl.cell} ${tl.amountCell}`}
                          style={condense ? { paddingRight: vars.space['3'] } : undefined}
                        >
                          {entry.amount != null ? renderMoney(entry.amount) : '–'}
                          {condense && (
                            <span className={iv.subline}>
                              <ProfitLossCell entry={entry} compact={compact} />
                            </span>
                          )}
                        </td>
                        {/* Col 7: P/L — merged into col 6 when condensed */}
                        {!condense && (
                          <td
                            className={`${tl.cell} ${tl.amountCell}`}
                            style={{ paddingRight: vars.space['3'] }}
                          >
                            <ProfitLossCell entry={entry} compact={compact} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <LoadMoreTrigger
            onLoadMore={() => fetchNextPage()}
            hasMore={hasNextPage}
            isFetching={isFetchingNextPage}
          />
        </div>
      )}
    </div>
  );
}
