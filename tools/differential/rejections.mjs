/**
 * The refusals both backends must agree on.
 *
 * # Why this is a separate file from `scenario.mjs`
 *
 * Two reasons, one boring and one not. The boring one: `scenario.mjs` is 378
 * lines and QUALITY.md caps a file at 500. The other one is that these steps
 * are a different KIND of step. The main scenario is a sequence — each write
 * changes what the next call sees, so its order is load-bearing. These are
 * independent probes that mostly change nothing, so they can be added to,
 * reordered, or read in isolation without thinking about what came before.
 *
 * # Why this file exists at all
 *
 * Measured on 2026-08-11, before any of it was written: the Rust suite asserts
 * the shape of an error body **6 times**; the TypeScript suite does it **183**.
 * The differential harness, which is the only check that has ever caught a port
 * defect, drove 61 steps of which **5** were refusals — all five at the very
 * end, added as an afterthought.
 *
 * So the port's error behaviour was covered by almost nothing, and that is the
 * half of the API a user meets on their worst day. It is also the half most
 * likely to have been invented during the port: a handler returning the right
 * row is constrained by the row, while a handler returning a rejection is
 * constrained by nothing except what the porter imagined. Every defect of that
 * shape found this week — `lineTotal`, the missing `refund`, the `defaultHook`
 * that reached no sub-router — was a response body nobody had compared.
 *
 * # Why almost nothing here says what it expects
 *
 * The harness compares the two backends against each other, so a step that is
 * refused identically by both is a pass whatever the status is. That is the
 * point: I do not have to be right about the rule. I could not be right about
 * all of them — several of these probe validation I have never read — and a
 * differential check does not need me to be. It needs the reference to be the
 * authority, which it is.
 *
 * `expectStatus` therefore appears only where a run has already been observed
 * and the two agreed. It is not my belief about the rule; it is a pin on an
 * answer both backends gave, so that a later change which quietly turns a 400
 * into a 500 cannot slip past as "still agreeing".
 *
 * # The trap this file is built to avoid
 *
 * A refusal step is the easiest kind of test to make worthless, and it fails
 * silently. Get a path wrong by one character and both backends 404 — in
 * perfect agreement, on a route neither of them has. The run goes green and
 * nothing was tested. This is exactly the staleness trap `expectStatus` was
 * added to `scenario.mjs` for, wearing a different hat: there, a create starts
 * failing and every later step compares two identical errors; here, the step
 * was never valid to begin with.
 *
 * Two structural guards, applied throughout rather than remembered:
 *
 * 1. **Every path AND METHOD here appears in `scenario.mjs` too**, where it was
 *    driven with good input and returned 2xx. A pair that works elsewhere in the
 *    run cannot be a typo. Where a rejection needs a route the scenario never
 *    calls, the comment says so explicitly and that step is the one to distrust
 *    first.
 *
 *    **The METHOD half was added 2026-08-12, after the guard was violated a
 *    third time by someone who had just read it.** The rule said "path", so
 *    `DELETE /healthcare/policies/:id` looked safe — the path is driven, by GET
 *    and PUT. Neither backend has a DELETE there. Both answered "no route", in
 *    perfect agreement, and the step tested nothing. A path is not a route; a
 *    path and a method are.
 * 2. **A "does not exist" id is a well-formed absent cuid**, never a word like
 *    `nope`. `nope` gets refused by anything that validates its id format,
 *    which is a different rejection from the one being probed — and the two
 *    backends can agree on it for two different reasons.
 */

/** A syntactically valid cuid that has never been issued. */
const ABSENT = 'clzz00000000000000000000';

