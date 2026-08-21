/**
 * Pure functions for normalizing, formatting, and merging investment history entries.
 * No database access — all functions take already-fetched data as input.
 */
import type { HistoryEntry } from '@budget-tracker/core';

// ─── Input Types ───

/** Trade metadata stored as JSON on Transaction.tradeMetadata */
export interface TradeMetadata {
  direction: 'BUY' | 'SELL';
  assetType: 'Stock' | 'Bitcoin';
  ticker?: string | null;
  quantity: number;
  unitPrice: number;
  bitcoinUnit?: 'Bitcoin' | 'Sats';
}

/** A Transaction row with the fields needed for trade normalization. */
interface TradeTransaction {
  id: string;
  date: Date;
  amount: number | { toNumber(): number };
  tradeMetadata: TradeMetadata;
  costBasisAllocated?: number | { toNumber(): number } | null;
  accountName?: string | null;
}

/** An InvestmentTransfer row with resolved wallet/custodian names. */
export interface TransferWithNames {
  id: string;
  type: string; // "BITCOIN" or "STOCK"
  createdAt: Date;
  quantity: number | { toNumber(): number };
  ticker: string | null;
  feeAmount: number | { toNumber(): number } | null;
  feeBtc: number | { toNumber(): number } | null;
  fromName: string;
  toName: string;
}

/** Bitcoin payment metadata stored as JSON on Transaction.bitcoinMetadata */
export interface BitcoinPaymentMeta {
  walletId: string;
  quantity: number;
  bitcoinUnit: 'Bitcoin' | 'Sats';
  unitPrice: number;
  incomeType?: 'Payment' | 'Rewards';
}

/** A Transaction row with the fields needed for bitcoin payment normalization. */
interface BitcoinPaymentTransaction {
  id: string;
  type: string; // EXPENSE, INCOME, REFUND
  date: Date;
  name: string;
  amount: number | { toNumber(): number };
  bitcoinMetadata: BitcoinPaymentMeta;
  walletName: string;
}

// ─── Helpers ───

/** Safely convert a Prisma Decimal or plain number to a JS number. */
function toNum(val: number | { toNumber(): number } | null | undefined): number {
  if (val == null) return 0;
  return typeof val === 'number' ? val : val.toNumber();
}

// ─── Description Formatters ───

/**
 * Format a trade description.
 * Returns "Bought BTC on {account}" or "Sold BTC on {account}".
 * Falls back to "Bought BTC" / "Sold BTC" if no account.
 */
function formatTradeDescription(
  direction: 'BUY' | 'SELL',
  _quantity: number,
  ticker: string | null | undefined,
  _unitPrice: number,
  accountName?: string | null,
): string {
  const verb = direction === 'BUY' ? 'Bought' : 'Sold';
  const symbol = ticker || 'BTC';
  if (accountName) {
    return `${verb} ${symbol} on ${accountName}`;
  }
  return `${verb} ${symbol}`;
}

/**
 * Format a transfer description.
 * BITCOIN: "{fromName} → {toName}"
 * STOCK:   "{ticker}: {fromName} → {toName}"
 */
function formatTransferDescription(
  assetType: 'STOCK' | 'BITCOIN',
  ticker: string | null | undefined,
  fromName: string,
  toName: string,
): string {
  if (assetType === 'BITCOIN') {
    return `${fromName} → ${toName}`;
  }
  return `${ticker}: ${fromName} → ${toName}`;
}

/**
 * Format a bitcoin payment description.
 * For Rewards INCOME: "Earned BTC rewards on {walletName}"
 * For Payment INCOME: "Received BTC on {walletName}"
 * For EXPENSE/REFUND: "Spent BTC on {walletName}"
 */
function formatPaymentDescription(
  txType: string,
  _quantity: number,
  _bitcoinUnit: 'Bitcoin' | 'Sats',
  walletName: string,
  incomeType?: 'Payment' | 'Rewards',
): string {
  if (txType === 'INCOME' && incomeType === 'Rewards') {
    return `Earned BTC rewards on ${walletName}`;
  }
  if (txType === 'INCOME') {
    return `Received BTC on ${walletName}`;
  }
  return `Spent BTC on ${walletName}`;
}

