# v0.9 paired spikes — decimal money on SQLite, and sqlx vs sea-orm

Run 2026-08-09. Both spikes are prototype code, not analysis: `spike-money`,
`spike-sqlx`, `spike-seaorm`. Every number below came out of running them or
out of the live production database, not out of documentation.

```bash
cd spikes
DATABASE_URL=sqlite:/tmp/spike-build.db cargo run -p spike-money
DATABASE_URL=sqlite:/tmp/spike-build.db cargo run -p spike-sqlx
DATABASE_URL=sqlite:/tmp/spike-build.db cargo run -p spike-seaorm
```

`spikes/` sits outside the pnpm workspace globs (`packages/*`, `apps/*`,
`tools/*`) deliberately — a crate here cannot join a turbo task or affect
`pnpm dev`.

---

## Spike 1 — how money is represented

### What the database actually holds

62 numeric columns in the live schema: **61 are `DECIMAL(65,30)`** (Prisma's
default — so the schema imposes essentially no constraint) and exactly one is
`DECIMAL(5,2)` (`Account.interestRate`). The declared type therefore says
nothing; the stored values had to be measured.

(Counting the `DECIMAL` declarations in the 76 migration files instead gives 70,
because a column can be declared and later altered. The live catalog is the
number that means anything.)

Measuring significant scale (`scale(trim_scale(x))`) across every numeric column
with data splits them cleanly in two:

| Kind                                                                                                                                                                         | Columns | Max significant scale |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------- |
| **Money** — `Transaction.amount`, `netAmount`, `balanceAfter`, `Account.balance`, `openingBalance`, `Expense.amount`, `Debt.*`, `UtilityReading.cost`, …                     | most    | **2**                 |
| **Quantity / unit rate** — `InvestmentSnapshot.quantity`, `InvestmentHolding.quantity`, `TradeDetail.unitPrice`, `UtilityReading.unitCost`, `BitcoinPaymentDetail.unitPrice` | 8       | **up to 20**          |

**No money value in production needs more than two decimal places.**

### The finding nobody was looking for

**769 money values** are stored with more than 2 decimal places, across 10
columns — the full census, counted by the importer as it converted them:

```
InvestmentSnapshot.value        724      ← every row of the table
DebtPayment.principalAmount       9
DebtPayment.interestAmount        9
BalanceSnapshot.openingBalance    7
BalanceSnapshot.closingBalance    6
BudgetVersion.monthlyEquivalent   5
CategoryBudget.highWaterMark      4      ← incl. the one genuine fraction
Transaction.costBasisAllocated    3
Transaction.balanceBefore         1
InvestmentHolding.costBasis       1
                                ---
                                769
```

**768 of the 769 are sub-cent artifacts, and the largest single correction
anywhere in the database is exactly 0.005** — one half-cent, on
`CategoryBudget.highWaterMark = 180.625`. They look like this:

```
1234.56   ← 1234.56
 2345.67                   ←  2345.67
 3456.78                 ← 3456.78
   4567.89                   ←   4567.89
```

That is float noise sitting inside a `Decimal` column. Postgres never did the
arithmetic — JavaScript did, as a float64, and Prisma faithfully persisted the
full decimal expansion. **The "exact decimal" property the Postgres schema
appears to provide is already not being delivered**, because exactness was only
ever enforced by the QUALITY.md discipline of hand-rounding every operation, and
that discipline has 72 call sites across 23 files to be applied at.

Note _which_ columns are contaminated: every one is **derived** (`balanceBefore`
chain, snapshots, debt splits, `monthlyEquivalent`, `highWaterMark`, cost basis,
and `InvestmentSnapshot.value` on every one of its rows).
Every **user-entered** money column is clean at exactly 2dp. The rule fails
precisely where a human is not typing the number.

### Candidates measured

**REAL (float64) — disqualified, and measurably so.** SQLite's own `SUM`:
`0.1 + 0.2 = 0.30000000000000004441`. `156144.26` stored and returned comes back
`156144.26000000000931322575`.

**TEXT + `rust_decimal` — exact at rest, float the moment SQL touches it.**
All 12 real ledger values round-tripped exactly, with no float anywhere. But
SQLite is dynamically typed and TEXT compares lexicographically:

```
ORDER BY amount  → ["-12000.00", "-13147.68", "-390.13", "0.01"]   (wrong)
MAX(amount)      → 954.83          (true max is 156144.26)
SUM(amount)      → coerced, typeof(SUM(amount)) = 'real'
```

