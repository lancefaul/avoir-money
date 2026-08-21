#!/usr/bin/env node
/**
 * Drive the same sequence of WRITES against both backends and diff every
 * response.
 *
 * # Why this exists separately from `diff.mjs`
 *
 * The read harness reached 86/86 identical on 2026-08-11, and that number was
 * immediately worth distrusting: injecting an invented field into `list_groups`
 * was caught at once, and injecting the same field into `group_json` — the shape
 * returned by `POST /budgets/groups` — produced a **fully green run**. The read
 * harness walks read endpoints, so every create, update and delete response was
 * outside it. Three of the six defects that started this whole exercise were
 * response shapes; a write-path response shape was still invisible.
 *
 * # The two hard parts
 *
 * **State.** A write changes what the next call sees, so the backends are only
 * comparable if they start identical and receive the same instructions in the
 * same order. Both therefore start EMPTY and build their own fixtures through
 * the API — see `run-writes.sh`, which also refuses to run against anything but
 * the disposable test database.
 *
 * **Identity.** Each backend mints its own cuids. `scenario.mjs` binds them
 * symbolically and this file substitutes per-backend on the way in, then
 * normalizes them back to `<name>` on the way out. So `accountId` pointing at
 * the right row compares equal across two different cuids, while `accountId`
 * pointing at the WRONG row still reports.
 */

import { diff, expected } from './compare.mjs';
import { scenario } from './scenario.mjs';
import { rejections } from './rejections.mjs';

/**
 * The refusals run AFTER the sequence, for two reasons.
 *
 * They need the ids the sequence binds — a rejection is only about the field
 * under test if every other field is good, so "an expense with a day of month
 * of 45" has to name a budget that really exists or it is a test of the budget
 * id instead. And a refused write changes nothing, so appending them cannot
 * disturb the sequence, where order is load-bearing.
 */
const steps = [...scenario, ...rejections];

const TS = process.env.TS_BASE ?? 'http://127.0.0.1:5274/api/v1';
const TS_KEY = process.env.TS_KEY ?? '';
const RS = process.env.RS_BASE ?? null;
const RS_KEY = process.env.RS_KEY ?? '';

if (!RS) {
  console.error('RS_BASE is required (the Rust server, e.g. http://127.0.0.1:41234/api/v1)');
  process.exit(2);
}

/** Replace every `$name` with this backend's value for it. */
function substitute(value, binds) {
  if (typeof value === 'string') {
    return value.replace(/\$([a-zA-Z][a-zA-Z0-9]*)/g, (whole, name) =>
      // An unbound `$name` is left alone rather than blanked: a step referring
      // to something that was never bound should fail loudly and identically on
      // both sides, not quietly become a request for id "".
      Object.hasOwn(binds, name) ? binds[name] : whole,
    );
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, binds));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, binds)]));
  }
  return value;
}

/**
 * Turn this backend's ids back into symbolic names.
 *
 * Only bound values are rewritten. An id the scenario never named stays as it
 * is and shows up as a difference — which is correct: if one backend invents a
 * reference the other does not, that is exactly the class of defect here.
 */
function normalize(value, byId) {
  if (typeof value === 'string') return byId.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => normalize(v, byId));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, byId)]));
  }
  return value;
}

async function send(base, key, step, binds) {
  const path = substitute(step.path, binds);
  const init = {
    method: step.method,
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  };
  if (step.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(substitute(step.body, binds));
  }
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { __unparseable: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

/**
 * Read a dotted path out of a response body, so a LIST can be bound from.
 *
 * `bindField: 'id'` covers a create, which answers with the object it made.
 * Nothing could bind from an array, and that quietly excluded a whole domain:
 * scheduled transactions are GENERATED lazily by the list endpoint and have no
 * create route at all, so `0.id` is the only way to name one. The refusals
 * that matter there — paying something already paid, skipping something paid —
 * all need a real id, and were unreachable.
 *
 * Binding index 0 assumes both backends order the list identically, which is an
 * assumption worth making BECAUSE it is self-checking: if they bind different
 * rows, every step that uses the id disagrees and the harness says so.
 */
function pick(body, path) {
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), body);
}

