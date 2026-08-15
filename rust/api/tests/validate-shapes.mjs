/**
 * Validate the Rust API's real responses against the frontend's REAL Zod schemas.
 *
 *   ACCEPTANCE_DB=... cargo test -p avoir-api --test acceptance -- --ignored
 *   node rust/api/tests/validate-shapes.mjs
 *
 * # Why this exists
 *
 * `acceptance.rs` checks that no read endpoint errors. It passed all 85 while
 * `/category-budgets` was returning a well-formed array with `actualSpending`
 * and `status` missing — both required by `BudgetStatusResponseSchema`. Zod
 * threw in the browser, the query failed, and the Budgets page rendered empty.
 * A status code says the handler ran; it says nothing about whether the
 * frontend can use what came back.
 *
 * The schemas here are IMPORTED, never reimplemented. A hand-written list of
 * expected fields would be a second definition free to drift from the one the
 * app actually validates with — and it would have agreed with the bug, because
 * I would have written it from the same reading of the code that produced it.
 */
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../../../packages/core/dist/index.js');

/**
 * Route pattern → the schema the API client parses that route with.
 *
 * Mirrors `apps/web/src/lib/api/*.ts`, where every call is
 * `request(path, Schema)`. This is a mapping, not a reimplementation: get a row
 * wrong and it validates against the wrong schema, which fails loudly rather
 * than silently passing.
 */
const ROUTES = [
  [/^\/accounts$/, 'AccountListResponseSchema'],
  [/^\/accounts\/[^/]+$/, 'AccountResponseSchema'],
  [/^\/expenses$/, 'ExpenseListResponseSchema'],
  [/^\/expenses\/[^/]+$/, 'ExpenseResponseSchema'],
  [/^\/income$/, 'IncomeListResponseSchema'],
  [/^\/income\/[^/]+$/, 'IncomeResponseSchema'],
  [/^\/scheduled-transactions\?/, () => core.ScheduledTransactionSchema.array()],
  [/^\/budgets$/, 'BudgetItemListResponseSchema'],
  [/^\/budgets\/groups$/, 'BudgetGroupListResponseSchema'],
  [/^\/category-budgets\?/, core.BudgetStatusResponseSchema.array()],
  [/^\/category-budgets$/, core.BudgetStatusResponseSchema.array()],
  [/^\/category-budgets\/[^/]+$/, 'CategoryBudgetResponseSchema'],
  [/^\/category-budgets\/[^/]+\/history$/, 'BudgetHistoryResponseSchema'],
  [/^\/category-budgets\/[^/]+\/links$/, () => core.BudgetExpenseLinkResponseSchema.array()],
  [/^\/year-plans$/, () => core.YearPlanResponseSchema.array()],
  [/^\/year-plans\/[^/]+$/, 'YearPlanResponseSchema'],
  [/^\/debts$/, 'DebtListResponseSchema'],
  [/^\/debts\/summary$/, 'DebtSummarySchema'],
  [/^\/debts\/[^/]+$/, 'DebtResponseSchema'],
  [/^\/debts\/[^/]+\/escrow$/, () => core.EscrowRecordSchema.array()],
  [/^\/healthcare\/years$/, 'PolicyYearsSchema'],
  [/^\/healthcare\/policies\?/, () => core.InsurancePolicyWithBalanceSchema.array()],
  [/^\/healthcare\/policies\/[^/]+$/, 'InsurancePolicySchema'],
  [/^\/healthcare\/summary\?/, 'LOCAL'],
  [/^\/pay-schedules$/, 'PayScheduleListResponseSchema'],
  [/^\/pay-schedules\/[^/]+$/, 'PayScheduleResponseSchema'],
  [/^\/pay-periods$/, 'PayPeriodListResponseSchema'],
  [/^\/pay-periods\/current$/, 'PayPeriodResponseSchema'],
  [/^\/pay-periods\/[^/]+$/, 'PayPeriodResponseSchema'],
  [/^\/goals$/, () => core.BudgetGoalSchema.array()],
  [/^\/dashboard\/current-period$/, 'CurrentPeriodSummarySchema'],
  [/^\/dashboard\/ytd/, 'YTDSummarySchema'],
  [/^\/dashboard\/trends/, 'TrendsSummarySchema'],
  [/^\/dashboard\/category-breakdown/, 'BudgetBreakdownSchema'],
  [/^\/dashboard\/goal-progress$/, 'GoalProgressListSchema'],
  [/^\/dashboard\/income-trend/, 'IncomeTrendResponseSchema'],
  [/^\/dashboard\/spend-prediction/, 'SpendPredictionResponseSchema'],
  [/^\/backups\/config$/, 'BackupConfigSchema'],
  [/^\/backups$/, 'BackupListSchema'],
  [/^\/descriptions/, () => core.DescriptionSchema.array()],
  [/^\/reconciliations$/, () => core.ReconciliationSessionSchema.array()],
  [/^\/data-management\/counts$/, 'LOCAL'],
  [/^\/connected-services$/, 'ServiceStatusListSchema'],
  [/^\/transactions(\?|$)/, 'PaginatedTransactionsResponseSchema'],
  [/^\/investments$/, 'InvestmentHoldingListResponseSchema'],
  [/^\/investments\/custodians$/, 'CustodianListResponseSchema'],
  [/^\/investments\/wallets$/, 'WalletListResponseSchema'],
  [/^\/utilities\/providers$/, 'UtilityProviderListResponseSchema'],
  [/^\/utilities\/readings/, null],
  [/^\/investments\/history/, null],
  [/^\/investments\/portfolio-history/, 'PortfolioHistoryResponseSchema'],
  [/^\/accounts\/[^/]+\/transaction-count$/, null],
  [/^\/healthcare\/policies\/[^/]+\/transactions$/, null],
  [/^\/debts\/[^/]+\/amortization$/, null],
  [/^\/transactions\/[^/]+\/children$/, 'ChildrenResponseSchema'],
];

