/**
 * Property-based tests for supply chain security hardening.
 * Feature: supply-chain-hardening
 *
 * Property 1: No unpinned non-workspace dependencies — **Validates: Requirements AC-1.1**
 * Property 2: Workspace references are preserved — **Validates: Requirements AC-1.4**
 * Property 3: CI workflow pnpm version matches packageManager field — **Validates: Requirements AC-5.3**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Constants ───

/**
 * The package.json files covered by the pinning policy (relative to repo root).
 *
 * `apps/mcp` was removed from this list on 2026-07-18 when that package was
 * deleted. `apps/showcase` was added at the same time — it had never been
 * covered and turned out to be already compliant.
 *
 * `packages/ui` was added on 2026-07-27 after its 5 unpinned devDependencies
 * (@testing-library/{jest-dom,react,user-event}, fast-check, jsdom) were pinned.
 * Its two `peerDependencies` (react, react-dom) are correctly ranged and are not
 * a violation; this check only scans dependencies + devDependencies.
 */
const PACKAGE_JSON_PATHS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/showcase/package.json',
  'packages/core/package.json',
  'packages/db/package.json',
  'packages/ui/package.json',
] as const;

/** Patterns that indicate an unpinned version specifier. */
const UNPINNED_PATTERNS = ['^', '~', '*', '>=', '<=', '>', '<', 'latest'];

// ─── Helpers ───

/** Resolve a repo-relative path to an absolute path. */
function repoRoot(): string {
  // vitest runs from apps/api, so go up two levels to reach the monorepo root
  return resolve(__dirname, '..', '..', '..', '..', '..');
}

interface DepEntry {
  packageJsonPath: string;
  depName: string;
  versionSpecifier: string;
}

/** Extract all non-workspace dependency entries from all package.json files. */
function getAllNonWorkspaceDeps(): DepEntry[] {
  const root = repoRoot();
  const entries: DepEntry[] = [];

  for (const relPath of PACKAGE_JSON_PATHS) {
    const absPath = resolve(root, relPath);
    const pkg = JSON.parse(readFileSync(absPath, 'utf-8'));

    for (const section of ['dependencies', 'devDependencies'] as const) {
      const deps = pkg[section];
      if (!deps) continue;
      for (const [name, version] of Object.entries(deps)) {
        const v = version as string;
        // Skip workspace references -- they are local packages, not registry deps
        if (v.startsWith('workspace:')) continue;
        entries.push({ packageJsonPath: relPath, depName: name, versionSpecifier: v });
      }
    }
  }

  return entries;
}

interface WorkspaceDepEntry {
  packageJsonPath: string;
  depName: string;
  versionSpecifier: string;
}

/** Extract all workspace-protocol dependency entries from all package.json files. */
function getAllWorkspaceDeps(): WorkspaceDepEntry[] {
  const root = repoRoot();
  const entries: WorkspaceDepEntry[] = [];

  for (const relPath of PACKAGE_JSON_PATHS) {
    const absPath = resolve(root, relPath);
    const pkg = JSON.parse(readFileSync(absPath, 'utf-8'));

    for (const section of ['dependencies', 'devDependencies'] as const) {
      const deps = pkg[section];
      if (!deps) continue;
      for (const [name, version] of Object.entries(deps)) {
        const v = version as string;
        if (v.startsWith('workspace:')) {
          entries.push({ packageJsonPath: relPath, depName: name, versionSpecifier: v });
        }
      }
    }
  }

  return entries;
}

// ─── Property 1 ───