export const rejections = [
  // ── Malformed bodies ──────────────────────────────────────────────────
  //
  // The floor of the validation layer. If these disagree, nothing built on
  // top of them is worth reading.

  {
    name: 'reject: budget with no name',
    method: 'POST',
    path: '/budgets',
    body: { groupId: '$group' },
  },
  {
    name: 'reject: budget with a null name',
    method: 'POST',
    path: '/budgets',
    body: { name: null, groupId: '$group' },
  },
  {
    name: 'reject: budget with an empty name',
    method: 'POST',
    path: '/budgets',
    body: { name: '', groupId: '$group' },
  },
  {
    name: 'reject: budget with a number for a name',
    method: 'POST',
    path: '/budgets',
    body: { name: 42, groupId: '$group' },
  },
  {
    name: 'reject: entirely empty body',
    method: 'POST',
    path: '/budgets',
    body: {},
  },
  {
    name: 'reject: account with no name',
    method: 'POST',
    path: '/accounts',
    body: { type: 'Checking', balance: 0 },
  },
  {
    name: 'reject: account with a string balance',
    method: 'POST',
    path: '/accounts',
    body: { name: 'Stringly', type: 'Checking', balance: '100' },
  },
  {
    name: 'reject: account with an unknown type',
    method: 'POST',
    path: '/accounts',
    body: { name: 'Mystery', type: 'Trebuchet', balance: 0 },
  },

  // ── Enum and range bounds ─────────────────────────────────────────────
  //
  // ADR-002 added amount bounds during the security pass. Whether the port
  // carried them is precisely the sort of thing that survives a green suite:
  // the bound only shows up on input no fixture contains.

  {
    name: 'reject: transaction with an unknown type',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Wrong type',
      type: 'GIFT',
      amount: 10.0,
      date: '2026-03-01T00:00:00.000Z',
      accountId: '$card',
    },
  },
  {
    name: 'reject: transaction with a lowercase type',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Case matters',
      type: 'expense',
      amount: 10.0,
      date: '2026-03-01T00:00:00.000Z',
      accountId: '$card',
    },
  },
  {
    name: 'reject: transaction amount beyond any bound',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Astronomical',
      type: 'EXPENSE',
      amount: 1e15,
      date: '2026-03-01T00:00:00.000Z',
      accountId: '$card',
    },
  },
  {
    name: 'reject: transaction with a NaN amount',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Not a number',
      type: 'EXPENSE',
      amount: 'NaN',
      date: '2026-03-01T00:00:00.000Z',
      accountId: '$card',
    },
  },
  {
    name: 'reject: transaction with an unparseable date',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Bad date',
      type: 'EXPENSE',
      amount: 10.0,
      date: 'the third of never',
      accountId: '$card',
    },
  },
  {
    name: 'reject: expense with an unknown frequency',
    method: 'POST',
    path: '/expenses',
    body: {
      name: 'Fortnightly-ish',
      amount: 10.0,
      frequency: 'WHENEVER',
      budgetId: '$budget',
    },
  },
  {
    name: 'reject: expense with a day of month of 45',
    method: 'POST',
    path: '/expenses',
    body: {
      name: 'The 45th',
      amount: 10.0,
      frequency: 'MONTHLY',
      dayOfMonth: 45,
      budgetId: '$budget',
    },
  },
  {
    name: 'reject: expense with a day of month of 0',
    method: 'POST',
    path: '/expenses',
    body: {
      name: 'The 0th',
      amount: 10.0,
      frequency: 'MONTHLY',
      dayOfMonth: 0,
      budgetId: '$budget',
    },
  },

  // ── Referential integrity ─────────────────────────────────────────────
  //
  // A foreign key naming a row that is not there. The interesting half is
  // WHICH failure it is: a validation 400, a not-found 404, or a Prisma
  // P2003 surfacing as a 409 or a 500. The two backends reach this through
  // completely different machinery — Prisma error codes on one side,
  // SQLite FK enforcement on the other — so agreement here is worth more
  // than most of this file.

  {
    name: 'reject: transaction on an account that does not exist',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Orphan',
      type: 'EXPENSE',
      amount: 10.0,
      date: '2026-03-01T00:00:00.000Z',
      accountId: ABSENT,
    },
  },
  {
    name: 'reject: budget in a group that does not exist',
    method: 'POST',
    path: '/budgets',
    body: { name: 'Homeless', groupId: ABSENT },
    // The one case where the PORT is right and the REFERENCE is wrong, which is
    // worth keeping visible rather than tidying away. The reference lets the FK
    // violation reach Prisma and surface through the global `onError`, so the
    // caller gets a 500 and "Internal server error" for what is plainly a bad
    // request. Rust checks the group first and answers 404 "Group not found".
    //
    // Not "fixed" by making Rust match: a differential harness measures the two,
    // and the moment it starts dictating behaviour it has stopped being a
    // measurement. Logged against the TypeScript instead.
    allowStatusDifference:
      'reference bug: the FK violation reaches Prisma and becomes a 500. Rust ' +
      'checks the group and 404s. The port is correct here.',
  },
  {
    name: 'reject: expense against a budget that does not exist',
    method: 'POST',
    path: '/expenses',
    body: { name: 'Unbudgeted', amount: 10.0, frequency: 'MONTHLY', budgetId: ABSENT },
  },

  // ── Absent rows ───────────────────────────────────────────────────────
  //
  // Every path below is driven successfully with a real id in `scenario.mjs`,
  // which is the guard described at the top: these cannot be 404ing because
  // the route is wrong.

  // The guard above earned itself on the first run. `GET /budgets/:id` and
  // `GET /transactions/:id` were in this list, they are in `scenario.mjs`
  // NOWHERE, and they were the only two steps that reported a difference which
  // was not a defect: neither backend HAS those routes — the frontend only ever
  // PUTs and DELETEs an id — so both answered "no route", and the diff was
  // reporting that the two word that sentence differently. Two steps written
  // against the guard, two false findings, and no others. They are deleted
  // rather than pinned, because a step probing a route that does not exist is
  // not a weaker test, it is a test of nothing.

  { name: 'reject: GET an absent account', method: 'GET', path: `/accounts/${ABSENT}` },
  { name: 'reject: GET an absent debt', method: 'GET', path: `/debts/${ABSENT}` },
  {
    name: 'reject: PUT an absent account',
    method: 'PUT',
    path: `/accounts/${ABSENT}`,
    body: { name: 'Ghost' },
  },
  {
    name: 'reject: PUT an absent budget',
    method: 'PUT',
    path: `/budgets/${ABSENT}`,
    body: { name: 'Ghost' },
  },
  {
    name: 'reject: DELETE an absent account',
    method: 'DELETE',
    path: `/accounts/${ABSENT}`,
  },
  {
    name: 'reject: DELETE an absent transaction',
    method: 'DELETE',
    path: `/transactions/${ABSENT}`,
  },
  {
    name: 'reject: amortization for an absent debt',
    method: 'GET',
    path: `/debts/${ABSENT}/amortization`,
  },

  // ── Cross-field transaction rules ─────────────────────────────────────
  //
  // v0.8 shipped a fix for seven of these being enforced on create and
  // silently skipped on PUT, so both directions are probed. The rules are
  // also what keeps `balanceBefore/balanceAfter` unambiguous: an account row
  // holds cents and a bitcoin-payment row holds BTC, and the only thing
  // stopping one row meaning both is a cross-field rule.

  {
    name: 'reject: TRANSFER with no destination',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'To nowhere',
      type: 'TRANSFER',
      amount: 10.0,
      date: '2026-03-01T00:00:00.000Z',
      accountId: '$card',
    },
  },
  {
    name: 'reject: TRANSFER to the account it came from',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'To itself',
      type: 'TRANSFER',
      amount: 10.0,
      date: '2026-03-01T00:00:00.000Z',
      accountId: '$card',
      toAccountId: '$card',
    },
  },
  {
    name: 'reject: TRADE with no trade detail',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Bare trade',
      type: 'TRADE',
      amount: 100.0,
      date: '2026-03-01T00:00:00.000Z',
      accountId: '$card',
    },
  },

  // ── Pagination and query parameters ───────────────────────────────────
  //
  // ADR-009's cursor is a position in an ordering, so a malformed cursor is
  // not a cosmetic complaint — a backend that ignores one it cannot parse
  // silently serves page one forever.

  {
    name: 'reject: a cursor that is not an id',
    method: 'GET',
    path: '/transactions?cursor=not-a-cursor',
  },
  { name: 'reject: a negative page size', method: 'GET', path: '/transactions?limit=-1' },
  { name: 'reject: a page size of zero', method: 'GET', path: '/transactions?limit=0' },
  {
    name: 'reject: an absurd page size',
    method: 'GET',
    path: '/transactions?limit=1000000',
  },
  {
    name: 'reject: a page size that is not a number',
    method: 'GET',
    path: '/transactions?limit=lots',
  },
  {
    name: 'reject: an unknown sort order',
    method: 'GET',
    path: '/transactions?sortOrder=sideways',
  },
  {
    name: 'reject: an unknown transaction type filter',
    method: 'GET',
    path: '/transactions?type=GIFT',
  },

  // ── Healthcare ────────────────────────────────────────────────────────
  //
  // Added 2026-08-12, chosen from the reference's own error strings rather
  // than imagined: `grep -o "error: '...'"` over `routes/healthcare.ts` lists
  // five, and the harness was probing none of them. Every path below is driven
  // with good input in `scenario.mjs` (`/healthcare/policies`, `/…/$policy`,
  // `/…/$policy/transactions`), so a 404 here cannot be a wrong route.

  {
    name: 'reject: GET an absent policy',
    method: 'GET',
    path: `/healthcare/policies/${ABSENT}`,
  },
  {
    name: 'reject: PUT an absent policy',
    method: 'PUT',
    path: `/healthcare/policies/${ABSENT}`,
    body: { employer: 'Ghost' },
  },
  {
    name: 'reject: transactions for an absent policy',
    method: 'GET',
    path: `/healthcare/policies/${ABSENT}/transactions`,
  },
  {
    // The one healthcare rule that is arithmetic rather than existence: an
    // out-of-pocket maximum below the deductible describes a plan that cannot
    // exist, and the reference says so explicitly.
    name: 'reject: policy whose OOPM is below its deductible',
    method: 'POST',
    path: '/healthcare/policies',
    body: {
      type: 'MEDICAL',
      year: 2026,
      employer: 'Backwards',
      premium: 100.0,
      deductibleLimit: 5000.0,
      oopmLimit: 1000.0,
      metadata: {},
    },
  },
  {
    name: 'reject: policy with an unknown type',
    method: 'POST',
    path: '/healthcare/policies',
    body: {
      type: 'DENTAL_ISH',
      year: 2026,
      employer: 'Acme',
      premium: 100.0,
      deductibleLimit: 1000.0,
      oopmLimit: 2000.0,
      metadata: {},
    },
  },
  {
    // `metadata` is NOT optional — a union ending in `.passthrough()` accepts
    // any object but requires the field. The port had it optional, which is
    // one of the two defects that broke 17 Rust tests when corrected.
    name: 'reject: policy with no metadata',
    method: 'POST',
    path: '/healthcare/policies',
    body: {
      type: 'MEDICAL',
      year: 2026,
      employer: 'Acme',
      premium: 100.0,
      deductibleLimit: 1000.0,
      oopmLimit: 2000.0,
    },
  },

  // ── Budgets and groups ────────────────────────────────────────────────

  {
    name: 'reject: DELETE an absent budget',
    method: 'DELETE',
    path: `/budgets/${ABSENT}`,
  },
  {
    // `Bills` is the group `scenario.mjs` creates at step 2, so this is a real
    // uniqueness collision rather than a validation error wearing its clothes.
    //
    // This step found Rust answering 500: the UNIQUE violation reached sqlx
    // unhandled. Fixed to 409 on 2026-08-12.
    name: 'reject: a budget group that already exists',
    method: 'POST',
    path: '/budgets/groups',
    body: { name: 'Bills', color: '#334155' },
    // Carries no `$binding`, and still depends entirely on the scenario
    // having created `Bills`. Declared, because nothing in the request
    // shows it — `refusals.rs` replayed this against an empty database and
    // it succeeded, which is how the recorder's blind spot was found.
    needsState: true,
    allowDiff: {
      path: /^details$/,
      why: "the port is right: the reference's `details` is Prisma's P2002 meta — {modelName, target} — which is an ORM internal leaking into an API response. Reproducing it in Rust would be porting a leak. Both say `Group already exists`, which is the part a caller can use.",
    },
  },
  {
    name: 'reject: budget group with no name',
    method: 'POST',
    path: '/budgets/groups',
    body: { color: '#334155' },
  },
  {
    name: 'reject: budget group with an empty name',
    method: 'POST',
    path: '/budgets/groups',
    body: { name: '', color: '#334155' },
  },

  // ── Debts ─────────────────────────────────────────────────────────────

  {
    name: 'reject: PUT an absent debt',
    method: 'PUT',
    path: `/debts/${ABSENT}`,
    body: { name: 'Ghost' },
  },
  {
    name: 'reject: DELETE an absent debt',
    method: 'DELETE',
    path: `/debts/${ABSENT}`,
  },
  {
    name: 'reject: debt with no name',
    method: 'POST',
    path: '/debts',
    body: { type: 'CREDIT_CARD', currentBalance: 100.0 },
    // Rust reports ONE failing field where the reference reports every one.
    // Declared rather than fixed, and the reasoning is structural: `body_of`
    // uses `serde_path_to_error`, and serde deserialization is fail-fast by
    // construction — it stops at the first field it cannot read. Zod collects.
    // Reporting all of them would mean deserializing into a permissive struct
    // and validating field by field, at every endpoint.
    //
    // What makes that disproportionate rather than merely expensive: Rust's
    // single detail is a TRUE statement — it names a field that really is
    // wrong, not a wrong guess — and the frontend validates with the same Zod
    // schema through `zodResolver` BEFORE submitting. A user reaches this
    // response only by bypassing the form, so `details` here is a backstop, not
    // the path anyone travels.
    allowDiff: {
      path: /^details/,
      why: 'serde is fail-fast so Rust names the first bad field; Zod collects all of them. Rust’s single entry is correct, just terser — and the form validates with the same schema client-side, so this body is a backstop rather than the user-facing path.',
    },
  },
  {
    name: 'reject: debt with an unknown type',
    method: 'POST',
    path: '/debts',
    body: { name: 'Odd', type: 'PAWN_SHOP', currentBalance: 100.0 },
    // Rust reports ONE failing field where the reference reports every one.
    // Declared rather than fixed, and the reasoning is structural: `body_of`
    // uses `serde_path_to_error`, and serde deserialization is fail-fast by
    // construction — it stops at the first field it cannot read. Zod collects.
    // Reporting all of them would mean deserializing into a permissive struct
    // and validating field by field, at every endpoint.
    //
    // What makes that disproportionate rather than merely expensive: Rust's
    // single detail is a TRUE statement — it names a field that really is
    // wrong, not a wrong guess — and the frontend validates with the same Zod
    // schema through `zodResolver` BEFORE submitting. A user reaches this
    // response only by bypassing the form, so `details` here is a backstop, not
    // the path anyone travels.
    allowDiff: {
      path: /^details/,
      why: 'serde is fail-fast so Rust names the first bad field; Zod collects all of them. Rust’s single entry is correct, just terser — and the form validates with the same schema client-side, so this body is a backstop rather than the user-facing path.',
    },
  },
  {
    name: 'reject: debt with a string balance',
    method: 'POST',
    path: '/debts',
    body: { name: 'Stringly', type: 'CREDIT_CARD', currentBalance: '100' },
    // Rust reports ONE failing field where the reference reports every one.
    // Declared rather than fixed, and the reasoning is structural: `body_of`
    // uses `serde_path_to_error`, and serde deserialization is fail-fast by
    // construction — it stops at the first field it cannot read. Zod collects.
    // Reporting all of them would mean deserializing into a permissive struct
    // and validating field by field, at every endpoint.
    //
    // What makes that disproportionate rather than merely expensive: Rust's
    // single detail is a TRUE statement — it names a field that really is
    // wrong, not a wrong guess — and the frontend validates with the same Zod
    // schema through `zodResolver` BEFORE submitting. A user reaches this
    // response only by bypassing the form, so `details` here is a backstop, not
    // the path anyone travels.
    allowDiff: {
      path: /^details/,
      why: 'serde is fail-fast so Rust names the first bad field; Zod collects all of them. Rust’s single entry is correct, just terser — and the form validates with the same schema client-side, so this body is a backstop rather than the user-facing path.',
    },
  },

  // ── Utilities ─────────────────────────────────────────────────────────
  //
  // Unlocked 2026-08-12 by giving `scenario.mjs` a utilities sequence. This
  // domain measured worst on the whole audit — 4 asserted refusals against the
  // reference's 18 — for a reason that had nothing to do with utilities: the
  // harness had never driven it, so the guard forbade probing it. Every path
  // below is now driven with good input by provider → service → reading.
  //
  // Chosen from `routes/utilities.ts`'s own error strings, all seven of them.

  {
    name: 'reject: GET services for an absent provider',
    method: 'GET',
    path: `/utilities/providers/${ABSENT}/services`,
  },
  {
    name: 'reject: PUT an absent provider',
    method: 'PUT',
    path: `/utilities/providers/${ABSENT}`,
    body: { name: 'Ghost Power' },
  },
  {
    name: 'reject: DELETE an absent provider',
    method: 'DELETE',
    path: `/utilities/providers/${ABSENT}`,
  },
  {
    name: 'reject: provider with no name',
    method: 'POST',
    path: '/utilities/providers',
    body: {},
  },
  {
    name: 'reject: provider with an empty name',
    method: 'POST',
    path: '/utilities/providers',
    body: { name: '' },
  },
  {
    // `City Power & Light` is what the scenario renamed the provider to, so
    // this is a real uniqueness collision.
    name: 'reject: a provider name that already exists',
    method: 'POST',
    path: '/utilities/providers',
    body: { name: 'City Power & Light' },
    needsState: true,
  },
  {
    name: 'reject: service on an absent provider',
    method: 'POST',
    path: `/utilities/providers/${ABSENT}/services`,
    body: { serviceType: 'WATER', metering: 'METERED' },
  },
  {
    name: 'reject: service with an unknown type',
    method: 'POST',
    path: '/utilities/providers/$provider/services',
    body: { serviceType: 'PLASMA', metering: 'METERED' },
  },
  {
    name: 'reject: service with an unknown metering',
    method: 'POST',
    path: '/utilities/providers/$provider/services',
    body: { serviceType: 'WATER', metering: 'GUESSED' },
  },
  {
    // The provider already has an ELECTRIC service, so this probes the
    // per-(provider, type) uniqueness rather than the per-provider one.
    name: 'reject: a second service of the same type on one provider',
    method: 'POST',
    path: '/utilities/providers/$provider/services',
    body: { serviceType: 'ELECTRIC', metering: 'METERED' },
    needsState: true,
  },
  {
    name: 'reject: PUT an absent service',
    method: 'PUT',
    path: `/utilities/services/${ABSENT}`,
    body: { metering: 'METERED' },
  },
  {
    name: 'reject: DELETE an absent service',
    method: 'DELETE',
    path: `/utilities/services/${ABSENT}`,
  },
  {
    // The provider has services, and a provider with services refuses to go.
    name: 'reject: deleting a provider that still has services',
    method: 'DELETE',
    path: '/utilities/providers/$provider',
    needsState: true,
  },
  {
    // The service has readings, and a service with readings refuses to go.
    name: 'reject: deleting a service that still has readings',
    method: 'DELETE',
    path: '/utilities/services/$service',
    needsState: true,
  },
  {
    name: 'reject: reading against an absent service',
    method: 'POST',
    path: '/utilities/readings',
    body: {
      serviceId: ABSENT,
      billDate: '2026-04-01T00:00:00.000Z',
      cost: 10.0,
    },
  },
  {
    name: 'reject: reading with a negative cost',
    method: 'POST',
    path: '/utilities/readings',
    body: {
      serviceId: ABSENT,
      billDate: '2026-04-01T00:00:00.000Z',
      cost: -10.0,
    },
  },
  {
    name: 'reject: reading with no cost',
    method: 'POST',
    path: '/utilities/readings',
    body: { serviceId: ABSENT, billDate: '2026-04-01T00:00:00.000Z' },
  },
  {
    name: 'reject: reading with an unparseable bill date',
    method: 'POST',
    path: '/utilities/readings',
    body: { serviceId: ABSENT, billDate: 'last Tuesday', cost: 10.0 },
  },
  {
    name: 'reject: reading with an unknown convenience fee type',
    method: 'POST',
    path: '/utilities/readings',
    body: {
      serviceId: ABSENT,
      billDate: '2026-04-01T00:00:00.000Z',
      cost: 10.0,
      convenienceFee: 1.0,
      convenienceFeeType: 'goats',
    },
  },
  {
    name: 'reject: PUT an absent reading',
    method: 'PUT',
    path: `/utilities/readings/${ABSENT}`,
    body: { cost: 12.0 },
  },
  {
    name: 'reject: DELETE an absent reading',
    method: 'DELETE',
    path: `/utilities/readings/${ABSENT}`,
  },

  // ── Scheduled transactions ────────────────────────────────────────────
  //
  // Unlocked 2026-08-12 by giving `scenario.mjs` a scheduled sequence. The
  // domain with the most incident history in this project — ADR-001 and
  // ADR-024 are both mark-as-paid failures — and the harness had never
  // touched it.

  {
    name: 'reject: pay an absent occurrence',
    method: 'POST',
    path: `/scheduled-transactions/${ABSENT}/pay`,
    body: {},
  },
  {
    name: 'reject: snooze an absent occurrence',
    method: 'POST',
    path: `/scheduled-transactions/${ABSENT}/snooze`,
    body: { days: 3 },
  },
  {
    name: 'reject: skip an absent occurrence',
    method: 'POST',
    path: `/scheduled-transactions/${ABSENT}/skip`,
  },
  {
    name: 'reject: snooze by zero days',
    method: 'POST',
    path: '/scheduled-transactions/$sched/snooze',
    body: { days: 0 },
    needsState: true,
  },
  {
    name: 'reject: snooze by a negative number of days',
    method: 'POST',
    path: '/scheduled-transactions/$sched/snooze',
    body: { days: -5 },
    needsState: true,
  },
  {
    name: 'reject: snooze by a fractional number of days',
    method: 'POST',
    path: '/scheduled-transactions/$sched/snooze',
    body: { days: 1.5 },
    needsState: true,
  },
  {
    name: 'reject: snooze with no days at all',
    method: 'POST',
    path: '/scheduled-transactions/$sched/snooze',
    body: {},
    needsState: true,
  },
  {
    // `periodStart` and `periodEnd` are both required by the query schema —
    // the schedule is generated for a window, and a window with one edge is
    // not a window.
    name: 'reject: the schedule with no period at all',
    method: 'GET',
    path: '/scheduled-transactions',
    allowDiff: {
      path: /^details/,
      why: 'the same fail-fast difference declared on the debt steps: Rust returns on the first missing parameter, Zod collects both. Rust names `periodStart`, which is genuinely missing.',
    },
  },
  {
    name: 'reject: the schedule with only a start',
    method: 'GET',
    path: '/scheduled-transactions?periodStart=2026-09-01T00:00:00.000Z',
  },
  {
    name: 'reject: the schedule with an unparseable period',
    method: 'GET',
    path: '/scheduled-transactions?periodStart=whenever&periodEnd=2026-10-31T00:00:00.000Z',
  },
  {
    name: 'reject: the schedule with an unknown source type',
    method: 'GET',
    path: '/scheduled-transactions?periodStart=2026-09-01T00:00:00.000Z&periodEnd=2026-10-31T00:00:00.000Z&sourceType=WISHES',
  },
  {
    // The occurrence bound by the scenario has been PAID by the time these
    // run, so both are the "already resolved" branch rather than a bad id.
    name: 'reject: paying something already paid',
    method: 'POST',
    path: '/scheduled-transactions/$sched/pay',
    body: {},
    needsState: true,
    allowStatusDifference:
      'downstream of the reference bug declared on `mark it paid` in scenario.mjs: the ' +
      'reference never completed that payment (its own lifecycle hook took the ' +
      '`transactionId` first), so its row is still SNOOZED and paying now SUCCEEDS. ' +
      'Rust paid it the first time and correctly refuses the second. The two are ' +
      'answering different questions because they are looking at different rows.',
  },
  {
    name: 'reject: skipping something already paid',
    method: 'POST',
    path: '/scheduled-transactions/$sched/skip',
    needsState: true,
  },

  // ── Reconciliation ────────────────────────────────────────────────────
  //
  // Unlocked 2026-08-12 by giving `scenario.mjs` a session. The largest
  // untouched surface in the audit: 18 distinct refusals in the reference,
  // none of them probed. The scenario deliberately leaves its session as a
  // live DRAFT — ADR-029 made `abandon` delete the row, so abandoning would
  // remove the state half of these need.

  {
    name: 'reject: GET an absent session',
    method: 'GET',
    path: `/reconciliations/${ABSENT}`,
  },
  {
    name: 'reject: PATCH an absent session',
    method: 'PATCH',
    path: `/reconciliations/${ABSENT}`,
    body: { statementEndingBalance: 100.0 },
  },
  {
    name: 'reject: close an absent session',
    method: 'POST',
    path: `/reconciliations/${ABSENT}/close`,
    body: {},
  },
  {
    name: 'reject: match on an absent session',
    method: 'POST',
    path: `/reconciliations/${ABSENT}/match`,
    body: {},
  },
  {
    name: 'reject: adjustment on an absent session',
    method: 'POST',
    path: `/reconciliations/${ABSENT}/adjustment`,
    body: {},
  },
  {
    name: 'reject: abandon an absent session',
    method: 'POST',
    path: `/reconciliations/${ABSENT}/abandon`,
    body: {},
  },
  {
    name: 'reject: delete a match on an absent session',
    method: 'DELETE',
    path: `/reconciliations/${ABSENT}/matches/${ABSENT}`,
  },
  {
    name: 'reject: a session on an account that does not exist',
    method: 'POST',
    path: '/reconciliations',
    body: {
      accountId: ABSENT,
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T00:00:00.000Z',
      statementEndingBalance: 100.0,
    },
  },
  {
    // The one cross-field rule on the create: a period that ends before it
    // starts is not a period.
    name: 'reject: a session whose period ends before it starts',
    method: 'POST',
    path: '/reconciliations',
    body: {
      accountId: '$card',
      periodStart: '2026-05-31T00:00:00.000Z',
      periodEnd: '2026-05-01T00:00:00.000Z',
      statementEndingBalance: 100.0,
    },
  },
  {
    name: 'reject: a session with no ending balance',
    method: 'POST',
    path: '/reconciliations',
    body: {
      accountId: '$card',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T00:00:00.000Z',
    },
  },
  {
    name: 'reject: a session with no account',
    method: 'POST',
    path: '/reconciliations',
    body: {
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T00:00:00.000Z',
      statementEndingBalance: 100.0,
    },
  },
  {
    name: 'reject: a session with an unparseable period',
    method: 'POST',
    path: '/reconciliations',
    body: {
      accountId: '$card',
      periodStart: 'springtime',
      periodEnd: '2026-05-31T00:00:00.000Z',
      statementEndingBalance: 100.0,
    },
  },
  {
    // The scenario's draft is still open on `$card`, so this is the real
    // one-draft-per-account rule rather than a validation error.
    name: 'reject: a second draft on an account that already has one',
    method: 'POST',
    path: '/reconciliations',
    body: {
      accountId: '$card',
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-06-30T00:00:00.000Z',
      statementEndingBalance: 200.0,
    },
    needsState: true,
  },
  {
    name: 'reject: merging transactions that do not exist',
    method: 'POST',
    path: '/reconciliations/$recon/merge',
    body: { transactionIds: [ABSENT, ABSENT], statementRowId: ABSENT },
    needsState: true,
  },
  {
    name: 'reject: a match naming a statement row that is not in this session',
    method: 'POST',
    path: '/reconciliations/$recon/matches',
    body: { statementRowId: ABSENT, transactionIds: [ABSENT] },
    needsState: true,
  },

  // ── The silent-zero survey ────────────────────────────────────────────
  //
  // A survey on 2026-08-12 found **21 non-Option numeric fields across 12
  // files** sitting on `#[serde(default)]` structs, where omitting the field
  // deserializes to 0 instead of failing. Two had already been caught this way
  // — `ReadingBody.cost` and `statementEndingBalance`, in different domains,
  // days apart — which is what prompted counting the rest.
  //
  // Each probe below omits exactly one number and leaves the body otherwise
  // valid, so the only variable is the missing field. The point is NOT that
  // every one should be refused: some zeros are legitimate defaults, and
  // deciding which by reading the code is the guessing this harness exists to
  // replace. THE REFERENCE DECIDES. Where it refuses and Rust accepts, that is
  // a defect; where both accept, the default was real and this step documents
  // that it was checked.

  {
    name: 'silent-zero: transaction with no amount',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Amountless',
      type: 'EXPENSE',
      date: '2026-03-01T00:00:00.000Z',
      accountId: '$card',
    },
    needsState: true,
  },
  {
    name: 'silent-zero: recurring expense with no amount',
    method: 'POST',
    path: '/expenses',
    body: {
      name: 'Freebie',
      frequency: 'MONTHLY',
      budgetId: '$budget',
      accountId: '$card',
      dueDay: 15,
    },
    needsState: true,
  },
  {
    name: 'silent-zero: purchase with no amount',
    method: 'POST',
    path: '/purchases',
    body: {
      name: 'Priceless',
      date: '2026-03-04T00:00:00.000Z',
      budgetId: '$budget',
      payments: [{ accountId: '$card', amount: 40.0 }],
    },
    needsState: true,
    allowDiff: {
      path: /^details\[0\]\.field$/,
      why: 'both mark the payments block; the reference names the exact path (`payments.0.amount`) because Zod walks the array, Rust names the containing field. Same input highlighted, less precisely — and this body is a backstop, since the form validates with the same schema before submitting.',
    },
  },
  {
    name: 'silent-zero: purchase leg with no amount',
    method: 'POST',
    path: '/purchases',
    body: {
      name: 'Legless',
      date: '2026-03-04T00:00:00.000Z',
      amount: 40.0,
      budgetId: '$budget',
      payments: [{ accountId: '$card' }],
    },
    needsState: true,
    allowDiff: {
      path: /^details\[0\]\.field$/,
      why: 'both mark the payments block; the reference names the exact path (`payments.0.amount`) because Zod walks the array, Rust names the containing field. Same input highlighted, less precisely — and this body is a backstop, since the form validates with the same schema before submitting.',
    },
  },
  {
    name: 'silent-zero: goal with no target',
    method: 'POST',
    path: '/goals',
    body: { name: 'Aimless', type: 'SAVINGS', budgetId: '$budget' },
    needsState: true,
  },
  {
    name: 'silent-zero: year plan with no year',
    method: 'POST',
    path: '/year-plans',
    body: {},
  },
  {
    name: 'silent-zero: category budget with no amount',
    method: 'POST',
    path: '/category-budgets',
    body: {
      yearPlanId: '$yearPlan',
      budgetId: '$budget',
      frequency: 'MONTHLY',
      effectiveMonth: 1,
    },
    needsState: true,
  },
  {
    name: 'silent-zero: policy with no premium',
    method: 'POST',
    path: '/healthcare/policies',
    body: {
      type: 'MEDICAL',
      year: 2026,
      employer: 'Acme',
      deductibleLimit: 1000.0,
      oopmLimit: 2000.0,
      metadata: {},
    },
  },
  {
    name: 'silent-zero: policy with no year',
    method: 'POST',
    path: '/healthcare/policies',
    body: {
      type: 'MEDICAL',
      employer: 'Acme',
      premium: 100.0,
      deductibleLimit: 1000.0,
      oopmLimit: 2000.0,
      metadata: {},
    },
  },
  {
    name: 'silent-zero: debt with no original balance',
    method: 'POST',
    path: '/debts',
    body: {
      name: 'Vague Loan',
      type: 'CREDIT_CARD',
      currentBalance: 500.0,
      apr: 19.99,
      minimumPayment: 25.0,
    },
    allowDiff: {
      path: /^details/,
      why: 'the fail-fast difference declared throughout: serde stops at the first unreadable field, Zod collects. Rust names one field that really is missing.',
    },
  },
  {
    name: 'silent-zero: debt with no minimum payment',
    method: 'POST',
    path: '/debts',
    body: {
      name: 'No Minimum',
      type: 'CREDIT_CARD',
      currentBalance: 500.0,
      originalBalance: 500.0,
      apr: 19.99,
    },
    allowDiff: {
      path: /^details/,
      why: 'the fail-fast difference declared throughout: serde stops at the first unreadable field, Zod collects. Rust names one field that really is missing.',
    },
  },
  {
    name: 'silent-zero: debt with no APR',
    method: 'POST',
    path: '/debts',
    body: {
      name: 'Free Money',
      type: 'CREDIT_CARD',
      currentBalance: 500.0,
      originalBalance: 500.0,
      minimumPayment: 25.0,
    },
    allowDiff: {
      path: /^details/,
      why: 'the fail-fast difference declared throughout: serde stops at the first unreadable field, Zod collects. Rust names one field that really is missing.',
    },
  },
];
