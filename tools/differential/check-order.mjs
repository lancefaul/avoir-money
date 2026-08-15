#!/usr/bin/env node
/**
 * Assert that list endpoints return rows in a STABLE, AGREED order.
 *
 * # Why this is separate from the diff
 *
 * `compare.mjs` matches array elements by identity rather than position, on
 * purpose: before the tie-breaks existed, positional comparison produced 801
 * artifacts on one route and masked every real difference underneath. But that
 * same normalisation means the diff is BLIND to ordering — it reports
 * "identical" whether the two backends agree on order or not, and it would keep
 * reporting identical if a tie-break were removed again.
 *
 * So ordering gets its own check, and it asks the two questions the diff cannot:
 *
 *   1. Is each backend's own order REPEATABLE? (call it twice, compare)
 *   2. Do the two backends AGREE on that order?
 *
 * Both matter. A list that reshuffles between two renders is a defect the user
 * sees directly, and under cursor pagination (ADR-009) an unstable order can
 * serve a row twice or skip it entirely — the cursor is a position in an
 * ordering that has to be a strict total order for the guarantee to hold.
 */

const TS = process.env.TS_BASE;
const TS_KEY = process.env.TS_KEY ?? '';
const RS = process.env.RS_BASE;
const RS_KEY = process.env.RS_KEY ?? '';

if (!TS || !RS) {
  console.error('TS_BASE and RS_BASE are required');
  process.exit(2);
}

/**
 * Routes whose ordering is pinned, and where the ids live in the response.
 *
 * Deliberately short. These are the lists with a demonstrated tie: transactions
 * because a split purchase writes its Anchor and legs inside one millisecond,
 * and scheduled transactions because a single day routinely holds several due
 * items.
 */
const ROUTES = [
  { path: '/transactions?limit=200', pick: (b) => b.transactions },
  { path: '/transactions?limit=200&sortOrder=oldest', pick: (b) => b.transactions },
  { path: '/scheduled-transactions?periodStart=2026-01-01&periodEnd=2026-12-31', pick: (b) => b },
];

async function ids(base, key, route) {
  const res = await fetch(`${base}${route.path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${route.path} → ${res.status}`);
  const rows = route.pick(await res.json());
  if (!Array.isArray(rows)) throw new Error(`${route.path} did not yield an array`);
  return rows.map((r) => r.id);
}

const firstDifference = (a, b) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
};

let failures = 0;

for (const route of ROUTES) {
  // Twice on each side. A single call cannot distinguish "stable" from "the
  // database happened to return this order once".
  const [ts1, ts2, rs1, rs2] = await Promise.all([
    ids(TS, TS_KEY, route),
    ids(TS, TS_KEY, route),
    ids(RS, RS_KEY, route),
    ids(RS, RS_KEY, route),
  ]);

  const checks = [
    ['typescript is repeatable', ts1, ts2],
    ['rust is repeatable', rs1, rs2],
    // Ids are shared here: both databases come from the same export.
    ['the two agree', ts1, rs1],
  ];

  for (const [what, a, b] of checks) {
    const i = firstDifference(a, b);
    if (i === -1) continue;
    failures += 1;
    console.log(`FAIL  ${route.path}\n      ${what}: first differs at index ${i}`);
    console.log(`        a[${i}] = ${a[i] ?? '<end>'}`);
    console.log(`        b[${i}] = ${b[i] ?? '<end>'}`);
  }

  if (failures === 0) console.log(`ok    ${route.path}  (${ts1.length} rows)`);
}

console.log(
  failures === 0
    ? '\nordering is stable on both backends and agrees between them'
    : `\n${failures} ordering failures`,
);
process.exit(failures ? 1 : 0);
