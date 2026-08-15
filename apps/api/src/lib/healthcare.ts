/**
 * Healthcare balance computation utilities.
 *
 * Pure logic for computing insurance policy balances, separated from
 * route handlers for testability.
 */

import { prisma } from '@budget-tracker/db';
import { today, localDate, makeDate } from './dates.js';

/** Prisma interactive-transaction client (omits $connect, $transaction, etc.) */
type PrismaTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

interface RawBalance {
  deductibleRaw: number;
  oopmRaw: number;
}

interface CappedBalance {
  deductibleSpent: number | null;
  oopmSpent: number | null;
  deductibleRaw: number;
  oopmRaw: number;
}

/** Map policy type to icon (used for display only, not budget lookup) */
export const POLICY_TYPE_ICON_MAP: Record<string, string> = {
  MEDICAL: '🏥',
  DENTAL: '🦷',
  VISION: '👓',
};

/**
 * Pure function: cap raw balance totals at their respective limits.
 * Returns both the capped values and the original raw values.
 * When a limit is null (dental/vision without limits), spent is null.
 *
 * When deductibleOverride is true, the full deductible limit counts as
 * spent toward OOPM (the deductible is a subset of OOPM — secondary
 * insurance covering the deductible means that amount is "paid" toward OOPM).
 */
export function computeCappedBalance(
  raw: RawBalance,
  deductibleLimit: number | null,
  oopmLimit: number | null,
  deductibleOverride = false,
): CappedBalance {
  const deductibleSpent =
    deductibleLimit != null ? Math.min(raw.deductibleRaw, deductibleLimit) : null;

  // When deductible override is active, the full deductible limit counts toward OOPM
  let effectiveOopmRaw = raw.oopmRaw;
  if (deductibleOverride && deductibleLimit != null) {
    // Add the portion of the deductible not yet covered by actual spending
    const actualDeductibleSpent = Math.min(raw.deductibleRaw, deductibleLimit);
    const deductibleBoost = deductibleLimit - actualDeductibleSpent;
    effectiveOopmRaw = raw.oopmRaw + deductibleBoost;
  }

  return {
    deductibleSpent,
    oopmSpent: oopmLimit != null ? Math.min(effectiveOopmRaw, oopmLimit) : null,
    deductibleRaw: raw.deductibleRaw,
    oopmRaw: raw.oopmRaw,
  };
}

/**
 * Compute the monthly OOPM spread for a single insurance policy.
 * Pure function — no DB access, no side effects.
 *
 * @param oopmLimit    - The policy's OOPM limit (null if not set)
 * @param oopmSpent    - Amount already spent toward OOPM
 * @param oopmOverride - Whether secondary insurance covers the remaining OOPM
 * @param currentMonth - 1-based month (1 = January, 12 = December)
 * @returns Monthly spread amount, rounded to 2 decimal places, >= 0
 */
export function computeOopmSpread(
  oopmLimit: number | null,
  oopmSpent: number,
  oopmOverride: boolean,
  currentMonth: number,
): number {
  if (oopmLimit == null) return 0;
  if (oopmOverride) return 0;
  if (oopmSpent >= oopmLimit) return 0;

  const remaining = oopmLimit - oopmSpent;
  const remainingMonths = Math.max(12 - currentMonth + 1, 1);
  const spread = remaining / remainingMonths;

  return Math.round(spread * 100) / 100;
}

/**
 * DB query: sum EXPENSE transaction amounts for the policy's budget
 * within the policy year (Jan 1 – Dec 31).
 *
 * Uses per-policy budget (budgetId on InsurancePolicy) when available,
 * falls back to type-level system budget for legacy data.
 *
 * Both deductible and OOPM use the same raw sum — they track the same
 * spending, just with different caps applied by computeCappedBalance.
 */
export async function computeRawBalance(
  policyId: string,
  tx?: PrismaTransactionClient,
): Promise<RawBalance> {
  const db = tx ?? prisma;

  const policy = await db.insurancePolicy.findUnique({
    where: { id: policyId },
    select: { type: true, year: true, budgetId: true },
  });
  if (!policy) return { deductibleRaw: 0, oopmRaw: 0 };

  const yearStart = makeDate(policy.year, 0, 1);
  const yearEnd = makeDate(policy.year, 11, 31);

  // Use per-policy budget
  const budgetId: string | null = policy.budgetId;
  if (!budgetId) return { deductibleRaw: 0, oopmRaw: 0 };

  const result = await db.transaction.aggregate({
    _sum: { amount: true },
    where: {
      type: 'EXPENSE',
      date: { gte: yearStart, lte: yearEnd },
      budgetId,
    },
  });

  const total = result._sum.amount?.toNumber() ?? 0;

  return {
    deductibleRaw: total,
    oopmRaw: total,
  };
}

/**
 * Full OOPM-to-budget synchronization for a single insurance policy.
 * Fetches the policy, computes the spread, and upserts a budget version.
 *
 * @param policyId - The InsurancePolicy ID to sync
 */