const label = (s, i) => `${String(i + 1).padStart(2, '0')} ${s.method} ${s.path} — ${s.name}`;

console.log(
  `Driving ${steps.length} steps (${scenario.length} sequence + ${rejections.length} refusals)\n  TS:   ${TS}\n  Rust: ${RS}\n`,
);

const tsBinds = {};
const rsBinds = {};
/** Every bound id (from BOTH backends) → its symbolic name. */
const byId = new Map();

let identical = 0;
const problems = [];
const statusMismatch = [];
const stale = [];
/** Steps where the two backends differ deliberately, with the reason. */
const allowed = [];

/* ── Recording refusals ──────────────────────────────────────────────────
 *
 * The point of this, and it is not "more coverage".
 *
 * `apps/api` is the only thing that can say what a refusal SHOULD look like.
 * That is why it cannot be deleted: not because its tests are needed, but
 * because it is the oracle. Recording what it answers turns the oracle from a
 * running backend into a file — and a file survives the deletion.
 *
 * Only steps where BOTH backends already agreed are recorded. A disagreement is
 * a port defect and gets fixed; freezing it would pin the bug. This also means
 * the recorder can never invent an expectation: every value in the golden file
 * was produced twice, independently, by two implementations.
 *
 * `needsState` marks a step whose request referenced an id minted earlier in the
 * run. Those cannot be replayed against an empty database, so the Rust test
 * skips them and says so rather than quietly passing on a 404 it caused itself.
 */
const recorded = [];
/**
 * Every step, in order, with its bindings still SYMBOLIC — a replay script.
 *
 * `recorded` alone cannot free the oracle from a running backend. 45 of its
 * entries are `needsState`: they name ids the sequence minted, so replaying
 * them against an empty database tests nothing. Those are exactly the
 * interesting refusals — "already paid", "still has readings", "already has a
 * draft" — because a rule about state needs state.
 *
 * So the whole sequence is recorded, not just the refusals, with `$name` left
 * intact. Rust can then rebuild the state through its own API and check each
 * refusal against the answer both backends gave. That is what makes deleting
 * `apps/api` possible: the oracle stops being a process and becomes a script.
 */
const replay = [];
const RECORD = process.env.RECORD_REFUSALS;

/**
 * Did this step's request depend on state the scenario built?
 *
 * A `$binding` is the detectable half and was the only half at first. That was
 * wrong within the hour: `reject: a budget group that already exists` posts the
 * literal name `Bills` and carries no binding at all — yet it only refuses
 * because the scenario created `Bills` earlier. Replayed against an empty
 * database it SUCCEEDS, and `refusals.rs` said so on the first run.
 *
 * There is no general way to detect that from the request, so a step that knows
 * it depends on state declares `needsState: true` and is believed. The
 * heuristic stays as the floor, not the ceiling.
 */
function usedBinding(step) {
  if (step.needsState === true) return true;
  const raw = JSON.stringify({ p: step.path, b: step.body ?? null });
  return /\$[a-zA-Z]/.test(raw);
}

/**
 * One step of the replay script.
 *
 * Refusals carry what to ASSERT; sequence steps carry only what to expect, and
 * exist to build state. A sequence step's body is never asserted here — that is
 * the differential harness's job and it needs two backends to do it. This file
 * answers a narrower question: does THIS backend still refuse what it refused.
 */
