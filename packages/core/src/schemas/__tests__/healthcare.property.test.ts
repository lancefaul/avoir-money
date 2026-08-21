import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { CreateInsurancePolicySchema } from '../healthcare.js';

/**
 * Feature: healthcare-page-revamp, Property 3: Policy input validation
 *
 * For any policy creation request where the OOPM limit is less than the
 * deductible limit (when both provided), or where any monetary field is
 * negative, the schema shall reject the request with a validation error.
 * Medical policies require deductible and OOPM limits.
 *
 * **Validates: Requirements 1.6, 1.7**
 */
describe('Feature: healthcare-page-revamp, Property 3: Policy input validation', () => {
  const validYear = 2025;
  const validEmployer = 'Acme Corp';

  const policyTypeArb = fc.constantFrom('MEDICAL' as const, 'DENTAL' as const, 'VISION' as const);

  /** Valid MEDICAL policy monetary fields */
  const validMedicalMonetaryArb = fc
    .record({
      premium: fc.double({ min: 0, max: 50_000, noNaN: true, noDefaultInfinity: true }),
      deductibleLimit: fc.double({ min: 0, max: 50_000, noNaN: true, noDefaultInfinity: true }),
    })
    .chain((base) =>
      fc
        .double({ min: base.deductibleLimit, max: 100_000, noNaN: true, noDefaultInfinity: true })
        .map((oopmLimit) => ({ ...base, oopmLimit })),
    );

  it('rejects MEDICAL when OOPM limit < deductible limit', () => {
    fc.assert(
      fc.property(
        fc
          .double({ min: 0.01, max: 100_000, noNaN: true, noDefaultInfinity: true })
          .chain((deductibleLimit) =>
            fc
              .double({
                min: 0,
                max: deductibleLimit - 0.001,
                noNaN: true,
                noDefaultInfinity: true,
              })
              .map((oopmLimit) => ({ deductibleLimit, oopmLimit })),
          ),
        ({ deductibleLimit, oopmLimit }) => {
          fc.pre(oopmLimit < deductibleLimit);
          const result = CreateInsurancePolicySchema.safeParse({
            type: 'MEDICAL',
            year: validYear,
            employer: validEmployer,
            premium: 100,
            deductibleLimit,
            oopmLimit,
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects MEDICAL when deductibleLimit is missing', () => {
    const result = CreateInsurancePolicySchema.safeParse({
      type: 'MEDICAL',
      year: validYear,
      employer: validEmployer,
      premium: 100,
      oopmLimit: 10000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects MEDICAL when oopmLimit is missing', () => {
    const result = CreateInsurancePolicySchema.safeParse({
      type: 'MEDICAL',
      year: validYear,
      employer: validEmployer,
      premium: 100,
      deductibleLimit: 5000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects when premium is negative', () => {
    fc.assert(
      fc.property(
        fc.double({ max: -Number.MIN_VALUE, noNaN: true }),
        validMedicalMonetaryArb,
        (negPremium, base) => {
          const result = CreateInsurancePolicySchema.safeParse({
            type: 'MEDICAL',
            year: validYear,
            employer: validEmployer,
            ...base,
            premium: negPremium,
          });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects when deductibleLimit is negative', () => {
    fc.assert(
      fc.property(fc.double({ max: -Number.MIN_VALUE, noNaN: true }), (negDeductible) => {
        const result = CreateInsurancePolicySchema.safeParse({
          type: 'MEDICAL',
          year: validYear,
          employer: validEmployer,
          premium: 100,
          deductibleLimit: negDeductible,
          oopmLimit: 10_000,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects when oopmLimit is negative', () => {
    fc.assert(
      fc.property(fc.double({ max: -Number.MIN_VALUE, noNaN: true }), (negOopm) => {
        const result = CreateInsurancePolicySchema.safeParse({
          type: 'MEDICAL',
          year: validYear,
          employer: validEmployer,
          premium: 100,
          deductibleLimit: 0,
          oopmLimit: negOopm,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('accepts valid MEDICAL inputs where OOPM >= deductible and all fields non-negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2100 }),
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        validMedicalMonetaryArb,
        (year, employer, monetary) => {
          const result = CreateInsurancePolicySchema.safeParse({
            type: 'MEDICAL',
            year,
            employer,
            ...monetary,
            metadata: { insurer: 'Test', policyId: 'P1', groupNumber: 'G1' },
          });
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('accepts DENTAL/VISION without deductible and OOPM limits', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('DENTAL' as const, 'VISION' as const),
        fc.integer({ min: 2000, max: 2100 }),
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        fc.double({ min: 0, max: 50_000, noNaN: true, noDefaultInfinity: true }),
        (type, year, employer, premium) => {
          const result = CreateInsurancePolicySchema.safeParse({
            type,
            year,
            employer,
            premium,
            metadata: { insurer: 'Test' },
          });
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });
});
