/**
 * CSV export helpers for the Data Management settings screen, extracted from
 * DataManagement.tsx. Fetches each category via the API and triggers a browser
 * download. Pure data/CSV logic — no React.
 */
import { escapeCsvCell } from '@budget-tracker/core';
import { api } from '../../lib/api.js';
import type { TransactionListParams } from '../../lib/api/request.js';

function toCsvString(headers: string[], rows: string[][]): string {
  // escapeCsvCell (shared with the transaction formatter) handles CSV quoting
  // AND formula-injection neutralization.
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map((v) => escapeCsvCell(v ?? '')).join(','));
  }
  return lines.join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportCategory(key: string): Promise<void> {
  switch (key) {
    case 'all-transactions':
    case 'imported-transactions': {
      // Fetch all pages using cursor-based pagination
      const allTxs: Record<string, unknown>[] = [];
      let cursor: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const params: TransactionListParams = { limit: 500 };
        if (cursor) params.cursor = cursor;
        const data = await api.transactions.list(params);
        const page = (data as { transactions?: unknown[] }).transactions ?? [];
        if (!Array.isArray(page) || page.length === 0) {
          hasMore = false;
        } else {
          allTxs.push(...(page as Record<string, unknown>[]));
          cursor = (page[page.length - 1] as { id?: string }).id;
          if (page.length < 500) hasMore = false;
        }
      }
      if (allTxs.length === 0) return;
      const headers = ['id', 'name', 'amount', 'date', 'type', 'accountId', 'budgetId', 'note'];
      const rows = allTxs.map((t) => headers.map((h) => String(t[h] ?? '')));
      downloadCsv(`${key}.csv`, toCsvString(headers, rows));
      break;
    }
    case 'recurring-expenses': {
      const data = await api.expenses.list();
      const items = Array.isArray(data)
        ? data
        : ((data as { expenses?: unknown[] }).expenses ?? []);
      if (!Array.isArray(items) || items.length === 0) return;
      const headers = ['id', 'name', 'amount', 'frequency', 'accountId', 'budgetId', 'status'];
      const rows = (items as Record<string, unknown>[]).map((e) =>
        headers.map((h) => String(e[h] ?? '')),
      );
      downloadCsv('recurring-expenses.csv', toCsvString(headers, rows));
      break;
    }
    case 'recurring-income': {
      const data = await api.income.list();
      const items = Array.isArray(data) ? data : ((data as { income?: unknown[] }).income ?? []);
      if (!Array.isArray(items) || items.length === 0) return;
      const headers = ['id', 'name', 'amount', 'frequency', 'accountId', 'status'];
      const rows = (items as Record<string, unknown>[]).map((e) =>
        headers.map((h) => String(e[h] ?? '')),
      );
      downloadCsv('recurring-income.csv', toCsvString(headers, rows));
      break;
    }
    case 'accounts': {
      const data = await api.accounts.list();
      const items = Array.isArray(data)
        ? data
        : ((data as { accounts?: unknown[] }).accounts ?? []);
      if (!Array.isArray(items) || items.length === 0) return;
      const headers = ['id', 'name', 'type', 'balance', 'institution'];
      const rows = (items as Record<string, unknown>[]).map((a) =>
        headers.map((h) => String(a[h] ?? '')),
      );
      downloadCsv('accounts.csv', toCsvString(headers, rows));
      break;
    }
    case 'budgets': {
      const data = await api.budgetItems.list();
      const items = Array.isArray(data) ? data : ((data as { budgets?: unknown[] }).budgets ?? []);
      if (!Array.isArray(items) || items.length === 0) return;
      const headers = ['id', 'name', 'amount', 'frequency', 'groupId'];
      const rows = (items as Record<string, unknown>[]).map((b) =>
        headers.map((h) => String(b[h] ?? '')),
      );
      downloadCsv('budgets.csv', toCsvString(headers, rows));
      break;
    }
    case 'debts': {
      const data = await api.debts.list();
      const items = Array.isArray(data) ? data : ((data as { debts?: unknown[] }).debts ?? []);
      if (!Array.isArray(items) || items.length === 0) return;
      const headers = [
        'id',
        'name',
        'type',
        'principal',
        'interestRate',
        'payment',
        'paymentFrequency',
      ];
      const rows = (items as Record<string, unknown>[]).map((d) =>
        headers.map((h) => String(d[h] ?? '')),
      );
      downloadCsv('debts.csv', toCsvString(headers, rows));
      break;
    }
    case 'utilities': {
      const data = await api.utilities.listProviders();
      const items = Array.isArray(data) ? data : [];
      if (items.length === 0) return;
      const headers = ['id', 'name'];
      const rows = (items as Record<string, unknown>[]).map((u) =>
        headers.map((h) => String(u[h] ?? '')),
      );
      downloadCsv('utilities.csv', toCsvString(headers, rows));
      break;
    }
    case 'healthcare-policies': {
      const yearsData = await api.healthcare.years();
      const years = Array.isArray(yearsData) ? yearsData : [];
      const allPolicies: Record<string, unknown>[] = [];
      for (const year of years) {
        const policies = await api.healthcare.policies(year as number);
        if (Array.isArray(policies)) allPolicies.push(...(policies as Record<string, unknown>[]));
      }
      if (allPolicies.length === 0) return;
      const headers = [
        'id',
        'insurer',
        'policyType',
        'premium',
        'deductibleLimit',
        'oopMaximum',
        'year',
      ];
      const rows = allPolicies.map((p) => headers.map((h) => String(p[h] ?? '')));
      downloadCsv('healthcare-policies.csv', toCsvString(headers, rows));
      break;
    }
    case 'investments': {
      const data = await api.investments.list();
      const items = Array.isArray(data)
        ? data
        : ((data as { holdings?: unknown[] }).holdings ?? []);
      if (!Array.isArray(items) || items.length === 0) return;
      const headers = [
        'id',
        'ticker',
        'assetType',
        'quantity',
        'costBasis',
        'custodianId',
        'walletId',
      ];
      const rows = (items as Record<string, unknown>[]).map((h) =>
        headers.map((k) => String(h[k] ?? '')),
      );
      downloadCsv('investments.csv', toCsvString(headers, rows));
      break;
    }
    case 'scheduled-transactions': {
      const now = new Date();
      const periodStart = `${now.getFullYear() - 10}-01-01`;
      const periodEnd = `${now.getFullYear() + 1}-12-31`;
      const data = await api.scheduledTransactions.list({ periodStart, periodEnd });
      const items = Array.isArray(data) ? data : ((data as { items?: unknown[] }).items ?? []);
      if (!Array.isArray(items) || items.length === 0) return;
      const headers = ['id', 'name', 'amount', 'date', 'status', 'sourceType', 'sourceId'];
      const rows = (items as Record<string, unknown>[]).map((s) =>
        headers.map((h) => String(s[h] ?? '')),
      );
      downloadCsv('scheduled-transactions.csv', toCsvString(headers, rows));
      break;
    }
    case 'pay-schedules': {
      const data = await api.paySchedules.list();
      const items = Array.isArray(data)
        ? data
        : ((data as { schedules?: unknown[] }).schedules ?? []);
      if (!Array.isArray(items) || items.length === 0) return;
      const headers = ['id', 'name', 'frequency', 'startDate'];
      const rows = (items as Record<string, unknown>[]).map((p) =>
        headers.map((h) => String(p[h] ?? '')),
      );
      downloadCsv('pay-schedules.csv', toCsvString(headers, rows));
      break;
    }
  }
}