function schemaFor(route) {
  for (const [pattern, s] of ROUTES) {
    if (pattern.test(route)) {
      // `null` = the API client parses this with `_passthrough`, so there is no
      // schema and nothing to check. Listed explicitly rather than left to fall
      // through, so an unmapped route stays visible as unmapped.
      if (s === null) return [null, '_passthrough'];
      // Declared inline in the API client rather than exported from core, so
      // there is nothing to import. Reconstructing it here would be the second
      // definition this file exists to avoid — and it would be written from the
      // same reading of the code that produced any bug in it.
      if (s === 'LOCAL') return [null, 'LOCAL'];
      const resolved = typeof s === 'string' ? core[s] : typeof s === 'function' ? s() : s;
      return [resolved, typeof s === 'string' ? s : '(inline)'];
    }
  }
  return [null, null];
}

/**
 * Optional keys the schema declares that the response never carried.
 *
 * `safeParse` cannot see these — an `.optional()` field is valid by its
 * absence — and that is the exact gap three defects shipped through:
 * `anticipations` never attached to the transactions list, `groupName` and
 * `groupColor` never flattened onto a budget. All three parsed perfectly and
 * left half a page blank.
 *
 * This cannot decide whether an absence is WRONG — only the reference can, and
 * that is the differential harness's job. What it can do is make the absences
 * visible, so "this field is never sent" is something a person can notice
 * rather than something only a user can.
 *
 * Reported, deliberately not failed. Plenty of optional fields are legitimately
 * absent, and a check that cried wolf on all of them would be turned off.
 */
function absentOptionals(schema, body) {
  // A list route's schema is `z.array(Item)`, whose `_def` carries `type`
  // rather than `shape` — unwrap to the element before asking for keys. The
  // first version of this checked `_def.shape` on the array, found nothing, and
  // silently returned no gaps for every list in the API. It was caught by
  // deleting `groupName` from a response and watching the check stay quiet.
  const inner = schema?._def?.typeName === 'ZodArray' ? schema._def.type : schema;
  const shape = inner?._def?.shape;
  const obj = Array.isArray(body) ? body[0] : body;
  if (typeof shape !== 'function' || !obj || typeof obj !== 'object') return [];
  let keys;
  try {
    keys = Object.entries(shape());
  } catch {
    return [];
  }
  return keys.filter(([k, v]) => v?.isOptional?.() && !(k in obj)).map(([k]) => k);
}

