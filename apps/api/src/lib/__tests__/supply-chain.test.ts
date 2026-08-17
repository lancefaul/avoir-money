/**
 * Example-based unit tests for supply chain security hardening.
 * These tests verify specific configuration values in .npmrc.
 *
 * Validates: AC-2.1, AC-2.2, AC-2.3, AC-2.4, AC-2.5, AC-2.6, AC-2.9, AC-7.4
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Helpers ───

/** Resolve to the monorepo root (vitest runs from apps/api). */
function repoRoot(): string {
  return resolve(__dirname, '..', '..', '..', '..', '..');
}

// ─── Shared state ───

let npmrcPath: string;
let npmrcContent: string;
let npmrcLines: string[];

beforeAll(() => {
  npmrcPath = resolve(repoRoot(), '.npmrc');
  npmrcContent = readFileSync(npmrcPath, 'utf-8');
  npmrcLines = npmrcContent.split('\n');
});

// ─── Required settings ───

const REQUIRED_SETTINGS: Record<string, string> = {
  'ignore-scripts': 'true',
  'save-exact': 'true',
  registry: 'https://registry.npmjs.org/',
  'strict-peer-dependencies': 'true',
  'auto-install-peers': 'true',
  'package-manager-strict': 'true',
};

// ─── Tests ───

describe('.npmrc existence and settings', () => {
  /** Validates: AC-2.1 */
  it('exists at the repository root', () => {
    expect(existsSync(npmrcPath)).toBe(true);
  });

  describe.each(Object.entries(REQUIRED_SETTINGS))('setting: %s=%s', (key, value) => {
    /** Validates: AC-2.2, AC-2.3, AC-2.4, AC-2.5, AC-2.6, AC-7.4 */
    it(`contains ${key}=${value}`, () => {
      const expectedLine = `${key}=${value}`;
      expect(npmrcContent, `Expected .npmrc to contain "${expectedLine}"`).toContain(expectedLine);
    });

    /** Validates: AC-2.9 */
    it(`has a comment preceding ${key}`, () => {
      const settingLineIndex = npmrcLines.findIndex((line) => line.trim() === `${key}=${value}`);
      expect(
        settingLineIndex,
        `Could not find "${key}=${value}" as a standalone line in .npmrc`,
      ).toBeGreaterThan(0);

      // Walk backwards from the setting line to find a comment
      let foundComment = false;
      for (let i = settingLineIndex - 1; i >= 0; i--) {
        const trimmed = npmrcLines[i]!.trim();
        if (trimmed === '') continue; // skip blank lines
        if (trimmed.startsWith('#')) {
          foundComment = true;
          break;
        }
        // Hit a non-comment, non-blank line — no preceding comment
        break;
      }

      expect(foundComment, `Expected a comment line before "${key}=${value}" in .npmrc`).toBe(true);
    });
  });
});

// ─── Root package.json tests ───

describe('root package.json scripts and overrides', () => {
  let rootPkg: Record<string, any>;

  beforeAll(() => {
    const pkgPath = resolve(repoRoot(), 'package.json');
    rootPkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  });

  /** Validates: AC-1.5, AC-3.1 */
  it('has pnpm.overrides.lodash set to ">=4.18.0"', () => {
    expect(rootPkg.pnpm?.overrides?.lodash).toBe('>=4.18.0');
  });

  /** Validates: AC-7.1 */
  it('has a preinstall script that enforces pnpm via only-allow', () => {
    expect(rootPkg.scripts?.preinstall).toBeDefined();
    expect(rootPkg.scripts.preinstall).toContain('only-allow pnpm');
  });

  /** Validates: AC-4.2 */
  it('has an audit script', () => {
    expect(rootPkg.scripts?.audit).toBeDefined();
  });
});

// ─── SECURITY.md structure tests ───

