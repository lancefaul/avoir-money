/**
 * The write sequence both backends are driven through, as data.
 *
 * # Why a scripted sequence rather than generated calls
 *
 * A write changes what the next call sees, so the two backends only stay
 * comparable if they are given the same instructions in the same order from the
 * same starting state. That rules out hitting endpoints independently the way
 * the read harness does, and it is why this is a list rather than a crawler.
 *
 * # Symbolic ids
 *
 * Each backend mints its own cuids, so a step cannot name a literal id. `bind`
 * records the id a step produced under a symbolic name, and any `$name` in a
 * later path or body is replaced with THAT backend's value. Before diffing, the
 * responses are walked and every bound id is replaced by `<name>`, so two
 * different cuids for the same logical row compare equal while a genuinely
 * wrong reference still shows up.
 *
 * # What a step asserts
 *
 * Nothing, by itself. The harness compares status and body between the two
 * backends — a step that 400s on both is a legitimate result and says the two
 * agree about rejecting it. `expectStatus` exists only to catch a scenario that
 * has gone stale: if a create starts failing, every step after it is comparing
 * two identical error responses and the run goes green while testing nothing.
 * That is the write-harness version of the trap this whole exercise exists for.
 */

export const scenario = [
  // ── Budget scaffolding: almost everything else needs a budget ──
  {
    name: 'create budget group',
    method: 'POST',
    path: '/budgets/groups',
    body: { name: 'Bills', color: '#334155' },
    bind: 'group',
    expectStatus: 201,
  },
  {
    name: 'create budget',
    method: 'POST',
    path: '/budgets',
    body: { name: 'Groceries', groupId: '$group' },
    bind: 'budget',
    expectStatus: 201,
  },
  {
    name: 'create a second budget',
    method: 'POST',
    path: '/budgets',
    body: { name: 'Fuel', groupId: '$group' },
    bind: 'budget2',
    expectStatus: 201,
  },
  { name: 'list budgets', method: 'GET', path: '/budgets' },
  {
    name: 'rename a budget',
    method: 'PUT',
    path: '/budgets/$budget2',
    body: { name: 'Petrol' },
  },
  { name: 'list budget groups', method: 'GET', path: '/budgets/groups' },

  // ── Accounts ──
  {
    name: 'create a checking account',
    method: 'POST',
    path: '/accounts',
    body: { name: 'Checking', type: 'Checking', balance: 1000.0 },
    bind: 'checking',
    expectStatus: 201,
  },
  {
    name: 'create a card',
    method: 'POST',
    path: '/accounts',
    body: { name: 'Card', type: 'Credit Card', balance: 0 },
    bind: 'card',
    expectStatus: 201,
  },
  {
    name: 'rename an account',
    method: 'PUT',
    path: '/accounts/$checking',
    body: { name: 'Main Checking' },
  },
  { name: 'read the account back', method: 'GET', path: '/accounts/$checking' },

  // ── Transactions: the ledger gate and the balance chain ──
  {
    name: 'create an expense',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Groceries',
      type: 'EXPENSE',
      amount: 45.67,
      date: '2026-03-01T00:00:00.000Z',
      accountId: '$checking',
      budgetId: '$budget',
    },
    bind: 'tx1',
    expectStatus: 201,
  },
  {
    name: 'create an income',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Paycheck',
      type: 'INCOME',
      amount: 2500.0,
      date: '2026-03-02T00:00:00.000Z',
      accountId: '$checking',
    },
    bind: 'tx2',
    expectStatus: 201,
  },
  {
    name: 'create a refund',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Return',
      type: 'REFUND',
      amount: 12.34,
      date: '2026-03-03T00:00:00.000Z',
      accountId: '$checking',
      budgetId: '$budget',
    },
    bind: 'tx3',
    expectStatus: 201,
  },
  // The balance chain is the most incident-prone code in the project
  // (ADR-013/014/018), and an edit in the MIDDLE of it is the case that has
  // broken most often — every later row's balanceBefore/After has to move.
  {
    name: 'edit the middle transaction',
    method: 'PUT',
    path: '/transactions/$tx2',
    body: { amount: 2600.0 },
  },
  { name: 'the account balance after the edit', method: 'GET', path: '/accounts/$checking' },
  { name: 'the whole ledger after the edit', method: 'GET', path: '/transactions' },

  // ── Budget split: children on one transaction ──
  //
  // Added after a defect shipped through both harnesses. `/transactions/{id}
  // /children` was already exercised — three times in the read harness — but
  // production has no split transactions, so every response was `children: []`,
  // which satisfies the schema trivially and compares equal to the reference's
  // empty array. The port was omitting `lineTotal` entirely and the frontend
  // threw on every attempt to split a purchase across budgets.
  //
  // A route being *called* is not the same as its shape being *seen*. The write
  // harness is the only one that can create the case, so it has to.
  {
    name: 'split a transaction across budgets',
    method: 'POST',
    path: '/transactions/$tx1/children',
    body: { preTaxAmount: 20.0, taxRate: 8.25, budgetId: '$budget' },
    bind: 'child',
    expectStatus: 201,
  },
  {
    name: 'a second line on the same purchase',
    method: 'POST',
    path: '/transactions/$tx1/children',
    body: { preTaxAmount: 10.0, taxAmount: 0.83, budgetId: '$budget2' },
    expectStatus: 201,
  },
  { name: 'the allocations and what is left', method: 'GET', path: '/transactions/$tx1/children' },
  {
    name: 'edit a line',
    method: 'PUT',
    path: '/transactions/$tx1/children/$child',
    body: { preTaxAmount: 15.0 },
  },
  {
    name: 'lines may not exceed the parent',
    method: 'POST',
    path: '/transactions/$tx1/children',
    body: { preTaxAmount: 9999.0, budgetId: '$budget' },
  },
  { name: 'remove a line', method: 'DELETE', path: '/transactions/$tx1/children/$child' },

  // ── Payment split (ADR-030) ──
  {
    name: 'split a purchase across two accounts',
    method: 'POST',
    path: '/purchases',
    body: {
      name: 'Big shop',
      date: '2026-03-04T00:00:00.000Z',
      amount: 100.0,
      budgetId: '$budget',
      payments: [
        { accountId: '$checking', amount: 60.0 },
        { accountId: '$card', amount: 40.0 },
      ],
    },
    bind: 'purchase',
    bindField: 'purchaseGroupId',
    expectStatus: 201,
  },
  { name: 'the ledger with a split in it', method: 'GET', path: '/transactions' },
  {
    name: 'the card ledger sees its own leg',
    method: 'GET',
    path: '/transactions?accountId=$card',
  },
  {
    name: 're-split the same purchase',
    method: 'PUT',
    path: '/purchases/$purchase/payments',
    body: {
      payments: [
        { accountId: '$checking', amount: 25.0 },
        { accountId: '$card', amount: 75.0 },
      ],
    },
  },
  { name: 'balances after the re-split', method: 'GET', path: '/accounts' },

  // ── Recurring expenses and income ──
  {
    name: 'create a recurring expense',
    method: 'POST',
    path: '/expenses',
    body: {
      name: 'Internet',
      amount: 89.99,
      frequency: 'MONTHLY',
      budgetId: '$budget',
      accountId: '$checking',
      dueDay: 15,
    },
    bind: 'expense',
    expectStatus: 201,
  },
  {
    name: 'change the amount',
    method: 'PUT',
    path: '/expenses/$expense',
    body: { amount: 94.99 },
  },
  {
    name: 'pause it',
    method: 'POST',
    path: '/expenses/$expense/pause',
    body: { duration: 2, unit: 'months' },
    expectStatus: 200,
  },
  {
    name: 'resume it',
    method: 'POST',
    path: '/expenses/$expense/resume',
    body: { immediately: true },
    expectStatus: 200,
  },
  { name: 'archive it', method: 'POST', path: '/expenses/$expense/archive', body: {} },
  {
    name: 'deleting an archived expense is refused',
    method: 'DELETE',
    path: '/expenses/$expense',
  },
  { name: 'restore it', method: 'POST', path: '/expenses/$expense/restore', body: {} },
  { name: 'list expenses', method: 'GET', path: '/expenses' },

  // ── Goals ──
  {
    name: 'create a savings goal',
    method: 'POST',
    path: '/goals',
    body: { name: 'Emergency fund', type: 'SAVINGS', targetAmount: 5000.0, budgetId: '$budget' },
    bind: 'goal',
    expectStatus: 201,
  },
  {
    name: 'put money against it',
    method: 'PUT',
    path: '/goals/$goal',
    body: { currentAmount: 250.0 },
  },
  { name: 'list goals', method: 'GET', path: '/goals' },

  // ── Debts ──
  {
    name: 'create a debt',
    method: 'POST',
    path: '/debts',
    body: {
      name: 'Auto Loan',
      type: 'AUTO_LOAN',
      originalBalance: 24000.0,
      currentBalance: 18000.0,
      apr: 5.9,
      minimumPayment: 415.0,
      frequency: 'MONTHLY',
      startDate: '2024-01-01T00:00:00.000Z',
      termMonths: 60,
    },
    bind: 'debt',
    expectStatus: 201,
  },
  // A second debt, never deleted. The first one IS deleted near the end — that
  // delete is load-bearing, because it exercises the cascade — which left the
  // Debt table empty at the end of a run. That is invisible to the differential
  // diff (both backends agree on nothing) and fatal to `build-fixture.mjs`,
  // whose whole job is to leave every table `acceptance.rs` samples non-empty.
  // A mortgage rather than a second auto loan, so the amortization and escrow
  // routes get a debt whose type actually reaches them.
  {
    name: 'create a mortgage that survives the run',
    method: 'POST',
    path: '/debts',
    body: {
      name: 'Mortgage',
      type: 'MORTGAGE',
      originalBalance: 250000.0,
      currentBalance: 231500.0,
      apr: 3.25,
      minimumPayment: 1088.02,
      frequency: 'MONTHLY',
      startDate: '2021-06-01T00:00:00.000Z',
      termMonths: 360,
    },
    bind: 'mortgage',
    expectStatus: 201,
  },
  { name: 'the mortgage amortization', method: 'GET', path: '/debts/$mortgage/amortization' },
  { name: 'its escrow records', method: 'GET', path: '/debts/$mortgage/escrow' },
  { name: 'the debt as served', method: 'GET', path: '/debts/$debt' },
  { name: 'its amortization', method: 'GET', path: '/debts/$debt/amortization' },
  {
    name: 'correct the balance',
    method: 'PUT',
    path: '/debts/$debt',
    body: { currentBalance: 17500.0 },
  },
  { name: 'debt summary', method: 'GET', path: '/debts/summary' },

  // ── Descriptions (the naming/merge surface) ──
  {
    name: 'create a description',
    method: 'POST',
    path: '/descriptions',
    body: { name: 'Corner Shop' },
    bind: 'description',
    expectStatus: 201,
  },
  { name: 'list descriptions', method: 'GET', path: '/descriptions' },

  // ── Deletes, in dependency order ──
  // ── The five entities the acceptance fixture had no way to produce ──
  //
  // `acceptance.rs` samples ids from ten tables and asserts each is non-empty,
  // because "an empty table means the per-record routes for it are silently
  // skipped, and a run that skips most of what it claims to check is worse than
  // one that fails". Five of those ten had no create step anywhere in this
  // scenario — YearPlan, CategoryBudget, PaySchedule, PayPeriod, InsurancePolicy
  // — plus Income, which is not sampled but is half of the recurring domain and
  // was equally absent.
  //
  // That is what stops the response-shape check becoming a CI gate: it needs a
  // production-SHAPED database, and CI cannot be handed the real one. Every
  // entity created here is one the fixture can now build from the API instead.

  {
    name: 'create a pay schedule',
    method: 'POST',
    path: '/pay-schedules',
    body: {
      name: 'Main job',
      type: 'BIWEEKLY',
      anchorDate: '2026-01-02T00:00:00.000Z',
      isDefault: true,
    },
    bind: 'paySchedule',
    expectStatus: 201,
  },
  // PayPeriod has no POST route at all — periods are DERIVED from a schedule,
  // which is why the fixture could never contain one by accident.
  {
    name: 'generate its pay periods',
    method: 'POST',
    path: '/pay-schedules/$paySchedule/generate',
    body: { rangeStart: '2026-01-01T00:00:00.000Z', rangeEnd: '2026-12-31T00:00:00.000Z' },
  },
  { name: 'the pay periods', method: 'GET', path: '/pay-periods' },

  {
    name: 'create a year plan',
    method: 'POST',
    path: '/year-plans',
    body: { year: 2026 },
    bind: 'yearPlan',
    expectStatus: 201,
  },
  {
    name: 'allocate a budget inside it',
    method: 'POST',
    path: '/category-budgets',
    body: {
      yearPlanId: '$yearPlan',
      budgetId: '$budget',
      amount: 400.0,
      frequency: 'MONTHLY',
      // Required by `CreateCategoryBudgetSchema`, and the port had it optional
      // — caught by the staleness guard on the first run of this block.
      effectiveMonth: 1,
    },
    bind: 'categoryBudget',
    expectStatus: 201,
  },
  // `/category-budgets` 400s without a year plan, which is the documented reason
  // the acceptance run tolerates a non-zero exit. With one created here, the
  // route is exercised properly rather than excused.
  { name: 'the allocations', method: 'GET', path: '/category-budgets?yearPlanId=$yearPlan' },
  { name: 'its history', method: 'GET', path: '/category-budgets/$categoryBudget/history' },
  {
    name: 'raise the allocation',
    method: 'PUT',
    path: '/category-budgets/$categoryBudget',
    body: { amount: 450.0 },
  },
  { name: 'the year plan as served', method: 'GET', path: '/year-plans/$yearPlan' },

  {
    name: 'create an insurance policy',
    method: 'POST',
    path: '/healthcare/policies',
    body: {
      type: 'MEDICAL',
      year: 2026,
      employer: 'Acme',
      premium: 240.0,
      deductibleLimit: 3000.0,
      oopmLimit: 6000.0,
      // `PolicyMetadataSchema` is a union ending in `z.object({}).passthrough()`
      // — any object passes, but the field itself is NOT optional. The port had
      // it optional.
      metadata: {},
    },
    binds: { policy: 'id', policyBudget: 'budgetId' },
    expectStatus: 201,
  },
  // Creating a policy also CREATES a budget for its premiums (in an INSURANCE
  // group both backends make on demand), so `budgetId` is an id minted by the
  // request. Binding it normalizes both to `<policyBudget>` — which is stricter
  // than excusing the field, because a policy pointing at the WRONG budget still
  // reports.
  {
    name: 'the budget the policy created',
    method: 'GET',
    path: '/budgets',
  },
  { name: 'the policy as served', method: 'GET', path: '/healthcare/policies/$policy' },
  {
    name: 'what has been paid against it',
    method: 'GET',
    path: '/healthcare/policies/$policy/transactions',
  },

  // Income is the other half of the recurring domain and the scenario only ever
  // created expenses, so every income-specific branch — the schedule generator's
  // INCOME source type, the pay-period linkage — went undriven.
  {
    name: 'create a recurring income',
    method: 'POST',
    path: '/income',
    body: {
      name: 'Salary',
      amount: 2500.0,
      frequency: 'BIWEEKLY',
      budgetId: '$budget',
      accountId: '$card',
    },
    bind: 'income',
    expectStatus: 201,
  },
  { name: 'the income list', method: 'GET', path: '/income' },
  {
    name: 'pause the income',
    method: 'POST',
    path: '/income/$income/pause',
    body: { duration: 1, unit: 'months' },
  },
  { name: 'and resume it', method: 'POST', path: '/income/$income/resume' },

  // ── Trades ──
  //
  // The scenario had no trade in it, and that single omission hid the whole
  // feature being dead: `POST /transactions` did not deserialize
  // `tradeMetadata` at all, so a fully-formed stock purchase returned 201 with
  // a real id, wrote no `TradeDetail`, and updated no holding. The read harness
  // could not see it either — it reads PRODUCTION, where every trade was
  // written by the TypeScript backend and therefore has its detail row.
  //
  // A create the fixture does not contain is a create nobody is checking. This
  // walks the whole path: custodian → BUY → the holding it must produce → the
  // serialized row → SELL back out.
  {
    name: 'create a custodian',
    method: 'POST',
    path: '/investments/custodians',
    body: { name: 'Fidelity' },
    bind: 'custodian',
    expectStatus: 201,
  },
  {
    name: 'buy a stock',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Buy AAPL',
      type: 'TRADE',
      amount: 1000.0,
      date: '2026-03-02T00:00:00.000Z',
      accountId: '$card',
      tradeMetadata: {
        direction: 'BUY',
        assetType: 'Stock',
        ticker: 'AAPL',
        unitPrice: 100.0,
        quantity: 10,
        custodianId: '$custodian',
      },
    },
    bind: 'trade',
    expectStatus: 201,
  },
  // The BUY must have produced a holding of 10 AAPL with a $1,000 basis. This
  // is the assertion the whole block exists for: the transaction row alone
  // proves nothing, because the broken version wrote that too.
  { name: 'holdings after the buy', method: 'GET', path: '/investments' },
  { name: 'the trade as served', method: 'GET', path: '/transactions?type=TRADE' },
  {
    name: 'sell some of it back',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Sell AAPL',
      type: 'TRADE',
      amount: 400.0,
      date: '2026-03-03T00:00:00.000Z',
      accountId: '$card',
      tradeMetadata: {
        direction: 'SELL',
        assetType: 'Stock',
        ticker: 'AAPL',
        unitPrice: 100.0,
        quantity: 4,
        custodianId: '$custodian',
      },
    },
    expectStatus: 201,
  },
  { name: 'holdings after the sell', method: 'GET', path: '/investments' },
  // Selling more than is held is the one rule `validateTradeMetadata` enforces,
  // and it only applies to a SELL — a BUY validates nothing, deliberately,
  // because buying creates the holding it needs.
  {
    name: 'reject: sell more than is held',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Sell too much',
      type: 'TRADE',
      amount: 9999.0,
      date: '2026-03-04T00:00:00.000Z',
      accountId: '$card',
      tradeMetadata: {
        direction: 'SELL',
        assetType: 'Stock',
        ticker: 'AAPL',
        unitPrice: 100.0,
        quantity: 99,
        custodianId: '$custodian',
      },
    },
  },
  // Deleting the BUY leaves the SELL as the card's FIRST row, which is the case
  // the reference gets wrong — see the `allowDiff` on 'and the ledger' below.
  { name: 'delete the trade', method: 'DELETE', path: '/transactions/$trade' },
  { name: 'holdings after the trade is deleted', method: 'GET', path: '/investments' },

  { name: 'delete the description', method: 'DELETE', path: '/descriptions/$description' },
  { name: 'delete the goal', method: 'DELETE', path: '/goals/$goal' },
  { name: 'delete the debt', method: 'DELETE', path: '/debts/$debt' },
  { name: 'delete the recurring expense', method: 'DELETE', path: '/expenses/$expense' },
  { name: 'delete the split purchase', method: 'DELETE', path: '/purchases/$purchase' },
  { name: 'balances after the split is deleted', method: 'GET', path: '/accounts' },
  { name: 'delete a transaction', method: 'DELETE', path: '/transactions/$tx1' },
  { name: 'the balance returns', method: 'GET', path: '/accounts/$checking' },

  // Deleting an account with transactions still on it is the case that used to
  // crash with a P2003 (ADR-028): `Transaction.accountId` is Restrict, not
  // Cascade, so the rows have to go first.
  { name: 'delete an account that still has rows', method: 'DELETE', path: '/accounts/$checking' },
  { name: 'what is left', method: 'GET', path: '/accounts' },
  {
    name: 'and the ledger',
    method: 'GET',
    path: '/transactions',
    // The second case where the PORT is right and the REFERENCE is wrong, found
    // by adding trades to this scenario.
    //
    // Deleting a transaction that was the account's FIRST row leaves every later
    // row's chain stale. `balance.hook.ts` looks up the predecessor of the row
    // being deleted and then guards on
    //
    //     prevBeforeDeleted?.balanceAfter !== null && ... !== undefined
    //
    // which is FALSE when there is no predecessor at all — so the one case that
    // needs a rebuild from the opening balance is the one case that skips it.
    // Here the BUY is the card's earliest row; after deleting it the SELL still
    // reports balanceBefore -1000, counting a transaction that no longer exists.
    // Rust reseeds from `openingBalance` and reports 0.
    //
    // `Account.balance` is maintained separately and both agree on it, which is
    // why the ledger invariant cannot see this: it sums `netAmount` and never
    // looks at the chain columns. Same shape as the ERRORS.md entry about one
    // NULL row poisoning the chain — a rule that stops propagation at a boundary
    // also stops REPAIR at that boundary. That fix was applied to create and
    // update and not to delete.
    allowDiff: {
      path: /^transactions\[[^\]]+\]\.balance(Before|After)$/,
      why:
        'reference bug: deleting an account FIRST row skips the chain rebuild, ' +
        'so later rows keep a balanceBefore counting the deleted transaction. ' +
        'Rust reseeds from openingBalance. The port is correct here.',
    },
  },

  // ── Rejections: the two must refuse the same things ──
  {
    name: 'a transaction with no date',
    method: 'POST',
    path: '/transactions',
    body: { name: 'Undated', type: 'EXPENSE', amount: 50.0, accountId: '$card' },
  },
  {
    name: 'a negative amount',
    method: 'POST',
    path: '/transactions',
    body: {
      name: 'Negative',
      type: 'EXPENSE',
      amount: -50.0,
      date: '2026-03-01T00:00:00.000Z',
      accountId: '$card',
    },
  },
  {
    name: 'legs that do not sum to the purchase',
    method: 'POST',
    path: '/purchases',
    body: {
      name: 'Mismatched',
      date: '2026-03-05T00:00:00.000Z',
      amount: 100.0,
      budgetId: '$budget',
      payments: [{ accountId: '$card', amount: 60.0 }],
    },
  },
  // ── Utilities ─────────────────────────────────────────────────────────
  //
  // Added 2026-08-12. This domain had **zero** scenario steps, which is exactly
  // why it measured worst on error coverage: 4 asserted refusals against the
  // reference's 18. Nothing could be probed here, because the guard in
  // `rejections.mjs` requires a path the sequence has driven with good input —
  // and a refusal on an undriven path is indistinguishable from a typo.
  //
  // Three levels, each owning the next: provider → service → reading. The
  // ordering is load-bearing in the usual way, and also in one that is not
  // obvious — a provider refuses deletion while it has services, and a service
  // refuses deletion while it has readings, so the teardown reads bottom-up.
  {
    name: 'create a utility provider',
    method: 'POST',
    path: '/utilities/providers',
    body: { name: 'City Power' },
    bind: 'provider',
    expectStatus: 201,
  },
  {
    name: 'create a metered electric service on it',
    method: 'POST',
    path: '/utilities/providers/$provider/services',
    body: { serviceType: 'ELECTRIC', metering: 'METERED' },
    bind: 'service',
    expectStatus: 201,
  },
  {
    name: 'record a reading against the service',
    method: 'POST',
    path: '/utilities/readings',
    body: {
      serviceId: '$service',
      billDate: '2026-03-01T00:00:00.000Z',
      dueDate: '2026-03-20T00:00:00.000Z',
      usage: 850.0,
      cost: 142.5,
      unitCost: 0.1676,
      convenienceFee: 2.5,
      convenienceFeeType: 'dollar',
    },
    bind: 'reading',
    expectStatus: 201,
  },
  {
    // An UNMETERED service on the same provider: the second service is what
    // proves `serviceType` uniqueness is per (provider, type) rather than per
    // provider, and unmetered is the branch where `usage` and `unitCost` are
    // absent rather than zero.
    name: 'a second, unmetered service',
    method: 'POST',
    path: '/utilities/providers/$provider/services',
    body: { serviceType: 'GARBAGE', metering: 'UNMETERED' },
    bind: 'service2',
    expectStatus: 201,
  },
  {
    name: 'a reading with no usage, on the unmetered service',
    method: 'POST',
    path: '/utilities/readings',
    body: {
      serviceId: '$service2',
      billDate: '2026-03-02T00:00:00.000Z',
      cost: 41.0,
    },
    expectStatus: 201,
  },
  { name: 'list utility providers', method: 'GET', path: '/utilities/providers' },
  {
    name: 'the services on the provider',
    method: 'GET',
    path: '/utilities/providers/$provider/services',
  },
  { name: 'list readings', method: 'GET', path: '/utilities/readings' },
  // No `GET /utilities/readings/:id` step: neither backend has that route. The
  // frontend only ever PUTs and DELETEs a reading id, so a list plus the write
  // paths is the whole surface. Written and removed the same day — the third
  // time this session that a PATH the client uses was mistaken for a ROUTE it
  // GETs. Both backends answered "no route", in agreement, testing nothing.
  {
    name: 'update the reading cost',
    method: 'PUT',
    path: '/utilities/readings/$reading',
    body: { cost: 150.0 },
  },
  {
    name: 'rename the provider',
    method: 'PUT',
    path: '/utilities/providers/$provider',
    body: { name: 'City Power & Light' },
  },
  {
    name: 'switch the service to unmetered',
    method: 'PUT',
    path: '/utilities/services/$service',
    body: { metering: 'UNMETERED' },
  },

  // ── Scheduled transactions ────────────────────────────────────────────
  //
  // Added 2026-08-12. Another domain with zero scenario steps, and the one
  // with the most history: ADR-001 and ADR-024 are both mark-as-paid
  // incidents — an occurrence date that did not match, then ids churning
  // under a client that still held them. Neither was reachable by the harness.
  //
  // Placed at the END on purpose. `pay` writes a real transaction against
  // `$checking`, and the ledger assertions earlier in this file compare
  // balances; adding a payment before them would move numbers those steps are
  // pinned to.
  //
  // The schedule has no create route — it is GENERATED lazily by the list — so
  // the only way to name an occurrence is to bind one out of the list. That is
  // what `bindField: '0.id'` is for, and it is self-checking: if the two
  // backends order the list differently they bind different rows, and every
  // step below reports.
  {
    name: 'the generated schedule for a future period',
    method: 'GET',
    path: '/scheduled-transactions?periodStart=2026-09-01T00:00:00.000Z&periodEnd=2026-10-31T00:00:00.000Z',
    bind: 'sched',
    bindField: '0.id',
    expectStatus: 200,
  },
  {
    name: 'snooze the first occurrence',
    method: 'POST',
    path: '/scheduled-transactions/$sched/snooze',
    body: { days: 3 },
    expectStatus: 200,
  },
  {
    name: 'mark it paid',
    method: 'POST',
    path: '/scheduled-transactions/$sched/pay',
    body: {},
    allowStatusDifference:
      'reference bug, and a live one: the handler calls `ledgerCreate`, which fires ' +
      '`schedule-matcher.hook` at priority 15 — that hook writes `transactionId` onto a ' +
      'matching occurrence. The handler then sets `transactionId` again itself, and when ' +
      'the hook attached that transaction to a DIFFERENT row the UNIQUE index fires. ' +
      'Prisma P2002 surfaces through the generic catch as `409 Duplicate record`, so ' +
      'mark-as-paid fails with a message about duplicates. The reference is fighting its ' +
      'own lifecycle hook. Rust links the row it was asked about and answers 201.',
  },
  {
    name: 'the schedule after paying',
    method: 'GET',
    path: '/scheduled-transactions?periodStart=2026-09-01T00:00:00.000Z&periodEnd=2026-10-31T00:00:00.000Z',
    allowDiff: {
      path: /^\[id=<sched>\]\.(status|transactionId|actualAmount)$/,
      why: 'follows from the step above: the reference could not complete the payment, so its row is still SNOOZED with no transaction. Rust paid it.',
    },
  },

  // ── Reconciliation ────────────────────────────────────────────────────
  //
  // Added 2026-08-12. The largest domain the harness had never driven — 18
  // distinct refusals in the reference against 0 probed here.
  //
  // The session is deliberately NOT abandoned. ADR-029 made `abandon` DELETE
  // the session rather than flag it, so abandoning would remove the very row
  // the refusals below need — "this account already has a draft", "only a
  // draft session can be…". A live draft at the end of the run is the state
  // those probes require.
  {
    name: 'start a reconciliation on the checking account',
    method: 'POST',
    path: '/reconciliations',
    body: {
      // `$card`, not `$checking`: the checking account is DELETED earlier by
      // `delete an account that still has rows`, so a session against it 404s.
      // Caught by the staleness guard on the first run — without it the run
      // reported 195/195 identical while five steps compared two 404s.
      accountId: '$card',
      periodStart: '2026-03-01T00:00:00.000Z',
      periodEnd: '2026-03-31T00:00:00.000Z',
      statementEndingBalance: 1500.0,
    },
    bind: 'recon',
    expectStatus: 201,
  },
  { name: 'list reconciliations', method: 'GET', path: '/reconciliations' },
  { name: 'the session as served', method: 'GET', path: '/reconciliations/$recon' },
  {
    // `periodEnd` is the user's stated cutoff rather than something derived
    // from the imported file, which is why it is editable at all — welding it
    // to the file's last posted date is what once hid activity inside the
    // comparison.
    name: 'move the cutoff and the anchor',
    method: 'PATCH',
    path: '/reconciliations/$recon',
    body: { periodEnd: '2026-04-05T00:00:00.000Z', statementEndingBalance: 1650.0 },
  },
  { name: 'the session after the patch', method: 'GET', path: '/reconciliations/$recon' },

  { name: 'an account that does not exist', method: 'GET', path: '/accounts/nope' },
  { name: 'deleting something twice', method: 'DELETE', path: '/goals/$goal' },
];
