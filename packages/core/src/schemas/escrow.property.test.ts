import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { CreateEscrowRecordSchema } from './debt.js';

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Feature: mortgage-escrow, Property 4: Escrow record validation rejects invalid inputs
 * Validates: Requirements 2.2, 2.3, 2.4, 2.5
 *
 * For any escrow record input where the monthly amount is negative,
 * OR the period start date is on or after the period end date,
 * OR the period span exceeds 366 days, the CreateEscrowRecordSchema
 * validation SHALL reject the input.
 */
describe('Property 4: Escrow record validation rejects invalid inputs', () => {
  it('rejects negative monthly amounts', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1_000_000, max: -0.01, noNaN: true }),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01'), noInvalidDate: true }),
        (amount, startDate) => {
          const endDate = new Date(startDate.getTime() + 30 * ONE_DAY_MS);
          const result = CreateEscrowRecordSchema.safeParse({
            monthlyAmount: amount,
            periodStartDate: startDate,
            periodEndDate: endDate,
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects startDate >= endDate', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10_000, noNaN: true }),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01'), noInvalidDate: true }),
        fc.integer({ min: 0, max: 365 }),
        (amount, endDate, offsetDays) => {
          // startDate is endDate + offsetDays (so startDate >= endDate)
          const startDate = new Date(endDate.getTime() + offsetDays * ONE_DAY_MS);
          const result = CreateEscrowRecordSchema.safeParse({
            monthlyAmount: amount,
            periodStartDate: startDate,
            periodEndDate: endDate,
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects period span > 366 days', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10_000, noNaN: true }),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2028-01-01'), noInvalidDate: true }),
        fc.integer({ min: 367, max: 1000 }),
        (amount, startDate, spanDays) => {
          const endDate = new Date(startDate.getTime() + spanDays * ONE_DAY_MS);
          const result = CreateEscrowRecordSchema.safeParse({
            monthlyAmount: amount,
            periodStartDate: startDate,
            periodEndDate: endDate,
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('accepts valid inputs (positive amount, startDate < endDate, span ≤ 366)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10_000, noNaN: true }),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2028-01-01'), noInvalidDate: true }),
        fc.integer({ min: 1, max: 366 }),
        (amount, startDate, spanDays) => {
          const endDate = new Date(startDate.getTime() + spanDays * ONE_DAY_MS);
          const result = CreateEscrowRecordSchema.safeParse({
            monthlyAmount: amount,
            periodStartDate: startDate,
            periodEndDate: endDate,
          });
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });
});
