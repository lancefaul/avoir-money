/**
 * Historical Data Backfill Script
 *
 * Generates ScheduledTransaction rows for all historical transactions
 * that have an expenseId or incomeId set. Each row is created with
 * status = PAID, actualAmount = transaction amount, transactionId = tx id,
 * and dueDate = tx.occurrenceDate ?? tx.date.
 *
 * Uses createMany({ skipDuplicates: true }) for idempotency — safe to
 * run multiple times without creating duplicates.
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/backfill-schedule.ts [--apply]
 *
 * Without --apply, runs in dry-run mode (read-only).
 */
import { prisma } from '@budget-tracker/db';

interface BackfillRow {
  sourceType: 'EXPENSE' | 'INCOME';
  sourceId: string;
  dueDate: Date;
  expectedAmount: number;
  actualAmount: number;
  status: 'PAID';
  transactionId: string;
  expenseId: string | null;
  incomeId: string | null;
}

/**
 * Core backfill logic — exported for testing.
 * Returns the rows that would be (or were) created.
 */
export async function backfillSchedule(opts: { apply: boolean }): Promise<{
  rows: BackfillRow[];
  created: number;
}> {
  const { apply } = opts;

  // Query all transactions linked to a recurring source
  const transactions = await prisma.transaction.findMany({
    where: {
      OR: [{ expenseId: { not: null } }, { incomeId: { not: null } }],
    },
    orderBy: { date: 'asc' },
  });

  console.log(`Found ${transactions.length} linked transaction(s) to backfill.\n`);

  // Build a cache of source amounts for expectedAmount resolution
  const expenseIds = [...new Set(transactions.filter((t) => t.expenseId).map((t) => t.expenseId!))];
  const incomeIds = [...new Set(transactions.filter((t) => t.incomeId).map((t) => t.incomeId!))];

  const expenses = await prisma.expense.findMany({ where: { id: { in: expenseIds } } });
  const incomes = await prisma.income.findMany({ where: { id: { in: incomeIds } } });

  const expenseMap = new Map(expenses.map((e) => [e.id, Number(e.amount)]));
  const incomeMap = new Map(incomes.map((i) => [i.id, Number(i.amount)]));

  const rows: BackfillRow[] = [];

  for (const tx of transactions) {
    const isExpense = tx.expenseId != null;
    const sourceType = isExpense ? ('EXPENSE' as const) : ('INCOME' as const);
    const sourceId = isExpense ? tx.expenseId! : tx.incomeId!;
    const dueDate = tx.occurrenceDate ?? tx.date;
    const txAmount = Number(tx.amount);

    // Resolve expectedAmount from source, fallback to tx amount
    const sourceAmount = isExpense ? expenseMap.get(sourceId) : incomeMap.get(sourceId);
    const expectedAmount = sourceAmount ?? txAmount;

    rows.push({
      sourceType,
      sourceId,
      dueDate,
      expectedAmount,
      actualAmount: txAmount,
      status: 'PAID',
      transactionId: tx.id,
      expenseId: isExpense ? sourceId : null,
      incomeId: isExpense ? null : sourceId,
    });

    console.log(
      `  ${sourceType} ${sourceId} @ ${dueDate.toISOString().slice(0, 10)} → PAID (expected: ${expectedAmount}, actual: ${txAmount})`,
    );
  }

  let created = 0;
  if (apply && rows.length > 0) {
    // Batch in chunks of 500 to avoid overly large queries
    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const result = await prisma.scheduledTransaction.createMany({
        data: batch.map((r) => ({
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          dueDate: r.dueDate,
          expectedAmount: r.expectedAmount,
          actualAmount: r.actualAmount,
          status: r.status,
          transactionId: r.transactionId,
          expenseId: r.expenseId,
          incomeId: r.incomeId,
        })),
        skipDuplicates: true,
      });
      created += result.count;
    }
  }

  return { rows, created };
}

// ─── CLI entry point ───

async function run() {
  const dryRun = !process.argv.includes('--apply');
  if (dryRun) console.log('DRY RUN — pass --apply to execute writes.\n');

  const { rows, created } = await backfillSchedule({ apply: !dryRun });

  console.log(`\nSummary: ${rows.length} row(s) prepared, ${created} created.`);
  if (dryRun) console.log('(No writes performed — dry run.)');

  await prisma.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
