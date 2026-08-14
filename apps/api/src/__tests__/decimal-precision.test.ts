/**
 * Guard tests for the Decimal write boundary (2026-07-18).
 *
 * Background: passing a plain JS `number` to a Prisma `Decimal` column
 * serialized it at 16 significant digits instead of its shortest round-trip
 * representation, so clean 2-decimal values were corrupted on write:
 *
 *     sent 9.79   ->  stored 9.789999999999999
 *     sent 84.29  ->  stored 84.29000000000001
 *
 * Ten production rows and one Account.balance carried these tails. The
 * corruption happened AFTER all arithmetic, at serialization, so the existing
 * `Math.round()` calls in ledger.ts could not prevent it — they rounded
 * correctly and the rounded result was then corrupted. `{ increment: n }`
 * amplified it: Postgres adds the tails in exact decimal arithmetic, so every
 * dirty amount permanently accumulated into the running balance.
 *
 * The fix is `decimalPrecisionExtension` in packages/db — it converts numbers
 * bound to Decimal fields into `Prisma.Decimal` before the query is issued.
 *
 * These tests exist because no test asserted stored precision. The values below
 * are chosen specifically because their 16-significant-digit expansion differs
 * from their shortest representation — most values round-trip cleanly by luck,
 * which is why the bug hid for weeks and surfaced on only ~10 rows.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma, Prisma, normalizeDecimalArgs } from '@budget-tracker/db';
import { ledgerCreate } from '../lib/lifecycle/index.js';

/** Values whose 16-sig-digit expansion differs from their shortest form. */
const DIRTY_PRONE = [9.79, 9.97, 8.14, 84.29, 64.6, 8.04, 86.85, 68.24, 8.72];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

/** The shared setup truncates between tests, so fixtures are made per test. */
async function makeAccount(): Promise<string> {
  const account = await prisma.account.create({
    data: { name: `__decimal_precision_${Date.now()}`, type: 'CHECKING', balance: 0 },
  });
  return account.id;
}

/** Read a column back as text so we see exactly what Postgres stored. */
async function storedText(table: string, column: string, id: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ v: string }[]>(
    `SELECT "${column}"::text AS v FROM "${table}" WHERE id = $1`,
    id,
  );
  return rows[0]!.v;
}

/** Trailing zeros are just the column's scale — strip them before comparing. */
const trim = (v: string) => v.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

// ─── Unit: the argument walker ───

