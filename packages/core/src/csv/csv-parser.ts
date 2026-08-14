import type { CSVColumnName } from './csv-columns.js';
import { unescapeFormulaGuard } from './csv-escape.js';

export interface ParsedTransaction {
  type: string;
  name: string;
  amount: number;
  date: string;
  rawAccount: string;
  rawToAccount?: string;
  rawCategory?: string;
  note?: string;
  tradeMetadata?: {
    direction: string;
    assetType: string;
    ticker?: string;
    rawCustodian?: string;
    rawWallet?: string;
    unitPrice: number;
    quantity: number;
    bitcoinUnit?: string;
  };
  bitcoinMetadata?: {
    rawWallet: string;
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
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  errors: Array<{ row: number; field: string; message: string }>;
  warnings: Array<{ row: number; message: string }>;
}

const VALID_TYPES = new Set(['EXPENSE', 'INCOME', 'TRANSFER', 'REFUND', 'TRADE']);

const REQUIRED_TRADE_COLUMNS: CSVColumnName[] = [
  'trade_direction',
  'trade_asset_type',
  'trade_unit_price',
  'trade_quantity',
];

const BITCOIN_META_COLUMNS: CSVColumnName[] = [
  'bitcoin_wallet',
  'bitcoin_quantity',
  'bitcoin_unit',
  'bitcoin_unit_price',
];

/** Read a cell value from a row using the column mapping */
function getCell(
  row: Record<string, string | number | null>,
  mapping: Partial<Record<CSVColumnName, string>>,
  col: CSVColumnName,
): string {
  const header = mapping[col];
  if (header === undefined) return '';
  const val = row[header];
  if (val === undefined || val === null) return '';
  // Strip our export's formula-injection guard so a round-trip is lossless.
  return unescapeFormulaGuard(String(val).trim());
}

/** Try to parse a string as a finite number, return undefined on failure */
function parseNum(val: string): number | undefined {
  if (val === '') return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parses CSV row data into structured transactions.
 * - Validates required fields per type (e.g., TRADE needs trade metadata)
 * - Sorts parents before children based on parent_id
 * - Reports errors for invalid rows without stopping the entire import
 */
export function parseCSVRows(
  rows: Record<string, string | number | null>[],
  columnMapping: Partial<Record<CSVColumnName, string>>,
): ParseResult {
  const errors: ParseResult['errors'] = [];
  const warnings: ParseResult['warnings'] = [];
  const parsed: Array<{ tx: ParsedTransaction; rowIndex: number }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 1; // 1-based for user-facing errors

    const name = getCell(row, columnMapping, 'name');
    const amountStr = getCell(row, columnMapping, 'amount');
    const date = getCell(row, columnMapping, 'date');

    // Validate required base fields
    if (!name) {
      errors.push({ row: rowNum, field: 'name', message: 'Missing required field: name' });
      continue;
    }
    if (!amountStr) {
      errors.push({ row: rowNum, field: 'amount', message: 'Missing required field: amount' });
      continue;
    }
    if (!date) {
      errors.push({ row: rowNum, field: 'date', message: 'Missing required field: date' });
      continue;
    }

    const amount = parseNum(amountStr);
    if (amount === undefined) {
      errors.push({ row: rowNum, field: 'amount', message: `Invalid amount: ${amountStr}` });
      continue;
    }

    // Type handling: default to EXPENSE with warning if unknown
    let type = getCell(row, columnMapping, 'type').toUpperCase() || 'EXPENSE';
    if (!VALID_TYPES.has(type)) {
      // Fuzzy match common variations
      if (type.includes('TRANSFER')) {
        type = 'TRANSFER';
      } else if (type.includes('REFUND') || type.includes('RETURN') || type.includes('CREDIT')) {
        type = 'REFUND';
      } else if (
        type.includes('INCOME') ||
        type.includes('DEPOSIT') ||
        type.includes('PAYMENT RECEIVED')
      ) {
        type = 'INCOME';
      } else if (type.includes('TRADE') || type.includes('BUY') || type.includes('SELL')) {
        type = 'TRADE';
      } else {
        warnings.push({ row: rowNum, message: `Unknown type "${type}", defaulting to EXPENSE` });
        type = 'EXPENSE';
      }
    }

    const rawAccount = getCell(row, columnMapping, 'account');
    const rawToAccount = getCell(row, columnMapping, 'to_account') || undefined;
    const rawCategory = getCell(row, columnMapping, 'category') || undefined;
    const note = getCell(row, columnMapping, 'note') || undefined;

    // --- TRADE metadata ---
    let tradeMetadata: ParsedTransaction['tradeMetadata'] | undefined;
    if (type === 'TRADE') {
      const missing = REQUIRED_TRADE_COLUMNS.filter((col) => !getCell(row, columnMapping, col));
      if (missing.length > 0) {
        errors.push({
          row: rowNum,
          field: 'trade_metadata',
          message: `TRADE row missing required trade metadata: ${missing.join(', ')}`,
        });
        continue; // skip entire row
      }

      const direction = getCell(row, columnMapping, 'trade_direction');
      const assetType = getCell(row, columnMapping, 'trade_asset_type');
      const unitPrice = parseNum(getCell(row, columnMapping, 'trade_unit_price'));
      const quantity = parseNum(getCell(row, columnMapping, 'trade_quantity'));

      if (unitPrice === undefined || quantity === undefined) {
        errors.push({
          row: rowNum,
          field: 'trade_metadata',
          message: 'TRADE row has invalid numeric values for unit_price or quantity',
        });
        continue;
      }

      tradeMetadata = { direction, assetType, unitPrice, quantity };

      // Stock variant fields
      const ticker = getCell(row, columnMapping, 'trade_ticker') || undefined;
      const rawCustodian = getCell(row, columnMapping, 'trade_custodian') || undefined;
      if (ticker) tradeMetadata.ticker = ticker;
      if (rawCustodian) tradeMetadata.rawCustodian = rawCustodian;

      // Bitcoin variant fields
      const rawWallet = getCell(row, columnMapping, 'trade_wallet') || undefined;
      const bitcoinUnit = getCell(row, columnMapping, 'trade_bitcoin_unit') || undefined;
      if (rawWallet) tradeMetadata.rawWallet = rawWallet;
      if (bitcoinUnit) tradeMetadata.bitcoinUnit = bitcoinUnit;
    }

    // --- Bitcoin payment metadata (all-or-nothing) ---
    let bitcoinMetadata: ParsedTransaction['bitcoinMetadata'] | undefined;
    const btcValues = BITCOIN_META_COLUMNS.map((col) => getCell(row, columnMapping, col));
    const btcPopulated = btcValues.filter((v) => v !== '');

    if (btcPopulated.length > 0 && btcPopulated.length < BITCOIN_META_COLUMNS.length) {
      errors.push({
        row: rowNum,
        field: 'bitcoin_metadata',
        message:
          'Partial bitcoin metadata — all four columns (bitcoin_wallet, bitcoin_quantity, bitcoin_unit, bitcoin_unit_price) must be provided or none',
      });
    } else if (btcPopulated.length === BITCOIN_META_COLUMNS.length) {
      const btcQuantity = parseNum(btcValues[1]!);
      const btcUnitPrice = parseNum(btcValues[3]!);
      if (btcQuantity === undefined || btcUnitPrice === undefined) {
        warnings.push({
          row: rowNum,
          message: 'Invalid numeric value in bitcoin metadata, skipping bitcoin metadata',
        });
      } else {
        bitcoinMetadata = {
          rawWallet: btcValues[0]!,
          quantity: btcQuantity,
          bitcoinUnit: btcValues[2]!,
          unitPrice: btcUnitPrice,
        };
      }
    }

    // --- Split fields ---
    const parentId = getCell(row, columnMapping, 'parent_id') || undefined;
    const preTaxAmount = parseNum(getCell(row, columnMapping, 'pre_tax_amount'));
    const taxAmount = parseNum(getCell(row, columnMapping, 'tax_amount'));
    const taxRate = parseNum(getCell(row, columnMapping, 'tax_rate'));

    // --- Linkage fields ---
    const expenseId = getCell(row, columnMapping, 'expense_id') || undefined;
    const incomeId = getCell(row, columnMapping, 'income_id') || undefined;
    const payPeriodId = getCell(row, columnMapping, 'pay_period_id') || undefined;
    const occurrenceDate = getCell(row, columnMapping, 'occurrence_date') || undefined;

    const tx: ParsedTransaction = {
      type,
      name,
      amount,
      date,
      rawAccount,
    };

    if (rawToAccount) tx.rawToAccount = rawToAccount;
    if (rawCategory) tx.rawCategory = rawCategory;
    if (note) tx.note = note;
    if (tradeMetadata) tx.tradeMetadata = tradeMetadata;
    if (bitcoinMetadata) tx.bitcoinMetadata = bitcoinMetadata;
    if (parentId) tx.parentId = parentId;
    if (preTaxAmount !== undefined) tx.preTaxAmount = preTaxAmount;
    if (taxAmount !== undefined) tx.taxAmount = taxAmount;
    if (taxRate !== undefined) tx.taxRate = taxRate;
    if (expenseId) tx.expenseId = expenseId;
    if (incomeId) tx.incomeId = incomeId;
    if (payPeriodId) tx.payPeriodId = payPeriodId;
    if (occurrenceDate) tx.occurrenceDate = occurrenceDate;

    parsed.push({ tx, rowIndex: rowNum });
  }

  // --- Sort: parents before children, detect orphans ---
  // Group children by parent_id
  const childGroups = new Map<string, Array<{ tx: ParsedTransaction; rowIndex: number }>>();
  for (const entry of parsed) {
    if (entry.tx.parentId) {
      const group = childGroups.get(entry.tx.parentId) ?? [];
      group.push(entry);
      childGroups.set(entry.tx.parentId, group);
    }
  }

  // For each child group, find the nearest preceding non-child row as its parent.
  const assignedParentIdx = new Map<string, number>();
  const usedAsParent = new Set<number>(); // indices into `parsed`

  for (const [pid] of childGroups) {
    const children = childGroups.get(pid)!;
    const firstChildPos = parsed.indexOf(children[0]!);

    // Walk backward from the first child to find the nearest non-child row
    // that hasn't already been assigned as a parent
    let found = false;
    for (let j = firstChildPos - 1; j >= 0; j--) {
      if (!parsed[j]!.tx.parentId && !usedAsParent.has(j)) {
        assignedParentIdx.set(pid, j);
        usedAsParent.add(j);
        found = true;
        break;
      }
    }

    if (!found) {
      for (const child of children) {
        errors.push({
          row: child.rowIndex,
          field: 'parent_id',
          message: `Orphan child: parent_id "${pid}" not found in batch`,
        });
      }
    }
  }

  // Build final output: iterate parsed in order, emit parents with children,
  // skip child rows (they're emitted after their parent)
  const transactions: ParsedTransaction[] = [];
  const emittedChildren = new Set<string>();

  for (let k = 0; k < parsed.length; k++) {
    const entry = parsed[k]!;

    if (entry.tx.parentId) {
      // Child row — skip here, emitted after parent
      continue;
    }

    // Non-child row
    transactions.push(entry.tx);

    // If this row is a parent, emit its children immediately after
    if (usedAsParent.has(k)) {
      for (const [pid, parentIdx] of assignedParentIdx) {
        if (parentIdx === k && !emittedChildren.has(pid)) {
          emittedChildren.add(pid);
          const children = childGroups.get(pid)!;
          for (const child of children) {
            transactions.push(child.tx);
          }
        }
      }
    }
  }

  return { transactions, errors, warnings };
}
