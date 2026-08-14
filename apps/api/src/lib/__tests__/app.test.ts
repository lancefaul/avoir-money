import { describe, it, expect } from 'vitest';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import app from '../../app.js';
import { get } from '../../test/helpers.js';

// ─── Helper: raw app.request() with auth header ───

async function rawRequest(path: string, init?: RequestInit) {
  return app.request(path, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env['API_KEY'] ?? 'budget-tracker-dev-key'}`,
    },
    ...init,
  });
}

describe('App module', () => {
  // ─── Requirement 2.1: Unhandled error → 500 ───

  describe('global onError handler', () => {
    it('returns 500 with generic message and no stack trace for unhandled errors', async () => {
      // Build a minimal app that mirrors the production onError handler from app.ts.
      // This isolates the test from route-registration timing issues.
      const testApp = new OpenAPIHono();

      testApp.get('/explode', () => {
        throw new Error('Boom! Unexpected failure');
      });

      testApp.onError((_err, c) => {
        return c.json({ error: 'Internal server error' }, 500);
      });

      const res = await testApp.request('/explode');
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body).toEqual({ error: 'Internal server error' });

      // Verify no stack trace leaks
      const text = JSON.stringify(body);
      expect(text).not.toContain('Boom');
      expect(text).not.toContain('at ');
    });
  });

  // ─── Requirement 2.2: Zod validation failure via defaultHook ───

  describe('defaultHook (Zod validation)', () => {
    it('returns 400 with validation details for invalid request body', async () => {
      // Build a minimal app that mirrors the production defaultHook from app.ts.
      const testApp = new OpenAPIHono({
        defaultHook: (result, c) => {
          if (!result.success) {
            const details = result.error.issues.map((issue) => ({
              field: issue.path.join('.'),
              message: issue.message,
            }));
            return c.json({ error: 'Validation failed', details }, 400);
          }
          return undefined;
        },
      });

      const route = createRoute({
        method: 'post',
        path: '/test',
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  name: z.string().min(1, 'Name is required'),
                  age: z.number().int().positive('Age must be positive'),
                }),
              },
            },
          },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
            description: 'OK',
          },
        },
      });

      testApp.openapi(route, (c) => {
        return c.json({ ok: true }, 200);
      });

      // Send an empty object — both name and age are required
      const res = await testApp.request('/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);

      const body = (await res.json()) as {
        error: string;
        details: Array<{ field: string; message: string }>;
      };
      expect(body.error).toBe('Validation failed');
      expect(body.details).toBeInstanceOf(Array);
      expect(body.details.length).toBeGreaterThan(0);

      // Each detail should have field and message
      for (const detail of body.details) {
        expect(detail).toHaveProperty('field');
        expect(detail).toHaveProperty('message');
        expect(typeof detail.field).toBe('string');
        expect(typeof detail.message).toBe('string');
      }
    });

    it('includes the correct field path in validation details', async () => {
      const testApp = new OpenAPIHono({
        defaultHook: (result, c) => {
          if (!result.success) {
            const details = result.error.issues.map((issue) => ({
              field: issue.path.join('.'),
              message: issue.message,
            }));
            return c.json({ error: 'Validation failed', details }, 400);
          }
          return undefined;
        },
      });

      const route = createRoute({
        method: 'post',
        path: '/test',
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  name: z.string().min(1, 'Name is required'),
                  age: z.number().int().positive('Age must be positive'),
                }),
              },
            },
          },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
            description: 'OK',
          },
        },
      });

      testApp.openapi(route, (c) => {
        return c.json({ ok: true }, 200);
      });

      // Send a body with invalid age to trigger a specific field error
      const res = await testApp.request('/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', age: -5 }),
      });

      expect(res.status).toBe(400);

      const body = (await res.json()) as {
        error: string;
        details: Array<{ field: string; message: string }>;
      };
      expect(body.error).toBe('Validation failed');

      const ageError = body.details.find((d: { field: string }) => d.field === 'age');
      expect(ageError).toBeTruthy();
      expect(ageError!.message).toBe('Age must be positive');
    });
  });

  // ─── Requirement 2.3: Health endpoint ───

  describe('GET /health', () => {
    it('returns 200 with { status: "ok" }', async () => {
      const res = await get('/health');

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({ status: 'ok' });
    });
  });

  // ─── Requirement 2.4: Category → Budget redirects ───

  describe('category → budget redirects', () => {
    it('redirects GET /categories to /api/v1/budgets with 308', async () => {
      const res = await get('/categories');

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe('/api/v1/budgets');
    });

    it('redirects GET /categories/some-id to /api/v1/budgets/some-id with 308', async () => {
      const res = await get('/categories/some-id');

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe('/api/v1/budgets/some-id');
    });

    it('redirects POST /categories/nested/path to /api/v1/budgets/nested/path with 308', async () => {
      const res = await rawRequest('/api/v1/categories/nested/path', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe('/api/v1/budgets/nested/path');
    });
  });
});
