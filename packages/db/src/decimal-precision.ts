/**
 * Decimal precision extension — the single gate for JS-number → Decimal writes.
 *
 * Passing a plain JS `number` to a Prisma `Decimal` column serializes it at 16
 * significant digits rather than its shortest round-trip representation, so a
 * perfectly clean 2-decimal value is silently corrupted on write:
 *
 *     sent 9.79   ->  stored 9.789999999999999
 *     sent 84.29  ->  stored 84.29000000000001
 *
 * This happens AFTER all arithmetic, at the serialization boundary, so no amount
 * of `Math.round()` in application code can prevent it — the rounded value is
 * what gets corrupted. `Prisma.Decimal` and string inputs are exact.
 *
 * The damage compounds: `{ increment: n }` performs the addition in SQL, so
 * Postgres adds those 16-digit tails into running balances in exact decimal
 * arithmetic, permanently accumulating the garbage (this is how Account.balance
 * reached -1478.929999999999999).
 *
 * This extension converts every number bound to a Decimal field into a
 * `Prisma.Decimal` before the query is issued — including comparison and
 * arithmetic operators (`increment`, `gt`, `in`, …), nested writes, and
 * `createMany`. It is deliberately a serialization fix only: it never rounds.
 * Rounding to cents remains a domain rule (see QUALITY.md "Monetary Arithmetic"),
 * because Decimal columns also carry values that legitimately need more
 * precision — BTC quantities, tax rates, interest rates.
 */
import { Prisma } from '@prisma/client';

interface ModelFields {
  /** Scalar fields on this model typed `Decimal`. */
  decimals: Set<string>;
  /** Relation field name → related model name, for recursing into nested writes. */
  relations: Map<string, string>;
}

/**
 * Structural argument keys that wrap further model-scoped arguments. Recursion
 * continues through these under the SAME model.
 *
 * Anything not listed here and not a known relation is left untouched, which is
 * what keeps `Json` columns (`amountSchedule`, `details`, `metadata`) safe — an
 * object living in a Json column is never walked into, so a JSON payload that
 * happens to contain a key like `amount` is never rewritten.
 */
const STRUCTURAL_KEYS = new Set([
  'data',
  'create',
  'update',
  'upsert',
  'connectOrCreate',
  'createMany',
  'updateMany',
  'where',
  'select',
  'include',
  'orderBy',
  'having',
  'AND',
  'OR',
  'NOT',
  'some',
  'every',
  'none',
  'is',
  'isNot',
]);

/** True for `{}`-literal objects only — excludes Date, Decimal, Buffer, arrays. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

let cachedFieldMap: Map<string, ModelFields> | undefined;

/** Build model → { Decimal fields, relations } from the generated DMMF. */
function fieldMap(): Map<string, ModelFields> {
  if (cachedFieldMap) return cachedFieldMap;
  const map = new Map<string, ModelFields>();
  for (const model of Prisma.dmmf.datamodel.models) {
    const decimals = new Set<string>();
    const relations = new Map<string, string>();
    for (const field of model.fields) {
      if (field.kind === 'scalar' && field.type === 'Decimal') decimals.add(field.name);
      else if (field.kind === 'object') relations.set(field.name, field.type);
    }
    map.set(model.name, { decimals, relations });
  }
  cachedFieldMap = map;
  return map;
}

/**
 * Convert a value bound to a Decimal field.
 *
 * Handles the bare value (`amount: 9.79`), operator objects
 * (`amount: { increment: 9.79 }`, `{ gt: 5 }`) and operator arrays
 * (`{ in: [1, 2] }`). Non-numeric values pass through untouched, which is what
 * makes `select: { amount: true }` and `orderBy: { amount: 'desc' }` safe.
 */
function toDecimal(value: unknown): unknown {
  if (typeof value === 'number') {
    // Leave NaN/Infinity alone so Prisma reports them rather than throwing here.
    return Number.isFinite(value) ? new Prisma.Decimal(value) : value;
  }
  if (Array.isArray(value)) return value.map(toDecimal);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = toDecimal(inner);
    return out;
  }
  return value;
}

/**
 * Walk query arguments in the context of `model`, replacing numbers bound to
 * Decimal fields. Returns new objects rather than mutating the caller's args.
 */
export function normalizeDecimalArgs(node: unknown, model: string): unknown {
  if (Array.isArray(node)) return node.map((item) => normalizeDecimalArgs(item, model));
  if (!isPlainObject(node)) return node;

  const info = fieldMap().get(model);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (info?.decimals.has(key)) out[key] = toDecimal(value);
    else if (info?.relations.has(key))
      out[key] = normalizeDecimalArgs(value, info.relations.get(key)!);
    else if (STRUCTURAL_KEYS.has(key)) out[key] = normalizeDecimalArgs(value, model);
    else out[key] = value;
  }
  return out;
}

export const decimalPrecisionExtension = Prisma.defineExtension({
  name: 'decimal-precision',
  query: {
    $allModels: {
      $allOperations({ model, args, query }) {
        return query(normalizeDecimalArgs(args, model) as typeof args);
      },
    },
  },
});
