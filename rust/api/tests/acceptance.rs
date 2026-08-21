//! Drive every read endpoint against a REAL database, not a fixture.
//!
//! Ignored by default and opt-in, because it needs a database that only exists
//! on a machine where production data has been imported:
//!
//! ```text
//! DATABASE_URL=postgresql://budget:budget@localhost:5432/budget_tracker \
//!   cargo run -p avoir-export -- prod.json        # read-only; zero write statements
//! cargo run -p avoir-import -- prod.json /tmp/acc.db   # out.db is POSITIONAL
//! ACCEPTANCE_DB=/tmp/acc.db cargo test -p avoir-api --test acceptance -- --ignored --nocapture
//! ```
//!
//! The import's target is an argument, not `DATABASE_URL`. Passing the latter
//! silently writes to `avoir.db` in the current directory instead, and the run
//! still reports success — which is how the first attempt here verified a
//! database nobody was looking at.
//!
//! # Why this exists, when 720 other tests pass
//!
//! Every one of those builds its own fixture, so every one asserts against data
//! shaped the way the test author imagined. Production is not shaped that way:
//! it has 2,545 transactions accumulated over months, 205 bitcoin payments whose
//! `balanceBefore` holds BTC rather than cents, 769 money values that needed
//! rounding on import, split children, purchase groups, archived expenses, and
//! four years of pay periods. A handler can be correct on a fixture and panic on
//! the real thing — an `unwrap` on a column that is never null in a fixture and
//! sometimes null in life, an assumption that every account has a type the
//! classifier knows.
//!
//! This is deliberately a SMOKE test, not an assertion of correctness: it proves
//! no read endpoint errors or panics on real data. What the numbers should BE is
//! what the other suites are for.

use avoir_api::dispatch;
use sqlx::SqlitePool;

