import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Validates: Requirements 12.5
 * Verifies the Husky pre-commit hook configuration file exists
 * and contains the expected typecheck and test commands.
 */

// Resolve workspace root from test file location:
// apps/api/src/lib/__tests__/ → 5 levels up to workspace root
const workspaceRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
const preCommitPath = path.resolve(workspaceRoot, '.husky', 'pre-commit');

describe('pre-commit hook configuration', () => {
  it('should have a .husky/pre-commit file', () => {
    expect(fs.existsSync(preCommitPath)).toBe(true);
  });

  it('should contain pnpm typecheck command', () => {
    const content = fs.readFileSync(preCommitPath, 'utf-8');
    expect(content).toContain('pnpm typecheck');
  });

  it('should contain pnpm test command', () => {
    const content = fs.readFileSync(preCommitPath, 'utf-8');
    expect(content).toContain('pnpm test');
  });
});