// ─── Normalization Functions ───

/**
 * Normalize a trade Transaction row to a HistoryEntry.
 * Uses formatTradeDescription for the description field.
 */
/**
 * Map a persisted TradeDetail row to the normalizer's TradeMetadata shape.
 * The enum columns are stored as strings (matching the Transaction.type convention);
 * they are narrowed here at the read boundary, and Decimals are converted to numbers.
 */
export function tradeMetadataFromDetail(d: {
  direction: string;
  assetType: string;
  ticker: string | null;
  quantity: number | { toNumber(): number };
  unitPrice: number | { toNumber(): number };
  bitcoinUnit: string | null;
}): TradeMetadata {
  return {
    direction: d.direction as TradeMetadata['direction'],
    assetType: d.assetType as TradeMetadata['assetType'],
    ticker: d.ticker,
    quantity: toNum(d.quantity),
    unitPrice: toNum(d.unitPrice),
    bitcoinUnit: (d.bitcoinUnit ?? undefined) as TradeMetadata['bitcoinUnit'],
  };
}

/** Map a persisted BitcoinPaymentDetail row to the normalizer's BitcoinPaymentMeta shape. */
export function bitcoinPaymentMetaFromDetail(d: {
  walletId: string;
  quantity: number | { toNumber(): number };
  unitPrice: number | { toNumber(): number };
  bitcoinUnit: string;
  incomeType: string | null;
}): BitcoinPaymentMeta {
  return {
    walletId: d.walletId,
    quantity: toNum(d.quantity),
    unitPrice: toNum(d.unitPrice),
    bitcoinUnit: d.bitcoinUnit as BitcoinPaymentMeta['bitcoinUnit'],
    incomeType: (d.incomeType ?? undefined) as BitcoinPaymentMeta['incomeType'],
  };
}

export function normalizeTradeEntry(tx: TradeTransaction): HistoryEntry {
  const meta = tx.tradeMetadata;
  const assetType = meta.assetType === 'Stock' ? 'STOCK' : 'BITCOIN';
  const ticker = meta.assetType === 'Stock' ? (meta.ticker ?? null) : null;

  // Normalize Bitcoin quantity to BTC (frontend always expects BTC for display)
  const quantity =
    assetType === 'BITCOIN' && meta.bitcoinUnit === 'Sats'
      ? meta.quantity / 100_000_000
      : meta.quantity;

  return {
    id: tx.id,
    entryType: 'TRADE',
    date: tx.date,
    description: formatTradeDescription(
      meta.direction,
      meta.quantity,
      ticker,
      meta.unitPrice,
      tx.accountName,
    ),
    assetType,
    ticker,
    quantity,
    direction: meta.direction,
    fromName: null,
    toName: null,
    custodianName: tx.accountName ?? null,
    amount: toNum(tx.amount),
    costBasisAllocated: tx.costBasisAllocated != null ? toNum(tx.costBasisAllocated) : null,
    feeAmount: null,
  };
}

/**
 * Normalize an InvestmentTransfer row (with resolved names) to a HistoryEntry.
 */
export function normalizeTransferEntry(transfer: TransferWithNames): HistoryEntry {
  const assetType = transfer.type === 'BITCOIN' ? 'BITCOIN' : 'STOCK';
  const feeAmount =
    assetType === 'BITCOIN'
      ? transfer.feeBtc != null
        ? toNum(transfer.feeBtc)
        : null
      : transfer.feeAmount != null
        ? toNum(transfer.feeAmount)
        : null;

  return {
    id: transfer.id,
    entryType: 'TRANSFER',
    date: transfer.createdAt,
    description: formatTransferDescription(
      assetType,
      transfer.ticker,
      transfer.fromName,
      transfer.toName,
    ),
    assetType,
    ticker: transfer.ticker,
    quantity: toNum(transfer.quantity),
    direction: null,
    fromName: transfer.fromName,
    toName: transfer.toName,
    custodianName: null,
    amount: null,
    feeAmount,
  };
}

/**
 * Normalize a bitcoin payment Transaction row to a HistoryEntry.
 * Covers EXPENSE, INCOME, and REFUND transactions paid via bitcoin.
 */
