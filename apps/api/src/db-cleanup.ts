import { prisma } from '@budget-tracker/db';

async function run() {
  const count = await prisma.transaction.count();
  console.log(`Transactions to delete: ${count}`);

  if (!process.argv.includes('--apply')) {
    console.log('\nDry run. Pass --apply to execute.');
    await prisma.$disconnect();
    return;
  }

  console.log('\nDeleting...');
  const t = await prisma.transaction.deleteMany();
  console.log(`  Transactions: ${t.count}`);
  console.log('\nDone.');
  await prisma.$disconnect();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