describe('SECURITY.md structure', () => {
  let securityPath: string;
  let securityContent: string;

  beforeAll(() => {
    securityPath = resolve(repoRoot(), '.kiro', 'docs', 'SECURITY.md');
    securityContent = readFileSync(securityPath, 'utf-8');
  });

  /** Validates: AC-6.1 */
  it('exists at the repository root', () => {
    expect(existsSync(securityPath)).toBe(true);
  });

  /** Validates: AC-6.1 — threat model section */
  it('contains a threat model section', () => {
    expect(securityContent).toMatch(/#+\s.*[Tt]hreat\s+[Mm]odel/);
  });

  /** Validates: AC-6.1 — accepted risks section */
  it('contains an accepted risks section', () => {
    expect(securityContent).toMatch(/#+\s.*[Aa]ccepted\s+[Rr]isks/);
  });

  /** Validates: AC-6.1 — incident response runbook section */
  it('contains an incident response runbook section', () => {
    expect(securityContent).toMatch(/#+\s.*[Ii]ncident\s+[Rr]esponse\s+[Rr]unbook/);
  });

  /** Validates: AC-6.2 — Detection phase */
  it('runbook covers Detection phase', () => {
    expect(securityContent).toMatch(/#+\s.*[Dd]etection/);
  });

  /** Validates: AC-6.2 — Containment phase */
  it('runbook covers Containment phase', () => {
    expect(securityContent).toMatch(/#+\s.*[Cc]ontainment/);
  });

  /** Validates: AC-6.2 — Eradication phase */
  it('runbook covers Eradication phase', () => {
    expect(securityContent).toMatch(/#+\s.*[Ee]radication/);
  });

  /** Validates: AC-6.2 — Recovery phase */
  it('runbook covers Recovery phase', () => {
    expect(securityContent).toMatch(/#+\s.*[Rr]ecovery/);
  });

  /** Validates: AC-6.2 — Lessons Learned phase */
  it('runbook covers Lessons Learned phase', () => {
    expect(securityContent).toMatch(/#+\s.*[Ll]essons\s+[Ll]earned/);
  });

  /** Validates: AC-6.4 — historical incident reference */
  it('references the April 2026 test data leak incident', () => {
    expect(securityContent).toContain('April 2026');
    expect(securityContent).toMatch(/test\s+data\s+leak/i);
  });
});

// ─── CI/CD workflow structure tests ───

describe('CI/CD workflow structure (docs/ci-cd-supply-chain.yml)', () => {
  let workflowPath: string;
  let workflowContent: string;

  beforeAll(() => {
    workflowPath = resolve(repoRoot(), 'docs', 'ci-cd-supply-chain.yml');
    workflowContent = readFileSync(workflowPath, 'utf-8');
  });

  /** Validates: AC-5.2 */
  it('exists at docs/ci-cd-supply-chain.yml', () => {
    expect(existsSync(workflowPath)).toBe(true);
  });

  /** Validates: AC-5.2 — valid YAML structure (basic structural checks) */
  it('is valid YAML with expected top-level keys', () => {
    expect(workflowContent).toMatch(/^name:\s+/m);
    expect(workflowContent).toMatch(/^on:\s*$/m);
    expect(workflowContent).toMatch(/^jobs:\s*$/m);
  });

  /** Validates: AC-5.1 — frozen-lockfile install step */
  it('includes a frozen-lockfile install step', () => {
    expect(workflowContent).toContain('pnpm install --frozen-lockfile');
  });

  /** Validates: AC-5.1 — audit step */
  it('includes an audit step', () => {
    expect(workflowContent).toContain('pnpm audit --audit-level=high');
  });

  /** Validates: AC-5.5 — signature verification step */
  it('includes a signature verification step', () => {
    expect(workflowContent).toContain('pnpm audit --signatures');
  });

  /** Validates: AC-5.3 — pnpm/action-setup version matches packageManager */
  it('uses pnpm/action-setup with version matching packageManager field', () => {
    // Extract pnpm version from root package.json packageManager field
    const pkgPath = resolve(repoRoot(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const packageManagerField: string = pkg.packageManager;
    const pnpmVersion = packageManagerField.replace(/^pnpm@/, '');

    // Extract version from pnpm/action-setup step in the workflow
    const versionMatch = workflowContent.match(/pnpm\/action-setup@\S+[\s\S]*?version:\s*([\d.]+)/);
    expect(versionMatch, 'Could not find pnpm/action-setup version in workflow').not.toBeNull();

    const workflowPnpmVersion = versionMatch![1]!.trim();
    expect(workflowPnpmVersion).toBe(pnpmVersion);
  });

  /** Validates: AC-5.4 — pnpm store caching */
  it('caches pnpm store via actions/setup-node', () => {
    expect(workflowContent).toContain("cache: 'pnpm'");
  });
});
