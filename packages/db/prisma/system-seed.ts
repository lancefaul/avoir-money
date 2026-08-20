/**
 * System seed — ensures out-of-the-box budgets always exist.
 * Safe to run multiple times (upserts by name).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SYSTEM_BUDGETS = [
  { name: 'Uncategorized', icon: '📋' },
  { name: 'Income', icon: '💵' },
  { name: 'Trade', icon: '📈' },
  { name: 'Transfer', icon: '➡️' },
  // Carries the payment legs of a multi-account purchase (payment-split, ADR-030)
  // so a leg is money movement, not categorized spend — excluded from budget
  // rollup the same way Transfer is. Inert until payment-split assigns legs to it.
  { name: 'Payment', icon: '💳' },
];

async function main() {
  console.log('Seeding system budgets...');

  // Ensure SYSTEM group exists
  let systemGroup = await prisma.budgetGroup.findFirst({
    where: { name: 'SYSTEM' },
  });
  if (!systemGroup) {
    systemGroup = await prisma.budgetGroup.create({
      data: { name: 'SYSTEM', color: 'fern50' },
    });
    console.log('  ✓ Created SYSTEM group');
  } else {
    if (systemGroup.color !== 'fern50') {
      systemGroup = await prisma.budgetGroup.update({
        where: { id: systemGroup.id },
        data: { color: 'fern50' },
      });
      console.log('  ✓ Updated SYSTEM group color to fern50');
    } else {
      console.log('  – SYSTEM group exists');
    }
  }

  for (const budget of SYSTEM_BUDGETS) {
    const existing = await prisma.budget.findFirst({
      where: { name: budget.name },
    });
    if (!existing) {
      await prisma.budget.create({
        data: {
          name: budget.name,
          icon: budget.icon,
          groupId: systemGroup.id,
          // System budgets carry isSystem so they are protected from
          // delete/reassign and excluded from user budget rollup. The column
          // defaults to false, so a create that omits it (as this seed did)
          // leaves a new system budget looking like an ordinary one.
          isSystem: true,
        },
      });
      console.log(`  ✓ Created: ${budget.icon} ${budget.name}`);
    } else {
      console.log(`  – Exists: ${budget.icon} ${budget.name}`);
    }
  }

  console.log('System seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
