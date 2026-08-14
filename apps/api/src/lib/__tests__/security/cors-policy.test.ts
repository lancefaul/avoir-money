/**
 * CORS Policy Tests
 *
 * Verifies that the CORS policy only allows configured origins and
 * rejects cross-origin requests from unauthorized domains.
 *
 * Requirements: 8.1, 8.2, 8.3
 */
import { describe, it, expect } from 'vitest';
import app from '../../../app.js';

const AUTH_HEADER = `Bearer ${process.env['API_KEY'] ?? 'budget-tracker-dev-key'}`;

describe('CORS Policy', () => {
  // ── Requirement 8.1: Allowed origin gets Access-Control-Allow-Origin ──

  it('includes Access-Control-Allow-Origin for allowed origin (http://localhost:3000)', async () => {
    const res = await app.request('/api/v1/accounts', {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:3000',
        Authorization: AUTH_HEADER,
      },
    });

    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  // ── Requirement 8.2: Disallowed origin does not get Access-Control-Allow-Origin ──

  it('does not include Access-Control-Allow-Origin for disallowed origin (https://evil.com)', async () => {
    const res = await app.request('/api/v1/accounts', {
      method: 'GET',
      headers: {
        Origin: 'https://evil.com',
        Authorization: AUTH_HEADER,
      },
    });

    const acao = res.headers.get('access-control-allow-origin');
    // Should be null or not set to the evil origin
    expect(acao).not.toBe('https://evil.com');
  });

  // ── Requirement 8.3: Preflight OPTIONS with disallowed origin ──

  it('preflight OPTIONS with disallowed origin does not grant CORS access', async () => {
    const res = await app.request('/api/v1/accounts', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });

    const acao = res.headers.get('access-control-allow-origin');
    expect(acao).not.toBe('https://evil.com');
  });

  it('preflight OPTIONS with allowed origin grants CORS access', async () => {
    const res = await app.request('/api/v1/accounts', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });

    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });
});
