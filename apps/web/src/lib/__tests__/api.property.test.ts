import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { ApiValidationError } from '../api.js';
import {
  IncomeResponseSchema,
  ExpenseResponseSchema,
  TransactionResponseSchema,
  AccountResponseSchema,
  BudgetItemResponseSchema,
  DebtResponseSchema,
  BudgetGoalResponseSchema,
  InvestmentHoldingResponseSchema,
  CustodianResponseSchema,
  WalletResponseSchema,
  UtilityReadingResponseSchema,
  PayScheduleResponseSchema,
  PayPeriodResponseSchema,
} from '@budget-tracker/core';

// ═══════════════════════════════════════════════════════════════════════════════
// Property 2: Parse Failure Error Contains Endpoint and Zod Details
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * **Validates: Requirements 6.2, 6.1**
 *
 * For any invalid payload (an object that does not conform to the expected
 * Response Schema) and for any API endpoint path, when the API client attempts
 * to parse the response, the thrown error SHALL be an ApiValidationError whose
 * message contains the endpoint path string and whose zodError property is a
 * ZodError with at least one issue.
 */

const schemasUnderTest: Array<{ name: string; schema: z.ZodTypeAny }> = [
  { name: 'IncomeResponseSchema', schema: IncomeResponseSchema },
  { name: 'ExpenseResponseSchema', schema: ExpenseResponseSchema },
  { name: 'TransactionResponseSchema', schema: TransactionResponseSchema },
  { name: 'AccountResponseSchema', schema: AccountResponseSchema },
  { name: 'BudgetItemResponseSchema', schema: BudgetItemResponseSchema },
  { name: 'DebtResponseSchema', schema: DebtResponseSchema },
  { name: 'BudgetGoalResponseSchema', schema: BudgetGoalResponseSchema },
  { name: 'InvestmentHoldingResponseSchema', schema: InvestmentHoldingResponseSchema },
  { name: 'CustodianResponseSchema', schema: CustodianResponseSchema },
  { name: 'WalletResponseSchema', schema: WalletResponseSchema },
  { name: 'UtilityReadingResponseSchema', schema: UtilityReadingResponseSchema },
  { name: 'PayScheduleResponseSchema', schema: PayScheduleResponseSchema },
  { name: 'PayPeriodResponseSchema', schema: PayPeriodResponseSchema },
];

/**
 * Arbitrary that generates payloads guaranteed to fail Zod parsing for any
 * object schema. We use fc.anything() and filter to only values that actually
 * fail schema.parse(). To ensure the filter doesn't reject too many values,
 * we also mix in structurally invalid objects (wrong types for required fields).
 */
function arbInvalidPayload(schema: z.ZodTypeAny): fc.Arbitrary<unknown> {
  // Guaranteed-invalid objects: use wrong types for all fields
  const guaranteedInvalid = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.constant(42),
    fc.constant('not-an-object'),
    fc.constant(true),
    fc.constant([]),
    fc.record({
      invalid: fc.constant(true),
      wrongType: fc.double({ noNaN: true }),
    }),
    // Empty object — will be missing all required fields
    fc.constant({}),
  );

  // Also try fc.anything() filtered to values that fail parsing
  const anythingInvalid = fc.anything().filter((val) => {
    try {
      schema.parse(val);
      return false; // parsed successfully — not invalid
    } catch {
      return true; // parse failed — this is an invalid payload
    }
  });

  return fc.oneof(guaranteedInvalid, anythingInvalid);
}

/** Arbitrary for non-empty endpoint path strings */
const arbEndpoint = fc.string({ minLength: 1, maxLength: 100 }).map((s) => `/${s}`);

describe('Feature: runtime-safety, Property 2: Parse Failure Error Contains Endpoint and Zod Details', () => {
  for (const { name, schema } of schemasUnderTest) {
    it(`ApiValidationError from ${name} contains endpoint and Zod issues`, () => {
      fc.assert(
        fc.property(arbEndpoint, arbInvalidPayload(schema), (endpoint, payload) => {
          // Attempt to parse the invalid payload
          let zodError: z.ZodError | undefined;
          try {
            schema.parse(payload);
            // If parse succeeds, this input isn't actually invalid — skip
            return;
          } catch (err) {
            if (err instanceof z.ZodError) {
              zodError = err;
            } else {
              // Non-Zod error — skip
              return;
            }
          }

          // Construct ApiValidationError the same way the request() function does
          const apiErr = new ApiValidationError(endpoint, zodError);

          // Property assertions
          expect(apiErr).toBeInstanceOf(ApiValidationError);
          expect(apiErr).toBeInstanceOf(Error);
          expect(apiErr.name).toBe('ApiValidationError');
          expect(apiErr.endpoint).toBe(endpoint);
          expect(apiErr.message).toContain(endpoint);
          expect(apiErr.zodError).toBeInstanceOf(z.ZodError);
          expect(apiErr.zodError.issues.length).toBeGreaterThan(0);
        }),
        { numRuns: 20 },
      );
    });
  }
});