function recordReplayStep(step, ts, rs) {
  if (!RECORD) return;
  const agreed = ts.status === rs.status;
  const message = typeof ts.body?.error === 'string' ? ts.body.error : null;
  const sameMsg = message === (typeof rs.body?.error === 'string' ? rs.body.error : null);
  const sameDetails =
    JSON.stringify(ts.body?.details ?? null) === JSON.stringify(rs.body?.details ?? null);
  const isRefusal = ts.status >= 400 && ts.status < 500;

  replay.push({
    name: step.name ?? `${step.method ?? 'GET'} ${step.path}`,
    method: step.method ?? 'GET',
    path: step.path,
    body: step.body ?? null,
    bind: step.bind ?? null,
    bindField: step.bind ? (step.bindField ?? 'id') : null,
    binds: step.binds ?? null,
    // Asserted only where the two agreed AND it is a refusal. A 5xx, or a
    // disagreement, is recorded as "run it, expect nothing" so the step still
    // builds its state without pinning something unproven.
    expect:
      isRefusal && agreed && sameMsg
        ? {
            status: ts.status,
            error: message,
            details: sameDetails ? (ts.body?.details ?? null) : null,
          }
        : null,
    /*
     * A setup step expects what RUST did, not what both agreed.
     *
     * Agreement is the right bar for a refusal ASSERTION — it is what makes the
     * expectation evidence rather than opinion. It is the wrong bar for setup:
     * `mark it paid` legitimately disagrees (the reference fights its own
     * lifecycle hook, declared in scenario.mjs), so requiring agreement recorded
     * NO expectation. When that step then failed on a FOREIGN KEY during replay,
     * the failure was silent and the NEXT refusal reported instead — blaming a
     * rule that was fine, for a state that was never built.
     *
     * This file replays one backend. "Does it still do what it did" is the only
     * question it can ask about setup, and it is the one worth asking.
     */
    expectOk: !isRefusal && rs.status < 400 ? rs.status : null,
  });
}

function recordRefusal(step, ts, rs) {
  if (!RECORD) return;
  // Refusals only. A 2xx belongs to the scenario, which the acceptance suite
  // and the shape check already cover.
  //
  // 5xx is excluded, and that exclusion earned itself on the first run. Two
  // steps — an expense and a transaction naming a non-existent FK — returned
  // `500 Internal server error` from BOTH backends. Agreement is what this
  // recorder trusts, and here agreement meant "both are wrong in the same
  // place": an unhandled FK violation is a gap, not a contract. Pinning it
  // would make the Rust suite defend a bug and turn fixing it into a test
  // failure. They are reported instead.
  if (ts.status < 400 || ts.status >= 500 || ts.status !== rs.status) return;
  const message = typeof ts.body?.error === 'string' ? ts.body.error : null;
  // Agreement means the MESSAGE too, not just the status. Recording a value
  // only one backend produces would pin a known divergence as the contract and
  // hand the Rust suite a test it is already failing — which reads as a broken
  // test rather than as the defect it is. Divergences belong in the diff report,
  // where they are fixed.
  if (message !== (typeof rs.body?.error === 'string' ? rs.body.error : null)) return;

  /*
   * `details` is recorded only when both sides produce the SAME one, and that
   * condition is doing real work rather than being cautious.
   *
   * Recording it unconditionally would take the reference's value — and several
   * steps agree on `error` while deliberately differing on `details` (serde is
   * fail-fast, Zod collects; Prisma leaks its P2002 meta). Pinning those would
   * hand `refusals.rs` an expectation Rust cannot meet.
   *
   * Omitting it entirely was the first version, and it was worse: the whole
   * point of `invalid_field` is which FIELD gets marked, and a fixture holding
   * only `error` cannot see that change. Mutating `oopmLimit` to
   * `deductibleLimit` passed the suite, because both still say
   * "Validation failed".
   */
  const same =
    JSON.stringify(ts.body?.details ?? null) === JSON.stringify(rs.body?.details ?? null);
  recorded.push({
    name: step.name ?? `${step.method} ${step.path}`,
    method: step.method ?? 'GET',
    path: step.path,
    body: step.body ?? null,
    status: ts.status,
    error: message,
    details: same ? (ts.body?.details ?? null) : null,
    needsState: usedBinding(step),
  });
}

