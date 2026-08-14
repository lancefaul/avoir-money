import { describe, it, expect } from 'vitest';
import { parseCSVRows } from '../csv-parser.js';
import type { CSVColumnName } from '../csv-columns.js';

/** Full column mapping where header strings match column names exactly */
const FULL_MAPPING: Partial<Record<CSVColumnName, string>> = {
  date: 'date',
  name: 'name',
  amount: 'amount',
  type: 'type',
  account: 'account',
  to_account: 'to_account',
  category: 'category',
  note: 'note',
  trade_direction: 'trade_direction',
  trade_asset_type: 'trade_asset_type',
  trade_ticker: 'trade_ticker',
  trade_custodian: 'trade_custodian',
  trade_wallet: 'trade_wallet',
  trade_unit_price: 'trade_unit_price',
  trade_quantity: 'trade_quantity',
  trade_bitcoin_unit: 'trade_bitcoin_unit',
  bitcoin_wallet: 'bitcoin_wallet',
  bitcoin_quantity: 'bitcoin_quantity',
  bitcoin_unit: 'bitcoin_unit',
  bitcoin_unit_price: 'bitcoin_unit_price',
  parent_id: 'parent_id',
  pre_tax_amount: 'pre_tax_amount',
  tax_amount: 'tax_amount',
  tax_rate: 'tax_rate',
  expense_id: 'expense_id',
  income_id: 'income_id',
  pay_period_id: 'pay_period_id',
  occurrence_date: 'occurrence_date',
};

/** Old-format mapping with only base columns */
const BASE_MAPPING: Partial<Record<CSVColumnName, string>> = {
  date: 'date',
  name: 'name',
  amount: 'amount',
  type: 'type',
  account: 'account',
  category: 'category',
  note: 'note',
};

