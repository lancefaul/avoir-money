/**
 * E2E Seed — minimal reference data for CI environment.
 *
 * Creates the minimum data needed for e2e tests to pass:
 * - System budgets (SYSTEM group + Uncategorized, Income, Trade, Transfer)
 * - INSURANCE budget group
 * - 2 Accounts (Checking, Credit Card)
 * - 1 PaySchedule (BIWEEKLY) + generated PayPeriods covering current year
 * - 1 UtilityProvider + UtilityService (for utilities page tests)
 * - 1 Expense (for schedule/recurring tests)
 * - 1 Income (for recurring income tests)
 *
 * Safe to run multiple times (idempotent via findFirst checks).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('E2E Seed — creating minimal reference data...\n');

  // ── 1. System budgets (same as system-seed.ts) ──
  let systemGroup = await prisma.budgetGroup.findFirst({ where: { name: 'SYSTEM' } });
  if (!systemGroup) {
    systemGroup = await prisma.budgetGroup.create({
      data: { name: 'SYSTEM', color: 'fern50' },
    });
    console.log('  ✓ Created SYSTEM group');
  } else {
    console.log('  – SYSTEM group exists');
  }

  const systemBudgets = [
    { name: 'Uncategorized', icon: '📋' },
    { name: 'Income', icon: '💵' },
    { name: 'Trade', icon: '📈' },
    { name: 'Transfer', icon: '➡️' },
  ];

  for (const budget of systemBudgets) {
    const existing = await prisma.budget.findFirst({ where: { name: budget.name } });
    if (!existing) {
      await prisma.budget.create({
        data: { name: budget.name, icon: budget.icon, groupId: systemGroup.id },
      });
      console.log(`  ✓ Created budget: ${budget.icon} ${budget.name}`);
    } else {
      console.log(`  – Budget exists: ${budget.icon} ${budget.name}`);
    }
  }

  // ── 2. INSURANCE budget group ──
  let insuranceGroup = await prisma.budgetGroup.findFirst({ where: { name: 'INSURANCE' } });
  if (!insuranceGroup) {
    insuranceGroup = await prisma.budgetGroup.create({
      data: { name: 'INSURANCE', color: 'violet50' },
    });
    console.log('  ✓ Created INSURANCE group');
  } else {
    console.log('  – INSURANCE group exists');
  }

  // ── 3. A general-purpose budget group + budget for tests ──
  let mandatoryGroup = await prisma.budgetGroup.findFirst({ where: { name: 'Mandatory' } });
  if (!mandatoryGroup) {
    mandatoryGroup = await prisma.budgetGroup.create({
      data: { name: 'Mandatory', color: 'neutral100' },
    });
    console.log('  ✓ Created Mandatory group');
  } else {
    console.log('  – Mandatory group exists');
  }

  let generalBudget = await prisma.budget.findFirst({ where: { name: 'General' } });
  if (!generalBudget) {
    generalBudget = await prisma.budget.create({
      data: { name: 'General', icon: '📁', groupId: mandatoryGroup.id },
    });
    console.log('  ✓ Created General budget');
  } else {
    console.log('  – General budget exists');
  }

  // ── 4. Accounts ──
  let checkingAccount = await prisma.account.findFirst({ where: { name: 'E2E Checking' } });
  if (!checkingAccount) {
    checkingAccount = await prisma.account.create({
      // Pre-tracking figure, so it is the opening balance (see seed.ts).
      data: { name: 'E2E Checking', type: 'Checking', balance: 5000, openingBalance: 5000 },
    });
    console.log('  ✓ Created E2E Checking account');
  } else {
    console.log('  – E2E Checking account exists');
  }

  let creditAccount = await prisma.account.findFirst({ where: { name: 'E2E Credit Card' } });
  if (!creditAccount) {
    creditAccount = await prisma.account.create({
      data: { name: 'E2E Credit Card', type: 'Credit Card', balance: -1200, openingBalance: -1200 },
    });
    console.log('  ✓ Created E2E Credit Card account');
  } else {
    console.log('  – E2E Credit Card account exists');
  }

  // ── 5. Pay Schedule + Pay Periods ──
  let paySchedule = await prisma.paySchedule.findFirst({ where: { name: 'E2E Primary' } });
  if (!paySchedule) {
    // Anchor date: Jan 3, 2025 (a Friday)
    paySchedule = await prisma.paySchedule.create({
      data: {
        name: 'E2E Primary',
        type: 'BIWEEKLY',
        anchorDate: new Date(Date.UTC(2025, 0, 3)),
        isDefault: true,
      },
    });
    console.log('  ✓ Created E2E Primary pay schedule');
  } else {
    console.log('  – E2E Primary pay schedule exists');
  }

  // Generate pay periods for current year and next year
  const existingPeriods = await prisma.payPeriod.count({
    where: { scheduleId: paySchedule.id },
  });

  if (existingPeriods === 0) {
    const anchor = new Date(Date.UTC(2025, 0, 3));
    const periods: Array<{
      scheduleId: string;
      startDate: Date;
      endDate: Date;
      payDate: Date;
      year: number;
      periodNum: number;
    }> = [];

    // Generate 52 biweekly periods (covers 2 years)
    for (let i = 0; i < 52; i++) {
      const startDate = new Date(anchor.getTime() + i * 14 * 86400000);
      const endDate = new Date(startDate.getTime() + 13 * 86400000);
      const payDate = new Date(startDate.getTime()); // Pay on first day

      periods.push({
        scheduleId: paySchedule.id,
        startDate,
        endDate,
        payDate,
        year: startDate.getUTCFullYear(),
        periodNum: i + 1,
      });
    }

    await prisma.payPeriod.createMany({ data: periods });
    console.log(`  ✓ Created ${periods.length} pay periods`);
  } else {
    console.log(`  – Pay periods exist (${existingPeriods})`);
  }

  // ── 6. Utility Provider + Service ──
  let gasProvider = await prisma.utilityProvider.findFirst({ where: { name: 'E2E Gas Co' } });
  if (!gasProvider) {
    gasProvider = await prisma.utilityProvider.create({
      data: { name: 'E2E Gas Co' },
    });
    console.log('  ✓ Created E2E Gas Co provider');
  } else {
    console.log('  – E2E Gas Co provider exists');
  }

  let gasService = await prisma.utilityService.findFirst({
    where: { providerId: gasProvider.id, serviceType: 'GAS' },
  });
  if (!gasService) {
    gasService = await prisma.utilityService.create({
      data: { providerId: gasProvider.id, serviceType: 'GAS', metering: 'METERED' },
    });
    console.log('  ✓ Created GAS service');
  } else {
    console.log('  – GAS service exists');
  }

  // ── 7. One recurring Expense (for recurring tests) ──
  const uncategorizedBudget = await prisma.budget.findFirst({ where: { name: 'Uncategorized' } });
  let testExpense = await prisma.expense.findFirst({ where: { name: 'E2E Monthly Expense' } });
  if (!testExpense && uncategorizedBudget) {
    testExpense = await prisma.expense.create({
      data: {
        name: 'E2E Monthly Expense',
        amount: 100,
        frequency: 'MONTHLY',
        budgetId: uncategorizedBudget.id,
        accountId: checkingAccount.id,
        dueDay: 15,
      },
    });
    console.log('  ✓ Created E2E Monthly Expense');
  } else {
    console.log('  – E2E Monthly Expense exists');
  }

  // ── 8. One recurring Income (for recurring income tests) ──
  const incomeBudget = await prisma.budget.findFirst({ where: { name: 'Income' } });
  let testIncome = await prisma.income.findFirst({ where: { name: 'E2E Biweekly Paycheck' } });
  if (!testIncome && incomeBudget) {
    testIncome = await prisma.income.create({
      data: {
        name: 'E2E Biweekly Paycheck',
        amount: 3000,
        frequency: 'BIWEEKLY',
        budgetId: incomeBudget.id,
        accountId: checkingAccount.id,
        startDate: new Date(Date.UTC(2025, 0, 3)),
      },
    });
    console.log('  ✓ Created E2E Biweekly Paycheck');
  } else {
    console.log('  – E2E Biweekly Paycheck exists');
  }

  // ── 9. Year Plan (ACTIVE) for budgets page ──
  // UTC getter (consistent with the rest of this seed) — local time would report
  // the wrong year near the Jan 1 boundary.
  const currentYear = new Date().getUTCFullYear();
  let yearPlan = await prisma.yearPlan.findFirst({ where: { year: currentYear } });
  if (!yearPlan) {
    yearPlan = await prisma.yearPlan.create({
      data: { year: currentYear, status: 'ACTIVE' },
    });
    console.log(`  ✓ Created ${currentYear} Year Plan (ACTIVE)`);
  } else {
    console.log(`  – ${currentYear} Year Plan exists`);
  }

  console.log('\nE2E seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
