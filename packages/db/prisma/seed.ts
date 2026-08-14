/**
 * Seed script — Phase 1, Step 6.
 *
 * **Its generator no longer exists.** This reads
 * `tools/import/dist/seed-data.json`, which was produced by `tools/import` —
 * deleted 2026-08-11 because it read a workbook that was not in the repo, had
 * never been run in this tree, and carried the project's only two accepted HIGH
 * advisories through `xlsx@0.18.5`.
 *
 * Left in place rather than deleted with it: this populates PRISMA models, so it
 * belongs to the TypeScript stack's own lifecycle, and it already degrades
 * gracefully — `existsSync` guards the read, so a missing file is a clean exit
 * rather than a crash. It should go when `apps/api` does.
 *
 * The migration path that replaced it is `rust/export` → `rust/import`, which
 * needs no spreadsheet and is exercised on every differential run.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../src/client.js';
import { inferServiceType } from '../../../apps/api/src/lib/utility-inference.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DATA_PATH = resolve(__dirname, '../../../tools/import/dist/seed-data.json');

// ─── Types (mirror of tools/import/src/index.ts) ─────────────────────────────

interface SeedAccount {
  name: string;
  type: string;
  balance: number;
}
interface SeedCategory {
  name: string;
  group: string;
  color: string;
  icon: string;
  isCustom: boolean;
}
interface SeedIncome {
  name: string;
  amount: number;
  frequency: string;
  categoryName: string;
  note?: string;
}
interface SeedExpense {
  name: string;
  amount: number;
  frequency: string;
  categoryName: string;
  accountName?: string;
  isAutomatic: boolean;
  dueDay?: number;
  note?: string;
}
interface SeedTransaction {
  amount: number;
  date: string;
  incomeName?: string;
  expenseName?: string;
  accountName?: string;
  note?: string;
}
interface SeedBalanceSnapshot {
  payDate: string;
  accountName: string;
  openingBalance: number;
  closingBalance: number;
}
interface SeedUtilityReading {
  type: string;
  billDate: string;
  usage?: number;
  cost: number;
  unitCost?: number;
  details?: Record<string, unknown>;
}
interface SeedHealthcareYear {
  year: number;
  employer: string;
  medicalPremium: number;
  medicalDeductible: number;
  medicalOOPM: number;
  dentalPremium: number;
  visionPremium: number;
  paidOutOfPocket: number;
}
interface SeedInvestmentHolding {
  name: string;
  ticker?: string;
  type: string;
  quantity: number;
  costBasis?: number;
  accountName: string;
}
interface SeedPaySchedule {
  name: string;
  type: string;
  anchorDate: string;
  isDefault: boolean;
}

interface SeedData {
  paySchedule: SeedPaySchedule;
  accounts: SeedAccount[];
  categories: SeedCategory[];
  income: SeedIncome[];
  expenses: SeedExpense[];
  transactions: SeedTransaction[];
  balanceSnapshots: SeedBalanceSnapshot[];
  utilityReadings: SeedUtilityReading[];
  healthcareYears: SeedHealthcareYear[];
  investmentHoldings: SeedInvestmentHolding[];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(SEED_DATA_PATH)) {
    console.error(`Seed data not found at: ${SEED_DATA_PATH}`);
    console.error('Run "pnpm import:spreadsheet" first to generate it.');
    process.exit(1);
  }

  const data: SeedData = JSON.parse(readFileSync(SEED_DATA_PATH, 'utf-8'));
  console.log('Seeding database...\n');

  // ── 1. Accounts ──
  const accountMap = new Map<string, string>(); // name → id
  for (const acc of data.accounts) {
    let record = await prisma.account.findFirst({ where: { name: acc.name } });
    if (!record)
      record = await prisma.account.create({
        // Seeded balances are pre-tracking figures — they are not derived from
        // any seeded transaction — so they are the account's opening balance.
        // Omitting it would leave openingBalance at 0 and break the invariant
        // openingBalance + SUM(transactions) == balance from the first seed.
        data: {
          name: acc.name,
          type: acc.type as never,
          balance: acc.balance,
          openingBalance: acc.balance,
        },
      });
    accountMap.set(acc.name, record.id);
  }
  console.log(`  ✓ Accounts: ${accountMap.size}`);

  // ── 2. Category Groups + Categories ──
  const groupMap = new Map<string, string>(); // group name → id
  const categoryMap = new Map<string, string>(); // category name → id

  // First pass: collect all unique group names and create CategoryGroup records
  const uniqueGroups = [...new Set(data.categories.map((c: { group: string }) => c.group))];
  for (const groupName of uniqueGroups) {
    let group = await prisma.categoryGroup.findFirst({ where: { name: groupName } });
    if (!group)
      group = await prisma.categoryGroup.create({ data: { name: groupName, color: '#94a3b8' } });
    groupMap.set(groupName, group.id);
  }
  console.log(`  ✓ Category groups: ${groupMap.size}`);

  // Second pass: create categories with groupId
  for (const cat of data.categories) {
    const groupId = groupMap.get(cat.group);
    if (!groupId) {
      console.warn(`    ⚠ Group not found: ${cat.group}`);
      continue;
    }
    let record = await prisma.category.findFirst({ where: { name: cat.name } });
    if (!record)
      record = await prisma.category.create({
        data: { name: cat.name, groupId, icon: cat.icon, isCustom: cat.isCustom },
      });
    categoryMap.set(cat.name, record.id);
  }
  console.log(`  ✓ Categories: ${categoryMap.size}`);

  // ── 3. Pay Schedule ──
  const ps = data.paySchedule;
  let paySchedule = await prisma.paySchedule.findFirst({ where: { name: ps.name } });
  if (!paySchedule) {
    paySchedule = await prisma.paySchedule.create({
      data: {
        name: ps.name,
        type: ps.type as never,
        anchorDate: new Date(ps.anchorDate),
        isDefault: ps.isDefault,
      },
    });
  }
  console.log(`  ✓ Pay schedule: ${paySchedule.name} (${paySchedule.type})`);

  // ── 4. Income ──
  const incomeMap = new Map<string, string>(); // name → id
  for (const inc of data.income) {
    const categoryId = categoryMap.get(inc.categoryName);
    if (!categoryId) {
      console.warn(`    ⚠ Category not found for income: ${inc.name} (${inc.categoryName})`);
      continue;
    }
    let record = await prisma.income.findFirst({ where: { name: inc.name } });
    if (!record)
      record = await prisma.income.create({
        data: {
          name: inc.name,
          amount: inc.amount,
          frequency: inc.frequency as never,
          categoryId,
          note: inc.note ?? null,
        },
      });
    incomeMap.set(inc.name, record.id);
  }
  console.log(`  ✓ Income sources: ${incomeMap.size}`);

  // ── 5. Expenses ──
  const expenseMap = new Map<string, string>(); // name → id
  for (const exp of data.expenses) {
    const categoryId = categoryMap.get(exp.categoryName);
    if (!categoryId) {
      console.warn(`    ⚠ Category not found for expense: ${exp.name} (${exp.categoryName})`);
      continue;
    }
    const accountId = exp.accountName ? accountMap.get(exp.accountName) : undefined;
    let record = await prisma.expense.findFirst({ where: { name: exp.name } });
    if (!record)
      record = await prisma.expense.create({
        data: {
          name: exp.name,
          amount: exp.amount,
          frequency: exp.frequency as never,
          categoryId,
          accountId: accountId ?? null,
          isAutomatic: exp.isAutomatic,
          dueDay: exp.dueDay ?? null,
          note: exp.note ?? null,
        },
      });
    expenseMap.set(exp.name, record.id);
  }
  console.log(`  ✓ Expenses: ${expenseMap.size}`);

  // ── 6. Transactions ──
  // Skipped — seeded transactions have pay period dates, not actual due dates.
  // Real transactions should be entered manually or auto-generated by the system.
  console.log(`  ⏭ Transactions: skipped (enter manually)`);

  // ── 7. Balance Snapshots ──
  // Requires pay periods to exist (generated via POST /pay-schedules/:id/generate or Step 6 seeding)
  let snapshotCount = 0;
  for (const snap of data.balanceSnapshots) {
    const accountId = accountMap.get(snap.accountName);
    if (!accountId) continue;
    const payDate = new Date(snap.payDate);
    const payPeriod = await prisma.payPeriod.findFirst({
      where: { startDate: { lte: payDate }, endDate: { gte: payDate }, scheduleId: paySchedule.id },
    });
    if (!payPeriod) continue;
    // Skip if snapshot already exists for this period + account
    const exists = await prisma.balanceSnapshot.findFirst({
      where: { payPeriodId: payPeriod.id, accountId },
    });
    if (exists) continue;
    await prisma.balanceSnapshot.create({
      data: {
        payPeriodId: payPeriod.id,
        accountId,
        openingBalance: snap.openingBalance,
        closingBalance: snap.closingBalance,
        totalIncome: 0,
        totalExpenses: 0,
      },
    });
    snapshotCount++;
  }
  console.log(`  ✓ Balance snapshots: ${snapshotCount}`);

  // ── 8. Utility Readings ──
  // First, create UtilityProviders and UtilityServices for each unique type
  const serviceMap = new Map<string, string>(); // type name → serviceId
  const uniqueTypes = [...new Set(data.utilityReadings.map((u) => u.type))];
  for (const typeName of uniqueTypes) {
    const serviceType = inferServiceType(typeName);
    // Create or find provider
    let provider = await prisma.utilityProvider.findFirst({ where: { name: typeName } });
    if (!provider) {
      provider = await prisma.utilityProvider.create({ data: { name: typeName } });
    }
    // Create or find service under provider
    let service = await prisma.utilityService.findFirst({
      where: { providerId: provider.id, serviceType },
    });
    if (!service) {
      service = await prisma.utilityService.create({
        data: { providerId: provider.id, serviceType, metering: 'METERED' },
      });
    }
    serviceMap.set(typeName, service.id);
  }
  console.log(`  ✓ Utility providers/services: ${uniqueTypes.length}`);

  let utilCount = 0;
  for (const u of data.utilityReadings) {
    const serviceId = serviceMap.get(u.type);
    if (!serviceId) {
      console.warn(`    ⚠ No service found for type: ${u.type}`);
      continue;
    }
    await prisma.utilityReading.create({
      data: {
        serviceId,
        billDate: new Date(u.billDate),
        usage: u.usage ?? null,
        cost: u.cost,
        unitCost: u.unitCost ?? null,
        details: u.details ?? null,
      },
    });
    utilCount++;
  }
  console.log(`  ✓ Utility readings: ${utilCount}`);

  // ── 9. Healthcare Years ──
  for (const h of data.healthcareYears) {
    await prisma.healthcareYear.upsert({
      where: { year: h.year },
      update: {},
      create: {
        year: h.year,
        employer: h.employer,
        medicalPremium: h.medicalPremium,
        medicalDeductible: h.medicalDeductible,
        medicalOOPM: h.medicalOOPM,
        dentalPremium: h.dentalPremium,
        visionPremium: h.visionPremium,
        paidOutOfPocket: h.paidOutOfPocket,
      },
    });
  }
  console.log(`  ✓ Healthcare years: ${data.healthcareYears.length}`);

  // ── 10. Investment Holdings ──
  for (const inv of data.investmentHoldings) {
    const exists = await prisma.investmentHolding.findFirst({ where: { name: inv.name } });
    if (!exists) {
      await prisma.investmentHolding.create({
        data: {
          name: inv.name,
          ticker: inv.ticker ?? null,
          type: inv.type as never,
          quantity: inv.quantity,
          costBasis: inv.costBasis ?? null,
          accountName: inv.accountName,
        },
      });
    }
  }
  console.log(`  ✓ Investment holdings: ${data.investmentHoldings.length}`);

  console.log('\nSeed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
