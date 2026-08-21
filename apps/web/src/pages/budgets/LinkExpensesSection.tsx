import { Sensitive } from '@budget-tracker/ui';
import { useEffect, useMemo, useRef } from 'react';
import { Link2 } from 'lucide-react';
import type { Frequency } from '@budget-tracker/core';
import { IconButton } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { useExpenses } from '../../hooks/useExpenses.js';
import { useBudgetLinks } from '../../hooks/useBudgetLinks.js';
import { formatCurrency } from '../../lib/utils.js';
import * as tl from '../transactions/transaction-list.css.js';

// ─── Helpers ───

const FREQUENCY_MULTIPLIERS: Record<string, number> = {
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  SEMI_MONTHLY: 2,
  MONTHLY: 1,
  QUARTERLY: 1 / 3,
  BIANNUAL: 1 / 6,
  ANNUAL: 1 / 12,
  ONE_TIME: 0,
};

function computeMonthlyEquivalent(amount: number, frequency: Frequency): number {
  const factor = FREQUENCY_MULTIPLIERS[frequency] ?? 0;
  return Math.round(amount * factor * 100) / 100;
}

function formatFrequencyShort(f: string): string {
  const map: Record<string, string> = {
    WEEKLY: '/wk',
    BIWEEKLY: '/2wk',
    SEMI_MONTHLY: '/2mo',
    MONTHLY: '/mo',
    QUARTERLY: '/qtr',
    BIANNUAL: '/6mo',
    ANNUAL: '/yr',
  };
  return map[f] ?? `/${f.toLowerCase()}`;
}

/** Convert a monthly amount to the target frequency. */
function convertMonthlyTo(monthly: number, targetFreq: string): number {
  const factor = FREQUENCY_MULTIPLIERS[targetFreq] ?? 1;
  return Math.round((monthly / factor) * 100) / 100;
}

// ─── Props ───

interface LinkExpensesSectionProps {
  budgetId: string;
  categoryBudgetId: string;
  stagedLinks: Set<string>;
  onToggle: (expenseId: string) => void;
  onStagedBaselineChange: (
    monthly: number,
    nativeAmount: number | null,
    sharedFrequency: string | null,
  ) => void;
  budgetFrequency: string;
}

// ─── Component ───

export default function LinkExpensesSection({
  budgetId,
  categoryBudgetId,
  stagedLinks,
  onToggle,
  onStagedBaselineChange,
  budgetFrequency,
}: LinkExpensesSectionProps) {
  const onStagedBaselineChangeRef = useRef(onStagedBaselineChange);
  onStagedBaselineChangeRef.current = onStagedBaselineChange;

  const { data: allExpenses } = useExpenses({ budgetId });
  const { data: existingLinks } = useBudgetLinks(categoryBudgetId);

  const linkedExpenseIds = useMemo(
    () => new Set((existingLinks ?? []).map((l) => l.expenseId)),
    [existingLinks],
  );

  const eligible = useMemo(
    () =>
      (allExpenses ?? []).filter(
        (e) =>
          !e.archivedAt &&
          e.frequency !== 'ONE_TIME' &&
          !e.isLinkedToBudget &&
          !linkedExpenseIds.has(e.id),
      ),
    [allExpenses, linkedExpenseIds],
  );

  const stagedExpenses = useMemo(
    () => eligible.filter((e) => stagedLinks.has(e.id)),
    [eligible, stagedLinks],
  );

  const stagedMonthly = useMemo(
    () =>
      Math.round(
        stagedExpenses.reduce(
          (sum, e) => sum + computeMonthlyEquivalent(e.amount, e.frequency as Frequency),
          0,
        ) * 100,
      ) / 100,
    [stagedExpenses],
  );

  const stagedSharedFrequency = useMemo(() => {
    if (stagedExpenses.length === 0) return null;
    const freqs = new Set(stagedExpenses.map((e) => e.frequency));
    return freqs.size === 1 ? ([...freqs][0] ?? null) : null;
  }, [stagedExpenses]);

  const stagedNativeAmount = useMemo(() => {
    if (!stagedSharedFrequency) return null;
    return Math.round(stagedExpenses.reduce((sum, e) => sum + e.amount, 0) * 100) / 100;
  }, [stagedSharedFrequency, stagedExpenses]);

  useEffect(() => {
    onStagedBaselineChangeRef.current(stagedMonthly, stagedNativeAmount, stagedSharedFrequency);
  }, [stagedMonthly, stagedNativeAmount, stagedSharedFrequency]);

  if (eligible.length === 0) return null;

  return (
    <div>
      <p
        style={{
          fontSize: vars.font.sm,
          color: vars.color.textSecondary,
          marginBottom: vars.space['2'],
        }}
      >
        Select recurring expenses to commit funding for them from this budget.
      </p>

      <div className={tl.card} style={{ maxHeight: '12rem', overflowY: 'auto' }}>
        <table className={tl.table} aria-label="Available expenses to link">
          <colgroup>
            <col style={{ width: '50%' }} />
            <col style={{ width: '35%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <tbody>
            {eligible.map((e) => {
              const checked = stagedLinks.has(e.id);
              const monthly = computeMonthlyEquivalent(e.amount, e.frequency as Frequency);
              const displayAmount =
                e.frequency === budgetFrequency
                  ? e.amount
                  : convertMonthlyTo(monthly, budgetFrequency);

              return (
                <tr
                  key={e.id}
                  className={tl.row}
                  style={checked ? { background: vars.color.brand50 } : undefined}
                >
                  <td
                    className={`${tl.cell} ${tl.nameCell}`}
                    style={{ paddingLeft: vars.space['3'] }}
                  >
                    {e.name}
                  </td>
                  <td className={`${tl.cell} ${tl.amountCell}`}>
                    <Sensitive label="amount">{formatCurrency(displayAmount)}</Sensitive>
                    {formatFrequencyShort(budgetFrequency)}
                  </td>
                  <td className={`${tl.cell} ${tl.actionsCell}`}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <IconButton
                        icon={<Link2 size={13} />}
                        tooltip={checked ? `Unlink ${e.name}` : `Link ${e.name}`}
                        size="sm"
                        variant={checked ? 'trueGhostDanger' : 'trueGhost'}
                        onClick={() => onToggle(e.id)}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
