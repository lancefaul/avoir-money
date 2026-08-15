import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { existsSync, unlinkSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { get, put } from '../test/helpers.js';

// Isolate from the REAL tools/import/sign-conventions.json via the route's
// SIGN_CONVENTION_CONFIG_PATH override — this property suite PUTs many configs
// and must never write to the shared config file.
const TMP_DIR = mkdtempSync(join(tmpdir(), 'sign-conv-prop-'));
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

// Generator for valid SignConventionConfig objects
const validConfigArb = fc.record({
  expense: fc.record({
    positiveMeaning: fc.constantFrom('money_out' as const, 'money_in' as const),
    negativeMeaning: fc.constantFrom('refund' as const, 'ignore' as const),
  }),
  income: fc.record({
    positiveMeaning: fc.constantFrom('money_in' as const, 'money_out' as const),
    negativeMeaning: fc.constantFrom('flip_sign' as const, 'ignore' as const),
  }),
  transfer: fc.record({
    positiveMeaning: fc.constantFrom('withdrawal' as const, 'deposit' as const),
  }),
  trade: fc.record({
    positiveMeaning: fc.constantFrom('buy' as const, 'sell' as const),
  }),
  refund: fc.record({
    positiveMeaning: fc.constant('money_in' as const),
  }),
});

afterEach(() => {
  cleanupConfigFile();
});

/**
 * Feature: import-sign-conventions, Property 5: API PUT/GET round-trip
 * Validates: Requirements 6.2, 3.1
 *
 * For any valid SignConventionConfig, PUTting it to the API endpoint then
 * GETting from the same endpoint should return a config deeply equal to the one that was PUT.
 */
describe('Property 5: API PUT/GET round-trip', () => {
  it('GET after PUT returns the same config that was PUT', async () => {
    await fc.assert(
      fc.asyncProperty(validConfigArb, async (config) => {
        const putRes = await put('/sign-conventions', config);
        expect(putRes.status).toBe(200);
        const putBody = await putRes.json();
        expect(putBody).toEqual(config);

        const getRes = await get('/sign-conventions');
        expect(getRes.status).toBe(200);
        const getBody = await getRes.json();
        expect(getBody).toEqual(config);
      }),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: import-sign-conventions, Property 6: API rejects invalid configs
 * Validates: Requirements 6.3
 *
 * For any object that fails SignConventionConfigSchema validation,
 * PUTting it to the API endpoint should return a 400 status code.
 */
describe('Property 6: API rejects invalid configs', () => {
  it('rejects objects with missing top-level keys', async () => {
    const keys = ['expense', 'income', 'transfer', 'trade', 'refund'] as const;
    await fc.assert(
      fc.asyncProperty(validConfigArb, fc.constantFrom(...keys), async (config, keyToRemove) => {
        const broken = { ...config };
        delete (broken as Record<string, unknown>)[keyToRemove];
        const res = await put('/sign-conventions', broken);
        expect(res.status).toBe(400);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects objects with invalid enum values', async () => {
    const invalidValue = fc
      .string({ minLength: 1 })
      .filter(
        (s) =>
          ![
            'money_out',
            'money_in',
            'refund',
            'ignore',
            'flip_sign',
            'withdrawal',
            'deposit',
            'buy',
            'sell',
          ].includes(s),
      );
    await fc.assert(
      fc.asyncProperty(
        validConfigArb,
        fc.constantFrom('expense', 'income', 'transfer', 'trade', 'refund'),
        invalidValue,
        async (config, key, bad) => {
          const broken = {
            ...config,
            [key]: {
              ...(config as Record<string, Record<string, unknown>>)[key],
              positiveMeaning: bad,
            },
          };
          const res = await put('/sign-conventions', broken);
          expect(res.status).toBe(400);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects an empty object', async () => {
    const res = await put('/sign-conventions', {});
    expect(res.status).toBe(400);
  });
});
