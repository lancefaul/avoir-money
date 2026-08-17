import { Sensitive } from '@budget-tracker/ui';
import { Pencil, Trash2, MoreVertical, ArrowLeftRight } from 'lucide-react';
import {
  IconButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Tooltip,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { formatCurrency, formatCurrencyCompact } from '../../lib/utils.js';
import { useIsNarrow } from '../../hooks/useIsNarrow.js';
import * as tl from '../transactions/transaction-list.css.js';
import * as iv from './investments-table.css.js';
import { formatSats, formatSatsCompact } from './formatSats.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

/**
 * Below this width the symbol and custodian/wallet columns merge into one: the
 * custodian is stacked under the symbol and its own column is dropped.
 *
 * The <col>, the body <td>, and the tfoot "Total" colSpan are switched together —
 * column count, cell count and colSpan must always agree, or cells shift into the
 * wrong columns (see ERRORS.md).
 */
const NARROW_BREAKPOINT = below.xl;

/**
 * Below this width sats and dollar values are abbreviated (27.42m sats, $16.43k)
 * with the exact value on hover. Sats abbreviation is Bitcoin-only — stock share
 * counts are short already and stay as-is.
 */
const COMPACT_BREAKPOINT = below.md;

/**
 * Below this width the Cost basis column is dropped entirely — its <col>, its body
 * <td>, and its tfoot <td> switch together. P/L is derived from cost basis, so the
 * figure remains inferable from the columns that stay.
 */
const DROP_COST_BASIS_BREAKPOINT = below.sm;

export interface Snapshot {
  id: string;
  date: string;
  quantity: number;
  value: number | null;
}

export interface Holding {
  id: string;
  name: string;
  ticker: string | null;
  type: string;
  quantity: number;
  costBasis: number | null;
  custodianId: string | null;
  walletId: string | null;
  custodianName: string | null;
  walletName: string | null;
  latestSnapshot: Snapshot | null;
}

interface ActionsCellProps {
  h: Holding;
  setEditTarget: (h: Holding) => void;
  setTransferTarget: (h: Holding) => void;
  setBtcTransferTarget: (h: Holding) => void;
  setDeleteTarget: (h: Holding) => void;
}

function ActionsCell({
  h,
  setEditTarget,
  setTransferTarget,
  setBtcTransferTarget,
  setDeleteTarget,
}: ActionsCellProps) {
  const isStock = h.type !== 'BITCOIN';
  const isBitcoin = h.type === 'BITCOIN';
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton icon={<MoreVertical size={14} />} tooltip="Actions" size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon={<Pencil size={13} />} onSelect={() => setEditTarget(h)}>
            Edit
          </DropdownMenuItem>
          {isStock && (
            <DropdownMenuItem
              icon={<ArrowLeftRight size={13} />}
              onSelect={() => setTransferTarget(h)}
            >
              Transfer
            </DropdownMenuItem>
          )}
          {isBitcoin && (
            <DropdownMenuItem
              icon={<ArrowLeftRight size={13} />}
              onSelect={() => setBtcTransferTarget(h)}
            >
              Transfer
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<Trash2 size={13} />}
            variant="danger"
            onSelect={() => setDeleteTarget(h)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface HoldingsTableProps {
  items: Holding[];
  type: 'bitcoin' | 'stock';
  /** `value: null` when there is no value, so no profit or loss to state. */
  plDisplay: (h: Holding) => { color: string; value: number | null };
  /** `null` when the holding cannot be valued right now — not the same as zero. */
  liveValue: (h: Holding) => number | null;
  setEditTarget: (h: Holding) => void;
  setTransferTarget: (h: Holding) => void;
  setBtcTransferTarget: (h: Holding) => void;
  setDeleteTarget: (h: Holding) => void;
}

export function HoldingsTable({
  items,
  type,
  plDisplay,
  liveValue,
  setEditTarget,
  setTransferTarget,
  setBtcTransferTarget,
  setDeleteTarget,
}: HoldingsTableProps) {
  const narrow = useIsNarrow(NARROW_BREAKPOINT);
  const compact = useIsNarrow(COMPACT_BREAKPOINT);
  const hideCostBasis = useIsNarrow(DROP_COST_BASIS_BREAKPOINT);
  const isBtc = type === 'bitcoin';

  /** Sats abbreviated below 640px, with the exact value on hover. */
  const renderQuantity = (btcQuantity: number, fallback: string) => {
    if (!isBtc) return <Sensitive label="share count">{fallback}</Sensitive>;
    if (!compact) return <Sensitive label="quantity">{formatSats(btcQuantity)}</Sensitive>;
    return (
      <Tooltip content={formatSats(btcQuantity)}>
        <span>
          <Sensitive label="amount">{formatSatsCompact(btcQuantity)}</Sensitive>
        </span>
      </Tooltip>
    );
  };

  /** Dollars abbreviated below 640px, with the exact value on hover. */
  const renderMoney = (amount: number) => {
    if (!compact) return <Sensitive label="amount">{formatCurrency(amount)}</Sensitive>;
    return (
      <Tooltip content={formatCurrency(amount)}>
        <span>
          <Sensitive label="amount">{formatCurrencyCompact(amount)}</Sensitive>
        </span>
      </Tooltip>
    );
  };

  /** P/L carries an explicit "+" on gains; losses get their "-" from the formatter. */
  const renderPL = (pl: number) => {
    const plus = pl >= 0 ? '+' : '';
    const exact = `${plus}${formatCurrency(pl)}`;
    if (!compact) return <Sensitive label="profit/loss">{exact}</Sensitive>;
    return (
      <Tooltip content={exact}>
        <span>
          <Sensitive label="profit/loss">{`${plus}${formatCurrencyCompact(pl)}`}</Sensitive>
        </span>
      </Tooltip>
    );
  };

  const totalQuantity = items.reduce((sum, h) => sum + h.quantity, 0);
  // Every money figure in this row covers the SAME holdings — the ones that
  // could be valued. Comparing a partial value against a complete cost basis is
  // exactly how two missing prices rendered as a 99% loss, and a reader
  // subtracting the two columns by eye would repeat it.
  const pricedItems = items.filter((h) => liveValue(h) !== null);
  const totalCostBasis = pricedItems.reduce((sum, h) => sum + (h.costBasis ?? 0), 0);
  const totalVal = pricedItems.reduce((sum, h) => sum + (liveValue(h) ?? 0), 0);
  const totalPL = totalVal - totalCostBasis;
  const unpricedCount = items.length - pricedItems.length;
  const plColor = totalPL >= 0 ? vars.color.success700 : vars.color.danger400;

  return (
    <div className={tl.card}>
      <table className={tl.table} aria-label="Investment holdings">
        {/*
         * Three width tiers. Symbol only holds a short ticker (over a custodian name
         * when narrow), so it stays lean and gives width to quantity — sats run long
         * ("33,752,838 sats") and clip first. Actions only holds the 30px ⋮ button,
         * so it yields width as things tighten.
         *
         *   >=1024   symbol custodian qty costBasis value P/L actions   (7)
         *   <1024    symbol+custodian  qty costBasis value P/L actions  (6)
         *   <540     symbol+custodian  qty           value P/L actions  (5)
         */}
        <colgroup>
          {/* symbol (+custodian below 1024) */}
          <col style={{ width: hideCostBasis ? '22%' : narrow ? '17%' : '12%' }} />
          {/* custodian — its own column only at >=1024 */}
          {!narrow && <col style={{ width: '13%' }} />}
          {/* quantity: full sats at >=1024 run long, so it needs room there too */}
          <col style={{ width: hideCostBasis ? '30%' : narrow ? '24%' : '20%' }} />
          {!hideCostBasis && <col style={{ width: narrow ? '17%' : '14%' }} />}
          <col style={{ width: hideCostBasis ? '18%' : narrow ? '15%' : '14%' }} />
          <col style={{ width: hideCostBasis ? '18%' : '15%' }} />
          <col style={{ width: hideCostBasis ? '12%' : narrow ? '12%' : '12%' }} />
        </colgroup>
        <tbody>
          {items.map((h) => {
            const { color: plColor, value: plValue } = plDisplay(h);
            return (
              <tr key={h.id} className={tl.row} style={{ cursor: 'default', height: '2.5rem' }}>
                {/* Col 1: Symbol with tooltip for full name. Narrow: custodian stacks under it. */}
                <td className={tl.cell} style={{ paddingLeft: vars.space['3'] }}>
                  <Tooltip content={type === 'bitcoin' ? 'Bitcoin' : h.name}>
                    <span className={tl.nameCell}>
                      <Sensitive label="ticker">
                        <Sensitive label="ticker">
                          {type === 'bitcoin' ? 'BTC' : (h.ticker ?? h.name)}
                        </Sensitive>
                      </Sensitive>
                    </span>
                  </Tooltip>
                  {narrow && (
                    <span className={iv.subline}>
                      <Sensitive label="custodian">
                        <Sensitive label="custodian">
                          {type === 'bitcoin' ? (h.walletName ?? '–') : (h.custodianName ?? '–')}
                        </Sensitive>
                      </Sensitive>
                    </span>
                  )}
                </td>
                {/* Col 2: Wallet / Custodian — merged into col 1 when narrow */}
                {!narrow && (
                  <td className={`${tl.cell} ${tl.secondaryCell}`}>
                    <Sensitive label="custodian">
                      {type === 'bitcoin' ? (h.walletName ?? '–') : (h.custodianName ?? '–')}
                    </Sensitive>
                  </td>
                )}
                {/* Col 3: Quantity — sats abbreviated below 640px */}
                <td className={`${tl.cell} ${tl.secondaryCell}`} style={{ textAlign: 'right' }}>
                  {renderQuantity(h.quantity, h.quantity.toLocaleString())}
                </td>
                {/* Col 4: Cost basis — dropped below 540px */}
                {!hideCostBasis && (
                  <td className={`${tl.cell} ${tl.secondaryCell}`} style={{ textAlign: 'right' }}>
                    {renderMoney(h.costBasis ?? 0)}
                  </td>
                )}
                {/* Col 5: Value */}
                <td className={`${tl.cell} ${tl.amountCell}`}>
                  {liveValue(h) === null ? (
                    <Tooltip content="No price available and nothing recorded previously">
                      <span style={{ color: vars.color.textTertiary }}>—</span>
                    </Tooltip>
                  ) : (
                    renderMoney(liveValue(h) ?? 0)
                  )}
                </td>
                {/* Col 6: P/L */}
                <td className={`${tl.cell} ${tl.amountCell}`} style={{ color: plColor }}>
                  {plValue === null ? '—' : renderPL(plValue)}
                </td>
                {/* Col 7: Actions */}
                <td className={`${tl.cell} ${tl.actionsCell}`}>
                  <ActionsCell
                    h={h}
                    setEditTarget={setEditTarget}
                    setTransferTarget={setTransferTarget}
                    setBtcTransferTarget={setBtcTransferTarget}
                    setDeleteTarget={setDeleteTarget}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr
            style={{
              borderTop: `${vars.border.thin} solid ${vars.color.border}`,
              height: '2.5rem',
            }}
          >
            <td
              className={tl.cell}
              colSpan={narrow ? 1 : 2}
              style={{
                paddingLeft: vars.space['3'],
                fontWeight: vars.font.semibold,
                color: vars.color.textPrimary,
              }}
            >
              Total
              {/*
                A total that silently covers fewer holdings than the rows above
                it is the shape of the original bug. Say so where the number is
                read, not only in a banner at the top of the page.
              */}
              {unpricedCount > 0 && (
                <span
                  className={tl.secondaryCell}
                  style={{ fontWeight: vars.font.regular, marginLeft: vars.space['2'] }}
                >
                  ({unpricedCount} unpriced, not included)
                </span>
              )}
            </td>
            <td
              className={`${tl.cell} ${tl.secondaryCell}`}
              style={{ textAlign: 'right', fontWeight: vars.font.semibold }}
            >
              {renderQuantity(totalQuantity, totalQuantity.toLocaleString())}
            </td>
            {!hideCostBasis && (
              <td
                className={`${tl.cell} ${tl.secondaryCell}`}
                style={{ textAlign: 'right', fontWeight: vars.font.semibold }}
              >
                {renderMoney(totalCostBasis)}
              </td>
            )}
            <td
              className={`${tl.cell} ${tl.amountCell}`}
              style={{ fontWeight: vars.font.semibold }}
            >
              {renderMoney(totalVal)}
            </td>
            <td
              className={`${tl.cell} ${tl.amountCell}`}
              style={{ fontWeight: vars.font.semibold, color: plColor }}
            >
              {renderPL(totalPL)}
            </td>
            <td className={tl.cell} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
