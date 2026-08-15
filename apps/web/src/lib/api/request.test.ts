import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { request, ApiError, ApiValidationError } from './request.js';

const testSchema = z.object({ id: z.string(), name: z.string() });

describe('request()', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('success path', () => {
    it('returns parsed data when response is OK and matches schema', async () => {
      const payload = { id: 'abc123', name: 'Test Account' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 200 }),
      );

      const result = await request('/accounts', testSchema);

      expect(result).toEqual(payload);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/accounts',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: expect.stringMatching(/^Bearer /),
          }),
        }),
      );
    });

    it('passes custom init options through to fetch', async () => {
      const payload = { id: '1', name: 'Created' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 201 }),
      );

      await request('/accounts', testSchema, {
        method: 'POST',
        body: JSON.stringify({ name: 'Created' }),
      });

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/accounts',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Created' }) }),
      );
    });
  });

  describe('error path', () => {
    it('throws ApiError with server message when response is non-OK', async () => {
      const errorBody = { error: 'Account not found' };
      (fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(errorBody), { status: 404, statusText: 'Not Found' }),
        ),
      );

      await expect(request('/accounts/xyz', testSchema)).rejects.toThrow(ApiError);
      await expect(request('/accounts/xyz', testSchema)).rejects.toThrow('Account not found');
    });

    it('falls back to statusText when response body has no error field', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response('not json', { status: 500, statusText: 'Internal Server Error' }),
      );

      await expect(request('/fail', testSchema)).rejects.toThrow('Internal Server Error');
    });

    it('includes method and path in ApiError description', async () => {
      const errorBody = { error: 'Bad request' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify(errorBody), { status: 400, statusText: 'Bad Request' }),
      );

      try {
        await request('/accounts', testSchema, { method: 'POST' });
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).description).toBe('POST /accounts → 400');
      }
    });
  });

  describe('204 No Content', () => {
    it('returns undefined when response status is 204', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 204 }));

      const result = await request('/accounts/abc', z.void(), { method: 'DELETE' });

      expect(result).toBeUndefined();
    });
  });

  describe('Zod validation failure', () => {
    it('throws ApiValidationError when response does not match schema', async () => {
      const invalidPayload = { id: 123, name: null }; // id should be string, name should be string
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify(invalidPayload), { status: 200 }),
      );

      await expect(request('/accounts', testSchema)).rejects.toThrow(ApiValidationError);
    });

    it('includes endpoint path in ApiValidationError', async () => {
      const invalidPayload = { wrong: 'shape' };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(JSON.stringify(invalidPayload), { status: 200 }),
      );

      try {
        await request('/accounts/list', testSchema);
      } catch (err) {
        expect(err).toBeInstanceOf(ApiValidationError);
        expect((err as ApiValidationError).endpoint).toBe('/accounts/list');
        expect((err as ApiValidationError).zodError).toBeInstanceOf(z.ZodError);
      }
    });
  });

  describe('network errors', () => {
    it('throws ApiError with user-friendly message on network failure', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(request('/accounts', testSchema)).rejects.toThrow(ApiError);
      await expect(request('/accounts', testSchema)).rejects.toThrow('Unable to reach the server');
    });

    it('re-throws non-network errors as-is', async () => {
      const customError = new Error('Something unexpected');
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(customError);

      await expect(request('/accounts', testSchema)).rejects.toThrow('Something unexpected');
    });
  });
});

// REMOVED 2026-08-10: the Tauri IPC transport suite.
//
// These tests were correct and are now meaningless — the transport they
// covered no longer exists. The Electron shell serves the app from the backend
// over HTTP, so the desktop runs the SAME `fetch` path the browser does, and
// the suites above cover it for both.
//
// Worth stating, because it is the reason the removal is an improvement rather
// than a loss of coverage: while two transports existed, only the HTTP one was
// exercised end-to-end, and a divergence between them was possible. Now there
// is nothing to diverge.
