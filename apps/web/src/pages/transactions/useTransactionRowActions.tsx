import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import { api } from '../../lib/api.js';
import { useToastStore } from '../../store/toast.js';
import { localToday } from '../../lib/utils.js';
import type { Transaction as CoreTransaction } from '@budget-tracker/core';
import {
  useCustodians,
  useWallets,
  useInvestmentPrices,
  useInvestments,
  useBitcoinTransfer,
  useStockTransfer,
} from '../../hooks/useApi.js';
import {
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useCreatePurchase,
  useUpdatePurchasePayments,
  useDeletePurchase,
  useLinkTransaction,
  useUnlinkTransaction,
} from '../../hooks/useTransactionMutations.js';
import { useTransactionForm } from './useTransactionForm.js';
import TransactionForm from './TransactionForm.js';
import SplitTransactionModal from './SplitTransactionModal.js';
import type { TransactionActionsMenuProps } from './TransactionActionsMenu.js';
import type { Expense, Income, Account, Category, NamedEntity, StockHolding } from './types.js';

/**
 * The minimal transaction shape this hook reads. Both the app's `Transaction`
 * and the core `Transaction` type satisfy it, so consumers pass their lists
 * straight in without a cast.
 */
export interface RowTransaction {
  id: string;
  type: string;
  name: string;
  amount: number;
  accountId: string | null;
  budgetId: string | null;
}

interface UseTransactionRowActionsOptions {
  /**
   * The current transaction list — used for name suggestions, the default
   * account on new entries, and locating the transaction being split.
   */
  transactions: RowTransaction[];
}

/**
 * The full row-action apparatus shared by the Transactions page and the account
 * ledger: it fetches the supporting data, owns the create/update/delete/link/
 * unlink mutations and the transaction form + split + delete modals, and returns
 * the handlers the shared `TransactionActionsMenu` needs. Render `modals` once in
 * the consumer. Data queries reuse the same React Query keys as the rest of the
 * app, so mounting this alongside those pages does not double-fetch.
 */
