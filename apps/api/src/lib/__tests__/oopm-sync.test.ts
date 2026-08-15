/**
 * Integration tests for syncOopmToBudget orchestrator.
 * Uses the real test database (port 5433) — setup.ts handles truncation.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.1, 6.2, 6.3, 6.4
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { syncOopmToBudget } from '../healthcare.js';
import { today, localDate, makeDate } from '../dates.js';

/** Unique prefix to avoid collisions with other test data */
const PREFIX = 'OOPM_SYNC';

/** Create a BudgetGroup + system Budget for a given policy type */
async function createSystemBudget(name: string, icon: string) {
  const group = await prisma.budgetGroup.create({
    data: { name: `${PREFIX}_Group_${Date.now()}` },
  });
  const category = await prisma.budget.create({
    data: { name, groupId: group.id, icon, isSystem: true },
  });
  return { group, category };
}

/** Get the current month (1-based) and year from today() */
function currentPeriod() {
  const t = today();
  const { year, month } = localDate(t);
  return { year, month1: month + 1 }; // month1 is 1-based
}

describe('syncOopmToBudget', () => {
  /** Validates: Requirement 6.3 */
  it('returns silently when policy does not exist', async () => {
    await expect(syncOopmToBudget('non-existent-id')).resolves.toBeUndefined();
  });

  /** Validates: Requirement 6.4 */
  it('skips budget update when policy is closed', async () => {
    const { category } = await createSystemBudget('Deductible & OOPM', '🏥');
    const { year } = currentPeriod();

    const policy = await prisma.insurancePolicy.create({
      data: {
        type: 'MEDICAL',
        year,
        employer: `${PREFIX}_Employer`,
        oopmLimit: 5000,
        status: 'CLOSED',
        closedOn: new Date(Date.UTC(year, 0, 15)),
      },
    });

    const yearPlan = await prisma.yearPlan.create({
      data: { year, status: 'ACTIVE' },
    });
    await prisma.categoryBudget.create({
      data: { yearPlanId: yearPlan.id, budgetId: category.id },
    });

    await syncOopmToBudget(policy.id);

    // No BudgetVersion should have been created
    const versions = await prisma.budgetVersion.findMany();
    expect(versions).toHaveLength(0);
  });

  /** Validates: Requirement 2.3 */
  it('returns silently when no year plan exists', async () => {
    await createSystemBudget('Deductible & OOPM', '🏥');
    const { year } = currentPeriod();

    const policy = await prisma.insurancePolicy.create({
      data: {
        type: 'MEDICAL',
        year,
        employer: `${PREFIX}_Employer`,
        oopmLimit: 5000,
      },
    });

    // No YearPlan created — sync should return silently
    await syncOopmToBudget(policy.id);

    const versions = await prisma.budgetVersion.findMany();
    expect(versions).toHaveLength(0);
  });

  /** Validates: Requirement 2.3 */
  it('returns silently when no category budget exists', async () => {
    await createSystemBudget('Deductible & OOPM', '🏥');
    const { year } = currentPeriod();

    const policy = await prisma.insurancePolicy.create({
      data: {
        type: 'MEDICAL',
        year,
        employer: `${PREFIX}_Employer`,
        oopmLimit: 5000,
      },
    });

    // YearPlan exists but no CategoryBudget for the system Budget
    await prisma.yearPlan.create({
      data: { year, status: 'ACTIVE' },
    });

    await syncOopmToBudget(policy.id);

    const versions = await prisma.budgetVersion.findMany();
    expect(versions).toHaveLength(0);
  });

  /** Validates: Requirement 2.5 */
  it('skips update when latest budget version has manualOverride true', async () => {
    const { category } = await createSystemBudget('Deductible & OOPM', '🏥');
    const { year, month1 } = currentPeriod();

    const policy = await prisma.insurancePolicy.create({
      data: {
        type: 'MEDICAL',
        year,
        employer: `${PREFIX}_Employer`,
        oopmLimit: 5000,
      },
    });

    const yearPlan = await prisma.yearPlan.create({
      data: { year, status: 'ACTIVE' },
    });
    const catBudget = await prisma.categoryBudget.create({
      data: { yearPlanId: yearPlan.id, budgetId: category.id },
    });

    // Create a manually overridden budget version (latest by effectiveDate)
    await prisma.budgetVersion.create({
      data: {
        categoryBudgetId: catBudget.id,
        amount: 999,
        frequency: 'MONTHLY',
        monthlyEquivalent: 999,
        manualOverride: true,
        effectiveDate: makeDate(year, month1 - 1, 1),
      },
    });

    await syncOopmToBudget(policy.id);

    // The manual override version should still be the only one
    const versions = await prisma.budgetVersion.findMany({
      where: { categoryBudgetId: catBudget.id },
    });
    expect(versions).toHaveLength(1);
    expect(Number(versions[0]!.amount)).toBe(999);
    expect(versions[0]!.manualOverride).toBe(true);
  });

  /** Validates: Requirements 2.1, 2.2, 2.4, 2.6, 6.1, 6.2 */
  it('creates BudgetVersion with correct fields on successful upsert', async () => {
    const { category } = await createSystemBudget('Deductible & OOPM', '🏥');
    const { year, month1 } = currentPeriod();

    const oopmLimit = 6000;
    const policy = await prisma.insurancePolicy.create({
      data: {
        type: 'MEDICAL',
        year,
        employer: `${PREFIX}_Employer`,
        oopmLimit,
        budgetId: category.id,
      },
    });

    const yearPlan = await prisma.yearPlan.create({
      data: { year, status: 'ACTIVE' },
    });
    const catBudget = await prisma.categoryBudget.create({
      data: { yearPlanId: yearPlan.id, budgetId: category.id },
    });

    await syncOopmToBudget(policy.id);

    const versions = await prisma.budgetVersion.findMany({
      where: { categoryBudgetId: catBudget.id },
    });
    expect(versions).toHaveLength(1);

    const v = versions[0]!;
    // Compute expected spread: no spending, so remaining = oopmLimit
    const remainingMonths = 12 - month1 + 1;
    const expectedSpread = Math.round((oopmLimit / remainingMonths) * 100) / 100;

    expect(Number(v.amount)).toBe(expectedSpread);
    expect(v.frequency).toBe('MONTHLY');
    expect(Number(v.monthlyEquivalent)).toBe(expectedSpread);
    expect(v.manualOverride).toBe(false);
    expect(v.activeMonths).toEqual([]);

    // effectiveDate should be first of current month (UTC)
    const expectedDate = makeDate(year, month1 - 1, 1);
    expect(v.effectiveDate.getTime()).toBe(expectedDate.getTime());
  });
});