for (const [i, step] of steps.entries()) {
  const name = label(step, i);
  let ts, rs;
  try {
    // Sequentially, and TS first, deliberately. Running them concurrently would
    // make each backend's wall-clock ordering its own, and `createdAt` ordering
    // is a tie-break in several list endpoints.
    ts = await send(TS, TS_KEY, step, tsBinds);
    rs = await send(RS, RS_KEY, step, rsBinds);
  } catch (err) {
    problems.push({ step: name, fatal: err.message });
    continue;
  }

  // `bind` names one field; `binds` names several. A create can mint more than
  // one id — a policy create also creates the budget its premiums post to — and
  // binding each is stricter than excusing the field, because a row pointing at
  // the WRONG one still reports.
  const bindings = step.binds ?? (step.bind ? { [step.bind]: step.bindField ?? 'id' } : null);
  if (bindings) {
    for (const [name, field] of Object.entries(bindings)) {
      const t = pick(ts.body, field);
      const r = pick(rs.body, field);
      if (typeof t === 'string') {
        tsBinds[name] = t;
        byId.set(t, `<${name}>`);
      }
      if (typeof r === 'string') {
        rsBinds[name] = r;
        byId.set(r, `<${name}>`);
      }
    }
  }

  /*
   * Recorded BEFORE the status-mismatch branch below, which `continue`s.
   *
   * It did not used to be, and the sequence silently lost every step the two
   * backends deliberately disagree on — `mark it paid` among them. The replay
   * then skipped straight from snoozing an occurrence to asserting a rule about
   * a PAID one, and reported that rule as broken. The step that was missing was
   * the one that would have made it true.
   */
  recordRefusal(step, ts, rs);
  recordReplayStep(step, ts, rs);

  // A scenario goes stale silently: once a create starts failing, every step
  // after it compares two identical error responses and the run reports green
  // while testing nothing. `expectStatus` is the guard, and it is checked
  // against BOTH backends so it cannot be satisfied by one of them.
  if (step.expectStatus !== undefined) {
    if (ts.status !== step.expectStatus) {
      stale.push({
        step: name,
        backend: 'typescript',
        want: step.expectStatus,
        got: ts.status,
        body: ts.body,
      });
    }
    if (rs.status !== step.expectStatus) {
      stale.push({
        step: name,
        backend: 'rust',
        want: step.expectStatus,
        got: rs.status,
        body: rs.body,
      });
    }
  }

  if (ts.status !== rs.status) {
    // A step may declare that the two SHOULD differ, with the reason on the
    // step itself rather than in a list somewhere else. There is exactly one
    // today and it is the direction nobody plans for: the port is RIGHT and the
    // reference is wrong. Making Rust reproduce a 500 to satisfy a diff would
    // be letting the harness dictate behaviour instead of measuring it.
    if (step.allowStatusDifference) {
      allowed.push({ step: name, ts: ts.status, rs: rs.status, why: step.allowStatusDifference });
      identical += 1;
    } else {
      statusMismatch.push({
        step: name,
        ts: ts.status,
        rs: rs.status,
        tsBody: ts.body,
        rsBody: rs.body,
      });
    }
    continue;
  }

  const all = diff(normalize(ts.body, byId), normalize(rs.body, byId));
  // A step may declare a body difference it expects, with the reason attached to
  // the step rather than to the global `EXPECTED` list — which is right when the
  // divergence belongs to THIS sequence's state rather than to the endpoint.
  const allowedHere = all.filter((d) => step.allowDiff?.path.test(d.path));
  if (allowedHere.length) {
    allowed.push({
      step: name,
      ts: allowedHere.map((d) => d.ts).join(', '),
      rs: allowedHere.map((d) => d.rs).join(', '),
      why: step.allowDiff.why,
    });
  }
  const real = all.filter((d) => !expected(d, step.path) && !step.allowDiff?.path.test(d.path));
  if (real.length === 0) identical += 1;
  else problems.push({ step: name, diffs: real });
}