export function useTransactionRowActions({ transactions }: UseTransactionRowActionsOptions) {
  // A single delete confirm covers both an ordinary transaction and a whole
  // purchase group (Anchor + every leg) — the kind decides which mutation runs.
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'tx' | 'group'; id: string } | null>(
    null,
  );
  const [splitPanelFor, setSplitPanelFor] = useState<string | null>(null);

  const { data: expData } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => api.expenses.list({ limit: 500 }) as Promise<Expense[]>,
  });
  const { data: incData } = useQuery({
    queryKey: ['income'],
    queryFn: () => api.income.list() as Promise<Income[]>,
  });
  const { data: acctData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts.list() as Promise<Account[]>,
  });
  const { data: catData } = useQuery({
    queryKey: ['budgetItems'],
    queryFn: () => api.budgetItems.list() as Promise<Category[]>,
  });
  const { data: custodiansData } = useCustodians();
  const { data: walletsData } = useWallets();
  const { data: pricesData } = useInvestmentPrices();
  const { data: investmentsData } = useInvestments();

  const expenses = useMemo(() => (expData ?? []) as Expense[], [expData]);
  const incomes = useMemo(() => (incData ?? []) as Income[], [incData]);
  const accounts = useMemo(() => (acctData ?? []) as Account[], [acctData]);
  const categories = useMemo(() => (catData ?? []) as Category[], [catData]);
  const custodians = useMemo(() => (custodiansData ?? []) as NamedEntity[], [custodiansData]);
  const wallets = useMemo(() => (walletsData ?? []) as NamedEntity[], [walletsData]);
  const holdings = useMemo(() => (investmentsData ?? []) as StockHolding[], [investmentsData]);
  const stockHoldings = useMemo(() => holdings.filter((h) => h.type === 'STOCK'), [holdings]);

  const createTx = useCreateTransaction();
  const updateTx = useUpdateTransaction();
  const deleteTx = useDeleteTransaction();
  const createPurchase = useCreatePurchase();
  const updatePurchasePayments = useUpdatePurchasePayments();
  const deletePurchase = useDeletePurchase();
  const linkTransaction = useLinkTransaction();
  const unlinkTransaction = useUnlinkTransaction();
  const bitcoinTransferMutation = useBitcoinTransfer();
  const stockTransferMutation = useStockTransfer();

  const form = useTransactionForm({
    accounts,
    categories,
    stockHoldings,
    pricesData: pricesData as Record<string, number | null> | undefined,
    lastAccountId: transactions[0]?.accountId ?? undefined,
    createTx,
    updateTx,
    deleteTx,
    createPurchase,
    updatePurchasePayments,
    bitcoinTransferMutation,
    stockTransferMutation,
  });

  const isPending =
    bitcoinTransferMutation.isPending ||
    stockTransferMutation.isPending ||
    createTx.isPending ||
    createPurchase.isPending ||
    updateTx.isPending ||
    updatePurchasePayments.isPending;

  const nameSuggestions = useMemo(() => {
    const txType = form.txType;
    if (!txType) return [];
    const seen = new Set<string>();
    for (const tx of transactions) {
      if (tx.type === txType && tx.name) seen.add(tx.name);
    }
    return Array.from(seen).toSorted((a, b) => a.localeCompare(b));
  }, [transactions, form.txType]);

  const onInstantDuplicate = useCallback(
    (tx: CoreTransaction) => {
      const body: Record<string, unknown> = {
        type: tx.type,
        name: tx.name,
        amount: tx.amount,
        date: localToday(),
        accountId: tx.accountId,
        toAccountId: tx.toAccountId,
        budgetId: tx.budgetId,
        note: tx.note,
      };
      if (tx.tradeMetadata) body.tradeMetadata = tx.tradeMetadata;
      if (tx.bitcoinMetadata) {
        body.bitcoinMetadata = tx.bitcoinMetadata;
        delete body.accountId;
      }
      const cleanBody = Object.fromEntries(
        Object.entries(body).filter(([, v]) => v !== undefined && v !== null),
      );
      createTx.mutate(cleanBody);
    },
    [createTx],
  );

  const onSplit = useCallback(
    (id: string) => setSplitPanelFor((cur) => (cur === id ? null : id)),
    [],
  );
  const onDelete = useCallback((id: string) => setDeleteTarget({ kind: 'tx', id }), []);
  const onDeleteGroup = useCallback(
    (groupId: string) => setDeleteTarget({ kind: 'group', id: groupId }),
    [],
  );
  // From a split leg on the account ledger, jump to the purchase's parent on the
  // Transactions page (scoped to that one group). The leg itself is never
  // editable in isolation — only the parent Anchor is, so "manage" routes there.
  const navigate = useNavigate();
  const onManageGroup = useCallback(
    (groupId: string) => navigate({ to: '/transactions', search: { purchase: groupId } }),
    [navigate],
  );
  // Quick budget-category switch from the transaction list's budget badge.
  // UpdateTransactionSchema is .partial(), so a budgetId-only body is valid.
  const onChangeBudget = useCallback(
    (id: string, budgetId: string) => updateTx.mutate({ id, body: { budgetId } }),
    [updateTx],
  );
  // Re-split a purchase group from its Anchor: fetch the group's legs (the
  // Anchor row only knows the total) and open the drawer pre-loaded with them.
  const onResplit = useCallback(
    async (anchor: CoreTransaction) => {
      if (!anchor.purchaseGroupId) return;
      try {
        const res = await api.transactions.list({
          purchaseGroupId: anchor.purchaseGroupId,
          skipGenerate: true,
        });
        const legs = res.transactions
          .filter((t) => t.accountId !== null)
          .map((t) => ({
            accountId: t.accountId as string,
            amountCents: Math.round(Number(t.amount) * 100),
          }));
        form.openResplit(anchor, legs);
      } catch {
        // The drawer needs the group's legs to open; without them, tell the user
        // rather than failing silently (or leaving an unhandled rejection).
        useToastStore
          .getState()
          .addToast('error', "Couldn't load the payment split. Please try again.");
      }
    },
    [form],
  );
  const onLink = useCallback(
    (id: string, body: { expenseId?: string; incomeId?: string }) =>
      linkTransaction.mutate({ id, body }),
    [linkTransaction],
  );
  const onUnlink = useCallback((id: string) => unlinkTransaction.mutate(id), [unlinkTransaction]);

  const splitTx = useMemo(
    () => (splitPanelFor ? transactions.find((t) => t.id === splitPanelFor) : undefined),
    [splitPanelFor, transactions],
  );

  const modals = (
    <>
      <TransactionForm
        form={form}
        accounts={accounts}
        categories={categories}
        incomes={incomes}
        wallets={wallets}
        custodians={custodians}
        stockHoldings={stockHoldings}
        isPending={isPending}
        nameSuggestions={nameSuggestions}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.kind === 'group' ? 'Delete Split Purchase' : 'Delete Transaction'}
        message={
          deleteTarget?.kind === 'group'
            ? 'This removes the purchase and every account payment in it, reversing each balance. This action cannot be undone.'
            : 'Are you sure you want to delete this transaction? This action cannot be undone.'
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmColor="red"
        onConfirm={() => {
          if (deleteTarget?.kind === 'group') deletePurchase.mutate(deleteTarget.id);
          else if (deleteTarget) deleteTx.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {splitTx && (
        <SplitTransactionModal
          open
          onClose={() => setSplitPanelFor(null)}
          parentId={splitTx.id}
          parentAmount={splitTx.amount}
          parentBudgetId={splitTx.budgetId}
          categories={categories}
        />
      )}
    </>
  );

  return {
    // supporting data (also reused by the Transactions page for filters/bulk)
    expenses,
    incomes,
    accounts,
    categories,
    custodians,
    wallets,
    stockHoldings,
    // form handle (openCreate for the page's Add button, txType for suggestions)
    form,
    openCreate: form.openCreate,
    isPending,
    // handlers consumed by TransactionActionsMenu
    onEdit: form.openEdit,
    onDuplicate: form.openDuplicate,
    onInstantDuplicate,
    onDelete,
    onLink,
    onUnlink,
    onSplit,
    onDeleteGroup,
    onManageGroup,
    onChangeBudget,
    onResplit,
    splitPanelFor,
    // pre-shaped bundle for <TransactionActionsMenu {...menuProps} tx={tx} />
    menuProps: {
      expenses,
      incomes,
      onEdit: form.openEdit,
      onDuplicate: form.openDuplicate,
      onInstantDuplicate,
      onDelete,
      onDeleteGroup,
      onManageGroup,
      onResplit,
      onLink,
      onUnlink,
      onSplit,
    } satisfies Omit<TransactionActionsMenuProps, 'tx'>,
    // render once in the consumer
    modals,
  };
}