The consequence is not theoretical. The ledger invariant
`openingBalance + SUM(tx) == balance` is asserted **in SQL** by
`scripts/check-ledger-integrity.sh`, and the API does SQL-level money
aggregation at 9 distinct sites across 6 non-test files (`Transaction.amount`
in `transactions.ts` and `category-budget-status.ts`, `InvestmentSnapshot.value`
in `investments.history.ts`, healthcare amounts). Trialling the invariant over
500 accounts × 30 exact-cent transactions:

```
TEXT → 215 of 500 accounts falsely report drift  (43.0%)
INT  →   0 of 500
```

A single hand-picked account passed under TEXT, which is the actual hazard —
float is _sometimes_ right, so a spot check reassures you and the trial does not.

**INTEGER scaled cents — exact at rest and under aggregation.** All 12 values
round-tripped exactly; `typeof(SUM(amount))` stays `integer`; `MAX` is correct.
`i64` headroom is ±$92,233,720,368,547,758.

### Recommendation

**Two representations, chosen by what the column means.**

1. **Money → `INTEGER` cents (`i64`), scale 2.** Balances, amounts, fees,
   principal/interest, costs. Exact under SQL aggregation, ordering and
   comparison, which money columns demonstrably need.
2. **Quantity and unit rate → `TEXT` + `rust_decimal`.** `quantity`,
   `unitPrice`, `unitCost`. These cannot be cents — `0.00000001` BTC becomes
   `0`, and `67432.10987654` loses real precision. **Constraint: never `SUM`,
   `MIN`, `MAX`, `ORDER BY` or range-filter these in SQL.** Aggregate them in
   Rust.

**The one column that has to be assigned deliberately** is
`InvestmentSnapshot.value` — a dollar market value (so: money), but derived as
`quantity × unitPrice` and currently stored unrounded on **all 724 rows**, up to
16 decimal places. It is also SQL-summed today (`investments.history.ts`). Under
cents it rounds per row, so the sum changes. Measured against production rather
than estimated: summing exactly then rounding gives `an eight-figure total`; rounding
each row then summing gives `one cent more`. **One cent across 724 rows on an
$11.3M portfolio chart.** It goes to cents.

This is not a compromise between the two candidates — it is the observation that
the schema contains two different kinds of number that have been sharing one
type because Postgres was permissive enough to let them.

### What this changes downstream

- **A migration of every money column** — the backlog anticipated this.
- **QUALITY.md's "Monetary Arithmetic — Zero Tolerance" section gets rewritten
  and mostly _deleted_.** `i64 + i64` is exact by construction, so 72 call sites
  of `Math.round(x*100)/100` / `roundCurrency` / `sumCurrency` stop being needed.
  What survives is much smaller and much sharper: **division is the only
  operation that can lose a cent**, so the rule becomes "every division of a
  money value states its rounding policy and where the residual goes" — interest
  splits, budget monthly-equivalents, proportional cost basis, payment splitting.
  A rule with four sites is enforceable in a way that a rule with 72 is not.
- **The 768 float-noise values get rounded on the way in**, which is a
  correction, not a loss; worst case is half a cent. The one genuine value
  (`180.625`) rounds to `180.63`.
- **`ADR-030`'s payment legs and `ADR-023`/`031`'s P&I splits need an explicit
  residual rule** — legs must sum to the parent exactly, so one leg absorbs the
  rounding remainder. In cents that is expressible and testable; in floats it was
  neither.

---

## Spike 2 — sqlx vs sea-orm

Both arms implement the same two things against the same schema
(`spikes/schema.sql`): `recalculateChainForward`, and an interactive transaction
with a deliberately failing third hook.

Both produce **identical, correct** chains — child row (`parent_id` set)
excluded, inbound transfer writing `to_balance_*` rather than `balance_*`
(ADR-018), `1000.00 → 3500.00 → 2300.00 → 2771.47 → 2687.15` — and both hold
all-or-nothing on rollback with zero surviving rows and an unchanged balance.
So the decision is not about capability.

### 1. Exact decimals (disqualifying criterion)

Both pass. Neither touches a float for `i64` cents or for TEXT decimals; both
bind and return them losslessly. **Not a differentiator.**

### 2. Compile-time verification — the decisive difference

`sqlx::query_as!` checks every query against the live schema at build time.
Renaming `balance_before` to `blance_before` in the chain query:

```
error: error returned from database: (code: 1) no such column: blance_before
   --> spike-sqlx/src/main.rs:130:19
```

The build fails; no binary is produced. Type errors are caught too — declaring
`existing_before: Option<String>` against an INTEGER column gives
`the trait bound Option<String>: From<Option<i64>> is not satisfied`.

sea-orm entities are Rust structs _asserting_ what the database looks like, and
nothing checks the assertion. An entity declaring a column that does not exist:

```
entity declaring a non-existent column `balnce`: COMPILED
query at RUN time: no such column: account.balnce
```

