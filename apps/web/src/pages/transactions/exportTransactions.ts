import { api } from '../../lib/api.js';
import { localToday } from '../../lib/utils.js';
import { formatTransactionsToCSV, type ExportableTransaction } from '@budget-tracker/core';
import type { TransactionListParams } from '../../lib/api/request.js';

interface Transaction {
  id: string;
  name: string;
  amount: number;
  date: string | Date;
  type: string;
  accountId: string | null;
  toAccountId: string | null;
  budgetId: string | null;
  note: string | null;
  tradeMetadata?: unknown;
  bitcoinMetadata?: unknown;
  parentId?: string | null;
  childCount?: number;
  expenseId?: string | null;
  incomeId?: string | null;
  payPeriodId?: string | null;
}

export interface ExportFilters {
  search?: string;
  budgetIds?: string[];
  accountIds?: string[];
  types?: string[];
}

/** Fetch all transactions using cursor-based pagination (limit max is 500 per page). */
async function fetchAllTransactions(filters?: ExportFilters): Promise<Transaction[]> {
  const all: Transaction[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const params: TransactionListParams = { limit: 500, cursor, skipGenerate: true };
    if (filters?.search) params.search = filters.search;
    const resp = await api.transactions.list(params);
    all.push(...(resp.transactions as Transaction[]));
    hasMore = resp.hasMore;
    cursor = resp.nextCursor ?? undefined;
  }

  return all;
}

/** Apply client-side filters that the server doesn't support as multi-select. */
function applyClientFilters(txs: Transaction[], filters?: ExportFilters): Transaction[] {
  let result = txs;
  if (filters?.types?.length) {
    result = result.filter((tx) => filters.types!.includes(tx.type));
  }
  if (filters?.accountIds?.length) {
    result = result.filter(
      (tx) =>
        (tx.accountId != null && filters.accountIds!.includes(tx.accountId)) ||
        (tx.toAccountId != null && filters.accountIds!.includes(tx.toAccountId)),
    );
  }
  if (filters?.budgetIds?.length) {
    result = result.filter((tx) => tx.budgetId != null && filters.budgetIds!.includes(tx.budgetId));
  }
  return result;
}

export async function exportTransactions(filters?: ExportFilters): Promise<void> {
  const allTxs = await fetchAllTransactions(filters);
  const txs = applyClientFilters(allTxs, filters);

  const [accts, cats, custodians, wallets] = await Promise.all([
    api.accounts.list() as Promise<Array<{ id: string; name: string }>>,
    api.budgetItems.list() as Promise<Array<{ id: string; name: string }>>,
    api.investments.custodians.list(),
    api.investments.wallets.list(),
  ]);

  const acctMap = new Map(accts.map((a) => [a.id, a.name]));
  const catMap = new Map(cats.map((c) => [c.id, c.name]));
  const custMap = new Map(custodians.map((c: { id: string; name: string }) => [c.id, c.name]));
  const walletMap = new Map(wallets.map((w: { id: string; name: string }) => [w.id, w.name]));

  function toExportable(
    tx: Transaction,
    children?: ExportableTransaction[],
  ): ExportableTransaction {
    const trade = tx.tradeMetadata as
      | {
          direction: string;
          assetType: string;
          ticker?: string;
          custodianId?: string;
          walletId?: string;
          unitPrice: number;
          quantity: number;
          bitcoinUnit?: string;
        }
      | null
      | undefined;
    const btc = tx.bitcoinMetadata as
      | {
          walletId: string;
          quantity: number;
          bitcoinUnit: string;
          unitPrice: number;
        }
      | null
      | undefined;
    const dateStr =
      typeof tx.date === 'string'
        ? tx.date.split('T')[0]!
        : new Date(tx.date).toISOString().split('T')[0]!;

    const exp: ExportableTransaction = {
      id: tx.id,
      type: tx.type,
      name: tx.name,
      amount: tx.amount,
      date: dateStr,
      accountName: (tx.accountId ? acctMap.get(tx.accountId) : undefined) ?? '',
      toAccountName: tx.toAccountId ? acctMap.get(tx.toAccountId) : undefined,
      categoryName: tx.budgetId ? catMap.get(tx.budgetId) : undefined,
      note: tx.note ?? undefined,
    };

    if (tx.type === 'TRADE' && trade) {
      exp.tradeMetadata = {
        direction: trade.direction,
        assetType: trade.assetType,
        ticker: trade.ticker,
        custodianName: trade.custodianId ? custMap.get(trade.custodianId) : undefined,
        walletName: trade.walletId ? walletMap.get(trade.walletId) : undefined,
        unitPrice: trade.unitPrice,
        quantity: trade.quantity,
        bitcoinUnit: trade.bitcoinUnit,
      };
    }

    if (btc) {
      exp.bitcoinMetadata = {
        walletName: walletMap.get(btc.walletId) ?? btc.walletId,
        quantity: btc.quantity,
        bitcoinUnit: btc.bitcoinUnit,
        unitPrice: btc.unitPrice,
      };
    }

    if (tx.parentId) exp.parentId = tx.parentId;
    if (tx.expenseId) exp.expenseId = tx.expenseId;
    if (tx.incomeId) exp.incomeId = tx.incomeId;
    if (tx.payPeriodId) exp.payPeriodId = tx.payPeriodId;
    if (children && children.length > 0) exp.children = children;

    return exp;
  }

  const sorted = txs.toSorted((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const exportable: ExportableTransaction[] = [];
  for (const tx of sorted) {
    if (tx.childCount && tx.childCount > 0) {
      const childrenResp = await api.transactions.listChildren(tx.id);
      const childExportables: ExportableTransaction[] = (
        childrenResp.children as Array<{
          id: string;
          parentId: string;
          budgetId: string;
          preTaxAmount: number;
          taxAmount: number;
          taxRate: number | null;
          lineTotal: number;
          note: string | null;
        }>
      ).map((child) => ({
        id: child.id,
        type: tx.type,
        name: tx.name,
        amount: child.lineTotal,
        date:
          typeof tx.date === 'string'
            ? tx.date.split('T')[0]!
            : new Date(tx.date).toISOString().split('T')[0]!,
        accountName: (tx.accountId ? acctMap.get(tx.accountId) : undefined) ?? '',
        categoryName: child.budgetId ? catMap.get(child.budgetId) : undefined,
        note: child.note ?? undefined,
        parentId: child.parentId,
        preTaxAmount: child.preTaxAmount,
        taxAmount: child.taxAmount,
        taxRate: child.taxRate ?? undefined,
      }));
      exportable.push(toExportable(tx, childExportables));
    } else {
      exportable.push(toExportable(tx));
    }
  }

  const csv = formatTransactionsToCSV(exportable);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions-${localToday()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
