import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { request, ApiValidationError } from '../request.js';

/**
 * Feature: frontend-coverage-push, Property 1: Zod validation round-trip
 *
 * For all valid payloads matching a schema → request returns parsed data.
 * For invalid payloads → request throws ApiValidationError.
 * Round-trip: parse(serialize(data)) === data for valid schemas.
 *
 * **Validates: Requirements 8.1**
 */

// --- Schemas under test ---

const simpleSchema = z.object({
  id: z.string(),
  name: z.string(),
  amount: z.number(),
  active: z.boolean(),
});

const nestedSchema = z.object({
  id: z.string(),
  meta: z.object({
    createdAt: z.string(),
    tags: z.array(z.string()),
  }),
  value: z.number().nullable(),
});

const arraySchema = z.array(
  z.object({
    id: z.string(),
    label: z.string(),
  }),
);

// --- Arbitraries ---

const arbSimplePayload = fc.record({
  id: fc.string({ minLength: 1, maxLength: 50 }),
  name: fc.string({ minLength: 0, maxLength: 100 }),
  amount: fc.double({ min: -1e9, max: 1e9, noNaN: true, noDefaultInfinity: true }),
  active: fc.boolean(),
});

const arbNestedPayload = fc.record({
  id: fc.string({ minLength: 1, maxLength: 50 }),
  meta: fc.record({
    createdAt: fc.string({ minLength: 1, maxLength: 30 }),
    tags: fc.array(fc.string({ minLength: 0, maxLength: 20 }), { minLength: 0, maxLength: 5 }),
  }),
  value: fc.option(fc.double({ min: -1e9, max: 1e9, noNaN: true, noDefaultInfinity: true }), {
    nil: null,
  }),
});

const arbArrayPayload = fc.array(
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 50 }),
    label: fc.string({ minLength: 0, maxLength: 100 }),
  }),
  { minLength: 0, maxLength: 10 },
);

// --- Helpers ---

function mockFetchWithJson(payload: unknown): void {
  globalThis.fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
}

describe('request() Zod validation round-trip (property)', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('valid payloads → returns parsed data', () => {
    it('simple object schema: valid payloads always parse successfully', () => {
      return fc.assert(
        fc.asyncProperty(arbSimplePayload, async (payload) => {
          // JSON.stringify converts -0 to 0, so the response will have 0 where payload has -0
          const jsonNormalized = JSON.parse(JSON.stringify(payload));
          mockFetchWithJson(jsonNormalized);
          const result = await request('/test', simpleSchema);
          expect(result).toEqual(jsonNormalized);
        }),
        { numRuns: 100 },
      );
    });

    it('nested object schema: valid payloads always parse successfully', () => {
      return fc.assert(
        fc.asyncProperty(arbNestedPayload, async (payload) => {
          const jsonNormalized = JSON.parse(JSON.stringify(payload));
          mockFetchWithJson(jsonNormalized);
          const result = await request('/test', nestedSchema);
          expect(result).toEqual(jsonNormalized);
        }),
        { numRuns: 100 },
      );
    });

    it('array schema: valid payloads always parse successfully', () => {
      return fc.assert(
        fc.asyncProperty(arbArrayPayload, async (payload) => {
          const jsonNormalized = JSON.parse(JSON.stringify(payload));
          mockFetchWithJson(jsonNormalized);
          const result = await request('/test', arraySchema);
          expect(result).toEqual(jsonNormalized);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('invalid payloads → throws ApiValidationError', () => {
    it('wrong types for simple schema always throw ApiValidationError', () => {
      // Generate payloads where at least one field has the wrong type
      const arbInvalidSimple = fc.oneof(
        // id is not a string
        fc.record({
          id: fc.integer(),
          name: fc.string(),
          amount: fc.double({ noNaN: true, noDefaultInfinity: true }),
          active: fc.boolean(),
        }),
        // amount is not a number
        fc.record({
          id: fc.string(),
          name: fc.string(),
          amount: fc.string(),
          active: fc.boolean(),
        }),
        // active is not a boolean
        fc.record({
          id: fc.string(),
          name: fc.string(),
          amount: fc.double({ noNaN: true, noDefaultInfinity: true }),
          active: fc.string(),
        }),
      );

      return fc.assert(
        fc.asyncProperty(arbInvalidSimple, async (payload) => {
          mockFetchWithJson(payload);
          await expect(request('/test', simpleSchema)).rejects.toThrow(ApiValidationError);
        }),
        { numRuns: 100 },
      );
    });

    it('missing required fields always throw ApiValidationError', () => {
      // Generate objects missing at least one required field
      const arbMissingFields = fc.oneof(
        fc.record({ id: fc.string() }), // missing name, amount, active
        fc.record({ name: fc.string(), amount: fc.integer() }), // missing id, active
        fc.constant({}), // empty object
      );

      return fc.assert(
        fc.asyncProperty(arbMissingFields, async (payload) => {
          mockFetchWithJson(payload);
          await expect(request('/test', simpleSchema)).rejects.toThrow(ApiValidationError);
        }),
        { numRuns: 50 },
      );
    });

    it('ApiValidationError always contains the endpoint path', () => {
      const arbPath = fc
        .string({ minLength: 1, maxLength: 30 })
        .map((s) => `/${s.replace(/[^a-z0-9-]/gi, 'x')}`);

      return fc.assert(
        fc.asyncProperty(arbPath, async (path) => {
          mockFetchWithJson({ wrong: 'shape' });
          try {
            await request(path, simpleSchema);
            // Should not reach here
            expect.fail('Expected ApiValidationError');
          } catch (err) {
            expect(err).toBeInstanceOf(ApiValidationError);
            expect((err as ApiValidationError).endpoint).toBe(path);
          }
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('round-trip: JSON.parse(JSON.stringify(data)) preserves schema validity', () => {
    it('simple schema: serialize → deserialize → parse is identity', () => {
      return fc.assert(
        fc.asyncProperty(arbSimplePayload, async (payload) => {
          // Simulate the JSON round-trip that happens over the wire
          // JSON.stringify normalizes -0 to 0, which is expected behavior
          const wirePayload = JSON.parse(JSON.stringify(payload));

          mockFetchWithJson(wirePayload);
          const result = await request('/test', simpleSchema);

          // The result should equal the JSON-normalized payload
          expect(result).toEqual(wirePayload);
        }),
        { numRuns: 100 },
      );
    });

    it('nested schema: serialize → deserialize → parse is identity', () => {
      return fc.assert(
        fc.asyncProperty(arbNestedPayload, async (payload) => {
          const wirePayload = JSON.parse(JSON.stringify(payload));

          mockFetchWithJson(wirePayload);
          const result = await request('/test', nestedSchema);

          expect(result).toEqual(wirePayload);
        }),
        { numRuns: 100 },
      );
    });

    it('array schema: serialize → deserialize → parse preserves all items', () => {
      return fc.assert(
        fc.asyncProperty(arbArrayPayload, async (payload) => {
          const wirePayload = JSON.parse(JSON.stringify(payload));

          mockFetchWithJson(wirePayload);
          const result = await request('/test', arraySchema);

          expect(result).toEqual(wirePayload);
        }),
        { numRuns: 100 },
      );
    });
  });
});
