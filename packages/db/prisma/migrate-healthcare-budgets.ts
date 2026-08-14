/**
 * Data migration: Create per-policy system budgets for existing insurance policies
 * and remap transactions from old type-level budgets to per-policy budgets.
 *
 * Run: npx tsx prisma/migrate-healthcare-budgets.ts
 * Target: production database (port 5432)
 *
 * Safe to run multiple times (idempotent — skips policies that already have budgetId).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const POLICY_TYPE_BUDGET_MAP: Record<string, { name: string; icon: string }> = {
  MEDICAL: { name: 'Deductible & OOPM', icon: '🏥' },
  DENTAL: { name: 'Dental Deductible & OOPM', icon: '🦷' },
  VISION: { name: 'Vision Deductible & OOPM', icon: '👓' },
};

async function main() {
  console.log('Healthcare budget migration starting...\n');

  // 1. Ensure INSURANCE group exists (lavender50 for badge backgrounds)
  let insuranceGroup = await prisma.budgetGroup.findFirst({ where: { name: 'INSURANCE' } });
  if (!insuranceGroup) {
    insuranceGroup = await prisma.budgetGroup.create({
      data: { name: 'INSURANCE', color: 'violet50' },
    });
    console.log('  ✓ Created INSURANCE group (lavender50)');
  }

  // 2. Get all policies without a budgetId
  const policies = await prisma.insurancePolicy.findMany({
    where: { budgetId: null },
  });

  if (policies.length === 0) {
    console.log('  – No policies need migration (all have budgetId)');
    return;
  }

  console.log(`  Found ${policies.length} policies to migrate\n`);

  for (const policy of policies) {
    const meta = policy.metadata as Record<string, unknown> | null;
    const insurer = (meta?.insurer as string) || policy.employer;
    const typeLabel = policy.type.charAt(0) + policy.type.slice(1).toLowerCase();
    const budgetName = `${insurer} ${typeLabel} ${policy.year}`;
    const icon = policy.type === 'MEDICAL' ? '🏥' : policy.type === 'DENTAL' ? '🦷' : '👓';

    // Create per-policy budget in INSURANCE group
    const policyBudget = await prisma.budget.create({
      data: {
        name: budgetName,
        icon,
        groupId: insuranceGroup.id,
        isSystem: true,
      },
    });

    // Link policy to its new budget
    await prisma.insurancePolicy.update({
      where: { id: policy.id },
      data: { budgetId: policyBudget.id },
    });

    console.log(
      `  ✓ ${policy.type} ${policy.year} "${insurer}" → budget "${budgetName}" (${policyBudget.id})`,
    );

    // 3. Remap transactions from old type-level budget to per-policy budget
    const oldBudgetInfo = POLICY_TYPE_BUDGET_MAP[policy.type];
    if (oldBudgetInfo) {
      const oldBudget = await prisma.budget.findFirst({
        where: { name: oldBudgetInfo.name, isSystem: true },
        select: { id: true },
      });

      if (oldBudget) {
        const yearStart = new Date(Date.UTC(policy.year, 0, 1));
        const yearEnd = new Date(Date.UTC(policy.year, 11, 31));

        const result = await prisma.transaction.updateMany({
          where: {
            type: 'EXPENSE',
            budgetId: oldBudget.id,
            date: { gte: yearStart, lte: yearEnd },
          },
          data: { budgetId: policyBudget.id },
        });

        if (result.count > 0) {
          console.log(`    → Remapped ${result.count} transactions from "${oldBudgetInfo.name}"`);
        }
      }
    }
  }

  console.log('\nHealthcare budget migration complete.');
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
