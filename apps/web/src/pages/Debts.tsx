import React, { useState, useId } from 'react';
import { Plus, HandCoins } from 'lucide-react';
import {
  useDebts,
  useDebtSummary,
  useDeleteDebt,
  useAccounts,
  useExpenses,
  useExtraPayment,
  type DebtRecord,
} from '../hooks/useApi.js';
import PageHeader from '../components/PageHeader.js';
import EmptyState from '../components/EmptyState.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import { formatCurrency, formatCount } from '../lib/utils.js';
import { useIsNarrow } from '../hooks/useIsNarrow.js';
import StatCard from '../components/StatCard.js';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import AmortizationPanel from './debts/AmortizationPanel.js';
import EscrowHistoryPanel from './debts/EscrowHistoryPanel.js';
import EscrowReminderBanner from './debts/EscrowReminderBanner.js';
import EscrowUpdateModal from './debts/EscrowUpdateModal.js';
import DebtForm from './debts/DebtForm.js';
import DebtCard from './debts/DebtCard.js';
import * as tl from './transactions/transaction-list.css.js';

import {
  Badge,
  BadgeCount,
  buttonStyles,
  inputStyles,
  CurrencyInput,
  DatePicker,
  Select,
  ResizableTextarea,
  SectionHeading,
  Modal,
} from '@budget-tracker/ui';
import type { SelectOption } from '@budget-tracker/ui';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

interface Account {
  id: string;
  name: string;
}
interface Expense {
  id: string;
  name: string;
}

/** Below this width the two summary stat cards stack into one column. */
const STACK_SUMMARY_BREAKPOINT = below.md;

/**
 * Below this width the progress bars' dollar values round to whole dollars
 * ($14,509 / $43,174) — cents are noise at that size. The detail rows keep
 * full precision.
 */
const ROUND_VALUES_BREAKPOINT = below.sm;

