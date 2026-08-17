import { Sensitive } from '@budget-tracker/ui';
import { CreditCard, Landmark } from 'lucide-react';
import { Badge, Tooltip } from '@budget-tracker/ui';
import { formatCurrency, cn } from '../../lib/utils.js';
import { computeCashRemaining } from './cashSpending.js';
import * as s from './payPeriodCard.css.js';
import {
  type CashSpendingCardProps,
  type CreditSpendingCardProps,
  NARROW_BREAKPOINT,
  useIsNarrow,
  StatusBadgeIcon,
  computeDueDateLabel,
  formatDateLabel,
  MarkAsPaidButton,
  TableColgroup,
} from './payPeriodCardShared.js';

/**
 * The amount cells of a summary row, laid out on the table's credit/debit
 * columns.
 *
 * The itemized rows above split their amounts across two columns — income lands
 * in the credit column and leaves the debit one empty, expenses do the reverse —
 * so a summary row has to occupy the same column its lines do, or the total
 * prints one column off from the figures it sums.
 *
 * A positive `amount` is a credit, a negative one a debit; pass `side` for a row
 * that belongs to one column by nature regardless of value (an expense total is
 * a debit even at zero). Below `NARROW_BREAKPOINT` the two columns collapse into
 * one, so a single cell is rendered.
 */
