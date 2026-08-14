/**
 * Storing a third-party API key.
 *
 * Two properties carry this feature, and both are the kind that fail silently:
 *
 *  1. **The key never comes back.** It is written once and read only by the
 *     server code that calls the provider. A response carrying it would put it
 *     in browser memory, devtools, and any proxy in between for no benefit.
 *  2. **It is encrypted at rest.** The database is dumped to files that get
 *     downloaded over the API, uploaded from other machines, and kept in cloud
 *     storage. A plaintext key would travel in all of them.
 *
 * Both are asserted against the real row, not the response, because a response
 * assertion cannot tell the difference between "encrypted" and "stored in plain
 * text and merely omitted from this particular payload".
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { get, put, del } from '../test/helpers.js';
import { getServiceKey } from '../lib/connected-services.js';

const KEY = 'fnhb_live_9f3a2b7c4d1e';

beforeEach(async () => {
  await prisma.connectedService.deleteMany({});
  vi.stubEnv('INTEGRATION_SECRET', 'test-integration-secret-value');
  vi.stubEnv('FINNHUB_API_KEY', '');
});

afterAll(() => vi.unstubAllEnvs());

describe('PUT /connected-services/finnhub', () => {
  it('stores the key and reports status without it', async () => {
    const res = await put('/connected-services/finnhub', { apiKey: KEY });
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ provider: 'finnhub', configured: true, source: 'database' });
    // Only the tail, never the key.
    expect(body.hint).toBe(KEY.slice(-4));
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it('encrypts the key at rest', async () => {
    await put('/connected-services/finnhub', { apiKey: KEY });

    const row = await prisma.connectedService.findUniqueOrThrow({
      where: { provider: 'finnhub' },
    });
    // The whole point: a dump of this table is not a credential leak.
    expect(row.secretCipher).not.toContain(KEY);
    expect(JSON.stringify(row)).not.toContain(KEY);
    expect(row.secretIv).toBeTruthy();
    expect(row.secretTag).toBeTruthy();
  });

  it('round-trips the key for the code that calls the provider', async () => {
    // Encryption is only useful if the server can still read it back.
    await put('/connected-services/finnhub', { apiKey: KEY });
    expect(await getServiceKey('finnhub')).toBe(KEY);
  });

  it('uses a fresh IV per write, so the same key does not encrypt identically', async () => {
    await put('/connected-services/finnhub', { apiKey: KEY });
    const first = await prisma.connectedService.findUniqueOrThrow({
      where: { provider: 'finnhub' },
    });
    await put('/connected-services/finnhub', { apiKey: KEY });
    const second = await prisma.connectedService.findUniqueOrThrow({
      where: { provider: 'finnhub' },
    });

    expect(second.secretIv).not.toBe(first.secretIv);
    expect(second.secretCipher).not.toBe(first.secretCipher);
  });

  it('replaces an existing key rather than adding a second row', async () => {
    await put('/connected-services/finnhub', { apiKey: KEY });
    await put('/connected-services/finnhub', { apiKey: 'fnhb_live_replacement99' });

    expect(await prisma.connectedService.count({ where: { provider: 'finnhub' } })).toBe(1);
    expect(await getServiceKey('finnhub')).toBe('fnhb_live_replacement99');
  });

  it('refuses an unknown provider', async () => {
    const res = await put('/connected-services/notaservice', { apiKey: KEY });
    expect(res.status).toBe(404);
  });

  it('refuses to store anything when the server cannot encrypt', async () => {
    // Writing the key in plain text instead would put it in the very dumps this
    // design exists to keep it out of, so refusing is the only honest option.
    vi.stubEnv('INTEGRATION_SECRET', '');
    const res = await put('/connected-services/finnhub', { apiKey: KEY });

    expect(res.status).toBe(503);
    expect(await prisma.connectedService.count()).toBe(0);
  });
});

describe('GET /connected-services', () => {
  it('never includes the key, configured or not', async () => {
    await put('/connected-services/finnhub', { apiKey: KEY });

    const res = await get('/connected-services');
    const raw = await res.text();

    expect(res.status).toBe(200);
    expect(raw).not.toContain(KEY);
    // Nor the ciphertext, which has no business leaving the server either.
    const row = await prisma.connectedService.findUniqueOrThrow({
      where: { provider: 'finnhub' },
    });
    expect(raw).not.toContain(row.secretCipher);
  });

  it('reports not configured when nothing is stored', async () => {
    const body = (await (await get('/connected-services')).json()) as Array<{
      provider: string;
      configured: boolean;
      source: string;
    }>;
    const finnhub = body.find((s) => s.provider === 'finnhub');

    expect(finnhub).toMatchObject({ configured: false, source: 'none' });
  });

  it('falls back to the environment so an existing install keeps working', async () => {
    vi.stubEnv('FINNHUB_API_KEY', 'env_key_abcd1234');

    const body = (await (await get('/connected-services')).json()) as Array<{
      provider: string;
      configured: boolean;
      source: string;
      hint: string;
    }>;
    const finnhub = body.find((s) => s.provider === 'finnhub');

    expect(finnhub).toMatchObject({ configured: true, source: 'environment', hint: '1234' });
  });

  it('prefers a stored key over the environment', async () => {
    // The stored key is the more recent, more deliberate act. A leftover env var
    // must not silently override what the user just typed.
    vi.stubEnv('FINNHUB_API_KEY', 'env_key_abcd1234');
    await put('/connected-services/finnhub', { apiKey: KEY });

    expect(await getServiceKey('finnhub')).toBe(KEY);
  });

  it('treats an unreadable row as unconfigured rather than crashing', async () => {
    // What a rotated INTEGRATION_SECRET looks like. Degrading to "no live
    // prices" is survivable; a 500 on a settings page is not.
    await put('/connected-services/finnhub', { apiKey: KEY });
    vi.stubEnv('INTEGRATION_SECRET', 'a-completely-different-secret');

    const res = await get('/connected-services');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<{ provider: string; configured: boolean }>;
    expect(body.find((s) => s.provider === 'finnhub')?.configured).toBe(false);
    expect(await getServiceKey('finnhub')).toBeNull();
  });
});

describe('CoinGecko as a second provider', () => {
  it('is accepted, so the settings page can store a key for it', async () => {
    // Only server change for CoinGecko was adding it to KNOWN_PROVIDERS. Without
    // this, removing it would 404 the UI and nothing but manual testing would say so.
    const res = await put('/connected-services/coingecko', { apiKey: 'CG-demo-key-abcd' });

    expect(res.status).toBe(200);
    expect(await getServiceKey('coingecko')).toBe('CG-demo-key-abcd');
  });

  it('is listed alongside Finnhub', async () => {
    const body = (await (await get('/connected-services')).json()) as Array<{ provider: string }>;
    expect(body.map((s) => s.provider).sort()).toEqual(['coingecko', 'finnhub']);
  });

  it('keeps its key independent of Finnhub', async () => {
    // One row per provider: storing or clearing one must not disturb the other.
    await put('/connected-services/finnhub', { apiKey: KEY });
    await put('/connected-services/coingecko', { apiKey: 'CG-demo-key-abcd' });

    await del('/connected-services/coingecko');

    expect(await getServiceKey('coingecko')).toBeNull();
    expect(await getServiceKey('finnhub')).toBe(KEY);
  });
});

describe('DELETE /connected-services/finnhub', () => {
  it('removes the stored key', async () => {
    await put('/connected-services/finnhub', { apiKey: KEY });

    const res = await del('/connected-services/finnhub');
    expect(res.status).toBe(200);
    expect((await res.json()) as { configured: boolean }).toMatchObject({ configured: false });
    expect(await prisma.connectedService.count()).toBe(0);
  });

  it('is silent when there was nothing to remove', async () => {
    const res = await del('/connected-services/finnhub');
    expect(res.status).toBe(200);
  });
});