const dumpPath = process.env.ACCEPTANCE_DUMP ?? '/tmp/avoir-responses.json';

// Refuse a dump that was not written by THIS run of the acceptance test.
//
// It is generated into /tmp, so a previous day's file sits there waiting. The
// acceptance test writing it can fail — one route legitimately 400s without
// query parameters — and if its output was piped away, this file happily parses
// yesterday's responses and reports on code that no longer exists. That
// happened: it reported `estimatedPayoffDate` missing from every debt hours
// after the field was added, and the ten minutes spent proving serde's nested
// `flatten` works were spent because the artifact, not the code, was wrong.
//
// ERRORS.md already records this class twice — the harness that ran a stale
// binary, and the mutation harness whose edits never applied. A generated
// artifact needs a freshness check or it is a confident wrong answer waiting.
const MAX_AGE_MS = 10 * 60 * 1000;
const age = Date.now() - statSync(dumpPath).mtimeMs;
if (age > MAX_AGE_MS) {
  console.error(
    `${dumpPath} is ${Math.round(age / 60000)} minutes old.\n` +
      'Regenerate it, and check that the command SUCCEEDED:\n' +
      '  ACCEPTANCE_DB=<a populated sqlite> ACCEPTANCE_DUMP=' +
      `${dumpPath} \\\n` +
      '    cargo test -p avoir-api --test acceptance -- --ignored every_read_endpoint',
  );
  process.exit(2);
}

const bodies = JSON.parse(readFileSync(dumpPath, 'utf8'));

const failures = [];
const unmapped = [];
const missingSchema = [];
const local = [];
const absent = [];
let checked = 0;

for (const [route, body] of Object.entries(bodies)) {
  const [schema, name] = schemaFor(route);
  if (!schema) {
    if (name === '_passthrough') continue;
    if (name === 'LOCAL') {
      local.push(route);
      continue;
    }
    (name === null ? unmapped : missingSchema).push(route);
    continue;
  }
  checked += 1;
  const gaps = absentOptionals(schema, body);
  if (gaps.length) absent.push({ route, name, gaps });
  const result = schema.safeParse(body);
  if (!result.success) {
    // Report the distinct problems, not one line per array element: a missing
    // field on 62 budgets is ONE defect, and printing it 62 times buries the
    // others.
    const seen = new Map();
    for (const issue of result.error.issues) {
      const path = issue.path.map((p) => (typeof p === 'number' ? '[]' : p)).join('.');
      const key = `${issue.code} at ${path}: ${issue.message}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    failures.push({ route, name, issues: [...seen.entries()] });
  }
}

console.log(`validated ${checked} responses against the frontend's own Zod schemas`);
if (unmapped.length)
  console.log(`  (${unmapped.length} routes have no mapping here — not validated)`);
if (local.length)
  console.log(
    `  (${local.length} use a schema declared inline in the API client, not exported from core — not validated)`,
  );
if (missingSchema.length)
  console.log(`  MAPPED TO A SCHEMA THAT DOES NOT EXIST: ${missingSchema.join(', ')}`);

if (absent.length) {
  console.log(
    `\n${absent.length} responses omit a field their schema marks optional.` +
      '\nParsing cannot see these — it is the gap `anticipations` and `groupName` shipped through.',
  );
  for (const a of absent) console.log(`  ${a.route}\n     never sends: ${a.gaps.join(', ')}`);
}

for (const f of failures) {
  console.log(`\nFAIL ${f.route}\n     against ${f.name}`);
  for (const [issue, count] of f.issues.slice(0, 6)) {
    console.log(`       ${count > 1 ? `×${count} ` : ''}${issue}`);
  }
  if (f.issues.length > 6) console.log(`       … and ${f.issues.length - 6} more kinds`);
}

if (failures.length || missingSchema.length) {
  console.log(`\n${failures.length} of ${checked} responses the frontend cannot parse`);
  process.exit(1);
}
console.log('all parsed cleanly');
