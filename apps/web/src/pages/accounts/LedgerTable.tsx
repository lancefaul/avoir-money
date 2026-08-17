import { Sensitive } from '@budget-tracker/ui';
import { Badge } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { formatCurrency, formatDate } from '../../lib/utils.js';
import { useIsNarrow } from '../../hooks/useIsNarrow.js';
import { LoadMoreTrigger } from '../../components/LoadMoreTrigger.js';
import EmptyState from '../../components/EmptyState.js';
import TransactionActionsMenu, {
  type TransactionActionsMenuProps,
} from '../transactions/TransactionActionsMenu.js';
import TransactionName from '../transactions/TransactionName.js';
import * as tl from '../transactions/transaction-list.css.js';
import type { Transaction as CoreTransaction } from '@budget-tracker/core';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

/**
 * Below this width the Balance Before column is dropped — its <col> and its
 * body <td> switch together (column count and cell count must always agree,
 * see ERRORS.md). The flow stays readable from Amount and Balance After.
 */
const DROP_BALANCE_BEFORE_BREAKPOINT = below.md;

/** Below this width Balance After goes too, leaving Amount to carry the row. */
const DROP_BALANCE_AFTER_BREAKPOINT = below.sm;

interface DateGroup {
  dateKey: string;
  txs: CoreTransaction[];
}

interface LedgerTableProps {
  groups: DateGroup[];
  isLoading: boolean;
  accountId: string;
  /**
   * Everything the shared row actions menu needs except the per-row `tx`. When
   * omitted, the actions column is not rendered (its <col> and <td> switch
   * together, keeping the column count consistent).
   */
  rowActions?: Omit<TransactionActionsMenuProps, 'tx'>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

export default function LedgerTable({
  groups,
  isLoading,
  accountId,
  rowActions,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: LedgerTableProps) {
  const hideBalanceBefore = useIsNarrow(DROP_BALANCE_BEFORE_BREAKPOINT);
  const hideBalanceAfter = useIsNarrow(DROP_BALANCE_AFTER_BREAKPOINT);

  // Column weights, normalized over whichever columns are visible so the table
  // always fills its width whatever the breakpoint drops (same pattern as
  // AmortizationPanel).
  const cols = [
    { key: 'name', w: 40 },
    ...(hideBalanceBefore ? [] : [{ key: 'balanceBefore', w: 14 }]),
    { key: 'amount', w: 15 },
    ...(hideBalanceAfter ? [] : [{ key: 'balanceAfter', w: 15 }]),
    ...(rowActions ? [{ key: 'actions', w: 8 }] : []),
  ];
  const colTotal = cols.reduce((sum, c) => sum + c.w, 0);

  if (isLoading) {
    return (
      <p
        style={{
          fontSize: vars.font.sm,
          color: vars.color.textTertiary,
          paddingTop: vars.space['4'],
        }}
      >
        Loading…
      </p>
    );
  }

  if (groups.length === 0) {
    return <EmptyState message="No transactions for this account." />;
  }

  return (
    <div className={tl.listWrap}>
      {groups.map(({ dateKey, txs }) => (
        <div key={dateKey}>
          <p
            className={tl.dateHeading}
            style={{ display: 'flex', alignItems: 'center', gap: vars.space['2'] }}
          >
            {formatDate(dateKey)}{' '}
            <Badge variant="neutral" size="sm">
              {txs.length}
            </Badge>
          </p>
          <div className={tl.card}>
            <table className={tl.table} aria-label="Account ledger transactions">
              <colgroup>
                {cols.map((c) => (
                  <col key={c.key} style={{ width: `${((c.w / colTotal) * 100).toFixed(2)}%` }} />
                ))}
              </colgroup>
              <tbody>
                {txs.map((tx) => {
                  const isIncome = tx.type === 'INCOME' || tx.type === 'REFUND';
                  const isExpense = tx.type === 'EXPENSE';
                  const displayAmount = Math.abs(tx.netAmount ?? tx.amount);
                  const isZero = displayAmount === 0;
                  const amtCls = isZero
                    ? tl.amountNeutral
                    : isIncome
                      ? tl.amountPositive
                      : isExpense
                        ? tl.amountNegative
                        : tl.amountNeutral;
                  const amtPrefix = isZero ? '' : isIncome ? '+' : isExpense ? '-' : '';
                  const balanceBefore =
                    tx.type === 'TRANSFER' && tx.toAccountId === accountId
                      ? tx.toBalanceBefore
                      : tx.balanceBefore;
                  const balanceAfter =
                    tx.type === 'TRANSFER' && tx.toAccountId === accountId
                      ? tx.toBalanceAfter
                      : tx.balanceAfter;

                  return (
                    <tr key={tx.id} className={tl.row}>
                      <td
                        className={`${tl.cell} ${tl.nameCell}`}
                        style={{ paddingLeft: vars.space['3'] }}
                      >
                        <TransactionName
                          name={tx.name}
                          isAdjustment={tx.isReconciliationAdjustment}
                        />
                      </td>
                      {!hideBalanceBefore && (
                        <td
                          className={`${tl.cell} ${tl.amountCell}`}
                          style={{ color: vars.color.textTertiary }}
                        >
                          <Sensitive label="running balance">
                            {balanceBefore != null ? formatCurrency(balanceBefore) : '–'}
                          </Sensitive>
                        </td>
                      )}
                      <td className={`${tl.cell} ${tl.amountCell} ${amtCls}`}>
                        {amtPrefix}
                        <Sensitive label="amount">{formatCurrency(displayAmount)}</Sensitive>
                      </td>
                      {!hideBalanceAfter && (
                        <td
                          className={`${tl.cell} ${tl.amountCell}`}
                          style={{
                            color: vars.color.textSecondary,
                            ...(rowActions ? {} : { paddingRight: vars.space['3'] }),
                          }}
                        >
                          <Sensitive label="running balance">
                            {balanceAfter != null ? formatCurrency(balanceAfter) : '–'}
                          </Sensitive>
                        </td>
                      )}
                      {rowActions && (
                        <td className={`${tl.cell} ${tl.actionsCell}`}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <TransactionActionsMenu tx={tx} {...rowActions} />
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
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
  );
}