**This is the criterion the backlog flagged as a potential silent downgrade, and
it is real.** Prisma's typing is generated _from_ the schema, so today a wrong
column name cannot compile. sqlx preserves that property. sea-orm does not — it
converts a build error into a runtime error, in the layer that maintains the
balance chain.

### 3. The balance chain

sqlx expresses the merge as one `UNION ALL` ordered by `(date, created_at, id)`,
which is what the composite index exists for, and returns it as one typed
`Vec<ChainEntry>`.

sea-orm's ORM API has no UNION, so the idiomatic version is **two queries plus
an in-memory merge-sort** — structurally the same shape as the Prisma code being
replaced, _including the same hazard_. That merge is exactly where ADR-018's bug
lived: `recalculateChainForward` queried source rows and forgot inbound
transfers, and the bulk rebuild in `account-balance.ts` repeated the omission
months later. Porting the two-list merge forward carries the defect's shape into
the new stack.

sea-orm _can_ express the UNION via `sea_query`, and the spike does it — but the
result comes back through `FromQueryResult` into a struct typed by hand, so that
path gives up the typed-entity benefit that is sea-orm's whole reason for
existing. You end up with sqlx's ergonomics and none of its verification.

### 4. Interactive transactions

**sea-orm is slightly nicer here**, and it is worth saying so plainly.
`DatabaseTransaction` implements `ConnectionTrait`, so a hook can be written
generic over `C: ConnectionTrait` and called with either a pool or a
transaction — a direct, clean analogue of threading `Prisma.TransactionClient`:

```rust
async fn hook_insert<C: ConnectionTrait>(conn: &C, …) -> Result<()>
```

sqlx needs `&mut SqliteTransaction<'_>` plus an `Acquire` call inside each hook,
which is more ceremony and less uniform. This is the one criterion sea-orm wins,
and it does not outweigh criterion 2.

### 5. Migrations

`sqlx migrate` is built in and needs no extra crate; `refinery` is unnecessary.
The 76 existing Prisma migrations are not replayed — the new baseline is a
single SQLite schema, which `spikes/schema.sql` is the seed of.

**One operational requirement, verified rather than assumed.** sqlx's macros
need schema access at build time. `cargo sqlx prepare` writes a `.sqlx/`
directory of query metadata (14 files for this spike) that is committed to the
repo; `SQLX_OFFLINE=true` then builds against it. Tested by deleting the
database entirely and rebuilding: **it works.**

The behaviour worth knowing precisely — offline mode does not silently skip
verification. With the database gone and a column name broken, the build still
fails, but the error changes:

```
error: `SQLX_OFFLINE=true` but there is no cached data for this query,
       run `cargo sqlx prepare` to update the query cache
```

So CI still catches the mistake (the safety property holds), but it reports a
stale cache rather than the real fault; diagnosing it needs a live database and
a `cargo sqlx prepare` run. The standing obligation is therefore: regenerate
`.sqlx` whenever a query or the schema changes, and expect that a forgotten
regeneration and a genuine schema error look identical in CI. This is the main
ongoing cost of choosing sqlx.

### Two smaller observations

- **sqlx 0.9 refuses dynamic SQL strings at the type level.** `sqlx::query()`
  takes `impl SqlSafeStr`, implemented only for `&'static str`; a `format!`-built
  query does not compile without an explicit `AssertSqlSafe` wrapper. Injection
  becomes a deliberate act rather than an oversight.
- **sea-query 1.0's `ExprTrait` is a blanket impl over `T`**, so importing it
  shadows inherent methods on primitives — `90.min(len)` stopped resolving to
  `Ord::min`. Minor, but it is the kind of friction that recurs.

### Recommendation

**sqlx.**

The criterion that decides it is the one the backlog predicted would decide it:
losing compile-time verification is a silent downgrade from what Prisma provides
today, and sea-orm loses it. In the specific code this project has repeatedly
been burned by — the balance chain, the ledger gate, the lifecycle hooks — the
difference between "the build fails" and "a query fails in production" is the
difference between the incidents in ERRORS.md happening again or not.

The secondary argument is that sqlx lets the chain merge be one ordered UNION
instead of two queries and a hand-written merge-sort, which retires the shape of
ADR-018's bug rather than porting it.

Accepted costs, stated plainly: the `.sqlx` offline-metadata obligation, and
slightly clumsier transaction-handle threading than sea-orm's `ConnectionTrait`.

---

## Status of the spike code

`spike-money` and `spike-seaorm` run standalone. `spike-sqlx` needs
`DATABASE_URL` pointing at a SQLite file carrying `schema.sql` **at build time**
(`sqlite3 /tmp/spike-build.db < schema.sql`). That build-time requirement is
itself part of the finding.