export async function syncOopmToBudget(policyId: string): Promise<void> {
  // 1. Fetch policy; return early if not found or closed
  const policy = await prisma.insurancePolicy.findUnique({ where: { id: policyId } });
  if (!policy) return;
  if (policy.status === 'CLOSED') return;

  // 2. Compute raw balance and cap to get oopmSpent
  const raw = await computeRawBalance(policyId);
  const capped = computeCappedBalance(
    raw,
    policy.deductibleLimit?.toNumber() ?? null,
    policy.oopmLimit?.toNumber() ?? null,
    policy.deductibleOverride,
  );
  const oopmSpent = capped.oopmSpent ?? 0;

  // 3. Extract current month from today() via localDate()
  const { year, month } = localDate(today());
  const currentMonth = month + 1; // localDate returns 0-based month, computeOopmSpread expects 1-based

  // 4. Compute the OOPM spread
  const spread = computeOopmSpread(
    policy.oopmLimit?.toNumber() ?? null,
    oopmSpent,
    policy.oopmOverride,
    currentMonth,
  );

  // 5. Look up per-policy budget
  const budgetId: string | null = policy.budgetId;
  if (!budgetId) return;

  // 6. Find YearPlan (ACTIVE or DRAFT) for the policy year
  const yearPlan = await prisma.yearPlan.findUnique({
    where: { year: policy.year },
    select: { id: true, status: true },
  });
  if (!yearPlan || (yearPlan.status !== 'ACTIVE' && yearPlan.status !== 'DRAFT')) return;

  // 7. Find CategoryBudget for this year plan + policy budget
  const categoryBudget = await prisma.categoryBudget.findUnique({
    where: {
      yearPlanId_budgetId: {
        yearPlanId: yearPlan.id,
        budgetId,
      },
    },
    select: { id: true },
  });
  if (!categoryBudget) return;

  // 8. Fetch latest BudgetVersion; skip if manualOverride is true
  const latestVersion = await prisma.budgetVersion.findFirst({
    where: { categoryBudgetId: categoryBudget.id },
    orderBy: { effectiveDate: 'desc' },
    select: { id: true, manualOverride: true },
  });
  if (latestVersion?.manualOverride) return;

  // 9. Upsert: delete existing version with same effectiveDate, create new one
  const effectiveDate = makeDate(year, currentMonth - 1, 1);

  const existingVersion = await prisma.budgetVersion.findUnique({
    where: {
      categoryBudgetId_effectiveDate: {
        categoryBudgetId: categoryBudget.id,
        effectiveDate,
      },
    },
    select: { id: true },
  });
  if (existingVersion) {
    await prisma.budgetVersion.delete({ where: { id: existingVersion.id } });
  }

  await prisma.budgetVersion.create({
    data: {
      categoryBudgetId: categoryBudget.id,
      amount: spread,
      frequency: 'MONTHLY',
      monthlyEquivalent: spread,
      activeMonths: [],
      manualOverride: false,
      effectiveDate,
    },
  });
}

/** Shape of a Prisma InsurancePolicy row as consumed by {@link serializePolicy}. */
export type PrismaPolicy = {
  id: string;
  type: string;
  year: number;
  employer: string;
  premium: { toNumber(): number };
  deductibleLimit: { toNumber(): number } | null;
  oopmLimit: { toNumber(): number } | null;
  status: string;
  endedOn: Date | null;
  closedOn: Date | null;
  deductibleOverride: boolean;
  oopmOverride: boolean;
  metadata: unknown;
  budgetId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Serialize a policy row into the API response shape, computing its live balance. */
export async function serializePolicy(policy: PrismaPolicy) {
  const deductibleLimit = policy.deductibleLimit?.toNumber() ?? null;
  const oopmLimit = policy.oopmLimit?.toNumber() ?? null;

  const raw = await computeRawBalance(policy.id);
  const capped = computeCappedBalance(raw, deductibleLimit, oopmLimit, policy.deductibleOverride);

  return {
    id: policy.id,
    type: policy.type as 'MEDICAL' | 'DENTAL' | 'VISION',
    year: policy.year,
    employer: policy.employer,
    premium: policy.premium.toNumber(),
    deductibleLimit,
    oopmLimit,
    status: policy.status as 'ACTIVE' | 'ENDED' | 'CLOSED',
    endedOn: policy.endedOn,
    closedOn: policy.closedOn,
    deductibleOverride: policy.deductibleOverride,
    oopmOverride: policy.oopmOverride,
    metadata: policy.metadata as Record<string, unknown>,
    budgetId: policy.budgetId,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
    balance: {
      deductibleSpent: capped.deductibleSpent,
      deductibleRaw: capped.deductibleRaw,
      deductibleLimit,
      oopmSpent: capped.oopmSpent,
      oopmRaw: capped.oopmRaw,
      oopmLimit,
      deductibleOverride: policy.deductibleOverride,
      oopmOverride: policy.oopmOverride,
    },
  };
}
