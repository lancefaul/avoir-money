/**
 * Authentication Bypass Tests
 *
 * Verifies that the auth middleware correctly rejects unauthenticated and
 * improperly authenticated requests, while allowing public endpoints through.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */
import { describe, it, expect, afterEach } from 'vitest';
import { rawRequest, rawGet } from './security-helpers.js';

describe('Authentication Bypass', () => {
  // ── Requirement 3.1: Missing Authorization header returns 401 ──

  it('rejects request without Authorization header with 401', async () => {
    const res = await rawGet('/accounts');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  // ── Requirement 3.2: Wrong auth scheme returns 401 ──

  it('rejects request with Basic auth scheme with 401', async () => {
    const res = await rawRequest('GET', '/accounts', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  // ── Requirement 3.3: Wrong Bearer token returns 401 ──

  it('rejects request with wrong Bearer token with 401', async () => {
    const res = await rawRequest('GET', '/accounts', {
      headers: { Authorization: 'Bearer wrong-key' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  // ── Requirement 3.4: Empty Bearer token returns 401 ──

  it('rejects request with empty Bearer token with 401', async () => {
    const res = await rawRequest('GET', '/accounts', {
      headers: { Authorization: 'Bearer ' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  // ── Requirement 3.5: Health endpoint is public ──

  it('allows GET /health without auth (public endpoint)', async () => {
    const res = await rawGet('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  // ── Requirement 3.6: Auth rejection per HTTP method ──

  describe('auth rejection per HTTP method', () => {
    it('rejects unauthenticated GET /accounts with 401', async () => {
      const res = await rawRequest('GET', '/accounts');
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('rejects unauthenticated POST /accounts with 401', async () => {
      const res = await rawRequest('POST', '/accounts', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('rejects unauthenticated PUT /accounts/fake-id with 401', async () => {
      const res = await rawRequest('PUT', '/accounts/fake-id', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('rejects unauthenticated DELETE /accounts/fake-id with 401', async () => {
      const res = await rawRequest('DELETE', '/accounts/fake-id');
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });
  });

  // ── Query-param (?key=) auth is scoped to the backup download route only ──

  describe('query-param auth scope', () => {
    const KEY = 'budget-tracker-dev-key'; // matches vitest.config.ts env

    it('rejects ?key= on a normal API endpoint even when the key is correct', async () => {
      const res = await rawGet(`/accounts?key=${KEY}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('rejects ?key= on a write endpoint even when the key is correct', async () => {
      const res = await rawRequest('DELETE', `/accounts/fake-id?key=${KEY}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('accepts ?key= on the backup download route (browser navigation, no header possible)', async () => {
      // Auth passes, so we reach the handler — a nonexistent id yields 404, not 401.
      const res = await rawGet(`/backups/nonexistent-id/download?key=${KEY}`);
      expect(res.status).not.toBe(401);
    });

    it('still rejects a wrong ?key= on the backup download route', async () => {
      const res = await rawGet('/backups/nonexistent-id/download?key=wrong-key');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('rejects a key of a different length without throwing (constant-time compare)', async () => {
      // A prefix of the real key must be rejected, and the HMAC-based compare
      // must not throw on the length mismatch that timingSafeEqual would reject.
      const res = await rawRequest('GET', '/accounts', {
        headers: { Authorization: `Bearer ${KEY.slice(0, 4)}` },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
    });
  });

  // ── OpenAPI spec is public in dev, gated in production ──

  describe('openapi.json exposure', () => {
    let savedNodeEnv: string | undefined;
    afterEach(() => {
      if (savedNodeEnv !== undefined) process.env['NODE_ENV'] = savedNodeEnv;
      else delete process.env['NODE_ENV'];
    });

    it('serves openapi.json without auth in non-production', async () => {
      savedNodeEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'development';
      const res = await rawGet('/openapi.json');
      expect(res.status).toBe(200);
    });

    it('requires auth for openapi.json in production (401 without a key)', async () => {
      savedNodeEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';
      const res = await rawGet('/openapi.json');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
    });
  });

  // ── Requirement 3.7: Missing API_KEY env var returns 500 ──

  describe('missing API_KEY environment variable', () => {
    let savedApiKey: string | undefined;

    afterEach(() => {
      // Always restore the API_KEY after each test in this block
      if (savedApiKey !== undefined) {
        process.env['API_KEY'] = savedApiKey;
      } else {
        delete process.env['API_KEY'];
      }
    });

    it('returns 500 with generic error when API_KEY is unset', async () => {
      savedApiKey = process.env['API_KEY'];
      delete process.env['API_KEY'];

      const res = await rawGet('/accounts');
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ error: 'Internal server error' });

      // Verify no sensitive details are leaked
      const text = JSON.stringify(body);
      expect(text).not.toContain('API_KEY');
      expect(text).not.toContain('not set');
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('environment');
    });
  });
});
