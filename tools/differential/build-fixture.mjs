#!/usr/bin/env node
/**
 * Drive the write scenario against the Rust backend ALONE, to leave behind a
 * populated database.
 *
 * # Why this exists
 *
 * `acceptance.rs` needs a production-SHAPED database — it samples ids from ten
 * tables and asserts each is non-empty, because "an empty table means the
 * per-record routes for it are silently skipped, and a run that skips most of
 * what it claims to check is worse than one that fails". The only such database
 * was an import of the real one, which cannot go into a hosted runner: it is one
 * person's complete financial history. So the response-shape check was a local
 * gate, and CI carried a comment explaining why it could not run.
 *
 * This closes that. The fixture is BUILT from the API rather than imported, so
 * CI can make one from nothing.
 *
 * # Why it is not `write-diff.mjs`
 *
 * That harness compares two backends, so it needs Postgres, Docker, and a
 * TypeScript server. None of that is needed to *populate* a database — only the
 * Rust side and the same instructions. Reusing `scenario.mjs` rather than
 * writing a second list is the point: the fixture is exactly what the
 * differential harness verifies, so a shape the harness has checked is a shape
 * the fixture contains, and neither can drift from the other without the diff
 * reporting it.
 *
 * # What it deliberately does NOT do
 *
 * Assert anything. A step that 400s here is not a failure — the scenario ends
 * with 36 refusals whose whole purpose is to be refused. The only thing worth
 * failing on is a step marked `expectStatus`, because those are the creates
 * everything else is built on: if one stops working, the fixture is empty in a
 * way that is silent, and an empty fixture is what `acceptance.rs` exists to
 * catch. That check is the same staleness guard `write-diff.mjs` uses, for the
 * same reason.
 *
 * Usage:  RS_BASE=http://127.0.0.1:PORT/api/v1 RS_KEY=... node build-fixture.mjs
 */

import { scenario } from './scenario.mjs';
import { rejections } from './rejections.mjs';

const RS = process.env.RS_BASE ?? null;
const KEY = process.env.RS_KEY ?? '';

if (!RS) {
  console.error('RS_BASE is required (e.g. http://127.0.0.1:41234/api/v1)');
  process.exit(2);
}

const steps = [...scenario, ...rejections];

/** Replace every `$name` with the id that step bound. */
function substitute(value, binds) {
  if (typeof value === 'string') {
    return value.replace(/\$([a-zA-Z][a-zA-Z0-9]*)/g, (whole, name) =>
      Object.hasOwn(binds, name) ? binds[name] : whole,
    );
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, binds));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, binds)]));
  }
  return value;
}

const binds = {};
let ran = 0;
const stale = [];

for (const [i, step] of steps.entries()) {
  const path = substitute(step.path, binds);
  const init = {
    method: step.method,
    headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
  };
  if (step.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(substitute(step.body, binds));
  }

  let res, body;
  try {
    res = await fetch(`${RS}${path}`, init);
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch (err) {
    console.error(`  ${step.method} ${path} — ${err.message}`);
    process.exit(1);
  }
  ran += 1;

  const bindings = step.binds ?? (step.bind ? { [step.bind]: step.bindField ?? 'id' } : null);
  if (bindings) {
    for (const [name, field] of Object.entries(bindings)) {
      const v = body?.[field];
      if (typeof v === 'string') binds[name] = v;
    }
  }

  // The creates the rest of the fixture hangs off. A silent failure here is the
  // one that matters: everything downstream then references an id that was never
  // bound, and the tables `acceptance.rs` samples come back empty.
  if (step.expectStatus !== undefined && res.status !== step.expectStatus) {
    stale.push(
      `  ${String(i + 1).padStart(3)} ${step.method} ${path}\n` +
        `      wanted ${step.expectStatus}, got ${res.status}: ${JSON.stringify(body)?.slice(0, 160)}`,
    );
  }
}

if (stale.length) {
  console.error(`\n${stale.length} scaffolding step(s) did not do what they claim:\n`);
  console.error(stale.join('\n'));
  console.error('\nThe fixture is incomplete; acceptance would run against empty tables.');
  process.exit(1);
}

console.log(`fixture built — ${ran} steps, ${Object.keys(binds).length} entities`);
