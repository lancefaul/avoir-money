import type { QueryClient } from '@tanstack/react-query';

export const TRANSACTION_QUERY_KEYS = [
  'transactions',
  'investments',
  'investment-history',
  'accounts',
  'dashboard',
  'debts',
] as const;

export function invalidateTransactionCaches(qc: QueryClient): void {
  for (const key of TRANSACTION_QUERY_KEYS) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}
