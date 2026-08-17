/**
 * Property-Based Tests for Utility Readings
 *
 * Tests Properties 7 and 8 from the design document.
 *
 * - Property 7: Reading field round-trip preservation (API-level)
 * - Property 8: Total bill computation correctness (pure function)
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { post, get } from '../test/helpers.js';
import { computeUtilityTotalBill } from '../lib/recurring.js';

// ─── Helpers ───

async function createProvider(name: string) {
  const res = await post('/utilities/providers', { name });
  return (await res.json()) as any;
}

async function createService(providerId: string) {
  const res = await post(`/utilities/providers/${providerId}/services`, {
    serviceType: 'ELECTRIC',
    metering: 'METERED',
  });
  return (await res.json()) as any;
}

// ─── Generators ───

/** Generate a non-negative finite number suitable for currency/usage fields */
const currencyArb = fc.double({
  min: 0,
  max: 999999.99,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Generate a non-negative finite number for usage */
const usageArb = fc.double({
  min: 0,
  max: 99999.99,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Generate a convenience fee type */
const feeTypeArb = fc.constantFrom('dollar', 'percent');

// ═══════════════════════════════════════════════════════════════════════════════
// Property 7: Reading Field Round-Trip Preservation
// Feature: utility-providers, Property 7: Reading field round-trip preservation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Feature: utility-providers, Property 7: Reading field round-trip preservation', () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * For any valid UtilityReading created via the API with all fields populated,
   * reading it back via the GET endpoint SHALL return all field values unchanged
   * (within floating-point tolerance for decimals).
   */
  it('all reading fields survive a create → read round-trip', async () => {
    // Create a provider and service once for all iterations
    const provider = await createProvider('RoundTrip Provider');
    const service = await createService(provider.id);

    await fc.assert(
      fc.asyncProperty(
        currencyArb,
        usageArb,
        currencyArb,
        currencyArb,
        feeTypeArb,
        currencyArb,
        fc.integer({ min: 2020, max: 2030 }),
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 1, max: 28 }),
        async (cost, usage, unitCost, convenienceFee, feeType, otherFees, year, month, day) => {
          const billDate = new Date(Date.UTC(year, month, day));
          const dueDate = new Date(Date.UTC(year, month, Math.min(day + 14, 28)));

          const payload = {
            serviceId: service.id,
            billDate: billDate.toISOString(),
            dueDate: dueDate.toISOString(),
            usage,
            cost,
            unitCost,
            convenienceFee,
            convenienceFeeType: feeType,
            otherFees,
            details: { note: 'test', value: 42 },
          };

          // Create
          const createRes = await post('/utilities/readings', payload);
          expect(createRes.status).toBe(201);
          const created: any = await createRes.json();

          // Read back via list filtered by serviceId
          const listRes = await get(`/utilities/readings?serviceId=${service.id}&limit=500`);
          expect(listRes.status).toBe(200);
          const list: any[] = (await listRes.json()) as any[];
          const readBack = list.find((r: any) => r.id === created.id);
          expect(readBack).toBeDefined();

          // Verify all fields within floating-point tolerance
          expect(readBack.serviceId).toBe(service.id);
          expect(new Date(readBack.billDate).getTime()).toBe(billDate.getTime());
          expect(new Date(readBack.dueDate).getTime()).toBe(dueDate.getTime());
          expect(readBack.usage).toBeCloseTo(usage, 2);
          expect(readBack.cost).toBeCloseTo(cost, 2);
          expect(readBack.unitCost).toBeCloseTo(unitCost, 2);
          expect(readBack.convenienceFee).toBeCloseTo(convenienceFee, 2);
          expect(readBack.convenienceFeeType).toBe(feeType);
          expect(readBack.otherFees).toBeCloseTo(otherFees, 2);
          expect(readBack.details).toEqual({ note: 'test', value: 42 });
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 8: Total Bill Computation Correctness
// Feature: utility-providers, Property 8: Total bill computation correctness
// ═══════════════════════════════════════════════════════════════════════════════

describe('Feature: utility-providers, Property 8: Total bill computation correctness', () => {
  /**
   * **Validates: Requirements 4.3**
   *
   * For any UtilityReading with non-negative cost, optional convenienceFee
   * (dollar or percent), and optional otherFees, computeUtilityTotalBill
   * SHALL return cost + convenienceAmount + otherFees where convenienceAmount
   * is fee when type is 'dollar' and cost * fee / 100 when type is 'percent'.
   */
  it('total bill = cost + convenienceAmount + otherFees for dollar fees', () => {
    fc.assert(
      fc.property(currencyArb, currencyArb, currencyArb, (cost, fee, otherFees) => {
        const result = computeUtilityTotalBill({
          cost,
          convenienceFee: fee,
          convenienceFeeType: 'dollar',
          otherFees,
        });
        const expected = cost + fee + otherFees;
        expect(result).toBeCloseTo(expected, 5);
      }),
      { numRuns: 100 },
    );
  });

  it('total bill = cost + (cost * fee / 100) + otherFees for percent fees', () => {
    fc.assert(
      fc.property(
        currencyArb,
        fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
        currencyArb,
        (cost, feePercent, otherFees) => {
          const result = computeUtilityTotalBill({
            cost,
            convenienceFee: feePercent,
            convenienceFeeType: 'percent',
            otherFees,
          });
          const expected = cost + (cost * feePercent) / 100 + otherFees;
          expect(result).toBeCloseTo(expected, 5);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('total bill = cost when no fees are provided', () => {
    fc.assert(
      fc.property(currencyArb, (cost) => {
        const result = computeUtilityTotalBill({
          cost,
          convenienceFee: null,
          convenienceFeeType: null,
          otherFees: null,
        });
        expect(result).toBeCloseTo(cost, 5);
      }),
      { numRuns: 100 },
    );
  });

  it('total bill = cost + otherFees when only otherFees is provided', () => {
    fc.assert(
      fc.property(currencyArb, currencyArb, (cost, otherFees) => {
        const result = computeUtilityTotalBill({
          cost,
          convenienceFee: null,
          convenienceFeeType: null,
          otherFees,
        });
        const expected = cost + otherFees;
        expect(result).toBeCloseTo(expected, 5);
      }),
      { numRuns: 100 },
    );
  });

  it('handles Decimal-like objects with toNumber()', () => {
    fc.assert(
      fc.property(currencyArb, currencyArb, currencyArb, (cost, fee, otherFees) => {
        const result = computeUtilityTotalBill({
          cost: { toNumber: () => cost },
          convenienceFee: { toNumber: () => fee },
          convenienceFeeType: 'dollar',
          otherFees: { toNumber: () => otherFees },
        });
        const expected = cost + fee + otherFees;
        expect(result).toBeCloseTo(expected, 5);
      }),
      { numRuns: 100 },
    );
  });
});
