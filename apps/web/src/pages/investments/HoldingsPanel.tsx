import { useState, useMemo } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import { SegmentedProgress } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { formatCurrency } from '../../lib/utils.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import EmptyState from '../../components/EmptyState.js';
import EditCostBasisModal from './EditCostBasisModal.js';
import StockTransferModal from './StockTransferModal.js';
import BitcoinTransferModal from './BitcoinTransferModal.js';
import * as tl from '../transactions/transaction-list.css.js';
import { HoldingsTable, type Holding } from './HoldingsTable.js';

// Minimal mutation interface — only what the panel actually uses
interface MutateOnly<TError = Error, TVariables = unknown> {
  mutate: (
    data: TVariables,
    options?: { onSuccess?: () => void; onError?: (err: TError) => void },
  ) => void;
  isPending: boolean;
}

interface HoldingsPanelProps {
  holdings: Holding[];
  /** `null` when the holding cannot be valued right now — not the same as zero. */
  liveValue: (h: Holding) => number | null;
  totalValue: number;
  updateInvestment: UseMutationResult<unknown, Error, { id: string; body: unknown }>;
  deleteHolding: MutateOnly<Error, string>;
}

export default function HoldingsPanel({
  holdings,
  liveValue,
  totalValue,
  updateInvestment,
  deleteHolding,
}: HoldingsPanelProps) {
  const [editTarget, setEditTarget] = useState<Holding | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Holding | null>(null);
  const [transferTarget, setTransferTarget] = useState<Holding | null>(null);
  const [btcTransferTarget, setBtcTransferTarget] = useState<Holding | null>(null);

  /* ── Allocation grouping (unchanged) ── */
  const allocationGroups = useMemo(() => {
    const groups = new Map<string, { label: string; value: number; isBitcoin: boolean }>();
    for (const h of holdings) {
      const key = h.type === 'BITCOIN' ? 'BTC' : (h.ticker ?? h.name);
      const existing = groups.get(key);
      // An unvalued holding is left out of the allocation entirely. Counting it
      // as zero would draw it as a 0% slice — which reads as "you hold almost
      // none of this" rather than "its price is unavailable".
      const val = liveValue(h);
      if (val === null) continue;
      if (existing) {
        existing.value += val;
      } else {
        groups.set(key, { label: key, value: val, isBitcoin: h.type === 'BITCOIN' });
      }
    }
    return [...groups.values()].toSorted((a, b) => b.value - a.value);
  }, [holdings, liveValue]);

  const allocationSegments = useMemo(() => {
    if (totalValue <= 0) return [];
    const colorMap: Record<string, string> = {
      BTC: vars.color.bitcoinOrange,
      TCKC: vars.color.dataViz7, // teal — was kiwi (148°) before the Avoir palette
      TCKB: vars.color.dataViz1, // rose — was tomato (18°), near-identical hue
    };
    const defaultColor = vars.color.dataViz9; // slateBlue — was blueberry (248°), near-identical
    return allocationGroups.map((g) => ({
      value: (g.value / totalValue) * 100,
      color: colorMap[g.label] ?? defaultColor,
      striped: g.isBitcoin,
    }));
  }, [allocationGroups, totalValue]);

  const allocationHelper = allocationGroups
    .map((g) => `${g.label} ${Math.round((g.value / totalValue) * 100)}%`)
    .join(' · ');

  /* ── Split holdings by type, sorted by value descending ──
     Unvalued holdings sort last rather than as zero: they are not the smallest
     position, they are the ones we cannot place. ── */
  const byValueDesc = (a: Holding, b: Holding) => {
    const av = liveValue(a);
    const bv = liveValue(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  };
  const btcHoldings = useMemo(
    () => holdings.filter((h) => h.type === 'BITCOIN').toSorted(byValueDesc),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- byValueDesc closes over liveValue
    [holdings, liveValue],
  );
  const stockHoldings = useMemo(
    () => holdings.filter((h) => h.type !== 'BITCOIN').toSorted(byValueDesc),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- byValueDesc closes over liveValue
    [holdings, liveValue],
  );

  /* ── P/L helper — returns the raw value; HoldingsTable formats it, since only
     it knows whether the viewport is narrow enough to abbreviate. ── */
  function plDisplay(h: Holding) {
    // No value means no profit and loss to state. Showing `0 - costBasis` here
    // is how a missing price became a five-figure phantom loss.
    const val = liveValue(h);
    if (val === null) return { color: vars.color.textTertiary, value: null };
    const pl = val - (h.costBasis ?? 0);
    const color = pl >= 0 ? vars.color.success700 : vars.color.danger400;
    return { color, value: pl };
  }

  const hasHoldings = holdings.length > 0;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['6'] }}>
        {/* Allocation bar */}
        {hasHoldings && (
          <>
            <SegmentedProgress
              label="Portfolio Allocation"
              valueLabel={formatCurrency(totalValue)}
              size="lg"
              segments={allocationSegments}
              helper={allocationHelper}
            />
            <hr
              style={{
                border: 'none',
                borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
                marginTop: `calc(-1 * ${vars.space['3']})`,
              }}
            />
          </>
        )}

        {!hasHoldings && (
          <EmptyState
            icon={<TrendingUp size={32} />}
            message="No holdings yet — add an investment to get started"
          />
        )}

        {/* Bitcoin section */}
        {btcHoldings.length > 0 && (
          <div>
            <p className={tl.dateHeading}>Bitcoin</p>
            <HoldingsTable
              items={btcHoldings}
              type="bitcoin"
              plDisplay={plDisplay}
              liveValue={liveValue}
              setEditTarget={setEditTarget}
              setTransferTarget={setTransferTarget}
              setBtcTransferTarget={setBtcTransferTarget}
              setDeleteTarget={setDeleteTarget}
            />
          </div>
        )}

        {/* Stocks section */}
        {stockHoldings.length > 0 && (
          <div>
            <p className={tl.dateHeading}>Stocks</p>
            <HoldingsTable
              items={stockHoldings}
              type="stock"
              plDisplay={plDisplay}
              liveValue={liveValue}
              setEditTarget={setEditTarget}
              setTransferTarget={setTransferTarget}
              setBtcTransferTarget={setBtcTransferTarget}
              setDeleteTarget={setDeleteTarget}
            />
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onConfirm={() => {
          if (deleteTarget) {
            deleteHolding.mutate(deleteTarget.id);
          }
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
        title="Delete holding"
        message="Are you sure you want to delete this holding? This cannot be undone."
        confirmLabel="Delete"
        confirmColor="red"
      />

      <EditCostBasisModal
        holding={editTarget}
        onClose={() => setEditTarget(null)}
        updateInvestment={updateInvestment}
      />

      <StockTransferModal holding={transferTarget} onClose={() => setTransferTarget(null)} />

      <BitcoinTransferModal
        holding={btcTransferTarget}
        onClose={() => setBtcTransferTarget(null)}
      />
    </>
  );
}
