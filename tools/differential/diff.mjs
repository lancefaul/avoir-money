#!/usr/bin/env node
/**
 * Diff the Rust backend against the TypeScript one, route by route.
 *
 * # Why this exists
 *
 * On 2026-08-10 the port stood at 178 of 180 handlers routed and 786 passing
 * tests, and one day of ordinary use turned up SIX defects — every one found by
 * opening a page, none by the suite. Three were response shapes invented during
 * the port, with tests written in the same sitting that asserted the invention.
 * A test written by the same person, at the same time, as the code it covers
 * inherits that person's misunderstanding; it is not weak, it is a precise
 * assertion of the wrong thing.
 *
 * The measure was wrong too. A handler count answers "does something exist",
 * never "is it the same". Only a comparison against the reference implementation
 * answers the second question, and that is the entire purpose of keeping
 * `apps/api` alive.
 *
 * # What it does NOT do
 *
 * It does not assert the values are *right* — both could be wrong together, and
 * a shared misunderstanding is exactly what a differential cannot see. It
 * asserts they are the SAME, which is the property a port owes.
 *
 * **It covers READ endpoints only.** The route list comes from the acceptance
 * suite's `every_read_endpoint`, so every POST, PUT and DELETE response shape is
 * outside it. That gap is not hypothetical: injecting an invented field into
 * `group_json` — the shape returned by `POST /budgets/groups` — produced a fully
 * green run, and the same field injected into `list_groups` was caught at once.
 * Three of the six defects that motivated this harness were response shapes, and
 * a write-path response shape would still be invisible today.
 *
 * Closing it means driving the same sequence of writes against both backends and
 * diffing each response, which needs a shared starting state and an ordering the
 * two agree on. Worth doing; not done.
 *
 * # Reading the output
 *
 * Every difference is printed with its JSON path. Differences that are
 * legitimate — ids minted per-run, timestamps, deliberate decisions recorded in
 * an ADR — belong in the `EXPECTED` list in `compare.mjs`, with a reason, never
 * silently filtered. That list is itself the reviewable artifact: it is every
 * way the two backends are allowed to disagree, and it should be read as such.
 */

import { readFileSync } from 'node:fs';
import { diff, expected } from './compare.mjs';

const TS = process.env.TS_BASE ?? 'http://127.0.0.1:5274/api/v1';
const TS_KEY = process.env.TS_KEY ?? 'budget-tracker-dev-key';
const RS = process.env.RS_BASE ?? null;
const RS_KEY = process.env.RS_KEY ?? '';
const ROUTES_FROM = process.env.ROUTES ?? '/tmp/avoir-responses.json';

if (!RS) {
  console.error('RS_BASE is required (the Rust server, e.g. http://127.0.0.1:41234/api/v1)');
  process.exit(2);
}

async function get(base, key, route) {
  const res = await fetch(`${base}${route}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { __unparseable: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

const routes = Object.keys(JSON.parse(readFileSync(ROUTES_FROM, 'utf8')));
console.log(`Comparing ${routes.length} routes\n  TS:   ${TS}\n  Rust: ${RS}\n`);

let identical = 0;
const problems = [];
const statusMismatch = [];

for (const route of routes) {
  let ts, rs;
  try {
    [ts, rs] = await Promise.all([get(TS, TS_KEY, route), get(RS, RS_KEY, route)]);
  } catch (err) {
    problems.push({ route, fatal: err.message });
    continue;
  }

  if (ts.status !== rs.status) {
    statusMismatch.push({ route, ts: ts.status, rs: rs.status });
    continue;
  }
  // A route the reference itself refuses says nothing about the port.
  if (ts.status >= 400) continue;

  const all = diff(ts.body, rs.body);
  const real = all.filter((d) => !expected(d, route));
  if (real.length === 0) identical += 1;
  else problems.push({ route, diffs: real });
}

// ─── Report ───

if (statusMismatch.length) {
  console.log(`STATUS MISMATCH (${statusMismatch.length})`);
  for (const m of statusMismatch) console.log(`  ${m.route}\n    ts=${m.ts}  rust=${m.rs}`);
  console.log('');
}

if (problems.length) {
  console.log(`DIFFERENCES (${problems.length} routes)`);
  for (const p of problems) {
    if (p.fatal) {
      console.log(`  ${p.route}\n    could not compare: ${p.fatal}`);
      continue;
    }
    console.log(`  ${p.route}  (${p.diffs.length})`);
    for (const d of p.diffs.slice(0, 8)) {
      const show = (v) => (v === undefined ? '<absent>' : JSON.stringify(v)?.slice(0, 70));
      console.log(`    ${d.kind.padEnd(16)} ${d.path}`);
      console.log(`      ts:   ${show(d.ts)}`);
      console.log(`      rust: ${show(d.rs)}`);
    }
    if (p.diffs.length > 8) console.log(`    … ${p.diffs.length - 8} more`);
  }
  console.log('');
}

// The console report truncates to eight per route so it stays readable. The
// full set goes to a file, because the useful question when triaging is "which
// FIELD is wrong across every route", and that cannot be answered from a
// truncated view — the first pass at this analysed the printed output and
// undercounted by an order of magnitude.
if (process.env.DIFF_JSON) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.DIFF_JSON, JSON.stringify({ problems, statusMismatch }, null, 2));
  console.log(`full diff written to ${process.env.DIFF_JSON}`);
}

console.log(
  `${identical}/${routes.length} identical, ` +
    `${problems.length} with differences, ${statusMismatch.length} status mismatches`,
);
process.exit(problems.length || statusMismatch.length ? 1 : 0);