describe('normalizeDecimalArgs', () => {
  it('converts numbers bound to Decimal fields', () => {
    const out = normalizeDecimalArgs({ data: { amount: 9.79 } }, 'Transaction') as {
      data: { amount: Prisma.Decimal };
    };
    expect(out.data.amount).toBeInstanceOf(Prisma.Decimal);
    expect(out.data.amount.toString()).toBe('9.79');
  });

  it('converts arithmetic operators — the increment amplifier', () => {
    const out = normalizeDecimalArgs({ data: { balance: { increment: 9.79 } } }, 'Account') as {
      data: { balance: { increment: Prisma.Decimal } };
    };
    expect(out.data.balance.increment.toString()).toBe('9.79');
  });

  it('converts comparison operators and operator arrays', () => {
    const out = normalizeDecimalArgs(
      { where: { amount: { gt: 9.79, in: [8.14, 84.29] } } },
      'Transaction',
    ) as { where: { amount: { gt: Prisma.Decimal; in: Prisma.Decimal[] } } };
    expect(out.where.amount.gt.toString()).toBe('9.79');
    expect(out.where.amount.in.map((d) => d.toString())).toEqual(['8.14', '84.29']);
  });

  it('recurses into createMany arrays and nested relation writes', () => {
    const many = normalizeDecimalArgs(
      { data: { createMany: { data: [{ amount: 9.79 }, { amount: 8.14 }] } } },
      'Transaction',
    ) as { data: { createMany: { data: { amount: Prisma.Decimal }[] } } };
    expect(many.data.createMany.data.map((r) => r.amount.toString())).toEqual(['9.79', '8.14']);

    const nested = normalizeDecimalArgs(
      { data: { name: 'x', transactions: { create: { amount: 84.29 } } } },
      'Account',
    ) as { data: { transactions: { create: { amount: Prisma.Decimal } } } };
    expect(nested.data.transactions.create.amount.toString()).toBe('84.29');
  });

  it('leaves non-numeric values on Decimal fields alone', () => {
    const out = normalizeDecimalArgs(
      { select: { amount: true }, orderBy: { amount: 'desc' } },
      'Transaction',
    ) as { select: { amount: boolean }; orderBy: { amount: string } };
    expect(out.select.amount).toBe(true);
    expect(out.orderBy.amount).toBe('desc');
  });

  it('never walks into Json columns', () => {
    // `amountSchedule` is Json. A key inside it that collides with a Decimal
    // field name must survive as a plain number, or JSON payloads get rewritten.
    const out = normalizeDecimalArgs(
      { data: { amountSchedule: { amount: 9.79, '1': 5000 } } },
      'Income',
    ) as { data: { amountSchedule: Record<string, unknown> } };
    expect(out.data.amountSchedule['amount']).toBe(9.79);
    expect(out.data.amountSchedule['amount']).not.toBeInstanceOf(Prisma.Decimal);
  });

  it('does not mutate the caller’s arguments', () => {
    const args = { data: { amount: 9.79 } };
    normalizeDecimalArgs(args, 'Transaction');
    expect(args.data.amount).toBe(9.79);
  });

  it('passes null and undefined through on nullable Decimal fields', () => {
    // 22 Decimal columns are nullable. Coercing null/undefined here would turn
    // "clear this value" into a write of Decimal(0), or crash on construction.
    const out = normalizeDecimalArgs(
      { data: { costBasisAllocated: null, balanceBefore: undefined, amount: 9.79 } },
      'Transaction',
    ) as { data: { costBasisAllocated: unknown; balanceBefore: unknown; amount: Prisma.Decimal } };
    expect(out.data.costBasisAllocated).toBeNull();
    expect(out.data.balanceBefore).toBeUndefined();
    expect(out.data.amount).toBeInstanceOf(Prisma.Decimal);
  });

  it('survives absent args and non-finite numbers', () => {
    // `prisma.x.findMany()` passes undefined; NaN/Infinity must reach Prisma so
    // it reports them rather than throwing inside Decimal construction.
    expect(normalizeDecimalArgs(undefined, 'Transaction')).toBeUndefined();
    expect(normalizeDecimalArgs({}, 'Transaction')).toEqual({});
    const out = normalizeDecimalArgs({ data: { amount: NaN } }, 'Transaction') as {
      data: { amount: number };
    };
    expect(out.data.amount).toBeNaN();
  });

  it('leaves a null Decimal null through a real write', async () => {
    const accountId = await makeAccount();
    const tx = await ledgerCreate({
      type: 'EXPENSE',
      name: '__nullable',
      amount: 9.79,
      date: new Date(Date.UTC(2026, 6, 1)),
      accountId,
    });
    const row = await prisma.transaction.findUniqueOrThrow({
      where: { id: tx.id },
      select: { costBasisAllocated: true, taxRate: true },
    });
    expect(row.costBasisAllocated).toBeNull();
    expect(row.taxRate).toBeNull();
  });
});

// ─── Integration: what actually lands in Postgres ───

describe('Decimal columns store exact 2-decimal values', () => {
  it('stores every dirty-prone amount exactly, via the ledger gate', async () => {
    const accountId = await makeAccount();
    for (const value of DIRTY_PRONE) {
      const tx = await ledgerCreate({
        type: 'EXPENSE',
        name: '__decimal_precision',
        amount: value,
        date: new Date(Date.UTC(2026, 6, 1)),
        accountId,
      });
      expect(trim(await storedText('Transaction', 'amount', tx.id)), `amount ${value}`).toBe(
        String(value),
      );
      expect(trim(await storedText('Transaction', 'netAmount', tx.id)), `netAmount ${value}`).toBe(
        String(value),
      );
    }
  });

  it('keeps a running balance clean across repeated increments', async () => {
    // The original amplifier: each dirty amount added its 16-digit tail into
    // Account.balance in SQL, which is how -1478.93 became -1478.929999999999999.
    const accountId = await makeAccount();
    for (const value of DIRTY_PRONE) {
      await prisma.account.update({
        where: { id: accountId },
        data: { balance: { increment: value } },
      });
    }
    const stored = trim(await storedText('Account', 'balance', accountId));
    const expected = DIRTY_PRONE.reduce((sum, n) => Math.round((sum + n) * 100) / 100, 0);
    expect(stored).toBe(String(expected));
    expect(stored).not.toMatch(/\d{10,}$/);
  });

  it('no Transaction row is written with sub-cent precision', async () => {
    // The invariant that was missing. Scoped to rows this test creates, so it
    // asserts the write path rather than the state of pre-existing data.
    const accountId = await makeAccount();
    for (const value of DIRTY_PRONE) {
      await ledgerCreate({
        type: 'EXPENSE',
        name: '__decimal_precision',
        amount: value,
        date: new Date(Date.UTC(2026, 6, 1)),
        accountId,
      });
    }
    const bad = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Transaction"
      WHERE "accountId" = ${accountId}
        AND (amount <> round(amount, 2) OR "netAmount" <> round("netAmount", 2))
    `;
    expect(Number(bad[0]!.n)).toBe(0);
  });
});
