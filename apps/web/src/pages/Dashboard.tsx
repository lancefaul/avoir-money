import type { CurrentPeriodSummary } from '@budget-tracker/core';
import { useCurrentPeriod, useYTD, useIncomeTrend } from '../hooks/useApi.js';
import { useSpendPrediction } from '../hooks/useDashboard.js';
import { useMarkAsPaid } from '../hooks/useScheduledTransactions.js';
import { useHealthcareSummary, usePolicies } from '../hooks/useHealthcare.js';
import StatCard from '../components/StatCard.js';
import PageHeader from '../components/PageHeader.js';
import EmptyState from '../components/EmptyState.js';
import { formatCurrency } from '../lib/utils.js';
import { format } from 'date-fns';
import { TrendingDown, BarChart3 } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog.js';
import { lazy, Suspense, useState } from 'react';

const SpendPredictionChart = lazy(() => import('../components/SpendPredictionChart.js'));
const NetSavingsBarChart = lazy(() => import('../components/NetSavingsBarChart.js'));
import { CashSpendingCard, CreditSpendingCard } from './dashboard/PayPeriodCard.js';
import * as ds from './dashboard.css.js';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

interface YTDData {
  year: number;
  startDate: string | Date;
  endDate: string | Date;
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
}

/** Parse an ISO date string (or Date) into a local-time Date (avoids UTC shift). */
function parseLocalDate(iso: string | Date): Date {
  const s = typeof iso === 'string' ? iso : iso.toISOString();
  const parts = s.split('T')[0]!.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

const EMPTY_ARRAY: never[] = [];
const currentYear = new Date().getFullYear();
const timeGreeting = (() => {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
})();

export default function Dashboard() {
  const period = useCurrentPeriod();
  const ytd = useYTD();
  const incomeTrend = useIncomeTrend();
  const spendPrediction = useSpendPrediction();
  const markAsPaid = useMarkAsPaid();
  const healthcareSummary = useHealthcareSummary(currentYear);
  const healthcarePolicies = usePolicies(currentYear);

  const [confirmPaidEarly, setConfirmPaidEarly] = useState<{
    id: string;
    name: string;
    amount: number;
  } | null>(null);

  const p = period.data as CurrentPeriodSummary | undefined;
  const y = ytd.data as YTDData | undefined;

  // Split expenses by type
  const cashExpenses = p?.expenseItems.filter((e) => e.expenseType === 'cash') ?? [];
  const creditExpenses = p?.expenseItems.filter((e) => e.expenseType === 'credit') ?? [];

  return (
    <div className={ds.pageStack}>
      <PageHeader title="Dashboard" />

      {/* Greeting */}
      <div>
        <p className={ds.greeting}>Good {timeGreeting}, Lance.</p>
        <p className={ds.greetingSub}>Here&apos;s a summary of your finances.</p>
      </div>

      <div className={ds.gridCharts}>
        {/* Spend Prediction */}
        {!spendPrediction.data ? (
          <EmptyState
            icon={<TrendingDown size={32} />}
            message={
              spendPrediction.isLoading
                ? 'Loading…'
                : 'Add a pay schedule and expenses to see spend predictions'
            }
          />
        ) : (
          <div className={ds.card}>
            <Suspense
              fallback={<p className={`py-10 text-center ${ds.placeholder}`}>Loading chart…</p>}
            >
              <SpendPredictionChart data={spendPrediction.data} />
            </Suspense>
          </div>
        )}

        {/* Savings Outlook */}
        {/*
          Mirrors the Spend Prediction branch above, INCLUDING while loading.
          This condition used to exclude `isLoading`, so a loading chart fell
          through to `ds.card` — `neutral0`, white — sitting beside an
          EmptyState on `neutral50`. Two cards side by side in different
          colours for the second before data arrives.
        */}
        {incomeTrend.isLoading || incomeTrend.isError || (incomeTrend.data ?? []).length === 0 ? (
          <EmptyState
            icon={<BarChart3 size={32} />}
            message={
              incomeTrend.isLoading
                ? 'Loading…'
                : 'Add income and expenses to see your savings outlook'
            }
          />
        ) : (
          <div className={ds.card}>
            <Suspense
              fallback={<p className={`py-10 text-center ${ds.placeholder}`}>Loading chart…</p>}
            >
              <NetSavingsBarChart
                data={incomeTrend.data ?? EMPTY_ARRAY}
                isLoading={incomeTrend.isLoading}
                isError={incomeTrend.isError}
              />
            </Suspense>
          </div>
        )}
      </div>

      {/* ── Pay Period section ── */}
      {p && (
        <div>
          <p className={ds.payPeriodLabel}>Pay Period</p>
          <p className={ds.payPeriodDate}>
            {format(parseLocalDate(p.payPeriod.startDate), 'MMMM d, yyyy')} &mdash;{' '}
            {format(parseLocalDate(p.payPeriod.endDate), 'MMMM d, yyyy')}
          </p>
        </div>
      )}

      {/* Balance-sheet cards */}
      {p && (
        <CashSpendingCard
          startDate={
            typeof p.payPeriod.startDate === 'string'
              ? p.payPeriod.startDate
              : new Date(p.payPeriod.startDate).toISOString()
          }
          endDate={
            typeof p.payPeriod.endDate === 'string'
              ? p.payPeriod.endDate
              : new Date(p.payPeriod.endDate).toISOString()
          }
          incomeItems={p.incomeItems}
          cashExpenses={cashExpenses}
          previousPeriodCreditExpenses={p.cashFlowSummary.previousPeriodCreditExpenses}
          previousPeriodCheckingBalance={p.cashFlowSummary.previousPeriodCheckingBalance}
          previousPeriodSavingsBalance={p.cashFlowSummary.previousPeriodSavingsBalance}
          adHocCashSpending={p.cashFlowSummary.adHocCashSpending}
          markAsPaid={markAsPaid}
          onPaidEarly={setConfirmPaidEarly}
        />
      )}
      {p && creditExpenses.length > 0 && (
        <CreditSpendingCard
          startDate={
            typeof p.payPeriod.startDate === 'string'
              ? p.payPeriod.startDate
              : new Date(p.payPeriod.startDate).toISOString()
          }
          endDate={
            typeof p.payPeriod.endDate === 'string'
              ? p.payPeriod.endDate
              : new Date(p.payPeriod.endDate).toISOString()
          }
          creditExpenses={creditExpenses}
          markAsPaid={markAsPaid}
          onPaidEarly={setConfirmPaidEarly}
        />
      )}

      {/* ── Year to Date section ── */}
      <div>
        <p className={ds.payPeriodLabel}>Year to Date</p>
        <p className={ds.payPeriodDate}>
          {y ? (
            <>
              {format(parseLocalDate(y.startDate), 'MMMM d, yyyy')} &mdash;{' '}
              {format(parseLocalDate(y.endDate), 'MMMM d, yyyy')}
            </>
          ) : (
            <>
              January 1, {currentYear} &mdash; December 31, {currentYear}
            </>
          )}
        </p>
      </div>
      <div className={ds.grid3}>
        <StatCard label="Income" value={y?.totalIncome ?? 0} color="green" />
        <StatCard label="Expenses" value={y?.totalExpenses ?? 0} color="red" />
        <StatCard
          label="Net"
          value={y?.netIncome ?? 0}
          color={y && y.netIncome >= 0 ? 'gray' : 'red'}
        />
      </div>

      {/* ── Healthcare Costs ── */}
      <div className={ds.grid3} style={{ marginTop: `calc(-1 * ${vars.space['1']})` }}>
        <StatCard
          label="Non-Insurance Healthcare"
          value={healthcareSummary.data?.healthcareBudgetSpent ?? 0}
          color="gray"
        />
        <StatCard
          label="Non-Insurance Medicine"
          value={healthcareSummary.data?.medicineBudgetSpent ?? 0}
          color="gray"
        />
        <StatCard
          label="Total Healthcare Costs"
          value={
            (healthcareSummary.data?.healthcareBudgetSpent ?? 0) +
            (healthcareSummary.data?.medicineBudgetSpent ?? 0) +
            (healthcarePolicies.data ?? []).reduce(
              (sum, p) => sum + p.premium + (p.balance.deductibleSpent ?? 0),
              0,
            )
          }
          color="gray"
        />
      </div>

      {/* Confirm Paid Early dialog */}
      <ConfirmDialog
        open={confirmPaidEarly !== null}
        title="Confirm Early Payment"
        message={
          confirmPaidEarly
            ? `Are you sure you want to mark ${confirmPaidEarly.name} as paid early? This will create a transaction for ${formatCurrency(confirmPaidEarly.amount)}.`
            : ''
        }
        confirmLabel="Yes, mark as paid"
        cancelLabel="Cancel"
        confirmColor="green"
        onConfirm={() => {
          if (confirmPaidEarly) markAsPaid.mutate({ id: confirmPaidEarly.id });
          setConfirmPaidEarly(null);
        }}
        onCancel={() => setConfirmPaidEarly(null)}
      />
    </div>
  );
}
