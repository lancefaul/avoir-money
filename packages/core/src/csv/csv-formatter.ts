import { CSV_COLUMNS } from './csv-columns.js';
import { escapeCsvCell } from './csv-escape.js';

export interface ExportableTransaction {
  id: string;
  type: string;
  name: string;
  amount: number;
  date: string;
  accountName: string;
  toAccountName?: string;
  categoryName?: string;
  note?: string;
  tradeMetadata?: {
    direction: string;
    assetType: string;
    ticker?: string;
    custodianName?: string;
    walletName?: string;
    unitPrice: number;
    quantity: number;
    bitcoinUnit?: string;
  };
  bitcoinMetadata?: {
    walletName: string;
    quantity: number;
    bitcoinUnit: string;
    unitPrice: number;
  };
  parentId?: string;
  preTaxAmount?: number;
  taxAmount?: number;
  taxRate?: number;
  expenseId?: string;
  incomeId?: string;
  payPeriodId?: string;
  occurrenceDate?: string;
  children?: ExportableTransaction[];
}

/** Convert a value to a CSV cell string (escaping + formula-injection guard in escapeCsvCell) */
function toCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') return value.toString();
  return escapeCsvCell(value);
}

/** Build a CSV row array from a single transaction */
function transactionToRow(tx: ExportableTransaction): string[] {
  const trade = tx.tradeMetadata;
  const btc = tx.bitcoinMetadata;
  const isTrade = tx.type === 'TRADE';

  return [
    // Base fields
    toCell(tx.date),
    toCell(tx.name),
    toCell(tx.amount),
    toCell(tx.type),
    toCell(tx.accountName),
    toCell(tx.toAccountName),
    toCell(tx.categoryName),
    toCell(tx.note),
    // Trade metadata — only for TRADE rows
    toCell(isTrade ? trade?.direction : undefined),
    toCell(isTrade ? trade?.assetType : undefined),
    toCell(isTrade ? trade?.ticker : undefined),
    toCell(isTrade ? trade?.custodianName : undefined),
    toCell(isTrade ? trade?.walletName : undefined),
    toCell(isTrade ? trade?.unitPrice : undefined),
    toCell(isTrade ? trade?.quantity : undefined),
    toCell(isTrade ? trade?.bitcoinUnit : undefined),
    // Bitcoin payment metadata — only when present
    toCell(btc?.walletName),
    toCell(btc?.quantity),
    toCell(btc?.bitcoinUnit),
    toCell(btc?.unitPrice),
    // Split fields
    toCell(tx.parentId),
    toCell(tx.preTaxAmount),
    toCell(tx.taxAmount),
    toCell(tx.taxRate),
    // Linkage fields
    toCell(tx.expenseId),
    toCell(tx.incomeId),
    toCell(tx.payPeriodId),
    toCell(tx.occurrenceDate),
  ];
}

/**
 * Formats transactions into a CSV string.
 * - Header row uses CSV_COLUMNS
 * - Parents are emitted before their children
 * - Numeric fields use full decimal precision
 * - String fields with commas/quotes are properly escaped
 */
export function formatTransactionsToCSV(transactions: ExportableTransaction[]): string {
  const rows: string[][] = [];

  // Header row
  rows.push([...CSV_COLUMNS]);

  // Emit each transaction, with children immediately after parent
  for (const tx of transactions) {
    rows.push(transactionToRow(tx));
    if (tx.children) {
      for (const child of tx.children) {
        rows.push(transactionToRow(child));
      }
    }
  }

  return rows.map((row) => row.join(',')).join('\n');
}