describe('Feature: supply-chain-hardening, Property 1: No unpinned non-workspace dependencies', () => {
  const allDeps = getAllNonWorkspaceDeps();

  // Sanity check: we expect roughly 57 non-workspace specifiers
  it('finds a reasonable number of non-workspace dependencies', () => {
    expect(allDeps.length).toBeGreaterThanOrEqual(40);
  });

  /**
   * **Validates: Requirements AC-1.1**
   *
   * For any non-workspace dependency specifier in any package.json,
   * the version string must be an exact version -- no range operators
   * or keywords that allow version drift.
   */
  it('all non-workspace dependency specifiers are exact versions', () => {
    fc.assert(
      fc.property(fc.constantFrom(...allDeps), (dep) => {
        for (const pattern of UNPINNED_PATTERNS) {
          expect(
            dep.versionSpecifier.includes(pattern),
            `${dep.packageJsonPath} -> ${dep.depName}: "${dep.versionSpecifier}" contains unpinned pattern "${pattern}"`,
          ).toBe(false);
        }
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2 ───

describe('Feature: supply-chain-hardening, Property 2: Workspace references are preserved', () => {
  const allWorkspaceDeps = getAllWorkspaceDeps();

  // Sanity check: we expect at least a few workspace references across the monorepo
  it('finds workspace dependencies in the monorepo', () => {
    expect(allWorkspaceDeps.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * **Validates: Requirements AC-1.4**
   *
   * For any dependency specifier using the workspace: protocol in any
   * package.json, the value must be exactly "workspace:*". The pinning
   * process must not modify workspace references -- they are local
   * package links, not registry dependencies.
   */
  it('all workspace dependency specifiers are exactly "workspace:*"', () => {
    fc.assert(
      fc.property(fc.constantFrom(...allWorkspaceDeps), (dep) => {
        expect(
          dep.versionSpecifier,
          `${dep.packageJsonPath} -> ${dep.depName}: expected "workspace:*" but got "${dep.versionSpecifier}"`,
        ).toBe('workspace:*');
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 3 ───

describe('Feature: supply-chain-hardening, Property 3: CI workflow pnpm version matches packageManager field', () => {
  /**
   * Extract the pnpm version from the root package.json packageManager field.
   * Expected format: "pnpm@x.y.z"
   */
  function getPnpmVersionFromPackageJson(): string {
    const root = repoRoot();
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
    const packageManager: string = pkg.packageManager ?? '';
    const match = packageManager.match(/^pnpm@(.+)$/);
    if (!match) {
      throw new Error(`packageManager field is missing or not pnpm: "${packageManager}"`);
    }
    return match[1]!;
  }

  /**
   * Extract the pnpm version from the CI workflow pnpm/action-setup step.
   * Reads the YAML as plain text and uses regex to find the version field.
   */
  function getPnpmVersionFromCIWorkflow(): string {
    const root = repoRoot();
    const content = readFileSync(resolve(root, 'docs', 'ci-cd-supply-chain.yml'), 'utf-8');
    // Match the version field that follows a uses: pnpm/action-setup line
    const match = content.match(/uses:\s*pnpm\/action-setup@\S+[\s\S]*?version:\s*(\S+)/);
    if (!match) {
      throw new Error('Could not find pnpm/action-setup version in CI workflow');
    }
    // Strip any trailing comment (e.g., "9.15.4  # comment" -> "9.15.4")
    return match[1]!.replace(/#.*$/, '').trim();
  }

  const packageJsonVersion = getPnpmVersionFromPackageJson();
  const ciWorkflowVersion = getPnpmVersionFromCIWorkflow();

  // Sanity checks: both versions should be non-empty semver-like strings
  it('extracts a valid pnpm version from package.json packageManager field', () => {
    expect(packageJsonVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('extracts a valid pnpm version from CI workflow pnpm/action-setup step', () => {
    expect(ciWorkflowVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  /**
   * **Validates: Requirements AC-5.3**
   *
   * For any version of the CI workflow file and the root package.json,
   * the pnpm version specified in the pnpm/action-setup step must exactly
   * match the version in the packageManager field of package.json.
   *
   * This is a sync invariant -- whenever either file changes, the other
   * must be updated to match. A mismatch causes lockfile format differences
   * and resolution inconsistencies between CI and local development.
   */
  it('CI workflow pnpm version matches packageManager field', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        expect(
          ciWorkflowVersion,
          `CI workflow pnpm version "${ciWorkflowVersion}" does not match packageManager version "${packageJsonVersion}"`,
        ).toBe(packageJsonVersion);
      }),
      { numRuns: 20 },
    );
  });
});
