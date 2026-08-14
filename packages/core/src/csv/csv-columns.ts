/** All supported CSV columns in canonical order */
export const CSV_COLUMNS = [
  // Base fields
  'date',
  'name',
  'amount',
  'type',
  'account',
  'to_account',
  'category',
  'note',
  // Trade metadata
  'trade_direction',
  'trade_asset_type',
  'trade_ticker',
  'trade_custodian',
  'trade_wallet',
  'trade_unit_price',
  'trade_quantity',
  'trade_bitcoin_unit',
  // Bitcoin payment metadata
  'bitcoin_wallet',
  'bitcoin_quantity',
  'bitcoin_unit',
  'bitcoin_unit_price',
  // Split fields
  'parent_id',
  'pre_tax_amount',
  'tax_amount',
  'tax_rate',
  // Linkage fields
  'expense_id',
  'income_id',
  'pay_period_id',
  'occurrence_date',
] as const;

export type CSVColumnName = (typeof CSV_COLUMNS)[number];

/**
 * Maps each CSV column name to an array of detection patterns.
 * The first element is always the exact canonical name.
 * Subsequent elements are partial-match patterns (matched case-insensitively
 * against substrings of the header).
 */
export const COLUMN_PATTERNS: Record<CSVColumnName, string[]> = {
  // Base fields
  date: ['date'],
  name: ['name', 'description', 'payee', 'merchant'],
  amount: ['amount', 'sum', 'total'],
  type: ['type', 'transaction type'],
  account: ['account', 'bank', 'source account'],
  to_account: ['to_account', 'to account', 'destination', 'target account'],
  category: ['category', 'group'],
  note: ['note', 'notes', 'memo', 'comment'],
  // Trade metadata
  trade_direction: ['trade_direction', 'trade direction', 'direction'],
  trade_asset_type: ['trade_asset_type', 'trade asset type', 'asset type'],
  trade_ticker: ['trade_ticker', 'trade ticker', 'ticker', 'symbol'],
  trade_custodian: ['trade_custodian', 'trade custodian', 'custodian', 'broker', 'brokerage'],
  trade_wallet: ['trade_wallet', 'trade wallet'],
  trade_unit_price: ['trade_unit_price', 'trade unit price', 'unit price', 'price per unit'],
  trade_quantity: ['trade_quantity', 'trade quantity', 'shares', 'units'],
  trade_bitcoin_unit: ['trade_bitcoin_unit', 'trade bitcoin unit'],
  // Bitcoin payment metadata
  bitcoin_wallet: ['bitcoin_wallet', 'bitcoin wallet', 'btc wallet'],
  bitcoin_quantity: ['bitcoin_quantity', 'bitcoin quantity', 'btc quantity', 'btc amount'],
  bitcoin_unit: ['bitcoin_unit', 'bitcoin unit', 'btc unit'],
  bitcoin_unit_price: ['bitcoin_unit_price', 'bitcoin unit price', 'btc price'],
  // Split fields
  parent_id: ['parent_id', 'parent id'],
  pre_tax_amount: ['pre_tax_amount', 'pre tax amount', 'pretax amount', 'pretax'],
  tax_amount: ['tax_amount', 'tax amount', 'tax'],
  tax_rate: ['tax_rate', 'tax rate'],
  // Linkage fields
  expense_id: ['expense_id', 'expense id'],
  income_id: ['income_id', 'income id'],
  pay_period_id: ['pay_period_id', 'pay period id', 'pay period'],
  occurrence_date: ['occurrence_date', 'occurrence date', 'occurrence'],
};

/**
 * Given a list of header strings, returns a mapping of CSVColumnName -> header string.
 * Uses exact match first (case-insensitive), then partial match.
 * Each header is mapped to at most one column, and each column to at most one header.
 */
export function autoMapColumns(headers: string[]): Partial<Record<CSVColumnName, string>> {
  const result: Partial<Record<CSVColumnName, string>> = {};
  const usedHeaders = new Set<string>();

  // Pass 1: exact matches (case-insensitive)
  for (const col of CSV_COLUMNS) {
    const patterns = COLUMN_PATTERNS[col];
    for (const header of headers) {
      if (usedHeaders.has(header)) continue;
      const normalizedHeader = header.toLowerCase().trim();
      if (patterns.some((p) => normalizedHeader === p.toLowerCase())) {
        result[col] = header;
        usedHeaders.add(header);
        break;
      }
    }
  }

  // Pass 2: partial matches for columns not yet mapped
  for (const col of CSV_COLUMNS) {
    if (result[col] !== undefined) continue;
    const patterns = COLUMN_PATTERNS[col];
    for (const header of headers) {
      if (usedHeaders.has(header)) continue;
      const normalizedHeader = header.toLowerCase().trim();
      if (patterns.some((p) => normalizedHeader.includes(p.toLowerCase()))) {
        result[col] = header;
        usedHeaders.add(header);
        break;
      }
    }
  }

  return result;
}
