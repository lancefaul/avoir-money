/**
 * Property-Based Tests for Utility Providers
 *
 * Tests Properties 1, 3, and 4 from the design document.
 *
 * - Property 1: Provider name case-insensitive uniqueness (API-level)
 * - Property 3: ServiceType enum validation (schema-level)
 * - Property 4: Metering enum validation (schema-level)
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { post } from '../test/helpers.js';
import { ServiceTypeSchema, MeteringSchema } from '@budget-tracker/core';

// ─── Generators ───

/** Non-empty alphanumeric string (1–50 chars) for provider names */
const providerNameArb = fc.stringMatching(/^[A-Za-z0-9]{1,50}$/);

/** Flip each character to upper or lower case randomly */
function randomCaseVariation(name: string, rand: number): string {
  // Use the random number to decide a strategy
  if (rand < 0.33) return name.toUpperCase();
  if (rand < 0.66) return name.toLowerCase();
  // Mixed case: flip each character
  return name
    .split('')
    .map((ch, i) => (i % 2 === 0 ? ch.toUpperCase() : ch.toLowerCase()))
    .join('');
}

// ─── Valid enum values ───

const VALID_SERVICE_TYPES = [
  'ELECTRIC',
  'GAS',
  'WATER',
  'GARBAGE',
  'SEWAGE',
  'INTERNET',
  'CELLULAR',
] as const;
const VALID_METERING = ['METERED', 'UNMETERED'] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Property 1: Provider Name Case-Insensitive Uniqueness
// Feature: utility-providers, Property 1: Provider name case-insensitive uniqueness
// ═══════════════════════════════════════════════════════════════════════════════

describe('Feature: utility-providers, Property 1: Provider name case-insensitive uniqueness', () => {
  /**
   * **Validates: Requirements 1.2, 1.4**
   *
   * For any provider name, creating a provider then attempting to create another
   * provider with a case variation of the same name SHALL be rejected with 409.
   */
  it('creating a provider with a case variation of an existing name returns 409', async () => {
    await fc.assert(
      fc.asyncProperty(
        providerNameArb,
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        async (name, rand) => {
          // Create the first provider
          const res1 = await post('/utilities/providers', { name });

          // If the name collides with a leftover from a previous iteration in the
          // same beforeEach cycle, skip this iteration (shouldn't happen with cleanup)
          if (res1.status === 409) return; // name already existed, skip
          expect(res1.status).toBe(201);

          // Generate a case variation of the same name
          const caseVariant = randomCaseVariation(name, rand);

          // Attempt to create a second provider with the case-varied name
          const res2 = await post('/utilities/providers', { name: caseVariant });
          expect(res2.status).toBe(409);

          const body = (await res2.json()) as { error: string };
          expect(body.error).toBe('A provider with this name already exists');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 3: ServiceType Enum Validation
// Feature: utility-providers, Property 3: ServiceType enum validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Feature: utility-providers, Property 3: ServiceType enum validation', () => {
  /**
   * **Validates: Requirements 2.2, 6.3**
   *
   * For any string value, ServiceTypeSchema SHALL accept it if and only if it is
   * one of the 7 valid values. All other strings SHALL be rejected.
   */
  it('only the 7 valid ServiceType values pass safeParse', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (value) => {
        const result = ServiceTypeSchema.safeParse(value);
        const isValid = (VALID_SERVICE_TYPES as readonly string[]).includes(value);

        if (isValid) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('all 7 valid ServiceType values are accepted', () => {
    for (const value of VALID_SERVICE_TYPES) {
      const result = ServiceTypeSchema.safeParse(value);
      expect(result.success).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 4: Metering Enum Validation
// Feature: utility-providers, Property 4: Metering enum validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Feature: utility-providers, Property 4: Metering enum validation', () => {
  /**
   * **Validates: Requirements 2.3, 6.4**
   *
   * For any string value, MeteringSchema SHALL accept it if and only if it is
   * one of: METERED, UNMETERED. All other strings SHALL be rejected.
   */
  it('only METERED and UNMETERED pass safeParse', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (value) => {
        const result = MeteringSchema.safeParse(value);
        const isValid = (VALID_METERING as readonly string[]).includes(value);

        if (isValid) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('both valid Metering values are accepted', () => {
    for (const value of VALID_METERING) {
      const result = MeteringSchema.safeParse(value);
      expect(result.success).toBe(true);
    }
  });
});
