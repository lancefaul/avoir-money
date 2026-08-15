import { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Landmark } from 'lucide-react';
import { Badge, BadgeCount, buttonStyles, Dialog } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { useAccounts } from '../hooks/useApi.js';
import { useUIStore } from '../store/ui.js';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import PageHeader from '../components/PageHeader.js';
import EmptyState from '../components/EmptyState.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import EarnRewardsModal from './accounts/EarnRewardsModal.js';
import AdjustRewardsModal from './accounts/AdjustRewardsModal.js';
import AccountCard from './accounts/AccountCard.js';
import AccountFormModal from './accounts/AccountFormModal.js';
import BalanceLedgerInline from './accounts/BalanceLedgerInline.js';
import ReconcileModal from './reconcile/ReconcileModal.js';
import { formatCount } from '../lib/utils.js';
import * as s from './accounts/accounts-page.css.js';

interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  /** Pre-tracking balance — the editable "Starting Balance". */
  openingBalance: number;
  archived: boolean;
  hasRewards: boolean;
  /** Set on a Rewards account: the id of its parent card. */
  parentAccountId?: string | null;
  earnsInterest?: boolean;
  interestRate?: number;
  interestRateType?: string;
}

export default function AccountsPage() {
  const { data, isLoading } = useAccounts();
  const qc = useQueryClient();

  const [editing, setEditing] = useState<Account | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [deleteTxCount, setDeleteTxCount] = useState(0);
  const [archiveTarget, setArchiveTarget] = useState<Account | null>(null);
  const [earnAccount, setEarnAccount] = useState<Account | null>(null);
  const [adjustAccount, setAdjustAccount] = useState<Account | null>(null);
  const [reconcileAccount, setReconcileAccount] = useState<Account | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const allAccounts = useMemo(() => (data ?? []) as Account[], [data]);
  const hiddenAccountIds = useUIStore((s) => s.hiddenAccountIds) ?? [];
  const hideAccount = useUIStore((s) => s.hideAccount);
  const unhideAccount = useUIStore((s) => s.unhideAccount);

  // Rewards accounts (rewards-as-child-account) never render as standalone cards
  // — they surface as an on-card row on their parent — so they're excluded from
  // the strip and indexed by parent for the card to read.
  const rewardsByParent = useMemo(() => {
    const m = new Map<string, Account>();
    for (const a of allAccounts) {
      if (a.type === 'Rewards' && a.parentAccountId) m.set(a.parentAccountId, a);
    }
    return m;
  }, [allAccounts]);
  const cardAccounts = allAccounts.filter((a) => a.type !== 'Rewards');

  const activeAccounts = cardAccounts.filter(
    (a) => !a.archived && !hiddenAccountIds.includes(a.id),
  );
  const hiddenAccounts = cardAccounts.filter((a) => !a.archived && hiddenAccountIds.includes(a.id));
  const archivedAccounts = cardAccounts.filter((a) => a.archived);

  function openCreate() {
    setEditing(null);
    setShowForm(true);
  }
  function openEdit(a: Account) {
    setEditing(a);
    setShowForm(true);
  }
  function close() {
    setShowForm(false);
    setEditing(null);
  }

  async function tryDelete(a: Account) {
    const { count } = await api.accounts.transactionCount(a.id);
    setDeleteTxCount(count);
    setDeleteTarget(a);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await api.accounts.delete(deleteTarget.id);
    setDeleteTarget(null);
    qc.invalidateQueries({ queryKey: ['accounts'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
  }

  async function toggleArchive(a: Account) {
    if (a.archived) await api.accounts.unarchive(a.id);
    else await api.accounts.archive(a.id);
    qc.invalidateQueries({ queryKey: ['accounts'] });
  }

  async function createRewardsAccountFor(card: Account) {
    await api.accounts.createRewardsAccount(card.id, {});
    qc.invalidateQueries({ queryKey: ['accounts'] });
  }

  // One continuous card list (no tabs): active accounts grouped by type, then a
  // Hidden group, then an Archived group. Hidden/archived remain concepts (the
  // card actions still toggle them) — they just render as trailing groups
  // instead of tab filters.
  const TYPE_ORDER = ['Checking', 'Savings', 'Credit Card', 'HSA', 'Cash', 'Gift Card'];
  const typeRank = (type: string) => {
    const i = TYPE_ORDER.indexOf(type);
    return i === -1 ? 999 : i;
  };
  const byBalance = (type: string) => (a: Account, b: Account) =>
    type === 'Credit Card' ? a.balance - b.balance : b.balance - a.balance;

  const activeTypeGroups = [...new Set(activeAccounts.map((a) => a.type))]
    .toSorted((a, b) => typeRank(a) - typeRank(b))
    .map((type) => ({
      key: type,
      label: type.replace(/_/g, ' '),
      accounts: activeAccounts.filter((a) => a.type === type).toSorted(byBalance(type)),
    }));

  // Hidden / archived groups hold mixed types — order by type, then by balance.
  const sortMixed = (list: Account[]) =>
    list.toSorted((a, b) => typeRank(a.type) - typeRank(b.type) || byBalance(a.type)(a, b));

  const groups = [
    ...activeTypeGroups,
    ...(hiddenAccounts.length
      ? [{ key: '__hidden', label: 'Hidden', accounts: sortMixed(hiddenAccounts) }]
      : []),
    ...(archivedAccounts.length
      ? [{ key: '__archived', label: 'Archived', accounts: sortMixed(archivedAccounts) }]
      : []),
  ];

  // Auto-select the first account when data loads (uses sorted order).
  const firstAccountId = groups[0]?.accounts[0]?.id;
  useEffect(() => {
    if (
      firstAccountId &&
      (!selectedAccountId || !allAccounts.some((a) => a.id === selectedAccountId))
    ) {
      setSelectedAccountId(firstAccountId);
    }
  }, [firstAccountId, allAccounts, selectedAccountId]);

  const selectedAccount = allAccounts.find((a) => a.id === selectedAccountId);

  const stripRef = useRef<HTMLDivElement>(null);

  // Wheel → horizontal scroll for the card strip. Attached manually because
  // React's synthetic onWheel is passive — preventDefault would be ignored and
  // the page would scroll vertically as well.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0 || e.deltaX !== 0) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <>
      <PageHeader
        title={
          <>
            Accounts <BadgeCount>{formatCount(activeAccounts.length)}</BadgeCount>
          </>
        }
        action={
          <button
            type="button"
            onClick={openCreate}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            <Plus size={15} /> Add Account
          </button>
        }
      />

      <div className={s.wrapper}>
        {/* ── Account cards: horizontal strip above the ledger ── */}
        <div className={s.topPanel}>
          <div ref={stripRef} className={s.stripScroll}>
            {isLoading ? (
              <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary }}>Loading…</p>
            ) : groups.length === 0 ? (
              // The ordinary full-width empty state every other page uses, not a
              // card-shaped one standing in for a missing account. It FILLS the
              // strip rather than replacing it, because `stripRef`'s wheel
              // handler attaches on mount and a strip that only appeared once
              // accounts loaded would never receive one.
              <div className={s.emptySlot}>
                <EmptyState
                  icon={<Landmark size={32} />}
                  message="No accounts yet"
                  action={
                    <button
                      type="button"
                      onClick={openCreate}
                      className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
                    >
                      <Plus size={15} /> Add Account
                    </button>
                  }
                />
              </div>
            ) : (
              groups.map(({ key, label, accounts: groupAccounts }) => (
                <div key={key} className={s.typeGroup}>
                  <h2 className={s.typeHeading}>
                    {label}{' '}
                    <Badge variant="neutral" size="sm">
                      {groupAccounts.length}
                    </Badge>
                  </h2>
                  <div className={s.cardListRow}>
                    {groupAccounts.map((a) => {
                      const childRewards = rewardsByParent.get(a.id) ?? null;
                      return (
                        <div
                          key={a.id}
                          role="button"
                          tabIndex={0}
                          className={`${s.cardButton} ${s.stripCard} ${selectedAccountId === a.id ? s.cardButtonSelected : ''}`}
                          onClick={() => setSelectedAccountId(a.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedAccountId(a.id);
                            }
                          }}
                        >
                          <AccountCard
                            account={a}
                            onEdit={() => openEdit(a)}
                            onDelete={() => tryDelete(a)}
                            onHide={
                              !a.archived
                                ? () =>
                                    hiddenAccountIds.includes(a.id)
                                      ? unhideAccount(a.id)
                                      : hideAccount(a.id)
                                : undefined
                            }
                            isHidden={hiddenAccountIds.includes(a.id)}
                            onToggleArchive={() => {
                              if (a.archived) toggleArchive(a);
                              else setArchiveTarget(a);
                            }}
                            onLedger={undefined}
                            // Rewards-as-child-account (new model): show the on-card
                            // rewards row + earn action when a child exists; offer to
                            // create one on a credit card that has none yet.
                            rewardsAccount={
                              childRewards
                                ? { id: childRewards.id, balance: childRewards.balance }
                                : null
                            }
                            onRewardsRowClick={
                              childRewards ? () => setSelectedAccountId(childRewards.id) : undefined
                            }
                            onEarnRewards={
                              childRewards ? () => setEarnAccount(childRewards) : undefined
                            }
                            onAdjustRewards={
                              childRewards ? () => setAdjustAccount(childRewards) : undefined
                            }
                            onAddRewardsAccount={
                              a.type === 'Credit Card' && !childRewards
                                ? () => createRewardsAccountFor(a)
                                : undefined
                            }
                            // Archived accounts are not reconciled — there is no
                            // current statement to check them against.
                            onReconcile={!a.archived ? () => setReconcileAccount(a) : undefined}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Right content: balance ledger ── */}
        {selectedAccount ? (
          <BalanceLedgerInline
            key={selectedAccount.id}
            accountId={selectedAccount.id}
            accountName={selectedAccount.name}
            onReconcile={
              !selectedAccount.archived ? () => setReconcileAccount(selectedAccount) : undefined
            }
          />
        ) : (
          <div
            className={s.main}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <p style={{ color: vars.color.textTertiary, fontSize: vars.font.base }}>
              Select an account to view its balance history
            </p>
          </div>
        )}
      </div>

      {/* ── Modals ── */}

      {/* Add/Edit Account Modal */}
      <AccountFormModal open={showForm} editing={editing} onClose={close} />

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete Account"
        message={
          deleteTarget
            ? deleteTxCount > 0
              ? `Are you sure you want to delete "${deleteTarget.name}"? ${deleteTxCount} transaction${deleteTxCount > 1 ? 's' : ''} will be permanently deleted. Consider archiving instead to keep transaction history.`
              : `Are you sure you want to delete "${deleteTarget.name}"? This account has no transactions.`
            : ''
        }
        variant="negative"
        confirmLabel="Delete"
        secondaryLabel="Archive Instead"
        onSecondary={() => {
          if (deleteTarget) {
            toggleArchive(deleteTarget);
            setDeleteTarget(null);
          }
        }}
        cancelLabel="Cancel"
      />

      {/* Archive Confirmation Dialog */}
      <ConfirmDialog
        open={archiveTarget !== null}
        title="Archive Account"
        message={
          archiveTarget
            ? `Are you sure you want to archive ${archiveTarget.name}? It will be hidden from the accounts list. You can restore it later.`
            : ''
        }
        confirmLabel="Archive"
        cancelLabel="Cancel"
        confirmColor="blue"
        onConfirm={() => {
          if (archiveTarget) {
            toggleArchive(archiveTarget);
            setArchiveTarget(null);
          }
        }}
        onCancel={() => setArchiveTarget(null)}
      />

      {/* Add Rewards Earned Modal (rewards-as-child-account) */}
      <EarnRewardsModal
        open={!!earnAccount}
        onClose={() => setEarnAccount(null)}
        rewardsAccountId={earnAccount?.id ?? ''}
      />

      {/* Adjust Rewards — a decrease that is not a redemption (expiry, clawback,
          correction). The mirror of the earn modal above. */}
      <AdjustRewardsModal
        open={!!adjustAccount}
        onClose={() => setAdjustAccount(null)}
        rewardsAccountId={adjustAccount?.id ?? ''}
        currentBalance={adjustAccount?.balance ?? 0}
      />

      {/* Reconcile — a full-screen modal over the account, not a separate page:
          a reconciliation is always of an account, and leaving the page to do it
          loses the account you were looking at. */}
      {reconcileAccount && (
        <ReconcileModal
          open
          onClose={() => setReconcileAccount(null)}
          accountId={reconcileAccount.id}
          accountName={reconcileAccount.name}
        />
      )}
    </>
  );
}
