/**
 * SSRF Prevention Verification Tests
 *
 * Static analysis tests that verify no user-controlled URLs are fetched
 * server-side, preventing internal network resource access through the API.
 *
 * Requirements: 6.1, 6.2, 6.3
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative } from 'path';

const API_SRC = resolve(__dirname, '..', '..', '..');

/**
 * Recursively collect all .ts files under a directory,
 * excluding node_modules and test files.
 */
function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.turbo') continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.property.test.ts')
    ) {
      files.push(full);
    }
  }
  return files;
}

describe('SSRF Prevention — Static Analysis', () => {
  // ── Requirement 6.1: fetch calls only in prices.ts ──

  it('the only fetch calls in apps/api/src/ are in src/lib/prices.ts', () => {
    const allFiles = collectTsFiles(API_SRC);
    const fetchRegex = /\bfetch\s*\(/;
    const filesWithFetch: string[] = [];

    for (const file of allFiles) {
      // Skip test setup files
      if (file.includes('/test/')) continue;
      const content = readFileSync(file, 'utf-8');
      if (fetchRegex.test(content)) {
        filesWithFetch.push(relative(API_SRC, file));
      }
    }

    // Only prices.ts and snapshot-generator.ts should contain fetch calls
    // (both use hardcoded CoinGecko URLs, no user-controlled input)
    expect(filesWithFetch).toEqual(expect.arrayContaining(['lib/prices.ts']));
    // Filter out allowed files — nothing else should have fetch
    const allowedFetchFiles = new Set(['lib/prices.ts', 'lib/snapshot-generator.ts']);
    const unexpected = filesWithFetch.filter((f) => !allowedFetchFiles.has(f));
    expect(unexpected).toEqual([]);
  });

  // ── Requirement 6.2: No route handler accepts a URL parameter used in fetch/http.get/https.get ──

  it('no route handler accepts a URL parameter used in fetch, http.get, or https.get', () => {
    const routesDir = resolve(API_SRC, 'routes');
    const routeFiles = collectTsFiles(routesDir);
    const urlFetchPattern =
      /(?:fetch|http\.get|https\.get)\s*\(\s*(?:req\.|c\.req\.|params\.|query\.)/;

    for (const file of routeFiles) {
      const content = readFileSync(file, 'utf-8');
      const relPath = relative(API_SRC, file);
      expect(
        urlFetchPattern.test(content),
        `${relPath} should not use user-controlled URLs in fetch/http.get/https.get`,
      ).toBe(false);
    }
  });

  // ── Requirement 6.3: sign-conventions.ts uses hardcoded CONFIG_PATH ──

  it('sign-conventions.ts uses a hardcoded CONFIG_PATH, not user-controlled paths', () => {
    const signConventionsPath = resolve(API_SRC, 'routes', 'sign-conventions.ts');
    const content = readFileSync(signConventionsPath, 'utf-8');

    // Verify the default path is a hardcoded const with a resolve() call.
    // (The route resolves through getConfigPath(), which returns either this
    // hardcoded default or an operator-set env var — never request input.)
    expect(content).toContain('const DEFAULT_CONFIG_PATH = resolve(');

    // Verify the config path is only ever the hardcoded default or an env-var
    // override — not derived from any request-controlled value.
    expect(content).toMatch(
      /process\.env\.SIGN_CONVENTION_CONFIG_PATH\s*\?\?\s*DEFAULT_CONFIG_PATH/,
    );

    // The filename is a literal, not built from anything a request supplies.
    // It moved from `tools/import/` to `packages/db/` when that tool was deleted
    // — the config outlived its original reader because the API grew a route for
    // it. The assertion is pinned to the exact literal on purpose, so a change
    // of location is a decision someone has to make here too rather than
    // something that slips through.
    expect(content).toContain("'sign-conventions.default.json'");

    // Verify readFileSync and writeFileSync only use CONFIG_PATH, not request params
    const readCalls = content.match(/readFileSync\s*\([^)]+\)/g) ?? [];
    for (const call of readCalls) {
      expect(call).toContain('CONFIG_PATH');
    }

    const writeCalls = content.match(/writeFileSync\s*\([^)]+\)/g) ?? [];
    for (const call of writeCalls) {
      expect(call).toContain('CONFIG_PATH');
    }

    // Verify no route parameter is used as a file path
    expect(content).not.toMatch(/c\.req\.(?:param|query)\(['"]\w*[Pp]ath/);
    expect(content).not.toMatch(/c\.req\.(?:param|query)\(['"]\w*[Uu]rl/);
  });
});
