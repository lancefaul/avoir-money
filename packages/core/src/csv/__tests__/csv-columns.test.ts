import { describe, it, expect } from 'vitest';
import { CSV_COLUMNS, COLUMN_PATTERNS, autoMapColumns } from '../csv-columns.js';

describe('csv-columns', () => {
  // Validates: Requirements 11.1, 11.2, 11.3, 11.4

  describe('exact canonical column name matching', () => {
    it('maps all 26 canonical column names when provided as exact headers', () => {
      const headers = [...CSV_COLUMNS];
      const mapping = autoMapColumns(headers);

      for (const col of CSV_COLUMNS) {
        expect(mapping[col]).toBe(col);
      }
      expect(Object.keys(mapping)).toHaveLength(CSV_COLUMNS.length);
    });

    it('maps trade metadata columns by exact name', () => {
      const tradeHeaders = [
        'trade_direction',
        'trade_asset_type',
        'trade_ticker',
        'trade_custodian',
        'trade_wallet',
        'trade_unit_price',
        'trade_quantity',
        'trade_bitcoin_unit',
      ];
      const mapping = autoMapColumns(tradeHeaders);

      for (const h of tradeHeaders) {
        expect(mapping[h as keyof typeof mapping]).toBe(h);
      }
    });

    it('maps bitcoin payment columns by exact name', () => {
      const btcHeaders = [
        'bitcoin_wallet',
        'bitcoin_quantity',
        'bitcoin_unit',
        'bitcoin_unit_price',
      ];
      const mapping = autoMapColumns(btcHeaders);

      for (const h of btcHeaders) {
        expect(mapping[h as keyof typeof mapping]).toBe(h);
      }
    });

    it('maps split field columns by exact name', () => {
      const splitHeaders = ['parent_id', 'pre_tax_amount', 'tax_amount', 'tax_rate'];
      const mapping = autoMapColumns(splitHeaders);

      for (const h of splitHeaders) {
        expect(mapping[h as keyof typeof mapping]).toBe(h);
      }
    });

    it('maps linkage field columns by exact name', () => {
      const linkageHeaders = ['expense_id', 'income_id', 'pay_period_id', 'occurrence_date'];
      const mapping = autoMapColumns(linkageHeaders);

      for (const h of linkageHeaders) {
        expect(mapping[h as keyof typeof mapping]).toBe(h);
      }
    });
  });

  describe('mixed-case column name matching', () => {
    it('maps uppercase canonical names', () => {
      const headers = ['DATE', 'NAME', 'AMOUNT', 'TYPE'];
      const mapping = autoMapColumns(headers);

      expect(mapping.date).toBe('DATE');
      expect(mapping.name).toBe('NAME');
      expect(mapping.amount).toBe('AMOUNT');
      expect(mapping.type).toBe('TYPE');
    });

    it('maps title-case canonical names', () => {
      const headers = ['Date', 'Name', 'Amount', 'Category', 'Note'];
      const mapping = autoMapColumns(headers);

      expect(mapping.date).toBe('Date');
      expect(mapping.name).toBe('Name');
      expect(mapping.amount).toBe('Amount');
      expect(mapping.category).toBe('Category');
      expect(mapping.note).toBe('Note');
    });

    it('maps mixed-case trade metadata headers', () => {
      const headers = ['Trade_Direction', 'TRADE_ASSET_TYPE', 'trade_Ticker'];
      const mapping = autoMapColumns(headers);

      expect(mapping.trade_direction).toBe('Trade_Direction');
      expect(mapping.trade_asset_type).toBe('TRADE_ASSET_TYPE');
      expect(mapping.trade_ticker).toBe('trade_Ticker');
    });

    it('maps alias patterns case-insensitively', () => {
      const headers = ['Description', 'TOTAL', 'Memo'];
      const mapping = autoMapColumns(headers);

      expect(mapping.name).toBe('Description');
      expect(mapping.amount).toBe('TOTAL');
      expect(mapping.note).toBe('Memo');
    });

    it('maps headers with leading/trailing whitespace', () => {
      const headers = ['  date  ', ' name ', '  amount'];
      const mapping = autoMapColumns(headers);

      expect(mapping.date).toBe('  date  ');
      expect(mapping.name).toBe(' name ');
      expect(mapping.amount).toBe('  amount');
    });
  });

  describe('unmapped headers are not assigned', () => {
    it('returns empty mapping for completely unrecognized headers', () => {
      const headers = ['foo', 'bar_baz', 'zzz_unknown', 'random_col'];
      const mapping = autoMapColumns(headers);

      expect(Object.keys(mapping)).toHaveLength(0);
    });

    it('does not map unrecognized headers alongside recognized ones', () => {
      const headers = ['date', 'amount', 'unknown_field', 'zzz_garbage'];
      const mapping = autoMapColumns(headers);

      expect(mapping.date).toBe('date');
      expect(mapping.amount).toBe('amount');
      expect(Object.keys(mapping)).toHaveLength(2);
      const values = Object.values(mapping);
      expect(values).not.toContain('unknown_field');
      expect(values).not.toContain('zzz_garbage');
    });

    it('does not assign the same header to multiple columns', () => {
      const headers = ['date', 'name', 'amount', 'type', 'account', 'category', 'note'];
      const mapping = autoMapColumns(headers);

      const values = Object.values(mapping);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });

    it('prefers exact match over partial match', () => {
      const headers = ['tax_rate', 'tax_amount'];
      const mapping = autoMapColumns(headers);

      expect(mapping.tax_rate).toBe('tax_rate');
      expect(mapping.tax_amount).toBe('tax_amount');
    });
  });
});
