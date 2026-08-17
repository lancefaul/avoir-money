export interface Transaction {
  id: string;
  type: string;
  name: string;
  amount: number;
  date: string | Date;
  netAmount: number;
  expenseId: string | null;
  incomeId: string | null;
  accountId: string | null;
  toAccountId: string | null;
  budgetId: string | null;
  note: string | null;
  tradeMetadata?: TradeMetadataJson | null;
  bitcoinMetadata?: { walletId?: string } | null;
  parentId: string | null;
  childCount: number;
  purchaseGroupId?: string | null;
}

export interface TradeMetadataJson {
  direction: 'BUY' | 'SELL';
  assetType: 'Bitcoin' | 'Stock';
  ticker?: string;
  unitPrice: number;
  quantity: number;
  custodianId?: string;
  walletId?: string;
  bitcoinUnit?: 'Bitcoin' | 'Sats';
}

export interface Expense {
  id: string;
  name: string;
  budgetId: string;
}
export interface Income {
  id: string;
  name: string;
}
export interface Account {
  id: string;
  name: string;
  type: string;
  balance?: number;
  archived?: boolean;
  hasRewards?: boolean;
  earnsInterest?: boolean;
  /** For a Rewards account, the card it belongs to (ADR-030). */
  parentAccountId?: string | null;
}
export interface Category {
  id: string;
  name: string;
  groupName?: string;
  groupColor?: string;
  icon: string | null;
}
export interface NamedEntity {
  id: string;
  name: string;
}

export interface StockHolding {
  id: string;
  name: string;
  ticker: string | null;
  type: string;
  custodianId: string | null;
  custodianName: string | null;
}
