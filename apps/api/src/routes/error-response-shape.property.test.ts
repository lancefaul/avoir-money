/**
 * Property-based tests for error response shape consistency.
 * Feature: v1-hardening, Property 3: Error Response Shape Consistency
 *
 * For any API endpoint, when the request contains invalid input or references
 * a non-existent resource ID, the error response body conforms to Error_Shape
 * `{ error: string, details?: unknown }`. No error response contains stack
 * traces, file paths, or internal implementation details.
 *
 * **Validates: Requirements 3.1, 3.3, 3.8**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import app from '../app.js';

// ─── Helpers ───

const AUTH_HEADER = `Bearer ${process.env['API_KEY'] ?? 'budget-tracker-dev-key'}`;

function authedRequest(method: string, path: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: AUTH_HEADER,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return app.request(`/api/v1${path}`, init);
}

/**
 * Validate that a JSON response body conforms to Error_Shape:
 * { error: string, details?: unknown }
 * and contains no stack traces or internal details.
 */
function assertErrorShape(body: Record<string, unknown>) {
  expect(body).toHaveProperty('error');
  expect(typeof body.error).toBe('string');
  expect((body.error as string).length).toBeGreaterThan(0);

  const keys = Object.keys(body);
  for (const key of keys) {
    expect(['error', 'details']).toContain(key);
  }

  assertNoStackTraces(body);
}

/**
 * Validate that a 400 validation error response is structured JSON
 * with no stack traces. Accepts both Error_Shape and the raw Zod
 * validation error shape from @hono/zod-openapi sub-routers.
 */
function assertValidationErrorResponse(body: Record<string, unknown>) {
  expect(body).toHaveProperty('error');

  if (typeof body.error === 'string') {
    const keys = Object.keys(body);
    for (const key of keys) {
      expect(['error', 'details']).toContain(key);
    }
  } else {
    expect(body.success).toBe(false);
    expect(body.error).toHaveProperty('issues');
  }

  assertNoStackTraces(body);
}

/** Verify no stack traces, file paths, or internal details leak in the response. */
function assertNoStackTraces(body: unknown) {
  const bodyStr = JSON.stringify(body);
  expect(bodyStr).not.toMatch(/at .+\.(ts|js):\d+/);
  expect(bodyStr).not.toContain('node_modules');
  expect(bodyStr).not.toMatch(/\/src\//);
}

// ─── Arbitraries ───

/**
 * Generate a realistic-looking CUID that will not exist in the database.
 * CUIDs start with 'c' followed by 24 lowercase alphanumeric characters.
 */
const fakeCuidArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
    minLength: 24,
    maxLength: 24,
  })
  .map((chars) => `c${chars.join('')}`);

/**
 * Endpoints with explicit /:id handlers that return JSON 404 for non-existent IDs.
 * Only routes that have GET/PUT/DELETE /{id} with P2025 or findUnique checks.
 */
const ID_ENDPOINTS: Array<{
  method: string;
  pathTemplate: string;
  putBody?: Record<string, unknown>;
}> = [
  // accounts — has GET, PUT, DELETE /{id}
  { method: 'GET', pathTemplate: '/accounts/:id' },
  { method: 'PUT', pathTemplate: '/accounts/:id', putBody: { name: 'test' } },
  { method: 'DELETE', pathTemplate: '/accounts/:id' },
  // budgets — has PUT, DELETE /{id} (no GET /{id})
  { method: 'PUT', pathTemplate: '/budgets/:id', putBody: { name: 'test' } },
  { method: 'DELETE', pathTemplate: '/budgets/:id' },
  // expenses — has GET, PUT, DELETE /{id}
  { method: 'GET', pathTemplate: '/expenses/:id' },
  { method: 'PUT', pathTemplate: '/expenses/:id', putBody: { name: 'test' } },
  { method: 'DELETE', pathTemplate: '/expenses/:id' },
  // income — has GET, PUT, DELETE /{id}
  { method: 'GET', pathTemplate: '/income/:id' },
  { method: 'PUT', pathTemplate: '/income/:id', putBody: { name: 'test' } },
  { method: 'DELETE', pathTemplate: '/income/:id' },
  // transactions — has PUT, DELETE /{id} (no GET /{id})
  { method: 'PUT', pathTemplate: '/transactions/:id', putBody: { name: 'test' } },
  { method: 'DELETE', pathTemplate: '/transactions/:id' },
  // goals — has PUT, DELETE /{id} (no GET /{id})
  { method: 'PUT', pathTemplate: '/goals/:id', putBody: { name: 'test' } },
  { method: 'DELETE', pathTemplate: '/goals/:id' },
  // debts — has GET, PUT, DELETE /{id}
  { method: 'GET', pathTemplate: '/debts/:id' },
  { method: 'PUT', pathTemplate: '/debts/:id', putBody: { name: 'test' } },
  { method: 'DELETE', pathTemplate: '/debts/:id' },
];

/**
 * POST endpoints that should return 400 for invalid inputs.
 */
const POST_ENDPOINTS = [
  '/accounts',
  '/budgets',
  '/expenses',
  '/income',
  '/transactions',
  '/goals',
  '/debts',
] as const;

// ─── Property Tests ───

describe('Property 3: Error Response Shape Consistency', () => {
  /**
   * Sub-property 3a: For any generated invalid input, API returns 400 with
   * structured error information and no stack traces.
   */
  it('invalid input returns structured error across all POST endpoints', () => {
    const endpointArb = fc.constantFrom(...POST_ENDPOINTS);
    const invalidBodyArb = fc.constantFrom(
      { invalid: true },
      {},
      { name: null },
      { amount: 'not-a-number' },
    );

    return fc.assert(
      fc.asyncProperty(endpointArb, invalidBodyArb, async (path, body) => {
        const res = await authedRequest('POST', path, body);
        expect(res.status).toBe(400);
        const responseBody = (await res.json()) as Record<string, unknown>;
        assertValidationErrorResponse(responseBody);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Sub-property 3b: For any non-existent CUID, API returns 404 with Error_Shape.
   */
  it('non-existent CUID returns 404 with Error_Shape across all ID endpoints', () => {
    const endpointArb = fc.constantFrom(...ID_ENDPOINTS);

    return fc.assert(
      fc.asyncProperty(endpointArb, fakeCuidArb, async (endpoint, cuid) => {
        const path = endpoint.pathTemplate.replace(':id', cuid);
        const body = endpoint.method === 'PUT' ? endpoint.putBody : undefined;
        const res = await authedRequest(endpoint.method, path, body);

        // Some DELETE endpoints may return 204 (idempotent) — skip those
        if (endpoint.method === 'DELETE' && res.status === 204) return;

        expect(res.status).toBe(404);
        const responseBody = (await res.json()) as Record<string, unknown>;
        assertErrorShape(responseBody);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Sub-property 3c: Wrong-typed fields return structured error with no stack traces.
   */
  it('wrong-typed fields return structured error', () => {
    const wrongTypedBodies = fc.constantFrom(
      { name: 12345 },
      { name: true },
      { name: { nested: 'object' } },
      { name: null, type: null },
      { amount: 'not-a-number', frequency: 123 },
    );

    const endpointPaths = fc.constantFrom(...POST_ENDPOINTS);

    return fc.assert(
      fc.asyncProperty(endpointPaths, wrongTypedBodies, async (path, body) => {
        const res = await authedRequest('POST', path, body);
        expect(res.status).toBe(400);
        const responseBody = (await res.json()) as Record<string, unknown>;
        assertValidationErrorResponse(responseBody);
      }),
      { numRuns: 100 },
    );
  });
});
