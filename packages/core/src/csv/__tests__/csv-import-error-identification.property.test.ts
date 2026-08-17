// Feature: v1-hardening, Property 4: Import Error Identification
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseCSVRows } from '../csv-parser.js';
import type { CSVColumnName } from '../csv-columns.js';

/**
 * **Validates: Requirements 3.7**
 *
 * For any CSV file with an intentionally malformed row (invalid date format,
 * non-numeric amount, missing required field), the import parser should return
 * an error response that identifies the specific row number and field name
 * that failed validation, conforming to Error_Shape.
 */

/** Column mapping for base CSV fields */
const BASE_COLUMN_MAPPING: Partial<Record<CSVColumnName, string>> = {
  name: 'name',
  amount: 'amount',
  date: 'date',
  type: 'type',
  account: 'account',
  category: 'category',
  note: 'note',
};

/** Generates a valid date string in YYYY-MM-DD format */
const arbDate = fc
  .record({
    y: fc.integer({ min: 2020, max: 2030 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

/** Generates a valid positive amount string */
const arbAmount = fc
  .float({ min: Math.fround(0.01), max: Math.fround(999999), noNaN: true })
  .map((n) => Math.abs(n).toFixed(2))
  .filter((s) => Number(s) > 0);

/** Generates a valid base CSV row */
const arbValidRow = fc.record({
  name: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,29}$/),
  amount: arbAmount,
  date: arbDate,
  type: fc.constantFrom('EXPENSE', 'INCOME', 'TRANSFER', 'REFUND'),
  account: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,14}$/),
  category: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,14}$/),
  note: fc.stringMatching(/^[A-Za-z0-9 ]{0,20}$/),
});

/**
 * The three required base fields that parseCSVRows validates.
 * Removing any one of these from a row should produce an error
 * identifying the row number and the missing field name.
 */
const REQUIRED_FIELDS = ['name', 'amount', 'date'] as const;
type RequiredField = (typeof REQUIRED_FIELDS)[number];

describe('Feature: v1-hardening, Property 4: Import Error Identification', () => {
  it('missing required field produces error with correct row number and field name', () => {
    fc.assert(
      fc.property(
        // Generate 0-5 valid rows before the malformed row
        fc.array(arbValidRow, { minLength: 0, maxLength: 5 }),
        // Generate a valid row to malform
        arbValidRow,
        // Pick which required field to remove
        fc.constantFrom<RequiredField>(...REQUIRED_FIELDS),
        // Generate 0-3 valid rows after the malformed row
        fc.array(arbValidRow, { minLength: 0, maxLength: 3 }),
        (validBefore, rowToBreak, fieldToRemove, validAfter) => {
          // Create the malformed row by blanking out the required field
          const malformedRow: Record<string, string> = { ...rowToBreak };
          malformedRow[fieldToRemove] = '';

          const allRows = [...validBefore, malformedRow, ...validAfter];
          const result = parseCSVRows(allRows, BASE_COLUMN_MAPPING);

          // The malformed row is at 1-based index: validBefore.length + 1
          const expectedRowNum = validBefore.length + 1;

          // There must be at least one error
          expect(result.errors.length).toBeGreaterThanOrEqual(1);

          // Find the error for the malformed row
          const errorForRow = result.errors.find((e) => e.row === expectedRowNum);
          expect(errorForRow).toBeDefined();

          // Error must identify the correct field
          expect(errorForRow!.field).toBe(fieldToRemove);

          // Error must have a non-empty message
          expect(errorForRow!.message.length).toBeGreaterThan(0);

          // Error shape must conform to { row: number, field: string, message: string }
          expect(typeof errorForRow!.row).toBe('number');
          expect(typeof errorForRow!.field).toBe('string');
          expect(typeof errorForRow!.message).toBe('string');

          // Valid rows before and after should still be parsed
          // (the malformed row is skipped, so total = validBefore + validAfter)
          expect(result.transactions).toHaveLength(validBefore.length + validAfter.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('non-numeric amount produces error with row number and field "amount"', () => {
    fc.assert(
      fc.property(
        // Generate 0-5 valid rows before the malformed row
        fc.array(arbValidRow, { minLength: 0, maxLength: 5 }),
        // Generate a valid row to malform
        arbValidRow,
        // Generate a non-numeric amount string (letters, symbols, etc.)
        fc.stringMatching(/^[A-Za-z!@#$%^&*()]{1,10}$/),
        // Generate 0-3 valid rows after the malformed row
        fc.array(arbValidRow, { minLength: 0, maxLength: 3 }),
        (validBefore, rowToBreak, badAmount, validAfter) => {
          // Create the malformed row with a non-numeric amount
          const malformedRow: Record<string, string> = { ...rowToBreak };
          malformedRow['amount'] = badAmount;

          const allRows = [...validBefore, malformedRow, ...validAfter];
          const result = parseCSVRows(allRows, BASE_COLUMN_MAPPING);

          const expectedRowNum = validBefore.length + 1;

          // There must be at least one error
          expect(result.errors.length).toBeGreaterThanOrEqual(1);

          // Find the error for the malformed row
          const errorForRow = result.errors.find((e) => e.row === expectedRowNum);
          expect(errorForRow).toBeDefined();

          // Error must identify the "amount" field
          expect(errorForRow!.field).toBe('amount');

          // Error must have a non-empty message
          expect(errorForRow!.message.length).toBeGreaterThan(0);

          // Error shape conformance
          expect(typeof errorForRow!.row).toBe('number');
          expect(typeof errorForRow!.field).toBe('string');
          expect(typeof errorForRow!.message).toBe('string');

          // Valid rows should still be parsed
          expect(result.transactions).toHaveLength(validBefore.length + validAfter.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
