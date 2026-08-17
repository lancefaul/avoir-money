import { Hono } from 'hono';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SignConventionConfigSchema, DEFAULT_SIGN_CONVENTION_CONFIG } from '@budget-tracker/core';

const app = new Hono();

const __dirname = dirname(fileURLToPath(import.meta.url));
// `tools/import` was deleted — it read a workbook that is not in the repo, had
// never been run in this tree, and produced output nothing consumes. The config
// outlived it, because the API grew a route for it, and now lives at
// `packages/db/sign-conventions.default.json`.
//
// The Rust port resolves this differently and deliberately — beside the
// database, so a per-user setting travels with a user's data rather than with
// the installation. This path only has to keep the reference backend working
// while it remains the differential harness's oracle.
const DEFAULT_CONFIG_PATH = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'sign-conventions.default.json',
);

/**
 * Resolve the sign-convention config path. Honors the
 * SIGN_CONVENTION_CONFIG_PATH env var override so tests can point at an
 * isolated temp file instead of clobbering the real shared config.
 */
function getConfigPath(): string {
  return process.env.SIGN_CONVENTION_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
}

function loadConfig() {
  const CONFIG_PATH = getConfigPath();
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = SignConventionConfigSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(
        '[sign-conventions] Invalid config file, using defaults:',
        result.error.format(),
      );
      return DEFAULT_SIGN_CONVENTION_CONFIG;
    }
    return result.data;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
      return DEFAULT_SIGN_CONVENTION_CONFIG;
    }
    console.warn('[sign-conventions] Failed to read config file, using defaults:', err);
    return DEFAULT_SIGN_CONVENTION_CONFIG;
  }
}

// ─── GET / ───
app.get('/', async (c) => {
  const config = loadConfig();
  return c.json(config, 200);
});

// ─── PUT / ───
app.put('/', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const result = SignConventionConfigSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return c.json({ error: 'Validation failed', details }, 400);
  }

  const body = result.data;
  const CONFIG_PATH = getConfigPath();
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(body, null, 2), 'utf-8');
    return c.json(body, 200);
  } catch (err: unknown) {
    console.error('[sign-conventions] Failed to write config file:', err);
    return c.json({ error: 'Failed to write configuration file' }, 500);
  }
});

export default app;