// ─── Report ───

if (stale.length) {
  console.log(`SCENARIO STALE (${stale.length}) — these steps did not do what they claim,`);
  console.log('so every step after them is comparing two failures.\n');
  for (const s of stale) {
    console.log(`  ${s.step}\n    ${s.backend}: wanted ${s.want}, got ${s.got}`);
    console.log(`    ${JSON.stringify(s.body)?.slice(0, 200)}`);
  }
  console.log('');
}

if (allowed.length) {
  console.log(`ALLOWED DIFFERENCES (${allowed.length}) — declared on the step, not silent\n`);
  for (const x of allowed) console.log(`  ${x.step}\n    ts=${x.ts} rust=${x.rs} — ${x.why}\n`);
}

if (statusMismatch.length) {
  console.log(`STATUS MISMATCH (${statusMismatch.length})`);
  for (const m of statusMismatch) {
    console.log(`  ${m.step}\n    ts=${m.ts}  rust=${m.rs}`);
    console.log(`      ts:   ${JSON.stringify(m.tsBody)?.slice(0, 160)}`);
    console.log(`      rust: ${JSON.stringify(m.rsBody)?.slice(0, 160)}`);
  }
  console.log('');
}

if (problems.length) {
  console.log(`DIFFERENCES (${problems.length} steps)`);
  for (const p of problems) {
    if (p.fatal) {
      console.log(`  ${p.step}\n    could not compare: ${p.fatal}`);
      continue;
    }
    console.log(`  ${p.step}  (${p.diffs.length})`);
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

if (RECORD) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(RECORD), { recursive: true });
  // Sorted by name so the file is stable across runs. The steps execute in a
  // fixed order today, but a reordering in `rejections.mjs` would otherwise
  // rewrite the whole file and bury the one line that actually changed.
  recorded.sort((a, b) => a.name.localeCompare(b.name));
  const replayable = recorded.filter((r) => !r.needsState).length;
  writeFileSync(
    RECORD,
    JSON.stringify(
      {
        note:
          'Generated by tools/differential/write-diff.mjs with RECORD_REFUSALS set. ' +
          'Every entry was produced INDEPENDENTLY by both backends, which agreed on ' +
          'the status and the message. Do not hand-edit: a value here is evidence ' +
          'that two implementations said the same thing, and editing it makes it ' +
          'one person’s opinion again.',
        generated: new Date().toISOString().slice(0, 10),
        refusals: recorded,
      },
      null,
      2,
    ) + '\n',
  );
  const { writeFileSync: wf } = await import('node:fs');
  const replayPath = RECORD.replace(/refusals\.json$/, 'replay.json');
  const asserted = replay.filter((r) => r.expect).length;
  wf(
    replayPath,
    JSON.stringify(
      {
        note:
          'Generated alongside refusals.json. The FULL sequence with bindings left ' +
          'symbolic, so a single backend can rebuild the state and re-check every ' +
          'refusal — including the ones that need state, which are the interesting ones. ' +
          'Do not hand-edit.',
        generated: new Date().toISOString().slice(0, 10),
        steps: replay,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `recorded ${recorded.length} agreed refusals to ${RECORD} ` +
      `(${replayable} replayable without fixture state)\n` +
      `recorded ${replay.length} replay steps to ${replayPath} (${asserted} asserted refusals)`,
  );
}

if (process.env.DIFF_JSON) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    process.env.DIFF_JSON,
    JSON.stringify({ problems, statusMismatch, stale }, null, 2),
  );
  console.log(`full diff written to ${process.env.DIFF_JSON}`);
}

console.log(
  `${identical}/${steps.length} identical, ` +
    `${problems.length} with differences, ${statusMismatch.length} status mismatches` +
    (stale.length ? `, ${stale.length} STALE STEPS` : ''),
);
process.exit(problems.length || statusMismatch.length || stale.length ? 1 : 0);
