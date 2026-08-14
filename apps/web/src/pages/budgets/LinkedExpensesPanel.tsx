import { useEffect, useMemo, useRef } from 'react';
import { Unlink } from 'lucide-react';
import type { BudgetExpenseLinkResponse } from '@budget-tracker/core';
import { IconButton, badgeStyles } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { useBudgetLinks } from '../../hooks/useBudgetLinks.js';
import { formatCurrency } from '../../lib/utils.js';
import * as tl from '../transactions/transaction-list.css.js';

// ─── Helpers ───

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

const FREQUENCY_MULTIPLIERS: Record<string, number> = {
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  SEMI_MONTHLY: 2,
  MONTHLY: 1,
  QUARTERLY: 1 / 3,
  BIANNUAL: 1 / 6,
  ANNUAL: 1 / 12,
};

/** Convert a monthly amount to the target frequency. */
function convertMonthlyTo(monthly: number, targetFreq: string): number {
  const factor = FREQUENCY_MULTIPLIERS[targetFreq] ?? 1;
  return Math.round((monthly / factor) * 100) / 100;
}

/** Maps expense frequencies to their budget frequency equivalents. */
const EXPENSE_TO_BUDGET_FREQ: Record<string, string> = {
  WEEKLY: 'WEEKLY',
  BIWEEKLY: 'BIWEEKLY',
  SEMI_MONTHLY: 'SEMI_MONTHLY',
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  BIANNUAL: 'BIANNUAL',
  ANNUAL: 'ANNUAL',
};

// ─── Props ───

interface LinkedExpensesPanelProps {
  categoryBudgetId: string;
  highWaterMark: number;
  stagedUnlinks: Set<string>;
  onUnlink: (linkId: string) => void;
  onBaselineChange: (
    baseline: number,
    suggestedFrequency: string | null,
    nativeBaseline: number | null,
  ) => void;
  /** The budget's current frequency — all amounts displayed in this frequency. */
  budgetFrequency: string;
}

// ─── Component ───

export default function LinkedExpensesPanel({
  categoryBudgetId,
  highWaterMark,
  stagedUnlinks,
  onUnlink,
  onBaselineChange,
  budgetFrequency,
}: LinkedExpensesPanelProps) {
  const onBaselineChangeRef = useRef(onBaselineChange);
  onBaselineChangeRef.current = onBaselineChange;

  const { data: links } = useBudgetLinks(categoryBudgetId);

  const effectiveLinks = useMemo(
    () => (links ?? []).filter((l) => !stagedUnlinks.has(l.id)),
    [links, stagedUnlinks],
  );

  const activeLinks = useMemo(
    () => effectiveLinks.filter((l) => !l.isPaused && !l.isArchived),
    [effectiveLinks],
  );

  const inactiveLinks = useMemo(
    () => effectiveLinks.filter((l) => l.isPaused || l.isArchived),
    [effectiveLinks],
  );

  const derivedBaseline = useMemo(
    () => Math.round(activeLinks.reduce((sum, l) => sum + l.monthlyEquivalent, 0) * 100) / 100,
    [activeLinks],
  );

  const suggestedFrequency = useMemo(() => {
    if (activeLinks.length === 0) return null;
    const frequencies = new Set(activeLinks.map((l) => l.expenseFrequency));
    if (frequencies.size !== 1) return null;
    const expFreq = [...frequencies][0];
    return expFreq ? (EXPENSE_TO_BUDGET_FREQ[expFreq] ?? null) : null;
  }, [activeLinks]);

  const nativeBaseline = useMemo(() => {
    if (!suggestedFrequency || activeLinks.length === 0) return null;
    return Math.round(activeLinks.reduce((sum, l) => sum + l.expenseAmount, 0) * 100) / 100;
  }, [suggestedFrequency, activeLinks]);

  const effectiveAmount = Math.max(derivedBaseline, highWaterMark);

  const hasEffectiveLinks = effectiveLinks.length > 0;
  useEffect(() => {
    if (hasEffectiveLinks) {
      onBaselineChangeRef.current(effectiveAmount, suggestedFrequency, nativeBaseline);
    }
  }, [hasEffectiveLinks, effectiveAmount, suggestedFrequency, nativeBaseline]);

  if (!hasEffectiveLinks) return null;

  return (
    <div>
      <div className={tl.card}>
        <table className={tl.table} aria-label="Linked expenses">
          <colgroup>
            <col style={{ width: '50%' }} />
            <col style={{ width: '35%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <tbody>
            {activeLinks.map((link) => (
              <LinkedExpenseRow
                key={link.id}
                link={link}
                onUnlink={onUnlink}
                budgetFrequency={budgetFrequency}
              />
            ))}
            {inactiveLinks.map((link) => (
              <LinkedExpenseRow
                key={link.id}
                link={link}
                dimmed
                statusLabel={link.isArchived ? 'Archived' : 'Paused'}
                onUnlink={onUnlink}
                budgetFrequency={budgetFrequency}
              />
            ))}
          </tbody>
          <tfoot>
            <tr
              style={{
                borderTop: `${vars.border.thin} solid ${vars.color.border}`,
                height: '2.75rem',
              }}
            >
              <td
                className={`${tl.cell} ${tl.nameCell}`}
                style={{ paddingLeft: vars.space['3'], fontWeight: vars.font.semibold }}
              >
                Committed
              </td>
              <td
                className={`${tl.cell} ${tl.amountCell}`}
                style={{ fontWeight: vars.font.semibold }}
              >
                {formatCurrency(
                  nativeBaseline !== null && suggestedFrequency === budgetFrequency
                    ? nativeBaseline
                    : convertMonthlyTo(derivedBaseline, budgetFrequency),
                )}
                {formatFrequencyShort(budgetFrequency)}
              </td>
              <td className={tl.cell} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Row Sub-Component ───

interface LinkedExpenseRowProps {
  link: BudgetExpenseLinkResponse;
  dimmed?: boolean;
  statusLabel?: string;
  onUnlink: (linkId: string) => void;
  budgetFrequency: string;
}

function LinkedExpenseRow({
  link,
  dimmed,
  statusLabel,
  onUnlink,
  budgetFrequency,
}: LinkedExpenseRowProps) {
  // If the expense's frequency matches the budget's frequency, show native amount.
  // Otherwise convert from monthly equivalent to the budget's frequency.
  const displayAmount =
    link.expenseFrequency === budgetFrequency
      ? link.expenseAmount
      : convertMonthlyTo(link.monthlyEquivalent, budgetFrequency);

  return (
    <tr className={tl.row} style={dimmed ? { opacity: 0.5 } : undefined}>
      <td className={`${tl.cell} ${tl.nameCell}`} style={{ paddingLeft: vars.space['3'] }}>
        {link.expenseName}
        {statusLabel && (
          <span
            className={`${badgeStyles.badge} ${badgeStyles.badgeNeutral}`}
            style={{ marginLeft: vars.space['2'] }}
          >
            {statusLabel}
          </span>
        )}
      </td>
      <td className={`${tl.cell} ${tl.amountCell}`}>
        {formatCurrency(displayAmount)}
        {formatFrequencyShort(budgetFrequency)}
      </td>
      <td className={`${tl.cell} ${tl.actionsCell}`}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <IconButton
            icon={<Unlink size={13} />}
            tooltip={`Unlink ${link.expenseName}`}
            size="sm"
            variant="trueGhostDanger"
            onClick={() => onUnlink(link.id)}
          />
        </div>
      </td>
    </tr>
  );
}
