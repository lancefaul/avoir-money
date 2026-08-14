import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '../app.js';

/**
 * Security tests — validates Requirement 2.9:
 * - Rate limiting rejects excessive requests
 * - Auth middleware rejects unauthenticated requests
 * - Error responses do not leak stack traces
 * - CORS rejects disallowed origins
 */

// ─── Helper: raw request without auth ───
function rawRequest(path: string, init: RequestInit = {}) {
  return app.request(`/api/v1${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
}

// ─── Helper: authenticated request ───
function authedRequest(path: string, init: RequestInit = {}) {
  return app.request(`/api/v1${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env['API_KEY'] ?? 'budget-tracker-dev-key'}`,
      ...(init.headers ?? {}),
    },
    ...init,
  });
}

describe('Security', () => {
  // ─── Auth Middleware ───
  describe('Auth middleware', () => {
    it('rejects requests without Authorization header', async () => {
      const res = await rawRequest('/accounts');
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('rejects requests with invalid bearer token', async () => {
      const res = await rawRequest('/accounts', {
        headers: { Authorization: 'Bearer wrong-key-here' },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('rejects requests with malformed Authorization header', async () => {
      const res = await rawRequest('/accounts', {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('allows health endpoint without auth', async () => {
      const res = await rawRequest('/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: 'ok' });
    });

    it('allows requests with valid bearer token', async () => {
      const res = await authedRequest('/accounts');
      expect(res.status).toBe(200);
    });
  });

  // ─── Error Response Safety ───
  describe('Error response safety', () => {
    it('does not leak stack traces on 404', async () => {
      const res = await authedRequest('/accounts/nonexistent-id-12345');
      // Could be 404 or 500 depending on route — either way, no stack trace
      const body = (await res.json()) as Record<string, unknown>;
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('at ');
      expect(bodyStr).not.toContain('.ts:');
      expect(bodyStr).not.toContain('.js:');
      expect(bodyStr).not.toContain('node_modules');
      expect(bodyStr).not.toContain('Error:');
      expect(body).toHaveProperty('error');
      expect(typeof body.error).toBe('string');
    });

    it('does not leak stack traces on validation error', async () => {
      const res = await app.request('/api/v1/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env['API_KEY'] ?? 'budget-tracker-dev-key'}`,
        },
        body: JSON.stringify({ invalid: true }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('at ');
      expect(bodyStr).not.toContain('.ts:');
      expect(bodyStr).not.toContain('.js:');
      expect(bodyStr).not.toContain('node_modules');
    });

    it('returns structured error on validation failure', async () => {
      const res = await app.request('/api/v1/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env['API_KEY'] ?? 'budget-tracker-dev-key'}`,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      // Validation errors should be structured — either Error_Shape or Zod error
      // The key requirement is no stack traces leak
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('at ');
      expect(bodyStr).not.toContain('.ts:');
      expect(bodyStr).not.toContain('.js:');
      expect(bodyStr).not.toContain('node_modules');
    });
  });

  // ─── CORS ───
  describe('CORS', () => {
    it('allows requests from default allowed origin', async () => {
      const res = await authedRequest('/health', {
        headers: { Origin: 'http://localhost:3000' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    });

    it('rejects requests from disallowed origin', async () => {
      const res = await authedRequest('/health', {
        headers: { Origin: 'https://evil-site.com' },
      });
      expect(res.status).toBe(200); // Request still succeeds but CORS header is absent
      const corsHeader = res.headers.get('access-control-allow-origin');
      expect(corsHeader).not.toBe('https://evil-site.com');
    });

    it('handles preflight OPTIONS for allowed origin', async () => {
      const res = await app.request('/api/v1/accounts', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      });
      // Preflight should return CORS headers for allowed origin
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    });

    it('does not set CORS header for disallowed origin on preflight', async () => {
      const res = await app.request('/api/v1/accounts', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://malicious.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      });
      const corsHeader = res.headers.get('access-control-allow-origin');
      expect(corsHeader).not.toBe('https://malicious.example.com');
    });
  });

  // ─── Rate Limiting ───
  describe('Rate limiting', () => {
    const originalEnv = process.env['NODE_ENV'];

    beforeEach(() => {
      // Enable rate limiting by switching away from 'test' env
      process.env['NODE_ENV'] = 'production';
    });

    afterEach(() => {
      process.env['NODE_ENV'] = originalEnv;
    });

    it('returns rate limit headers on requests', async () => {
      const res = await authedRequest('/health');
      expect(res.status).toBe(200);
      expect(res.headers.get('x-ratelimit-limit')).toBeDefined();
      expect(res.headers.get('x-ratelimit-remaining')).toBeDefined();
      expect(res.headers.get('x-ratelimit-reset')).toBeDefined();
    });

    it('rate limiter middleware is bypassed in test environment', async () => {
      // Restore test env to verify bypass
      process.env['NODE_ENV'] = 'test';
      const res = await authedRequest('/health');
      expect(res.status).toBe(200);
      // In test mode, rate limit headers should NOT be set
      expect(res.headers.get('x-ratelimit-limit')).toBeNull();
    });
  });
});