describe('csv-parser', () => {
  // Validates: Requirements 13.1, 13.2, 13.3, 13.4
  describe('parses a known old-format CSV row', () => {
    const rows = [
      {
        date: '2026-01-15',
        name: 'Groceries',
        amount: '52.30',
        type: 'EXPENSE',
        account: 'Checking',
        category: 'Food',
        note: 'Weekly shop',
      },
    ];

    it('produces a valid transaction with base fields only', () => {
      const result = parseCSVRows(rows, BASE_MAPPING);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.transactions).toHaveLength(1);
      const tx = result.transactions[0];
      expect(tx.type).toBe('EXPENSE');
      expect(tx.name).toBe('Groceries');
      expect(tx.amount).toBe(52.3);
      expect(tx.date).toBe('2026-01-15');
      expect(tx.rawAccount).toBe('Checking');
      expect(tx.rawCategory).toBe('Food');
      expect(tx.note).toBe('Weekly shop');
    });

    it('leaves all extended metadata fields undefined', () => {
      const result = parseCSVRows(rows, BASE_MAPPING);
      const tx = result.transactions[0];
      expect(tx.tradeMetadata).toBeUndefined();
      expect(tx.bitcoinMetadata).toBeUndefined();
      expect(tx.parentId).toBeUndefined();
      expect(tx.preTaxAmount).toBeUndefined();
      expect(tx.taxAmount).toBeUndefined();
      expect(tx.taxRate).toBeUndefined();
      expect(tx.expenseId).toBeUndefined();
      expect(tx.incomeId).toBeUndefined();
      expect(tx.payPeriodId).toBeUndefined();
      expect(tx.occurrenceDate).toBeUndefined();
    });
  });

  // Validates: Requirements 6.1, 6.2, 6.3, 7.1
  describe('parses a known TRADE (Stock) row', () => {
    const rows = [
      {
        date: '2026-02-10',
        name: 'Buy AAPL',
        amount: '1750',
        type: 'TRADE',
        account: 'Brokerage',
        to_account: '',
        category: 'Investments',
        note: 'Q1 purchase',
        trade_direction: 'BUY',
        trade_asset_type: 'Stock',
        trade_ticker: 'AAPL',
        trade_custodian: 'Fidelity',
        trade_wallet: '',
        trade_unit_price: '175',
        trade_quantity: '10',
        trade_bitcoin_unit: '',
        bitcoin_wallet: '',
        bitcoin_quantity: '',
        bitcoin_unit: '',
        bitcoin_unit_price: '',
        parent_id: '',
        pre_tax_amount: '',
        tax_amount: '',
        tax_rate: '',
        expense_id: '',
        income_id: '',
        pay_period_id: '',
        occurrence_date: '',
      },
    ];

    it('produces a TRADE transaction with stock trade metadata', () => {
      const result = parseCSVRows(rows, FULL_MAPPING);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(1);
      const tx = result.transactions[0];
      expect(tx.type).toBe('TRADE');
      expect(tx.name).toBe('Buy AAPL');
      expect(tx.amount).toBe(1750);
      expect(tx.date).toBe('2026-02-10');
      expect(tx.rawAccount).toBe('Brokerage');
      expect(tx.rawCategory).toBe('Investments');
      expect(tx.note).toBe('Q1 purchase');
      expect(tx.tradeMetadata).toBeDefined();
      expect(tx.tradeMetadata!.direction).toBe('BUY');
      expect(tx.tradeMetadata!.assetType).toBe('Stock');
      expect(tx.tradeMetadata!.ticker).toBe('AAPL');
      expect(tx.tradeMetadata!.rawCustodian).toBe('Fidelity');
      expect(tx.tradeMetadata!.unitPrice).toBe(175);
      expect(tx.tradeMetadata!.quantity).toBe(10);
      expect(tx.tradeMetadata!.rawWallet).toBeUndefined();
      expect(tx.tradeMetadata!.bitcoinUnit).toBeUndefined();
    });

    it('leaves bitcoin metadata undefined for stock trade', () => {
      const result = parseCSVRows(rows, FULL_MAPPING);
      expect(result.transactions[0].bitcoinMetadata).toBeUndefined();
    });
  });

  // Validates: Requirements 6.1, 6.2, 6.3, 7.2
  describe('parses a known TRADE (Bitcoin) row', () => {
    const rows = [
      {
        date: '2026-03-05',
        name: 'Buy Bitcoin',
        amount: '5000',
        type: 'TRADE',
        account: 'Crypto Account',
        to_account: '',
        category: '',
        note: '',
        trade_direction: 'BUY',
        trade_asset_type: 'Bitcoin',
        trade_ticker: '',
        trade_custodian: '',
        trade_wallet: 'Cold Storage',
        trade_unit_price: '50000',
        trade_quantity: '0.1',
        trade_bitcoin_unit: 'Bitcoin',
        bitcoin_wallet: '',
        bitcoin_quantity: '',
        bitcoin_unit: '',
        bitcoin_unit_price: '',
        parent_id: '',
        pre_tax_amount: '',
        tax_amount: '',
        tax_rate: '',
        expense_id: '',
        income_id: '',
        pay_period_id: '',
        occurrence_date: '',
      },
    ];

    it('produces a TRADE transaction with bitcoin trade metadata', () => {
      const result = parseCSVRows(rows, FULL_MAPPING);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(1);
      const tx = result.transactions[0];
      expect(tx.type).toBe('TRADE');
      expect(tx.name).toBe('Buy Bitcoin');
      expect(tx.amount).toBe(5000);
      expect(tx.date).toBe('2026-03-05');
      expect(tx.rawAccount).toBe('Crypto Account');
      expect(tx.tradeMetadata).toBeDefined();
      expect(tx.tradeMetadata!.direction).toBe('BUY');
      expect(tx.tradeMetadata!.assetType).toBe('Bitcoin');
      expect(tx.tradeMetadata!.rawWallet).toBe('Cold Storage');
      expect(tx.tradeMetadata!.unitPrice).toBe(50000);
      expect(tx.tradeMetadata!.quantity).toBe(0.1);
      expect(tx.tradeMetadata!.bitcoinUnit).toBe('Bitcoin');
      expect(tx.tradeMetadata!.ticker).toBeUndefined();
      expect(tx.tradeMetadata!.rawCustodian).toBeUndefined();
    });
  });

  // Validates: Requirements 9.1, 9.3
  describe('parses a split transaction set (parent + children)', () => {
    const rows = [
      {
        date: '2026-01-20',
        name: 'Restaurant Bill',
        amount: '100',
        type: 'EXPENSE',
        account: 'Credit Card',
        to_account: '',
        category: 'Dining',
        note: '',
        trade_direction: '',
        trade_asset_type: '',
        trade_ticker: '',
        trade_custodian: '',
        trade_wallet: '',
        trade_unit_price: '',
        trade_quantity: '',
        trade_bitcoin_unit: '',
        bitcoin_wallet: '',
        bitcoin_quantity: '',
        bitcoin_unit: '',
        bitcoin_unit_price: '',
        parent_id: '',
        pre_tax_amount: '',
        tax_amount: '',
        tax_rate: '',
        expense_id: '',
        income_id: '',
        pay_period_id: '',
        occurrence_date: '',
      },
      {
        date: '2026-01-20',
        name: 'Food',
        amount: '80',
        type: 'EXPENSE',
        account: 'Credit Card',
        to_account: '',
        category: 'Dining',
        note: '',
        trade_direction: '',
        trade_asset_type: '',
        trade_ticker: '',
        trade_custodian: '',
        trade_wallet: '',
        trade_unit_price: '',
        trade_quantity: '',
        trade_bitcoin_unit: '',
        bitcoin_wallet: '',
        bitcoin_quantity: '',
        bitcoin_unit: '',
        bitcoin_unit_price: '',
        parent_id: 'split-1',
        pre_tax_amount: '72.73',
        tax_amount: '7.27',
        tax_rate: '10',
        expense_id: '',
        income_id: '',
        pay_period_id: '',
        occurrence_date: '',
      },
      {
        date: '2026-01-20',
        name: 'Drinks',
        amount: '20',
        type: 'EXPENSE',
        account: 'Credit Card',
        to_account: '',
        category: 'Alcohol',
        note: '',
        trade_direction: '',
        trade_asset_type: '',
        trade_ticker: '',
        trade_custodian: '',
        trade_wallet: '',
        trade_unit_price: '',
        trade_quantity: '',
        trade_bitcoin_unit: '',
        bitcoin_wallet: '',
        bitcoin_quantity: '',
        bitcoin_unit: '',
        bitcoin_unit_price: '',
        parent_id: 'split-1',
        pre_tax_amount: '18.18',
        tax_amount: '1.82',
        tax_rate: '10',
        expense_id: '',
        income_id: '',
        pay_period_id: '',
        occurrence_date: '',
      },
    ];

    it('outputs parent before children with correct tax fields', () => {
      const result = parseCSVRows(rows, FULL_MAPPING);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(3);
      const parent = result.transactions[0];
      expect(parent.name).toBe('Restaurant Bill');
      expect(parent.amount).toBe(100);
      expect(parent.parentId).toBeUndefined();
      const child1 = result.transactions[1];
      expect(child1.name).toBe('Food');
      expect(child1.amount).toBe(80);
      expect(child1.parentId).toBe('split-1');
      expect(child1.preTaxAmount).toBe(72.73);
      expect(child1.taxAmount).toBe(7.27);
      expect(child1.taxRate).toBe(10);
      const child2 = result.transactions[2];
      expect(child2.name).toBe('Drinks');
      expect(child2.amount).toBe(20);
      expect(child2.parentId).toBe('split-1');
      expect(child2.preTaxAmount).toBe(18.18);
      expect(child2.taxAmount).toBe(1.82);
      expect(child2.taxRate).toBe(10);
    });
  });

  // Validates: Requirements 10.1, 10.3
  describe('parses a row with all linkage fields', () => {
    const rows = [
      {
        date: '2026-04-01',
        name: 'Paycheck',
        amount: '3000',
        type: 'INCOME',
        account: 'Checking',
        to_account: '',
        category: 'Salary',
        note: 'April pay',
        trade_direction: '',
        trade_asset_type: '',
        trade_ticker: '',
        trade_custodian: '',
        trade_wallet: '',
        trade_unit_price: '',
        trade_quantity: '',
        trade_bitcoin_unit: '',
        bitcoin_wallet: '',
        bitcoin_quantity: '',
        bitcoin_unit: '',
        bitcoin_unit_price: '',
        parent_id: '',
        pre_tax_amount: '',
        tax_amount: '',
        tax_rate: '',
        expense_id: 'exp-abc',
        income_id: 'inc-xyz',
        pay_period_id: 'pp-2026-04',
        occurrence_date: '2026-04-01',
      },
    ];

    it('populates all linkage fields on the parsed transaction', () => {
      const result = parseCSVRows(rows, FULL_MAPPING);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(1);
      const tx = result.transactions[0];
      expect(tx.type).toBe('INCOME');
      expect(tx.name).toBe('Paycheck');
      expect(tx.amount).toBe(3000);
      expect(tx.date).toBe('2026-04-01');
      expect(tx.rawAccount).toBe('Checking');
      expect(tx.rawCategory).toBe('Salary');
      expect(tx.note).toBe('April pay');
      expect(tx.expenseId).toBe('exp-abc');
      expect(tx.incomeId).toBe('inc-xyz');
      expect(tx.payPeriodId).toBe('pp-2026-04');
      expect(tx.occurrenceDate).toBe('2026-04-01');
    });
  });
});