export default function DebtsPage() {
  const { data: debtsData, isLoading } = useDebts();
  const { data: summaryData } = useDebtSummary();
  const { data: acctData } = useAccounts();
  const { data: expData } = useExpenses({ limit: 200 });
  const del = useDeleteDebt();

  const allDebts = (debtsData ?? []) as DebtRecord[];
  const activeDebts = allDebts.filter((d) => !d.paidOff);
  const paidOffDebts = allDebts.filter((d) => d.paidOff);
  const accounts = (acctData ?? []) as Account[];
  const expenses = (expData ?? []) as Expense[];
  const summary = summaryData as
    | {
        totalBalance: number;
        totalMinimumMonthly: number;
        debtFreeDate: string | null;
        activeCount: number;
        paidOffCount: number;
      }
    | undefined;

  const [editing, setEditing] = useState<DebtRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DebtRecord | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<DebtRecord | null>(null);
  const [escrowTarget, setEscrowTarget] = useState<DebtRecord | null>(null);
  const [extraPaymentTarget, setExtraPaymentTarget] = useState<DebtRecord | null>(null);
  const [extraPayments] = useState<Record<string, number>>({});
  const [extraPaymentDraft, setExtraPaymentDraft] = useState(0);
  const [extraDate, setExtraDate] = useState<Date | null>(null);
  const [extraAccountId, setExtraAccountId] = useState<string>('');
  const [extraNote, setExtraNote] = useState('');
  const fid = useId();
  const extraPaymentMutation = useExtraPayment();
  const stackSummary = useIsNarrow(STACK_SUMMARY_BREAKPOINT);
  const roundValues = useIsNarrow(ROUND_VALUES_BREAKPOINT);

  const accountOptions: SelectOption[] = accounts.map((a) => ({ value: a.id, label: a.name }));

  function openCreate() {
    setEditing(null);
    setShowForm(true);
  }
  function openEdit(r: DebtRecord) {
    setEditing(r);
    setShowForm(true);
  }
  function closeForm() {
    setShowForm(false);
    setEditing(null);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    del.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
  }

  function openExtraPayment(d: DebtRecord) {
    setExtraPaymentDraft(0);
    setExtraDate(new Date());
    setExtraAccountId(d.linkedAccountId ?? '');
    setExtraNote('');
    setExtraPaymentTarget(d);
  }

  return (
    <div>
      <PageHeader
        title={
          <>
            Debts <BadgeCount>{formatCount(allDebts.length)}</BadgeCount>
          </>
        }
        action={
          <button
            type="button"
            onClick={openCreate}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            <Plus size={15} /> Add Debt
          </button>
        }
      />

      {/* Summary cards */}
      {summary && allDebts.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: stackSummary ? '1fr' : 'repeat(2, 1fr)',
            gap: vars.space['4'],
            marginBottom: vars.space['8'],
          }}
        >
          <StatCard label="Total Balance" value={summary.totalBalance} color="red" />
          <StatCard label="Monthly Payment" value={summary.totalMinimumMonthly} color="gray" />
        </div>
      )}

      {/* Escrow renewal reminders for mortgage debts */}
      {allDebts.reduce<React.ReactNode[]>((acc, d) => {
        if (d.type === 'MORTGAGE' && d.escrowEnabled) {
          acc.push(
            <div key={`escrow-reminder-${d.id}`} style={{ marginBottom: vars.space['4'] }}>
              <EscrowReminderBanner
                debtName={d.name}
                debtId={d.id}
                onUpdate={() => setEscrowTarget(d)}
              />
            </div>,
          );
        }
        return acc;
      }, [])}

      {/* Debt list */}
      {isLoading ? (
        <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary }}>Loading…</p>
      ) : allDebts.length === 0 ? (
        <EmptyState
          icon={<HandCoins size={32} />}
          message="No debts yet — add one to get started"
          action={
            <button
              type="button"
              onClick={openCreate}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              <Plus size={15} /> Add Debt
            </button>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['6'] }}>
          {/* Active debts */}
          {activeDebts.length > 0 && (
            <div>
              <h2
                className={tl.dateHeading}
                style={{ display: 'flex', alignItems: 'center', gap: vars.space['2'] }}
              >
                Active{' '}
                <Badge variant="neutral" size="sm">
                  {activeDebts.length}
                </Badge>
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['2'] }}>
                {activeDebts.map((d) => (
                  <DebtCard
                    key={d.id}
                    debt={d}
                    roundValues={roundValues}
                    onEdit={openEdit}
                    onViewSchedule={setScheduleTarget}
                    onExtraPayment={openExtraPayment}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Paid off debts */}
          {paidOffDebts.length > 0 && (
            <div>
              <h2
                className={tl.dateHeading}
                style={{ display: 'flex', alignItems: 'center', gap: vars.space['2'] }}
              >
                Paid Off{' '}
                <Badge variant="neutral" size="sm">
                  {paidOffDebts.length}
                </Badge>
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['2'] }}>
                {paidOffDebts.map((d) => (
                  <DebtCard
                    key={d.id}
                    debt={d}
                    roundValues={roundValues}
                    onEdit={openEdit}
                    onViewSchedule={setScheduleTarget}
                    onExtraPayment={openExtraPayment}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showForm && (
        <DebtForm editing={editing} accounts={accounts} expenses={expenses} onClose={closeForm} />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        title="Delete Debt"
        message={`Are you sure you want to delete "${deleteTarget?.name ?? ''}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmColor="red"
      />

      {/* Schedule modal */}
      <Modal
        open={scheduleTarget !== null}
        onClose={() => setScheduleTarget(null)}
        title={scheduleTarget ? `${scheduleTarget.name} – Schedule` : ''}
        variant="pinned"
      >
        {scheduleTarget && (
          <>
            <AmortizationPanel
              debtId={scheduleTarget.id}
              frequency={scheduleTarget.frequency}
              escrowEnabled={scheduleTarget.escrowEnabled}
              extraPayment={extraPayments[scheduleTarget.id] ?? 0}
            />
            {scheduleTarget.type === 'MORTGAGE' && scheduleTarget.escrowEnabled && (
              <EscrowHistoryPanel debtId={scheduleTarget.id} />
            )}
          </>
        )}
      </Modal>

      {/* Update escrow drawer */}
      {escrowTarget && (
        <EscrowUpdateModal debt={escrowTarget} onClose={() => setEscrowTarget(null)} />
      )}

      {/* Extra payment drawer */}
      <Modal
        open={extraPaymentTarget !== null}
        onClose={() => setExtraPaymentTarget(null)}
        title={extraPaymentTarget ? `${extraPaymentTarget.name} – Extra Payment` : ''}
        variant="drawer"
        closeButton="none"
        footer={
          <div style={{ display: 'flex', gap: vars.space['2'] }}>
            <button
              type="submit"
              form="extra-payment-form"
              disabled={
                extraPaymentMutation.isPending ||
                extraPaymentDraft <= 0 ||
                !extraDate ||
                !extraAccountId
              }
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              {extraPaymentDraft > 0 ? `Add · ${formatCurrency(extraPaymentDraft)}` : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => setExtraPaymentTarget(null)}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              Cancel
            </button>
          </div>
        }
      >
        {extraPaymentTarget && (
          <form
            id="extra-payment-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!extraPaymentTarget || extraPaymentDraft <= 0 || !extraDate || !extraAccountId)
                return;
              const year = extraDate.getFullYear();
              const month = String(extraDate.getMonth() + 1).padStart(2, '0');
              const day = String(extraDate.getDate()).padStart(2, '0');
              const dateStr = `${year}-${month}-${day}T00:00:00.000Z`;
              extraPaymentMutation.mutate(
                {
                  debtId: extraPaymentTarget.id,
                  body: {
                    amount: extraPaymentDraft,
                    date: dateStr,
                    accountId: extraAccountId,
                    note: extraNote || undefined,
                  },
                },
                { onSuccess: () => setExtraPaymentTarget(null) },
              );
            }}
          >
            <div className={inputStyles.formStack}>
              {/* ── TRANSACTION INFORMATION ── */}
              <SectionHeading>Transaction Information</SectionHeading>

              {/* Date */}
              <div className={inputStyles.field}>
                <label htmlFor={`${fid}-extra-date`} className={inputStyles.fieldLabel}>
                  Date <span className={inputStyles.fieldRequired}>*</span>
                </label>
                <DatePicker id={`${fid}-extra-date`} value={extraDate} onChange={setExtraDate} />
              </div>

              {/* ── PAYMENT INFORMATION ── */}
              <SectionHeading>Payment Information</SectionHeading>

              {/* Account */}
              <div className={inputStyles.field}>
                <label htmlFor={`${fid}-extra-account`} className={inputStyles.fieldLabel}>
                  Account <span className={inputStyles.fieldRequired}>*</span>
                </label>
                <Select
                  id={`${fid}-extra-account`}
                  options={accountOptions}
                  value={extraAccountId}
                  onChange={(val) => setExtraAccountId(Array.isArray(val) ? (val[0] ?? '') : val)}
                  aria-label="Payment account"
                />
              </div>

              {/* Amount */}
              <div className={inputStyles.field}>
                <label htmlFor={`${fid}-extra-amount`} className={inputStyles.fieldLabel}>
                  Amount <span className={inputStyles.fieldRequired}>*</span>
                </label>
                <CurrencyInput
                  id={`${fid}-extra-amount`}
                  value={Math.round(extraPaymentDraft * 100)}
                  onChange={(cents) => setExtraPaymentDraft(cents / 100)}
                />
              </div>

              {/* ── EXTRA INFORMATION ── */}
              <SectionHeading>Extra Information</SectionHeading>

              {/* Note */}
              <div className={inputStyles.field}>
                <label htmlFor={`${fid}-extra-note`} className={inputStyles.fieldLabel}>
                  Note
                </label>
                <ResizableTextarea
                  id={`${fid}-extra-note`}
                  value={extraNote}
                  onChange={(e) => setExtraNote(e.target.value)}
                  placeholder="Optional note"
                />
              </div>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
