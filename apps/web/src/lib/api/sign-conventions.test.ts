import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signConventionsApi } from './sign-conventions.js';
import type { SignConventionConfig } from '@budget-tracker/core';

const mockConfig: SignConventionConfig = {
  expense: { positiveMeaning: 'money_out', negativeMeaning: 'refund' },
  income: { positiveMeaning: 'money_in', negativeMeaning: 'flip_sign' },
  transfer: { positiveMeaning: 'withdrawal' },
  trade: { positiveMeaning: 'buy' },
  refund: { positiveMeaning: 'money_in' },
};

describe('signConventionsApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('get', () => {
    it('calls GET /api/v1/sign-conventions and returns parsed config', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockConfig),
      });

      const result = await signConventionsApi.get();

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe('/api/v1/sign-conventions');
      expect(init.method).toBeUndefined();
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers['Authorization']).toMatch(/^Bearer /);
      expect(result).toEqual(mockConfig);
    });
  });

  describe('save', () => {
    it('calls PUT /api/v1/sign-conventions with JSON body and returns parsed config', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockConfig),
      });

      const result = await signConventionsApi.save(mockConfig);

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe('/api/v1/sign-conventions');
      expect(init.method).toBe('PUT');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers['Authorization']).toMatch(/^Bearer /);
      expect(init.body).toBe(JSON.stringify(mockConfig));
      expect(result).toEqual(mockConfig);
    });
  });
});
