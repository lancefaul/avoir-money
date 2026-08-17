/**
 * Unit and Integration Tests for Healthcare Module
 *
 * Tests pure functions (computeCappedBalance, computeOopmSpread) and
 * DB-backed functions (syncOopmToBudget) from the healthcare module.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { computeCappedBalance, computeOopmSpread, syncOopmToBudget } from './healthcare.js';
import { createBudgetGroup, createAccount, createTransaction } from '../test/helpers.js';
import { makeDate } from './dates.js';

describe('computeCappedBalance', () => {
  // ─── Requirement 7.1: deductibleOverride=true adds unspent deductible to OOPM ───

  it('with deductibleOverride=true, adds unspent deductible portion to OOPM before capping', () => {
    const raw = { deductibleRaw: 1000, oopmRaw: 2000 };
    const deductibleLimit = 3000;
    const oopmLimit = 6000;

    const result = computeCappedBalance(raw, deductibleLimit, oopmLimit, true);

    // Deductible spent: min(1000, 3000) = 1000
    expect(result.deductibleSpent).toBe(1000);

    // Deductible boost: 3000 - 1000 = 2000
    // Effective OOPM raw: 2000 + 2000 = 4000
    // OOPM spent: min(4000, 6000) = 4000
    expect(result.oopmSpent).toBe(4000);
    expect(result.deductibleRaw).toBe(1000);
    expect(result.oopmRaw).toBe(2000);
  });

  it('with deductibleOverride=true and deductible fully spent, no boost is added', () => {
    const raw = { deductibleRaw: 3000, oopmRaw: 4000 };
    const deductibleLimit = 3000;
    const oopmLimit = 7000;

    const result = computeCappedBalance(raw, deductibleLimit, oopmLimit, true);

    // Deductible fully spent, so boost = 3000 - 3000 = 0
    // Effective OOPM raw: 4000 + 0 = 4000
    expect(result.deductibleSpent).toBe(3000);
    expect(result.oopmSpent).toBe(4000);
  });

  // ─── Requirement 7.2: null limits return null for both spent values ───

  it('with null deductible and OOPM limits, returns null for both spent values', () => {
    const raw = { deductibleRaw: 500, oopmRaw: 1200 };

    const result = computeCappedBalance(raw, null, null, false);

    expect(result.deductibleSpent).toBeNull();
    expect(result.oopmSpent).toBeNull();
    expect(result.deductibleRaw).toBe(500);
    expect(result.oopmRaw).toBe(1200);
  });

  it('with null deductible limit only, returns null for deductibleSpent', () => {
    const raw = { deductibleRaw: 500, oopmRaw: 1200 };
    const oopmLimit = 5000;

    const result = computeCappedBalance(raw, null, oopmLimit, false);

    expect(result.deductibleSpent).toBeNull();
    expect(result.oopmSpent).toBe(1200);
  });

  it('with null OOPM limit only, returns null for oopmSpent', () => {
    const raw = { deductibleRaw: 500, oopmRaw: 1200 };
    const deductibleLimit = 2000;

    const result = computeCappedBalance(raw, deductibleLimit, null, false);

    expect(result.deductibleSpent).toBe(500);
    expect(result.oopmSpent).toBeNull();
  });
});

describe('computeOopmSpread', () => {
  // ─── Requirement 7.3: oopmOverride=true returns 0 ───

  it('with oopmOverride=true, returns 0', () => {
    const result = computeOopmSpread(6000, 2000, true, 6);
    expect(result).toBe(0);
  });

  // ─── Requirement 7.4: oopmSpent >= oopmLimit returns 0 ───

  it('with oopmSpent >= oopmLimit, returns 0', () => {
    const result = computeOopmSpread(5000, 5000, false, 6);
    expect(result).toBe(0);
  });

  it('with oopmSpent > oopmLimit, returns 0', () => {
    const result = computeOopmSpread(5000, 6000, false, 6);
    expect(result).toBe(0);
  });

  // ─── Requirement 7.5: null OOPM limit returns 0 ───

  it('with null OOPM limit, returns 0', () => {
    const result = computeOopmSpread(null, 2000, false, 6);
    expect(result).toBe(0);
  });
});

describe('syncOopmToBudget', () => {
  let systemBudget: any;
  let yearPlan: any;
  let categoryBudget: any;

  beforeEach(async () => {
    // Create system budget for MEDICAL type
    const group = await createBudgetGroup('Healthcare');
    systemBudget = await prisma.budget.create({
      data: {
        name: 'Deductible & OOPM',
        groupId: group.id,
        isCustom: false,
        isSystem: true,
      },
    });

    // Create year plan for 2026
    yearPlan = await prisma.yearPlan.create({
      data: {
        year: 2026,
        status: 'ACTIVE',
      },
    });

    // Create category budget linking the year plan and system budget
    categoryBudget = await prisma.categoryBudget.create({
      data: {
        yearPlanId: yearPlan.id,
        budgetId: systemBudget.id,
      },
    });
  });

  // ─── Requirement 7.6: closed policy returns early without modifying budget ───

  it('for closed policy, returns early without modifying budget version', async () => {
    const policy = await prisma.insurancePolicy.create({
      data: {
        type: 'MEDICAL',
        year: 2026,
        employer: 'TestCorp',
        premium: 500,
        deductibleLimit: 3000,
        oopmLimit: 6000,
        status: 'CLOSED',
      },
    });

    await syncOopmToBudget(policy.id);

    // Verify no budget version was created
    const versions = await prisma.budgetVersion.findMany({
      where: { categoryBudgetId: categoryBudget.id },
    });
    expect(versions).toHaveLength(0);
  });

  // ─── Requirement 7.7: manualOverride=true on latest budget version returns early ───

  it('for policy with manualOverride=true on latest budget version, returns early without modifying', async () => {
    const policy = await prisma.insurancePolicy.create({
      data: {
        type: 'MEDICAL',
        year: 2026,
        employer: 'TestCorp',
        premium: 500,
        deductibleLimit: 3000,
        oopmLimit: 6000,
      },
    });

    // Create a budget version with manualOverride=true
    const existingVersion = await prisma.budgetVersion.create({
      data: {
        categoryBudgetId: categoryBudget.id,
        amount: 999,
        frequency: 'MONTHLY',
        monthlyEquivalent: 999,
        activeMonths: [],
        manualOverride: true,
        effectiveDate: makeDate(2026, 0, 1),
      },
    });

    await syncOopmToBudget(policy.id);

    // Verify the existing version was not modified or deleted
    const versions = await prisma.budgetVersion.findMany({
      where: { categoryBudgetId: categoryBudget.id },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0]!.id).toBe(existingVersion.id);
    expect(versions[0]!.amount.toNumber()).toBe(999);
    expect(versions[0]!.manualOverride).toBe(true);
  });

  it('creates budget version when no manualOverride exists', async () => {
    const policy = await prisma.insurancePolicy.create({
      data: {
        type: 'MEDICAL',
        year: 2026,
        employer: 'TestCorp',
        premium: 500,
        deductibleLimit: 3000,
        oopmLimit: 6000,
        budgetId: systemBudget.id,
      },
    });

    // Create some healthcare spending
    const account = await createAccount();
    await createTransaction(account.id, {
      type: 'EXPENSE',
      budgetId: systemBudget.id,
      amount: 1000,
      date: makeDate(2026, 2, 15),
    });

    await syncOopmToBudget(policy.id);

    // Verify a budget version was created
    const versions = await prisma.budgetVersion.findMany({
      where: { categoryBudgetId: categoryBudget.id },
    });
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0]!.manualOverride).toBe(false);
  });

  it('returns early when policy does not exist', async () => {
    await syncOopmToBudget('nonexistent-id');
    // Should not throw, just return early
  });

  it('returns early when no year plan exists for policy year', async () => {
    const policy = await prisma.insurancePolicy.create({
      data: {
        type: 'MEDICAL',
        year: 2025, // No year plan for 2025
        employer: 'TestCorp',
        premium: 500,
        deductibleLimit: 3000,
        oopmLimit: 6000,
      },
    });

    await syncOopmToBudget(policy.id);

    // Should not throw, just return early
  });
});
