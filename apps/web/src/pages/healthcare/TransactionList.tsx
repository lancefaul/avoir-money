import { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { usePolicyTransactions } from '../../hooks/useHealthcare.js';
import { formatCurrency, formatDate } from '../../lib/utils.js';
import { useIsNarrow } from '../../hooks/useIsNarrow.js';
import EmptyState from '../../components/EmptyState.js';
import * as tl from '../transactions/transaction-list.css.js';
import * as iv from '../investments/investments-table.css.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

interface Props {
  policyId: string;
}

interface HealthcareTx {
  id: string;
  date: Date | string;
  name: string;
  category: string;
  categoryIcon: string | null;
  paymentMethod: string | null;
  amount: number;
}

interface DateGroup {
  dateKey: string;
  txs: HealthcareTx[];
}

/**
 * Below this width the payment-method column merges into the name column (the
 * payment method stacks under the name as a subline). This table only has four
 * columns, so unlike the Investments tables there is nothing to shed at 1024 —
 * the first tier starts at 640. Amounts are never abbreviated: healthcare
 * charges are small (copays under $10 would compact to "$8" or even "$0"), and
 * a single short money column has no space pressure to justify losing cents.
 *
 * The <col> and the body <td> switch together — column count and cell count
 * must always agree, or cells shift into the wrong columns (see ERRORS.md).
 */
const MERGE_PAYMENT_BREAKPOINT = below.md;

const CATEGORY_BADGE_BG = (vars.color as Record<string, string>).violet50;

function groupByDate(transactions: HealthcareTx[]): DateGroup[] {
  const map = new Map<string, HealthcareTx[]>();
  for (const tx of transactions) {
    const d = tx.date instanceof Date ? tx.date : new Date(tx.date);
    const key = d.toISOString().slice(0, 10);
    const list = map.get(key) ?? [];
    list.push(tx);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, txs]) => ({ dateKey, txs }));
}

export default function TransactionList({ policyId }: Props) {
  const { data: transactions, isLoading } = usePolicyTransactions(policyId);
  const narrow = useIsNarrow(MERGE_PAYMENT_BREAKPOINT);

  const groups = useMemo(
    () => groupByDate((transactions as HealthcareTx[] | undefined) ?? []),
    [transactions],
  );

  if (isLoading) {
    return (
      <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary }}>
        Loading transactions…
      </p>
    );
  }

  if (!transactions || transactions.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck size={32} />}
        message="All clear — no healthcare expenses yet this year"
      />
    );
  }

  return (
    <div className={tl.listWrap}>
      {groups.map(({ dateKey, txs }) => (
        <div key={dateKey}>
          <p className={tl.dateHeading}>{formatDate(dateKey)}</p>
          <div className={tl.card}>
            <table className={tl.table} aria-label="Healthcare expenses">
              {/*
               * One width tier. The name column carries no width and flexes;
               * every other column has an explicit width (see ERRORS.md).
               *
               *   >=640   name           category payment amount   (4)
               *   <640    name+payment   category         amount   (3)
               */}
              <colgroup>
                {/* name (+payment subline below 640) — the flexible column */}
                <col />
                <col style={{ width: narrow ? '32%' : '25%' }} />
                {/* payment method — merged into name below 640 */}
                {!narrow && <col style={{ width: '20%' }} />}
                <col style={{ width: narrow ? '28%' : '20%' }} />
              </colgroup>
              <tbody>
                {txs.map((tx) => (
                  <tr key={tx.id} className={tl.row} style={{ height: '2.5rem' }}>
                    {/* Col 1: Name. Narrow: payment method stacks under it. */}
                    <td
                      className={tl.cell}
                      style={{ paddingLeft: vars.space['3'], overflow: 'hidden' }}
                    >
                      <span className={tl.nameCell}>{tx.name}</span>
                      {narrow && <span className={iv.subline}>{tx.paymentMethod ?? '–'}</span>}
                    </td>
                    {/* Col 2: Category badge */}
                    <td className={`${tl.cell} ${tl.secondaryCell}`}>
                      <Badge variant="neutral" background={CATEGORY_BADGE_BG} truncate>
                        {tx.categoryIcon && `${tx.categoryIcon} `}
                        {tx.category}
                      </Badge>
                    </td>
                    {/* Col 3: Payment method — merged into col 1 when narrow */}
                    {!narrow && (
                      <td className={`${tl.cell} ${tl.tertiaryCell}`}>{tx.paymentMethod ?? '–'}</td>
                    )}
                    {/* Col 4: Amount — always full precision (see breakpoint note) */}
                    <td
                      className={`${tl.cell} ${tl.amountCell} ${tl.amountNegative}`}
                      style={{ paddingRight: vars.space['3'] }}
                    >
                      {formatCurrency(Math.abs(tx.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
