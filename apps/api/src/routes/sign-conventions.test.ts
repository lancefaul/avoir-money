import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { existsSync, unlinkSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { get, put } from '../test/helpers.js';
import { DEFAULT_SIGN_CONVENTION_CONFIG } from '@budget-tracker/core';

// Isolate from the REAL tools/import/sign-conventions.json. The route honors
// SIGN_CONVENTION_CONFIG_PATH, so point it at a throwaway temp file for the
// duration of this suite — these tests write and delete the config, and must
// never touch the shared config consumed by the import tool.
const TMP_DIR = mkdtempSync(join(tmpdir(), 'sign-conv-api-'));
const CONFIG_PATH = join(TMP_DIR, 'sign-conventions.json');

beforeAll(() => {
  process.env.SIGN_CONVENTION_CONFIG_PATH = CONFIG_PATH;
});

afterAll(() => {
  delete process.env.SIGN_CONVENTION_CONFIG_PATH;
  rmSync(TMP_DIR, { recursive: true, force: true });
});

function cleanupConfigFile() {
  try {
    if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
  } catch {
    /* ignore */
  }
}

afterEach(() => {
  cleanupConfigFile();
});

describe('Sign Conventions API', () => {
  describe('GET /sign-conventions', () => {
    it('returns defaults when no config file exists', async () => {
      cleanupConfigFile(); // ensure no file
      const res = await get('/sign-conventions');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(DEFAULT_SIGN_CONVENTION_CONFIG);
    });

    it('returns defaults when config file contains invalid JSON schema', async () => {
      // Write an invalid config file (missing required fields)
      writeFileSync(CONFIG_PATH, JSON.stringify({ invalid: 'schema' }), 'utf-8');

      const res = await get('/sign-conventions');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(DEFAULT_SIGN_CONVENTION_CONFIG);
    });
  });

  describe('PUT /sign-conventions', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await put('/sign-conventions', { expense: { positiveMeaning: 'money_out' } });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; details: unknown[] };
      expect(body).toHaveProperty('error', 'Validation failed');
      expect(body).toHaveProperty('details');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('PUT then GET round-trip with a specific config', async () => {
      const config = {
        expense: { positiveMeaning: 'money_in', negativeMeaning: 'ignore' },
        income: { positiveMeaning: 'money_out', negativeMeaning: 'ignore' },
        transfer: { positiveMeaning: 'deposit' },
        trade: { positiveMeaning: 'sell' },
        refund: { positiveMeaning: 'money_in' },
      };

      const putRes = await put('/sign-conventions', config);
      expect(putRes.status).toBe(200);
      expect(await putRes.json()).toEqual(config);

      const getRes = await get('/sign-conventions');
      expect(getRes.status).toBe(200);
      expect(await getRes.json()).toEqual(config);
    });
  });
});

describe('File system error handling', () => {
  it('PUT returns 500 when directory is not writable', async () => {
    const { chmodSync } = await import('fs');
    const { dirname } = await import('path');

    const dir = dirname(CONFIG_PATH);
    const originalMode = 0o755;

    try {
      // Make directory read-only
      chmodSync(dir, 0o444);

      const config = {
        expense: { positiveMeaning: 'money_in', negativeMeaning: 'ignore' },
        income: { positiveMeaning: 'money_out', negativeMeaning: 'ignore' },
        transfer: { positiveMeaning: 'deposit' },
        trade: { positiveMeaning: 'sell' },
        refund: { positiveMeaning: 'money_in' },
      };

      const res = await put('/sign-conventions', config);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ error: 'Failed to write configuration file' });
    } finally {
      // Restore directory permissions
      chmodSync(dir, originalMode);
    }
  });
});