/// Read endpoints, with the id-bearing ones resolved at run time.
///
/// Only GETs. A write would mutate the imported copy, which would make the run
/// non-repeatable and — far worse — make it tempting to point this at something
/// that matters.
async fn routes(pool: &SqlitePool) -> Vec<String> {
    let mut out: Vec<String> = [
        "/accounts",
        "/expenses",
        "/income",
        // These three REQUIRE query parameters — in the TypeScript too, and the
        // frontend always sends them. Called bare they 400 correctly, which
        // says nothing about whether they work.
        "/scheduled-transactions?periodStart=2026-01-01&periodEnd=2026-12-31",
        "/utilities/providers",
        "/utilities/readings",
        "/budgets/groups",
        "/budgets",
        "/category-budgets",
        "/debts/summary",
        "/debts",
        "/investments/custodians",
        "/investments/wallets",
        "/investments/history",
        "/investments/portfolio-history",
        "/investments",
        "/healthcare/years",
        "/healthcare/policies?year=2026",
        "/healthcare/summary?year=2026",
        "/pay-schedules",
        "/pay-periods",
        "/pay-periods/current",
        "/goals",
        "/dashboard/current-period",
        "/dashboard/ytd",
        "/dashboard/trends",
        "/dashboard/category-breakdown",
        "/dashboard/goal-progress",
        "/dashboard/income-trend",
        "/dashboard/spend-prediction",
        "/backups/config",
        "/backups",
        "/descriptions",
        "/year-plans",
        "/reconciliations",
        "/data-management/counts",
        "/connected-services",
        "/transactions",
        // The paginated list under the filters the UI actually sends.
        "/transactions?limit=50",
        "/transactions?type=EXPENSE&limit=50",
        "/transactions?search=a&limit=50",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    // The Budgets page's real call. The bare `/category-budgets` above is NOT
    // what the app sends, and validating only that is how a page stayed empty
    // while its endpoint "passed": the parameters change which branch runs.
    if let Some(yp) = sample_ids(pool, "YearPlan").await.first() {
        let today = chrono::Utc::now().date_naive();
        use chrono::Datelike;
        out.push(format!(
            "/category-budgets?yearPlanId={yp}&month={}&year={}",
            today.month(),
            today.year()
        ));
        out.push(format!(
            "/category-budgets?yearPlanId={yp}&month={}&year={}&periodStart={}&periodEnd={}&viewMode=PAY_PERIOD",
            today.month(), today.year(),
            (today - chrono::Duration::days(6)).format("%Y-%m-%d"),
            (today + chrono::Duration::days(7)).format("%Y-%m-%d"),
        ));
    }

    // Per-record routes, against ids that really exist. Hitting `/accounts/{id}`
    // with a made-up id proves only that 404 works.
    for (table, template) in [
        ("Account", "/accounts/{}"),
        ("Account", "/accounts/{}/transaction-count"),
        ("Expense", "/expenses/{}"),
        ("Income", "/income/{}"),
        ("CategoryBudget", "/category-budgets/{}"),
        ("CategoryBudget", "/category-budgets/{}/history"),
        ("CategoryBudget", "/category-budgets/{}/links"),
        ("Debt", "/debts/{}"),
        ("Debt", "/debts/{}/amortization"),
        ("Debt", "/debts/{}/escrow"),
        ("InsurancePolicy", "/healthcare/policies/{}"),
        ("InsurancePolicy", "/healthcare/policies/{}/transactions"),
        ("PaySchedule", "/pay-schedules/{}"),
        ("PayPeriod", "/pay-periods/{}"),
        ("YearPlan", "/year-plans/{}"),
        ("Transaction", "/transactions/{}/children"),
    ] {
        for id in sample_ids(pool, table).await {
            out.push(template.replace("{}", &id));
        }
    }
    out
}

/// A few real ids from a table — enough to hit variety without running the
/// whole ledger through every handler.
async fn sample_ids(pool: &SqlitePool, table: &str) -> Vec<String> {
    // The table name is from the fixed list above, never from input.
    let sql = format!(r#"SELECT "id" FROM "{table}" LIMIT 3"#);
    let ids = sqlx::query_scalar::<_, String>(sqlx::AssertSqlSafe(sql))
        .fetch_all(pool)
        .await
        .unwrap_or_else(|e| panic!("reading ids from {table}: {e}"));
    // An empty table means the per-record routes for it are silently skipped,
    // and a run that skips most of what it claims to check is worse than one
    // that fails. This caught the first attempt pointing at an empty database.
    assert!(
        !ids.is_empty(),
        "{table} is empty — is ACCEPTANCE_DB really the imported production data?"
    );
    ids
}

#[tokio::test]
#[ignore = "needs ACCEPTANCE_DB pointing at an imported production database"]
async fn every_read_endpoint_survives_real_data() {
    let Ok(path) = std::env::var("ACCEPTANCE_DB") else {
        panic!("set ACCEPTANCE_DB=/path/to/imported.db");
    };
    let pool = avoir_db::connect(&format!("sqlite:{path}"))
        .await
        .expect("open the imported database");

    let mut failures: Vec<(String, String)> = Vec::new();
    let mut checked = 0usize;
    // Every body is kept so `validate-shapes.mjs` can parse it with the REAL
    // Zod schemas. A 200 says nothing about whether the frontend can use the
    // response — `/category-budgets` returned a well-formed array missing two
    // required fields, and this test passed it.
    let mut bodies = serde_json::Map::new();

    for route in routes(&pool).await {
        checked += 1;
        // A panic inside a handler would abort the whole run, which is itself
        // the finding — catch it so the rest still get exercised and the report
        // names every broken endpoint rather than only the first.
        let result = std::panic::AssertUnwindSafe(dispatch(&pool, "GET", &route, None));
        match result.0.await {
            Ok(r) if r.status < 400 => {
                bodies.insert(route.clone(), r.body.clone());
            }
            Ok(r) => failures.push((route.clone(), format!("status {}", r.status))),
            Err(e) => failures.push((route.clone(), format!("{} {}", e.status, e.error))),
        }
    }

    let dump =
        std::env::var("ACCEPTANCE_DUMP").unwrap_or_else(|_| "/tmp/avoir-responses.json".into());
    std::fs::write(&dump, serde_json::to_vec(&bodies).unwrap()).expect("writing the dump");
    println!("checked {checked} read endpoints against real data");
    println!("wrote {} bodies to {dump}", bodies.len());
    if !failures.is_empty() {
        for (route, why) in &failures {
            println!("  FAIL {route} — {why}");
        }
        panic!("{} of {checked} read endpoints failed", failures.len());
    }
}

/// Print the headline figures so they can be read against the live TypeScript
/// API, which is still running on the same data.
///
/// Not assertions: the two are expected to differ in the last decimal, because
/// TypeScript sums float64 and this sums `i64` cents. That difference is the
/// point of ADR-033, so encoding one side's noise as the expected answer would
/// be exactly wrong. What must match is the value rounded to the cent.
#[tokio::test]
#[ignore = "needs ACCEPTANCE_DB; prints for comparison rather than asserting"]
async fn headline_figures_for_comparison_with_the_typescript_api() {
    let path = std::env::var("ACCEPTANCE_DB").expect("set ACCEPTANCE_DB");
    let pool = avoir_db::connect(&format!("sqlite:{path}")).await.unwrap();
    let year = chrono::Utc::now().format("%Y").to_string();

    for route in [
        format!("/dashboard/ytd?year={year}"),
        "/debts/summary".to_string(),
        "/data-management/counts".to_string(),
    ] {
        match dispatch(&pool, "GET", &route, None).await {
            Ok(r) => println!(
                "\n{route}\n{}",
                serde_json::to_string_pretty(&r.body).unwrap()
            ),
            Err(e) => println!("\n{route}\n  ERROR {} {}", e.status, e.error),
        }
    }
}

/// Dump one endpoint's Rust response for diffing against the TypeScript API.
///
/// ```text
/// DIFF_DB=/tmp/diff.db DIFF_PATH=/budgets/groups \
///   cargo test -p avoir-api --test acceptance -- --ignored dump_one --nocapture
/// ```
#[tokio::test]
#[ignore]
async fn dump_one() {
    let (Ok(db), Ok(path)) = (std::env::var("DIFF_DB"), std::env::var("DIFF_PATH")) else {
        eprintln!("DIFF_DB / DIFF_PATH not set");
        return;
    };
    let pool = SqlitePool::connect(&format!("sqlite://{db}"))
        .await
        .unwrap();
    let r = dispatch(&pool, "GET", &path, None).await.unwrap();
    println!("{}", serde_json::to_string(&r.body).unwrap());
}

/// Every stored group colour must still resolve in the design system.
///
/// `ColorPicker.test.tsx` already asserts the picker only offers tokens the
/// contract defines — that is the CODE half, and it held. This is the DATA
/// half, which nothing covered: a colour stored before a palette redesign keeps
/// naming a token that no longer exists, and the render sites resolve it as
/// `vars.color[name] ?? name`, so the dead name falls through as a literal and
/// the browser discards it as invalid CSS. No error, no warning, just a badge
/// with no colour.
///
/// That is exactly what happened. avoir-finance's design system replaced twelve
/// "fruit" families (kiwi, lavender, blueberry, …) with twelve new ones (fern,
/// violet, brass, …). Two groups carried over from before the redesign —
/// SYSTEM at `kiwi50`, which colours the Income, Trade, Transfer, Payment and
/// Uncategorized badges, and INSURANCE at `lavender50`. Both went colourless.
///
/// Literal hex values are always valid and are skipped.
#[tokio::test]
#[ignore]
async fn every_stored_group_colour_resolves_in_the_design_system() {
    let Ok(db) = std::env::var("ACCEPTANCE_DB") else {
        eprintln!("ACCEPTANCE_DB not set");
        return;
    };
    let pool = SqlitePool::connect(&format!("sqlite://{db}"))
        .await
        .unwrap();

    // Read the contract as text rather than reproducing the token list here:
    // a copy would drift from the palette it is meant to check.
    let contract = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/ui/src/theme/contract.css.ts"
    ))
    .expect("theme contract");
    let known: std::collections::HashSet<&str> = contract
        .lines()
        .filter_map(|l| l.trim().strip_suffix(": null,"))
        .collect();
    assert!(
        known.len() > 100,
        "parsed {} tokens — that is not a contract, it is a bad parse",
        known.len()
    );

    let rows =
        sqlx::query_as::<_, (String, String)>(r#"SELECT "name", "color" FROM "BudgetGroup""#)
            .fetch_all(&pool)
            .await
            .unwrap();

    let dead: Vec<_> = rows
        .iter()
        .filter(|(_, c)| !c.starts_with('#') && !known.contains(c.as_str()))
        .collect();

    assert!(
        dead.is_empty(),
        "group colours naming tokens the design system no longer defines — these \
         render as invalid CSS and show no colour at all: {dead:?}"
    );
}
