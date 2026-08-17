/**
 * Test setup — uses a separate test database (port 5433).
 * The DATABASE_URL env var is set in vitest.config.ts so the
 * @budget-tracker/db singleton connects to the test DB.
 *
 * Cleanup strategy: Prisma deleteMany() in FK-safe order inside
 * an interactive $transaction, with deadlock retry logic.
 *
 * Why deleteMany instead of TRUNCATE:
 * - TRUNCATE requires ACCESS EXCLUSIVE locks on every table, which
 *   deadlock with ROW EXCLUSIVE locks held by in-flight Prisma
 *   operations from lifecycle hooks on other pool connections.
 * - deleteMany() only requires ROW EXCLUSIVE locks, which are
 *   compatible with other ROW EXCLUSIVE locks.
 * - The interactive $transaction ensures all deletes run on a single
 *   connection, atomically.
 *
 * Why this order matters:
 * - Child tables (those with FK references to parent tables) must be
 *   deleted before parent tables to avoid FK constraint violations.
 * - Transaction has a self-referencing parent-child relationship,
 *   so children are deleted first.
 *
 * FK constraint violations (P2003) are retryable because lifecycle
 * hooks running on separate pool connections can insert rows between
 * delete statements within the transaction. Retrying the entire
 * transaction resolves this race condition.
 *
 * Performance: deleteMany is slightly slower than TRUNCATE but test
 * tables are small (typically < 100 rows), so the difference is
 * negligible (~50ms vs ~5ms per cleanup).
 */
import { prisma } from '@budget-tracker/db';
import { beforeAll, beforeEach, afterAll } from 'vitest';
import { markScheduleDirty } from '../lib/schedule-generator.js';

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 200;

async function cleanDatabase(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await prisma.$transaction(
        async (tx) => {
          // ── Leaf tables (no other tables reference these) ──
          await tx.budgetExpenseLink.deleteMany();
          await tx.budgetVersion.deleteMany();
          await tx.scheduledTransaction.deleteMany();
          await tx.balanceSnapshot.deleteMany();
          await tx.debtPayment.deleteMany();
          await tx.investmentTransfer.deleteMany();
          await tx.investmentSnapshot.deleteMany();
          await tx.policyBudgetLink.deleteMany();
          await tx.utilityReading.deleteMany();
          await tx.utilityService.deleteMany();
          await tx.escrowRecord.deleteMany();
          // No foreign keys in either direction, so its position here is
          // arbitrary — but it must be SOMEWHERE. This list is maintained by
          // hand, and a table missing from it leaks rows across test files,
          // which shows up as one suite failing only when another ran first.
          await tx.uiPreference.deleteMany();

          // ── Transaction (self-referencing: delete children first) ──
          await tx.transaction.deleteMany({ where: { parentId: { not: null } } });
          await tx.transaction.deleteMany();

          // ── Tables referenced only by leaf tables above ──
          await tx.transactionDescription.deleteMany();
          await tx.investmentHolding.deleteMany();
          await tx.budgetGoal.deleteMany();
          await tx.categoryBudget.deleteMany();

          // ── Mid-level tables ──
          await tx.yearPlan.deleteMany();
          await tx.expense.deleteMany();
          await tx.income.deleteMany();
          await tx.payPeriod.deleteMany();
          await tx.paySchedule.deleteMany();
          await tx.insurancePolicy.deleteMany();
          await tx.utilityProvider.deleteMany();
          await tx.healthcareYear.deleteMany();

          // ── Parent tables (referenced by mid-level tables) ──
          await tx.budget.deleteMany();
          await tx.budgetGroup.deleteMany();
          await tx.custodian.deleteMany();
          await tx.wallet.deleteMany();
          await tx.debt.deleteMany();
          await tx.account.deleteMany();
        },
        { timeout: 30000 },
      );
      return;
    } catch (err: unknown) {
      const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : '';
      const message = err instanceof Error ? err.message : '';
      // 40P01 = deadlock, 55P03 = lock timeout, 40001 = serialization failure
      // P2003 = FK constraint violation (lifecycle hooks on other connections
      //         can insert rows between delete statements)
      // P2025 = record not found (concurrent deletion)
      // "Response from the Engine was empty" = Prisma engine crash (transient in CI)
      const isRetryable =
        code === '40P01' ||
        code === '55P03' ||
        code === '40001' ||
        code === 'P2003' ||
        code === 'P2025' ||
        message.includes('Response from the Engine was empty');
      if (isRetryable && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }
      throw err;
    }
  }
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  // Reconnect if the engine crashed between tests (transient CI issue)
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
  await cleanDatabase();
  // Reset schedule generator cache so deleted tables don't cause stale no-ops
  markScheduleDirty();
});

afterAll(async () => {
  await prisma.$disconnect();
});
