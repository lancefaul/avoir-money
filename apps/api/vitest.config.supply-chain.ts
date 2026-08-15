import { defineConfig } from 'vitest/config';

/**
 * Minimal vitest config for supply-chain property tests.
 * These tests only read filesystem files (package.json) — no database needed.
 * Skips the default setup.ts which connects to the test database.
 */
export default defineConfig({
  test: {
    globals: true,
    include: [
      'src/lib/__tests__/supply-chain.property.test.ts',
      'src/lib/__tests__/supply-chain.test.ts',
    ],
  },
});