function SummaryAmountCells({
  narrow,
  amount,
  side,
}: {
  narrow: boolean;
  amount: number;
  side?: 'credit' | 'debit';
}) {
  const isCredit = side ? side === 'credit' : amount >= 0;
  const cell = (
    <td className={cn(s.sectionTotalAmount, isCredit ? s.totalPositive : s.totalNegative)}>
      {isCredit ? '+' : '-'}
      <Sensitive label="amount">{formatCurrency(Math.abs(amount))}</Sensitive>
    </td>
  );

  if (narrow) return cell;

  return isCredit ? (
    <>
      {cell}
      <td className={s.cell} />
    </>
  ) : (
    <>
      <td className={s.cell} />
      {cell}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Card 1: Cash Spending
   ══════════════════════════════════════════════════════════════════════════════ */

export function CashSpendingCard({
  startDate,
  endDate,
  incomeItems,
  cashExpenses,
  previousPeriodCreditExpenses,
  previousPeriodCheckingBalance,
  previousPeriodSavingsBalance,
  adHocCashSpending,
  markAsPaid,
  onPaidEarly,
}: CashSpendingCardProps) {
  const narrow = useIsNarrow(NARROW_BREAKPOINT);
  const colCount = narrow ? 5 : 6;

  const { totalIncome, totalCashExpenses, cashRemaining, cashAfterExpenses } = computeCashRemaining(
    {
      previousPeriodCheckingBalance,
      previousPeriodSavingsBalance,
      incomeItems,
      cashExpenses,
      previousPeriodCreditExpenses,
      adHocCashSpending,
    },
  );
  const hasAdHoc = adHocCashSpending !== 0;

  const periodStartLabel = formatDateLabel(startDate);

  return (
    <div className={s.card}>
      <div className={s.cardHeader}>
        <div className={s.cardTitle}>Cash Spending</div>
      </div>

      <table className={s.table} aria-label="Cash spending breakdown">
        <TableColgroup narrow={narrow} />
        <tbody>
          {/* ── INCOME ── */}
          <tr>
            <td colSpan={colCount} className={cn(s.sectionLabel, s.cellFirst)}>
              Income
            </td>
          </tr>
          {/* Previous period checking balance */}
          <tr className={s.row}>
            <td className={cn(s.cell, s.cellFirst)}>
              <Tooltip content="Prior Period Balance">
                <Badge variant="neutral" size="xl" iconOnly>
                  <Landmark size={14} />
                </Badge>
              </Tooltip>
            </td>
            <td className={cn(s.cell, s.nameCell)} colSpan={narrow ? 2 : undefined}>
              <span className={s.nameCellPrimary}>Previous Period Checking Balance</span>
              <span className={s.nameCellDate}>{periodStartLabel}</span>
            </td>
            {!narrow && <td className={cn(s.cell, s.secondaryCell)}>{periodStartLabel}</td>}
            <td className={cn(s.cell, s.amountCell, s.textPaid)}>
              +<Sensitive label="amount">{formatCurrency(previousPeriodCheckingBalance)}</Sensitive>
            </td>
            {!narrow && <td className={s.cell} />}
            <td className={cn(s.cell, s.cellLast)} />
          </tr>
          {/* Previous period savings balance */}
          <tr className={s.row}>
            <td className={cn(s.cell, s.cellFirst)}>
              <Tooltip content="Prior Period Balance">
                <Badge variant="neutral" size="xl" iconOnly>
                  <Landmark size={14} />
                </Badge>
              </Tooltip>
            </td>
            <td className={cn(s.cell, s.nameCell)} colSpan={narrow ? 2 : undefined}>
              <span className={s.nameCellPrimary}>Previous Period Savings Balance</span>
              <span className={s.nameCellDate}>{periodStartLabel}</span>
            </td>
            {!narrow && <td className={cn(s.cell, s.secondaryCell)}>{periodStartLabel}</td>}
            <td className={cn(s.cell, s.amountCell, s.textPaid)}>
              +<Sensitive label="amount">{formatCurrency(previousPeriodSavingsBalance)}</Sensitive>
            </td>
            {!narrow && <td className={s.cell} />}
            <td className={cn(s.cell, s.cellLast)} />
          </tr>
          {incomeItems.length === 0 ? (
            <tr className={s.row}>
              <td colSpan={colCount} className={cn(s.emptyText, s.cellFirst)}>
                No income this period.
              </td>
            </tr>
          ) : (
            incomeItems.map((inc, idx) => {
              const isPaid = inc.anticipationStatus === 'PAID' || inc.actualAmount != null;
              const status = inc.anticipationStatus;
              const displayStatus = isPaid ? ('PAID' as const) : status;
              const isLast = idx === incomeItems.length - 1;
              return (
                <tr key={inc.id} className={cn(s.row, isLast && s.sectionLastRow)}>
                  <td className={cn(s.cell, s.cellFirst)}>
                    <StatusBadgeIcon status={displayStatus} />
                  </td>
                  <td className={cn(s.cell, s.nameCell)} colSpan={narrow ? 2 : undefined}>
                    <Tooltip content={inc.name} truncate>
                      <span className={s.nameCellPrimary}>{inc.name}</span>
                    </Tooltip>
                    <span className={s.nameCellDate}>{periodStartLabel}</span>
                  </td>
                  {!narrow && <td className={cn(s.cell, s.secondaryCell)}>{periodStartLabel}</td>}
                  <td className={cn(s.cell, s.amountCell, s.textPaid)}>
                    +
                    <Sensitive label="amount">
                      <Sensitive label="amount">
                        {formatCurrency(inc.actualAmount ?? inc.amount)}
                      </Sensitive>
                    </Sensitive>
                  </td>
                  {!narrow && <td className={s.cell} />}
                  <td className={cn(s.cell, s.actionsCell, s.cellLast)}>
                    {!isPaid && status !== 'SKIPPED' && (
                      <MarkAsPaidButton
                        anticipationId={inc.anticipationId}
                        anticipationStatus={status}
                        name={inc.name}
                        amount={inc.amount}
                        markAsPaid={markAsPaid}
                        onPaidEarly={onPaidEarly}
                      />
                    )}
                  </td>
                </tr>
              );
            })
          )}
          {/* Income total — credit column */}
          <tr className={s.sectionTotalRow}>
            <td className={cn(s.cell, s.cellFirst)} />
            <td colSpan={2} className={cn(s.cell, s.sectionTotalLabel)}>
              Total Income
            </td>
            <td className={cn(s.sectionTotalAmount, s.totalPositive)}>
              +<Sensitive label="amount">{formatCurrency(totalIncome)}</Sensitive>
            </td>
            {!narrow && <td className={s.cell} />}
            <td className={cn(s.cell, s.cellLast)} />
          </tr>

          {/* ── EXPENSES ── */}
          <tr>
            <td
              colSpan={colCount}
              className={cn(s.sectionLabel, s.sectionLabelSpaced, s.cellFirst)}
            >
              Expenses
            </td>
          </tr>
          {/* Prior period credit card expenses */}
          <tr className={s.row}>
            <td className={cn(s.cell, s.cellFirst)}>
              <Tooltip content="Prior Period">
                <Badge variant="neutral" size="xl" iconOnly>
                  <CreditCard size={14} />
                </Badge>
              </Tooltip>
            </td>
            <td className={cn(s.cell, s.nameCell)} colSpan={narrow ? 2 : undefined}>
              <span className={s.nameCellPrimary}>Previous Period Credit Expenses</span>
              <span className={s.nameCellDate}>{periodStartLabel}</span>
            </td>
            {!narrow && <td className={cn(s.cell, s.secondaryCell)}>{periodStartLabel}</td>}
            {!narrow && <td className={s.cell} />}
            <td className={cn(s.cell, s.amountCell, s.textOverdue)}>
              -<Sensitive label="amount">{formatCurrency(previousPeriodCreditExpenses)}</Sensitive>
            </td>
            <td className={cn(s.cell, s.cellLast)} />
          </tr>
          {cashExpenses.map((exp, idx) => {
            const status = exp.anticipationStatus;
            const dateLabel = computeDueDateLabel(exp.dueDay, startDate, endDate);
            const isLast = idx === cashExpenses.length - 1;
            return (
              <tr key={`${exp.id}-${idx}`} className={cn(s.row, isLast && s.sectionLastRow)}>
                <td className={cn(s.cell, s.cellFirst)}>
                  <StatusBadgeIcon status={status} />
                </td>
                <td className={cn(s.cell, s.nameCell)} colSpan={narrow ? 2 : undefined}>
                  <Tooltip content={exp.name} truncate>
                    <span className={s.nameCellPrimary}>{exp.name}</span>
                  </Tooltip>
                  <span className={s.nameCellDate}>{dateLabel ?? '–'}</span>
                </td>
                {!narrow && <td className={cn(s.cell, s.secondaryCell)}>{dateLabel ?? '–'}</td>}
                {!narrow && <td className={s.cell} />}
                {/* Live model: a PAID expense has already drawn down Cash Remaining;
                    an UNPAID one is shown but not deducted until paid. The amount is
                    always shown (status icon distinguishes paid vs upcoming). */}
                <td className={cn(s.cell, s.amountCell, s.textOverdue)}>
                  -
                  <Sensitive label="amount">
                    <Sensitive label="amount">
                      {formatCurrency(exp.actualAmount ?? exp.amount)}
                    </Sensitive>
                  </Sensitive>
                </td>
                <td className={cn(s.cell, s.actionsCell, s.cellLast)}>
                  <MarkAsPaidButton
                    anticipationId={exp.anticipationId}
                    anticipationStatus={status}
                    name={exp.name}
                    amount={exp.amount}
                    markAsPaid={markAsPaid}
                    onPaidEarly={onPaidEarly}
                  />
                </td>
              </tr>
            );
          })}
          {/* ── CURRENT CASH BALANCE (live) ── */}
          <tr className={s.footerRow}>
            <td className={cn(s.cell, s.cellFirst)} />
            <td colSpan={2} className={cn(s.cell, s.sectionTotalLabel)}>
              Current Cash Balance
            </td>
            <SummaryAmountCells narrow={narrow} amount={cashRemaining} />
            <td className={cn(s.cell, s.cellLast)} />
          </tr>
          {/* Total of the itemized cash expense lines above (paid + upcoming). */}
          <tr className={s.sectionTotalRow}>
            <td className={cn(s.cell, s.cellFirst)} />
            <td colSpan={2} className={cn(s.cell, s.sectionTotalLabel)}>
              Total Cash Expenses
            </td>
            <SummaryAmountCells narrow={narrow} amount={-totalCashExpenses} side="debit" />
            <td className={cn(s.cell, s.cellLast)} />
          </tr>
          {/* Ad-hoc cash purchases not tied to a bill — already reflected in
              Current Cash Balance above, shown here as its own line. A negative
              adHocCashSpending is a net refund, so it lands in the credit column. */}
          {hasAdHoc && (
            <tr className={s.sectionTotalRow}>
              <td className={cn(s.cell, s.cellFirst)} />
              <td colSpan={2} className={cn(s.cell, s.sectionTotalLabel)}>
                Discretionary Cash Spending
              </td>
              <SummaryAmountCells narrow={narrow} amount={-adHocCashSpending} />
              <td className={cn(s.cell, s.cellLast)} />
            </tr>
          )}
          {/* ── CASH AFTER EXPENSES (projected once upcoming bills are paid) ── */}
          <tr className={s.footerRow}>
            <td className={cn(s.cell, s.cellFirst)} />
            <td colSpan={2} className={cn(s.cell, s.sectionTotalLabel)}>
              Cash After Expenses
            </td>
            <SummaryAmountCells narrow={narrow} amount={cashAfterExpenses} />
            <td className={cn(s.cell, s.cellLast)} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Card 2: Recurring Credit Spending
   ══════════════════════════════════════════════════════════════════════════════ */

export function CreditSpendingCard({
  startDate,
  endDate,
  creditExpenses,
  markAsPaid,
  onPaidEarly,
}: CreditSpendingCardProps) {
  const narrow = useIsNarrow(NARROW_BREAKPOINT);
  const colCount = narrow ? 5 : 6;

  const totalCredit = creditExpenses.reduce(
    (sum, exp) => sum + (exp.actualAmount ?? exp.amount),
    0,
  );

  return (
    <div className={s.card}>
      <div className={s.cardHeader}>
        <div className={s.cardTitle}>Recurring Credit Spending</div>
      </div>

      <table className={s.table} aria-label="Recurring credit spending breakdown">
        <TableColgroup narrow={narrow} />
        <tbody>
          <tr>
            <td colSpan={colCount} className={cn(s.sectionLabel, s.cellFirst)}>
              Expenses
            </td>
          </tr>
          {creditExpenses.length === 0 ? (
            <tr className={s.row}>
              <td colSpan={colCount} className={cn(s.emptyText, s.cellFirst)}>
                No credit expenses this period.
              </td>
            </tr>
          ) : (
            creditExpenses.map((exp, idx) => {
              const status = exp.anticipationStatus;
              const dateLabel = computeDueDateLabel(exp.dueDay, startDate, endDate);
              const isLast = idx === creditExpenses.length - 1;
              return (
                <tr key={`${exp.id}-${idx}`} className={cn(s.row, isLast && s.sectionLastRow)}>
                  <td className={cn(s.cell, s.cellFirst)}>
                    <StatusBadgeIcon status={status} />
                  </td>
                  <td className={cn(s.cell, s.nameCell)} colSpan={narrow ? 2 : undefined}>
                    <Tooltip content={exp.name} truncate>
                      <span className={s.nameCellPrimary}>{exp.name}</span>
                    </Tooltip>
                    <span className={s.nameCellDate}>{dateLabel ?? '–'}</span>
                  </td>
                  {!narrow && <td className={cn(s.cell, s.secondaryCell)}>{dateLabel ?? '–'}</td>}
                  {!narrow && <td className={s.cell} />}
                  <td className={cn(s.cell, s.amountCell, s.textOverdue)}>
                    -
                    <Sensitive label="amount">
                      <Sensitive label="amount">
                        {formatCurrency(exp.actualAmount ?? exp.amount)}
                      </Sensitive>
                    </Sensitive>
                  </td>
                  <td className={cn(s.cell, s.actionsCell, s.cellLast)}>
                    <MarkAsPaidButton
                      anticipationId={exp.anticipationId}
                      anticipationStatus={status}
                      name={exp.name}
                      amount={exp.amount}
                      markAsPaid={markAsPaid}
                      onPaidEarly={onPaidEarly}
                    />
                  </td>
                </tr>
              );
            })
          )}

          {/* Total */}
          <tr className={s.footerRow}>
            <td className={cn(s.cell, s.cellFirst)} />
            <td colSpan={2} className={cn(s.cell, s.sectionTotalLabel)}>
              Total
            </td>
            {!narrow && <td className={s.cell} />}
            <td className={cn(s.sectionTotalAmount, s.totalNegative)}>
              -<Sensitive label="amount">{formatCurrency(totalCredit)}</Sensitive>
            </td>
            <td className={cn(s.cell, s.cellLast)} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
