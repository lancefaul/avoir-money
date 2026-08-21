/**
 * Infrastructure tests — Database migration deployment integrity.
 *
 * These tests verify that Prisma migrations apply cleanly, the schema is in sync,
 * and the schema file can be parsed. They complement the existing
 * migration.property.test.ts which covers holdings FK migration logic.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

const PACKAGES_DB_DIR = path.resolve(__dirname, '../../../../..', 'packages/db');
const TEST_DATABASE_URL = 'postgresql://budget:budget@localhost:5433/budget_tracker_test';

const execEnv = {
  ...process.env,
  DATABASE_URL: TEST_DATABASE_URL,
};

const execOpts = {
  cwd: PACKAGES_DB_DIR,
  env: execEnv,
  encoding: 'utf-8' as const,
  timeout: 30_000,
};

describe('Database migration deployment integrity', { timeout: 30_000 }, () => {
  /**
   * Requirement 13.1: prisma migrate deploy applies all migrations without errors.
   */
  it('prisma migrate deploy applies all migrations without errors', () => {
    const output = execSync('npx prisma migrate deploy', execOpts);
    // migrate deploy should not throw; any error would cause execSync to throw
    expect(output).toBeDefined();
  });

  /**
   * Requirement 13.2: prisma migrate status reports zero pending migrations.
   */
  it('prisma migrate status reports zero pending migrations after deploy', () => {
    const output = execSync('npx prisma migrate status', execOpts);
    // Prisma outputs "Database schema is up to date!" when no pending migrations
    expect(output).toContain('Database schema is up to date');
  });

  /**
   * Requirement 13.3: prisma generate succeeds, confirming schema and migrations are in sync.
   */
  it('prisma generate succeeds after migrations', () => {
    const output = execSync('npx prisma generate', execOpts);
    expect(output).toBeDefined();
    // Prisma outputs "Generated Prisma Client" on success
    expect(output).toContain('Generated Prisma Client');
  });

  /**
   * Requirement 13.4: The Prisma schema file can be parsed without errors.
   * Verifies the file is readable and contains expected model definitions.
   */
  it('schema.prisma can be parsed and contains expected model definitions', () => {
    const schemaPath = path.join(PACKAGES_DB_DIR, 'prisma', 'schema.prisma');
    const schema = readFileSync(schemaPath, 'utf-8');

    // Schema should be non-empty
    expect(schema.length).toBeGreaterThan(0);

    // Verify core model definitions exist
    expect(schema).toContain('model Account');
    expect(schema).toContain('model Transaction');
    expect(schema).toContain('model Budget');
    expect(schema).toContain('model BudgetGroup');
    expect(schema).toContain('model Expense');
    expect(schema).toContain('model Income');
    expect(schema).toContain('model PaySchedule');
    expect(schema).toContain('model PayPeriod');

    // Verify datasource and generator blocks
    expect(schema).toContain('datasource db');
    expect(schema).toContain('generator client');
    expect(schema).toContain('provider = "postgresql"');
  });
});