export function normalizePaymentEntry(tx: BitcoinPaymentTransaction): HistoryEntry {
  const meta = tx.bitcoinMetadata;
  const quantity = meta.bitcoinUnit === 'Sats' ? meta.quantity / 100_000_000 : meta.quantity;

  return {
    id: tx.id,
    entryType: 'PAYMENT',
    date: tx.date,
    description: formatPaymentDescription(
      tx.type,
      meta.quantity,
      meta.bitcoinUnit,
      tx.walletName,
      meta.incomeType,
    ),
    assetType: 'BITCOIN',
    ticker: null,
    quantity,
    direction: null,
    fromName: null,
    toName: null,
    custodianName: tx.walletName,
    amount: toNum(tx.amount),
    feeAmount: null,
    incomeType: meta.incomeType ?? null,
  };
}

// ─── Cursor Encoding/Decoding ───

interface CursorData {
  date: string;
  id: string;
  source: 'trade' | 'transfer' | 'payment';
}

/**
 * Encode a cursor as a base64 JSON string.
 */
function encodeCursor(
  date: Date | string,
  id: string,
  source: 'trade' | 'transfer' | 'payment',
): string {
  const dateStr = typeof date === 'string' ? date : date.toISOString();
  const payload: CursorData = { date: dateStr, id, source };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Decode a base64-encoded cursor string.
 * Throws if the cursor is malformed or missing required fields.
 */
export function decodeCursor(cursor: string): CursorData {
  try {
    const json = Buffer.from(cursor, 'base64').toString('utf-8');
    const parsed = JSON.parse(json);
    if (!parsed.date || !parsed.id || !parsed.source) {
      throw new Error('Missing cursor fields');
    }
    if (parsed.source !== 'trade' && parsed.source !== 'transfer' && parsed.source !== 'payment') {
      throw new Error('Invalid cursor source');
    }
    return parsed as CursorData;
  } catch {
    throw new Error('Invalid cursor');
  }
}

// ─── Merge and Sort ───

/**
 * Merge trade, transfer, and payment entries, sort by date descending, and apply cursor-based pagination.
 *
 * @param trades - Normalized trade entries
 * @param transfers - Normalized transfer entries
 * @param payments - Normalized bitcoin payment entries
 * @param limit - Maximum entries to return
 * @param cursor - Optional cursor string to resume from
 * @returns Paginated result with entries, nextCursor, and hasMore flag
 */
export function mergeAndSort(
  trades: HistoryEntry[],
  transfers: HistoryEntry[],
  limit: number,
  cursor?: string,
  payments: HistoryEntry[] = [],
): { entries: HistoryEntry[]; nextCursor: string | null; hasMore: boolean } {
  // Combine all entries
  let all = [...trades, ...transfers, ...payments];

  // Sort by date descending, then by id descending for stable ordering
  all.sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    if (dateB !== dateA) return dateB - dateA;
    return b.id.localeCompare(a.id);
  });

  // Apply cursor: skip entries up to and including the cursor position
  if (cursor) {
    const cursorData = decodeCursor(cursor);
    const cursorDate = new Date(cursorData.date).getTime();
    const cursorId = cursorData.id;

    const cursorIndex = all.findIndex((entry) => {
      const entryDate = new Date(entry.date).getTime();
      return entryDate === cursorDate && entry.id === cursorId;
    });

    if (cursorIndex !== -1) {
      all = all.slice(cursorIndex + 1);
    } else {
      // Cursor entry not found — fall back to date-based filtering
      all = all.filter((entry) => {
        const entryDate = new Date(entry.date).getTime();
        if (entryDate < cursorDate) return true;
        if (entryDate === cursorDate) return entry.id < cursorId;
        return false;
      });
    }
  }

  // Apply limit
  const hasMore = all.length > limit;
  const entries = all.slice(0, limit);

  // Build next cursor from the last entry in the page
  let nextCursor: string | null = null;
  if (hasMore && entries.length > 0) {
    const last = entries[entries.length - 1]!;
    const source =
      last.entryType === 'TRADE' ? 'trade' : last.entryType === 'TRANSFER' ? 'transfer' : 'payment';
    nextCursor = encodeCursor(last.date, last.id, source);
  }

  return { entries, nextCursor, hasMore };
}
