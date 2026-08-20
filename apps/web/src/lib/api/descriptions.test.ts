import { describe, it, expect, beforeEach, vi } from 'vitest';
import { descriptionsApi } from './descriptions.js';

const mockFetch = () => globalThis.fetch as ReturnType<typeof vi.fn>;
const lastCall = () =>
  mockFetch().mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];

const mockDescription = { id: 'desc_1', name: 'Groceries' };
const mockDescriptions = [
  { id: 'desc_1', name: 'Groceries' },
  { id: 'desc_2', name: 'Gas' },
];

describe('descriptionsApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('list', () => {
    it('calls GET /api/v1/descriptions and returns parsed array', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockDescriptions),
      });

      const result = await descriptionsApi.list();

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [url, init] = lastCall();
      expect(url).toBe('/api/v1/descriptions');
      expect(init.method).toBeUndefined();
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers['Authorization']).toMatch(/^Bearer /);
      expect(result).toEqual(mockDescriptions);
    });

    it('appends search query param when provided', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([mockDescriptions[0]]),
      });

      await descriptionsApi.list('Groc');

      const [url] = lastCall();
      expect(url).toBe('/api/v1/descriptions?search=Groc');
    });

    it('encodes special characters in search param', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      await descriptionsApi.list('a&b=c');

      const [url] = lastCall();
      expect(url).toBe('/api/v1/descriptions?search=a%26b%3Dc');
    });
  });

  describe('create', () => {
    it('calls POST /api/v1/descriptions with name in body', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockDescription),
      });

      const result = await descriptionsApi.create('Groceries');

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [url, init] = lastCall();
      expect(url).toBe('/api/v1/descriptions');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.body).toBe(JSON.stringify({ name: 'Groceries' }));
      expect(result).toEqual(mockDescription);
    });
  });

  describe('rename', () => {
    it('calls PUT /api/v1/descriptions/:id with name in body', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ...mockDescription, name: 'Food' }),
      });

      const result = await descriptionsApi.rename('desc_1', 'Food');

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [url, init] = lastCall();
      expect(url).toBe('/api/v1/descriptions/desc_1');
      expect(init.method).toBe('PUT');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.body).toBe(JSON.stringify({ name: 'Food' }));
      expect(result).toEqual({ ...mockDescription, name: 'Food' });
    });
  });

  describe('delete', () => {
    it('calls DELETE /api/v1/descriptions/:id', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.resolve(null),
      });

      await descriptionsApi.delete('desc_1');

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [url, init] = lastCall();
      expect(url).toBe('/api/v1/descriptions/desc_1');
      expect(init.method).toBe('DELETE');
    });
  });

  describe('merge', () => {
    it('calls POST /api/v1/descriptions/merge with targetId and sourceIds', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockDescription),
      });

      const result = await descriptionsApi.merge('desc_1', ['desc_2', 'desc_3']);

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [url, init] = lastCall();
      expect(url).toBe('/api/v1/descriptions/merge');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.body).toBe(
        JSON.stringify({ targetId: 'desc_1', sourceIds: ['desc_2', 'desc_3'] }),
      );
      expect(result).toEqual(mockDescription);
    });
  });
});
