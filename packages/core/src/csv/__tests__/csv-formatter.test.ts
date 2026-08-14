import { describe, it, expect } from 'vitest';
import { formatTransactionsToCSV, ExportableTransaction } from '../csv-formatter.js';
import { CSV_COLUMNS } from '../csv-columns.js';

/** Helper: parse CSV output into header + data rows */
function parseCSV(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.split('\n');
  return {
    header: lines[0].split(','),
    rows: lines.slice(1).map((line) => line.split(',')),
  };
}

/** Helper: get a cell value by column name from a parsed row */
function cell(row: string[], colName: (typeof CSV_COLUMNS)[number]): string {
  const idx = CSV_COLUMNS.indexOf(colName);
  return row[idx] ?? '';
}

describe('csv-formatter', () => {
  // Validates: Requirements 1.1, 1.2, 1.3

  describe('exports all 5 transaction types', () => {
    const transactions: ExportableTransaction[] = [
      {
        id: 'tx-expense',
        type: 'EXPENSE',
        name: 'Groceries',
        amount: 52.3,
        date: '2026-01-15',
        accountName: 'Checking',
      },
      {
        id: 'tx-income',
        type: 'INCOME',
        name: 'Salary',
        amount: 3000,
        date: '2026-01-15',
        accountName: 'Checking',
      },
      {
        id: 'tx-transfer',
        type: 'TRANSFER',
        name: 'Savings Move',
        amount: 500,
        date: '2026-01-15',
        accountName: 'Checking',
        toAccountName: 'Savings',
      },
      {
        id: 'tx-refund',
        type: 'REFUND',
        name: 'Amazon Return',
        amount: 29.99,
        date: '2026-01-15',
        accountName: 'Credit Card',
      },
      {
        id: 'tx-trade',
        type: 'TRADE',
        name: 'Buy AAPL',
        amount: 1750,
        date: '2026-01-15',
        accountName: 'Brokerage',
        tradeMetadata: {
          direction: 'BUY',
          assetType: 'Stock',
          ticker: 'AAPL',
          custodianName: 'Fidelity',
          unitPrice: 175,
          quantity: 10,
        },
      },
    ];

    it('includes all 5 types in the output', () => {
      const csv = formatTransactionsToCSV(transactions);
      const { rows } = parseCSV(csv);

      expect(rows).toHaveLength(5);
      const types = rows.map((r) => cell(r, 'type'));
      expect(types).toEqual(['EXPENSE', 'INCOME', 'TRANSFER', 'REFUND', 'TRADE']);
    });

    it('header row contains all 28 CSV columns', () => {
      const csv = formatTransactionsToCSV(transactions);
      const { header } = parseCSV(csv);

      expect(header).toEqual([...CSV_COLUMNS]);
      expect(header).toHaveLength(28);
    });
  });

  // Validates: Requirements 2.1, 2.2, 2.3
  describe('Stock trade export with known values', () => {
    const stockTrade: ExportableTransaction = {
      id: 'trade-stock-1',
      type: 'TRADE',
      name: 'Buy AAPL',
      amount: 1750,
      date: '2026-01-15',
      accountName: 'Brokerage',
      categoryName: 'Investments',
      note: 'Q1 purchase',
      tradeMetadata: {
        direction: 'BUY',
        assetType: 'Stock',
        ticker: 'AAPL',
        custodianName: 'Fidelity',
        unitPrice: 175,
        quantity: 10,
      },
    };

    it('populates all stock trade metadata columns', () => {
      const csv = formatTransactionsToCSV([stockTrade]);
      const { rows } = parseCSV(csv);
      const row = rows[0];

      expect(cell(row, 'date')).toBe('2026-01-15');
      expect(cell(row, 'name')).toBe('Buy AAPL');
      expect(cell(row, 'amount')).toBe('1750');
      expect(cell(row, 'type')).toBe('TRADE');
      expect(cell(row, 'account')).toBe('Brokerage');
      expect(cell(row, 'category')).toBe('Investments');
      expect(cell(row, 'note')).toBe('Q1 purchase');
      expect(cell(row, 'trade_direction')).toBe('BUY');
      expect(cell(row, 'trade_asset_type')).toBe('Stock');
      expect(cell(row, 'trade_ticker')).toBe('AAPL');
      expect(cell(row, 'trade_custodian')).toBe('Fidelity');
      expect(cell(row, 'trade_unit_price')).toBe('175');
      expect(cell(row, 'trade_quantity')).toBe('10');
      // Bitcoin-specific trade fields should be empty for Stock
      expect(cell(row, 'trade_wallet')).toBe('');
      expect(cell(row, 'trade_bitcoin_unit')).toBe('');
    });

    it('leaves bitcoin payment columns empty for stock trade', () => {
      const csv = formatTransactionsToCSV([stockTrade]);
      const { rows } = parseCSV(csv);
      const row = rows[0];

      expect(cell(row, 'bitcoin_wallet')).toBe('');
      expect(cell(row, 'bitcoin_quantity')).toBe('');
      expect(cell(row, 'bitcoin_unit')).toBe('');
      expect(cell(row, 'bitcoin_unit_price')).toBe('');
    });
  });

  // Validates: Requirements 2.1, 2.3
  describe('Bitcoin trade export with known values', () => {
    const btcTrade: ExportableTransaction = {
      id: 'trade-btc-1',
      type: 'TRADE',
      name: 'Buy Bitcoin',
      amount: 5000,
      date: '2026-01-15',
      accountName: 'Crypto Account',
      tradeMetadata: {
        direction: 'BUY',
        assetType: 'Bitcoin',
        walletName: 'Cold Storage',
        unitPrice: 50000,
        quantity: 0.1,
        bitcoinUnit: 'Bitcoin',
      },
    };

    it('populates all bitcoin trade metadata columns', () => {
      const csv = formatTransactionsToCSV([btcTrade]);
      const { rows } = parseCSV(csv);
      const row = rows[0];

      expect(cell(row, 'date')).toBe('2026-01-15');
      expect(cell(row, 'name')).toBe('Buy Bitcoin');
      expect(cell(row, 'amount')).toBe('5000');
      expect(cell(row, 'type')).toBe('TRADE');
      expect(cell(row, 'account')).toBe('Crypto Account');
      expect(cell(row, 'trade_direction')).toBe('BUY');
      expect(cell(row, 'trade_asset_type')).toBe('Bitcoin');
      expect(cell(row, 'trade_wallet')).toBe('Cold Storage');
      expect(cell(row, 'trade_unit_price')).toBe('50000');
      expect(cell(row, 'trade_quantity')).toBe('0.1');
      expect(cell(row, 'trade_bitcoin_unit')).toBe('Bitcoin');
      // Stock-specific trade fields should be empty for Bitcoin
      expect(cell(row, 'trade_ticker')).toBe('');
      expect(cell(row, 'trade_custodian')).toBe('');
    });
  });

  // Validates: Requirements 4.1, 4.2, 4.3, 4.4
  describe('split transaction export (parent + 2 children)', () => {
    const parentId = 'parent-split-1';
    const splitTransaction: ExportableTransaction = {
      id: parentId,
      type: 'EXPENSE',
      name: 'Restaurant Bill',
      amount: 100,
      date: '2026-01-15',
      accountName: 'Credit Card',
      categoryName: 'Dining',
      children: [
        {
          id: 'child-1',
          type: 'EXPENSE',
          name: 'Food',
          amount: 80,
          date: '2026-01-15',
          accountName: 'Credit Card',
          categoryName: 'Dining',
          parentId,
          preTaxAmount: 72.73,
          taxAmount: 7.27,
          taxRate: 10,
        },
        {
          id: 'child-2',
          type: 'EXPENSE',
          name: 'Drinks',
          amount: 20,
          date: '2026-01-15',
          accountName: 'Credit Card',
          categoryName: 'Alcohol',
          parentId,
          preTaxAmount: 18.18,
          taxAmount: 1.82,
          taxRate: 10,
        },
      ],
    };

    it('emits parent row followed by child rows in order', () => {
      const csv = formatTransactionsToCSV([splitTransaction]);
      const { rows } = parseCSV(csv);

      expect(rows).toHaveLength(3);

      // Row 0: parent
      expect(cell(rows[0], 'name')).toBe('Restaurant Bill');
      expect(cell(rows[0], 'amount')).toBe('100');
      expect(cell(rows[0], 'parent_id')).toBe('');

      // Row 1: first child
      expect(cell(rows[1], 'name')).toBe('Food');
      expect(cell(rows[1], 'amount')).toBe('80');
      expect(cell(rows[1], 'parent_id')).toBe(parentId);
      expect(cell(rows[1], 'pre_tax_amount')).toBe('72.73');
      expect(cell(rows[1], 'tax_amount')).toBe('7.27');
      expect(cell(rows[1], 'tax_rate')).toBe('10');

      // Row 2: second child
      expect(cell(rows[2], 'name')).toBe('Drinks');
      expect(cell(rows[2], 'amount')).toBe('20');
      expect(cell(rows[2], 'parent_id')).toBe(parentId);
      expect(cell(rows[2], 'pre_tax_amount')).toBe('18.18');
      expect(cell(rows[2], 'tax_amount')).toBe('1.82');
      expect(cell(rows[2], 'tax_rate')).toBe('10');
    });
  });

  // Validates: Requirements 1.3
  describe('REFUND type exports correctly', () => {
    const refund: ExportableTransaction = {
      id: 'tx-refund-1',
      type: 'REFUND',
      name: 'Store Refund',
      amount: 45.5,
      date: '2026-01-15',
      accountName: 'Checking',
      categoryName: 'Shopping',
      note: 'Returned item',
      expenseId: 'exp-123',
      occurrenceDate: '2026-01-10',
    };

    it('exports REFUND type with correct field values', () => {
      const csv = formatTransactionsToCSV([refund]);
      const { rows } = parseCSV(csv);
      const row = rows[0];

      expect(cell(row, 'type')).toBe('REFUND');
      expect(cell(row, 'name')).toBe('Store Refund');
      expect(cell(row, 'amount')).toBe('45.5');
      expect(cell(row, 'date')).toBe('2026-01-15');
      expect(cell(row, 'account')).toBe('Checking');
      expect(cell(row, 'category')).toBe('Shopping');
      expect(cell(row, 'note')).toBe('Returned item');
      expect(cell(row, 'expense_id')).toBe('exp-123');
      expect(cell(row, 'occurrence_date')).toBe('2026-01-10');
    });

    it('leaves trade and bitcoin columns empty for REFUND', () => {
      const csv = formatTransactionsToCSV([refund]);
      const { rows } = parseCSV(csv);
      const row = rows[0];

      expect(cell(row, 'trade_direction')).toBe('');
      expect(cell(row, 'trade_asset_type')).toBe('');
      expect(cell(row, 'trade_ticker')).toBe('');
      expect(cell(row, 'trade_custodian')).toBe('');
      expect(cell(row, 'trade_wallet')).toBe('');
      expect(cell(row, 'trade_unit_price')).toBe('');
      expect(cell(row, 'trade_quantity')).toBe('');
      expect(cell(row, 'trade_bitcoin_unit')).toBe('');
      expect(cell(row, 'bitcoin_wallet')).toBe('');
      expect(cell(row, 'bitcoin_quantity')).toBe('');
      expect(cell(row, 'bitcoin_unit')).toBe('');
      expect(cell(row, 'bitcoin_unit_price')).toBe('');
    });
  });
});
