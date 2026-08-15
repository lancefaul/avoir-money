import type { DbClient } from './db-client.js';

export type LifecycleEvent = 'created' | 'updated' | 'deleted';

export interface TransactionRecord {
  id: string;
  type: string;
  name: string;
  amount: number | { toNumber(): number };
  netAmount?: number | { toNumber(): number };
  date: Date;
  createdAt: Date;
  occurrenceDate?: Date | null;
  accountId: string | null;
  toAccountId: string | null;
  expenseId: string | null;
  incomeId: string | null;
  budgetId: string | null;
  tradeDetail?: TradeDetailRecord | null;
  bitcoinPaymentDetail?: BitcoinPaymentDetailRecord | null;
  parentId?: string | null;
}

/** Typed TradeDetail row as loaded onto a TransactionRecord (Decimal-friendly). */
export interface TradeDetailRecord {
  direction: string;
  assetType: string;
  ticker: string | null;
  quantity: number | { toNumber(): number };
  unitPrice: number | { toNumber(): number };
  bitcoinUnit: string | null;
  custodianId: string | null;
  walletId: string | null;
}

/** Typed BitcoinPaymentDetail row as loaded onto a TransactionRecord. */
export interface BitcoinPaymentDetailRecord {
  walletId: string;
  quantity: number | { toNumber(): number };
  unitPrice: number | { toNumber(): number };
  bitcoinUnit: string;
  incomeType: string | null;
}

export interface HookContext {
  event?: LifecycleEvent;
  tx: TransactionRecord;
  oldTx?: TransactionRecord;
  _debtPayment?: unknown;
  /**
   * The client this hook must run its queries against — the interactive
   * transaction client when the gate was called inside one, else the global
   * `prisma`. A hook reads it as `ctx.db ?? prisma`; ignoring it drops the hook's
   * writes outside the surrounding transaction and breaks atomicity.
   */
  db?: DbClient;
}

export interface HookDefinition {
  name: string;
  events: LifecycleEvent[];
  priority?: number;
  condition?: (ctx: HookContext) => boolean;
  execute: (ctx: HookContext) => Promise<void>;
}
