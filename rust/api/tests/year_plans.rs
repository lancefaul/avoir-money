//! `/year-plans`, `/purchases`, `/data-management`, and the two remaining
//! `/transactions` reads.

use avoir_api::{dispatch, ApiError, Response};
use serde_json::{json, Value};
use sqlx::SqlitePool;

async fn db() -> SqlitePool {
    avoir_db::connect_in_memory().await.expect("test db")
}

async fn call(
    pool: &SqlitePool,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    dispatch(pool, method, path, body).await
}

fn this_year() -> i64 {
    chrono::Datelike::year(&chrono::Utc::now().date_naive()) as i64
}

async fn plan(pool: &SqlitePool, year: i64) -> String {
    call(pool, "POST", "/year-plans", Some(json!({ "year": year })))
        .await
        .expect("create plan")
        .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn budget(pool: &SqlitePool, name: &str) -> String {
    let g = call(
        pool,
        "POST",
        "/budgets/groups",
        Some(json!({ "name": format!("{name}-grp"), "color": "#fff" })),
    )
    .await
    .unwrap();
    call(
        pool,
        "POST",
        "/budgets",
        Some(json!({ "name": name, "groupId": g.body["id"] })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn account(pool: &SqlitePool, name: &str, opening: f64) -> String {
    call(
        pool,
        "POST",
        "/accounts",
        Some(json!({ "name": name, "type": "CHECKING", "openingBalance": opening })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn balance(pool: &SqlitePool, id: &str) -> i64 {
    sqlx::query_scalar(r#"SELECT "balance" FROM "Account" WHERE "id" = ?"#)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn invariant_holds(pool: &SqlitePool) -> bool {
    avoir_db::balance::check_invariant(&mut pool.acquire().await.unwrap())
        .await
        .unwrap()
        .is_empty()
}

// ═══ Year plans ═══

#[tokio::test]
async fn a_plan_starts_as_a_draft_and_lists_newest_first() {
    let pool = db().await;
    for y in [2024, 2026, 2025] {
        plan(&pool, y).await;
    }
    let r = call(&pool, "GET", "/year-plans", None).await.unwrap();
    let years: Vec<i64> = r
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["year"].as_i64().unwrap())
        .collect();
    assert_eq!(years, vec![2026, 2025, 2024]);
    assert_eq!(r.body[0]["status"], json!("DRAFT"));
}

#[tokio::test]
async fn a_year_can_only_be_planned_once() {
    let pool = db().await;
    plan(&pool, 2026).await;
    let err = call(&pool, "POST", "/year-plans", Some(json!({ "year": 2026 })))
        .await
        .unwrap_err();
    assert_eq!(err.status, 409);
}

#[tokio::test]
async fn a_year_that_is_not_a_year_is_refused() {
    let pool = db().await;
    // Zero is what a missing field deserialises to, so it has to be refused
    // rather than creating a plan for the year 0.
    for year in [json!({}), json!({ "year": 0 }), json!({ "year": 99 })] {
        let err = call(&pool, "POST", "/year-plans", Some(year))
            .await
            .unwrap_err();
        assert_eq!(err.status, 400);
    }
}

#[tokio::test]
async fn the_first_plan_creates_a_group_to_put_budgets_in() {
    let pool = db().await;
    plan(&pool, 2026).await;
    let groups: Vec<String> = sqlx::query_scalar(r#"SELECT "name" FROM "BudgetGroup""#)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(groups, vec!["Mandatory"]);

    // Only the first — a second plan must not add another.
    plan(&pool, 2027).await;
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "BudgetGroup""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
}

#[tokio::test]
async fn a_plan_cannot_be_confirmed_before_its_year_begins() {
    let pool = db().await;
    let future = plan(&pool, this_year() + 1).await;

    // An ACTIVE plan is what the effective-version lookup reads for the current
    // month, so confirming early budgets this month against next year.
    let err = call(
        &pool,
        "POST",
        &format!("/year-plans/{future}/confirm"),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    assert!(err.error.contains("January 1"), "{}", err.error);

    let now = plan(&pool, this_year()).await;
    let r = call(&pool, "POST", &format!("/year-plans/{now}/confirm"), None)
        .await
        .unwrap();
    assert_eq!(r.body["status"], json!("ACTIVE"));
}

#[tokio::test]
async fn only_a_draft_can_be_confirmed() {
    let pool = db().await;
    let id = plan(&pool, this_year()).await;
    call(&pool, "POST", &format!("/year-plans/{id}/confirm"), None)
        .await
        .unwrap();
    let err = call(&pool, "POST", &format!("/year-plans/{id}/confirm"), None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 400);
}

/// A source year with one budget allocated at a known frequency.
async fn seeded_source(pool: &SqlitePool, year: i64, amount: i64, freq: &str) -> String {
    let src = plan(pool, year).await;
    let b = budget(pool, "Groceries").await;
    sqlx::query(
        r#"INSERT INTO "CategoryBudget" ("id","yearPlanId","budgetId","highWaterMark",
             "doneForYear","createdAt","updatedAt")
           VALUES ('cb_src', ?, ?, 0, 0, '2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z')"#,
    )
    .bind(&src)
    .bind(&b)
    .execute(pool)
    .await
    .unwrap();
    // Two versions: only the LATEST should be carried.
    for (id, amt, date) in [
        ("bv_old", amount / 2, "2025-01-01T00:00:00.000Z"),
        ("bv_new", amount, "2025-06-01T00:00:00.000Z"),
    ] {
        sqlx::query(
            r#"INSERT INTO "BudgetVersion" ("id","categoryBudgetId","amount","frequency",
                 "monthlyEquivalent","activeMonths","manualOverride","effectiveDate","createdAt")
               VALUES (?, 'cb_src', ?, ?, ?, '[]', 0, ?, '2025-01-01T00:00:00.000Z')"#,
        )
        .bind(id)
        .bind(amt)
        .bind(freq)
        .bind(amt)
        .bind(date)
        .execute(pool)
        .await
        .unwrap();
    }
    src
}

#[tokio::test]
async fn carry_forward_copies_the_latest_version_only() {
    let pool = db().await;
    seeded_source(&pool, 2025, 300_00, "MONTHLY").await;
    let target = plan(&pool, 2026).await;

    call(
        &pool,
        "POST",
        &format!("/year-plans/{target}/carry-forward"),
        Some(json!({ "sourceYear": 2025 })),
    )
    .await
    .unwrap();

    let rows: Vec<(i64, String)> = sqlx::query_as(
        r#"SELECT v."amount", v."effectiveDate" FROM "BudgetVersion" v
             JOIN "CategoryBudget" cb ON cb."id" = v."categoryBudgetId"
            WHERE cb."yearPlanId" = ?"#,
    )
    .bind(&target)
    .fetch_all(&pool)
    .await
    .unwrap();

    // One version, the newer amount, dated the target year's January 1. The
    // older version described a change made during a year that is over.
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].0, 300_00);
    assert_eq!(rows[0].1, "2026-01-01T00:00:00.000Z");
}

#[tokio::test]
async fn carry_forward_converts_the_frequency_to_a_monthly_equivalent() {
    let pool = db().await;
    // $1,200 a year is $100 a month.
    seeded_source(&pool, 2025, 1_200_00, "YEARLY").await;
    let target = plan(&pool, 2026).await;
    call(
        &pool,
        "POST",
        &format!("/year-plans/{target}/carry-forward"),
        Some(json!({ "sourceYear": 2025 })),
    )
    .await
    .unwrap();

    let (amount, monthly, freq): (i64, i64, String) = sqlx::query_as(
        r#"SELECT v."amount", v."monthlyEquivalent", v."frequency" FROM "BudgetVersion" v
             JOIN "CategoryBudget" cb ON cb."id" = v."categoryBudgetId"
            WHERE cb."yearPlanId" = ?"#,
    )
    .bind(&target)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(freq, "YEARLY");
    assert_eq!(amount, 1_200_00, "the budget keeps its own frequency");
    assert_eq!(monthly, 100_00, "and carries what that is per month");
}

#[tokio::test]
async fn carry_forward_can_be_run_twice_without_duplicating() {
    let pool = db().await;
    seeded_source(&pool, 2025, 300_00, "MONTHLY").await;
    let target = plan(&pool, 2026).await;
    for _ in 0..2 {
        call(
            &pool,
            "POST",
            &format!("/year-plans/{target}/carry-forward"),
            Some(json!({ "sourceYear": 2025 })),
        )
        .await
        .unwrap();
    }
    // `(yearPlanId, budgetId)` is unique and re-running is something a user
    // will do, so the second pass skips rather than failing.
    let n: i64 =
        sqlx::query_scalar(r#"SELECT count(*) FROM "CategoryBudget" WHERE "yearPlanId" = ?"#)
            .bind(&target)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(n, 1);
}

#[tokio::test]
async fn carry_forward_skips_allocations_that_were_removed() {
    let pool = db().await;
    seeded_source(&pool, 2025, 300_00, "MONTHLY").await;
    sqlx::query(r#"UPDATE "CategoryBudget" SET "removedAt" = '2025-09-01T00:00:00.000Z'"#)
        .execute(&pool)
        .await
        .unwrap();
    let target = plan(&pool, 2026).await;
    call(
        &pool,
        "POST",
        &format!("/year-plans/{target}/carry-forward"),
        Some(json!({ "sourceYear": 2025 })),
    )
    .await
    .unwrap();

    let n: i64 =
        sqlx::query_scalar(r#"SELECT count(*) FROM "CategoryBudget" WHERE "yearPlanId" = ?"#)
            .bind(&target)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(n, 0, "a retired budget is not carried into a new year");
}

#[tokio::test]
async fn carry_forward_needs_a_draft_target_and_a_real_source() {
    let pool = db().await;
    seeded_source(&pool, 2025, 300_00, "MONTHLY").await;
    let target = plan(&pool, this_year()).await;

    let err = call(
        &pool,
        "POST",
        &format!("/year-plans/{target}/carry-forward"),
        Some(json!({ "sourceYear": 1999 })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 404);

    call(
        &pool,
        "POST",
        &format!("/year-plans/{target}/confirm"),
        None,
    )
    .await
    .unwrap();
    let err = call(
        &pool,
        "POST",
        &format!("/year-plans/{target}/carry-forward"),
        Some(json!({ "sourceYear": 2025 })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

// ═══ Purchases ═══

#[tokio::test]
async fn a_single_payment_is_one_ordinary_transaction() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 1000.00).await;
    let b = budget(&pool, "Groceries").await;

    let r = call(
        &pool,
        "POST",
        "/purchases",
        Some(
            json!({ "name": "Weekly shop", "date": "2026-03-01", "amount": 80.00,
                     "budgetId": b, "payments": [{ "accountId": acct, "amount": 80.00 }] }),
        ),
    )
    .await
    .unwrap();
    assert_eq!(r.status, 201);
    // No group at all — the degenerate one-of-each case stays one row.
    assert_eq!(r.body["purchaseGroupId"], Value::Null);
    assert_eq!(r.body["transactionIds"].as_array().unwrap().len(), 1);

    assert_eq!(balance(&pool, &acct).await, 100_000 - 80_00);
    assert!(invariant_holds(&pool).await);
}

#[tokio::test]
async fn a_split_purchase_is_an_anchor_and_its_legs() {
    let pool = db().await;
    let a = account(&pool, "Checking", 1000.00).await;
    let c = account(&pool, "Card", 0.0).await;
    let b = budget(&pool, "Groceries").await;

    let r = call(
        &pool,
        "POST",
        "/purchases",
        Some(
            json!({ "name": "Big shop", "date": "2026-03-01", "amount": 100.00,
                     "budgetId": b, "payments": [
                        { "accountId": a, "amount": 60.00 },
                        { "accountId": c, "amount": 40.00 }] }),
        ),
    )
    .await
    .unwrap();
    let group = r.body["purchaseGroupId"].as_str().unwrap().to_string();
    assert_eq!(r.body["transactionIds"].as_array().unwrap().len(), 3);

    let rows: Vec<(String, Option<String>, i64, Option<String>)> = sqlx::query_as(
        r#"SELECT "id","accountId","amount","budgetId" FROM "Transaction"
            WHERE "purchaseGroupId" = ? ORDER BY "accountId" IS NULL DESC"#,
    )
    .bind(&group)
    .fetch_all(&pool)
    .await
    .unwrap();

    // The Anchor carries the total and the budget, and no account — which is
    // what keeps it out of every balance query for free.
    let anchor = &rows[0];
    assert_eq!(anchor.1, None);
    assert_eq!(anchor.2, 100_00);
    assert_eq!(anchor.3.as_deref(), Some(b.as_str()));

    // The legs move the balances and carry the purchase's budget nowhere.
    assert_eq!(balance(&pool, &a).await, 100_000 - 60_00);
    assert_eq!(balance(&pool, &c).await, -40_00);
    for leg in &rows[1..] {
        assert_ne!(leg.3.as_deref(), Some(b.as_str()), "a leg is not spend");
    }
    assert!(invariant_holds(&pool).await);
}

#[tokio::test]
async fn the_legs_must_sum_to_the_purchase() {
    let pool = db().await;
    let a = account(&pool, "Checking", 1000.00).await;
    let c = account(&pool, "Card", 0.0).await;

    // Exact equality, not a tolerance: in cents there is no epsilon to pick.
    let err = call(
        &pool,
        "POST",
        "/purchases",
        Some(
            json!({ "name": "Shop", "date": "2026-03-01", "amount": 100.00,
                     "payments": [{ "accountId": a, "amount": 60.00 },
                                  { "accountId": c, "amount": 39.99 }] }),
        ),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    // The message rides in `details`, not `error`, because the reference raises
    // this as a `superRefine` issue on `payments` — and `request.ts` builds the
    // user-visible text from `details[].field` and `details[].message`, so the
    // field name is the part that says which input was wrong.
    assert_eq!(err.error, "Validation failed");
    let details = err.details.as_ref().expect("a field-level issue");
    assert_eq!(details[0]["field"], json!("payments"));
    assert!(
        details[0]["message"].as_str().unwrap().contains("99.99"),
        "{details}"
    );

    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "Transaction""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0, "nothing was written");
}

#[tokio::test]
async fn one_account_may_fund_a_purchase_only_once() {
    let pool = db().await;
    let a = account(&pool, "Checking", 1000.00).await;
    // Two legs on one account is a single payment written twice, and it would
    // show as two rows on that account's ledger.
    let err = call(
        &pool,
        "POST",
        "/purchases",
        Some(
            json!({ "name": "Shop", "date": "2026-03-01", "amount": 100.00,
                     "payments": [{ "accountId": a, "amount": 60.00 },
                                  { "accountId": a, "amount": 40.00 }] }),
        ),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn a_purchase_naming_a_missing_account_writes_nothing() {
    let pool = db().await;
    let a = account(&pool, "Checking", 1000.00).await;
    let err = call(
        &pool,
        "POST",
        "/purchases",
        Some(
            json!({ "name": "Shop", "date": "2026-03-01", "amount": 100.00,
                     "payments": [{ "accountId": a, "amount": 60.00 },
                                  { "accountId": "ghost", "amount": 40.00 }] }),
        ),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 404);
    assert_eq!(balance(&pool, &a).await, 100_000);
}

#[tokio::test]
async fn deleting_a_group_reverses_every_leg() {
    let pool = db().await;
    let a = account(&pool, "Checking", 1000.00).await;
    let c = account(&pool, "Card", 0.0).await;
    let b = budget(&pool, "Groceries").await;
    let r = call(
        &pool,
        "POST",
        "/purchases",
        Some(
            json!({ "name": "Big shop", "date": "2026-03-01", "amount": 100.00,
                     "budgetId": b, "payments": [
                        { "accountId": a, "amount": 60.00 },
                        { "accountId": c, "amount": 40.00 }] }),
        ),
    )
    .await
    .unwrap();
    let group = r.body["purchaseGroupId"].as_str().unwrap().to_string();

    call(&pool, "DELETE", &format!("/purchases/{group}"), None)
        .await
        .unwrap();

    assert_eq!(balance(&pool, &a).await, 100_000);
    assert_eq!(balance(&pool, &c).await, 0);
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "Transaction""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0, "the Anchor goes with its legs");
    assert!(invariant_holds(&pool).await);
}

#[tokio::test]
async fn re_splitting_the_payment_leaves_the_budget_alone() {
    let pool = db().await;
    let a = account(&pool, "Checking", 1000.00).await;
    let c = account(&pool, "Card", 0.0).await;
    let d = account(&pool, "Savings", 500.00).await;
    let b = budget(&pool, "Groceries").await;
    let r = call(
        &pool,
        "POST",
        "/purchases",
        Some(
            json!({ "name": "Big shop", "date": "2026-03-01", "amount": 100.00,
                     "budgetId": b, "payments": [
                        { "accountId": a, "amount": 60.00 },
                        { "accountId": c, "amount": 40.00 }] }),
        ),
    )
    .await
    .unwrap();
    let group = r.body["purchaseGroupId"].as_str().unwrap().to_string();
    let anchor_before: String = sqlx::query_scalar(
        r#"SELECT "id" FROM "Transaction" WHERE "purchaseGroupId" = ? AND "accountId" IS NULL"#,
    )
    .bind(&group)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Pay it entirely from a third account instead.
    let r = call(
        &pool,
        "PUT",
        &format!("/purchases/{group}/payments"),
        Some(json!({ "payments": [{ "accountId": d, "amount": 100.00 }] })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["transactionIds"].as_array().unwrap().len(), 2);

    // Changing who paid says nothing about which budget the purchase is for —
    // the Anchor is the same row, still carrying it.
    let (anchor_after, budget_after): (String, Option<String>) = sqlx::query_as(
        r#"SELECT "id","budgetId" FROM "Transaction"
            WHERE "purchaseGroupId" = ? AND "accountId" IS NULL"#,
    )
    .bind(&group)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(anchor_after, anchor_before);
    assert_eq!(budget_after.as_deref(), Some(b.as_str()));

    assert_eq!(balance(&pool, &a).await, 100_000, "the old leg is reversed");
    assert_eq!(balance(&pool, &c).await, 0);
    assert_eq!(balance(&pool, &d).await, 50_000 - 100_00);
    assert!(invariant_holds(&pool).await);
}

#[tokio::test]
async fn a_re_split_that_does_not_cover_the_total_changes_nothing() {
    let pool = db().await;
    let a = account(&pool, "Checking", 1000.00).await;
    let c = account(&pool, "Card", 0.0).await;
    let r = call(
        &pool,
        "POST",
        "/purchases",
        Some(
            json!({ "name": "Big shop", "date": "2026-03-01", "amount": 100.00,
                     "payments": [{ "accountId": a, "amount": 60.00 },
                                  { "accountId": c, "amount": 40.00 }] }),
        ),
    )
    .await
    .unwrap();
    let group = r.body["purchaseGroupId"].as_str().unwrap().to_string();

    let err = call(
        &pool,
        "PUT",
        &format!("/purchases/{group}/payments"),
        Some(json!({ "payments": [{ "accountId": a, "amount": 50.00 }] })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);

    // Checked against the stored Anchor before anything is deleted, so the
    // original legs survive intact.
    assert_eq!(balance(&pool, &a).await, 100_000 - 60_00);
    assert_eq!(balance(&pool, &c).await, -40_00);
}

#[tokio::test]
async fn a_missing_purchase_group_is_a_404() {
    let pool = db().await;
    for (method, path, body) in [
        ("DELETE", "/purchases/nope", None),
        (
            "PUT",
            "/purchases/nope/payments",
            Some(json!({ "payments": [] })),
        ),
    ] {
        let err = call(&pool, method, path, body).await.unwrap_err();
        assert_eq!(err.status, 404, "{method} {path}");
    }
}

// ═══ Data management ═══

#[tokio::test]
async fn counts_report_what_a_wipe_would_remove() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 1000.00).await;
    budget(&pool, "Groceries").await;
    call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({ "type": "EXPENSE", "name": "x", "amount": 10.00,
                     "date": "2026-03-01", "accountId": acct })),
    )
    .await
    .unwrap();

    let r = call(&pool, "GET", "/data-management/counts", None)
        .await
        .unwrap();
    assert_eq!(r.body["allTransactions"], json!(1));
    assert_eq!(r.body["importedTransactions"], json!(0));
    assert_eq!(r.body["accounts"], json!(1));
    // Every key the frontend schema requires is present.
    for key in [
        "recurringExpenses",
        "recurringIncome",
        "budgets",
        "debts",
        "utilities",
        "healthcarePolicies",
        "investments",
        "scheduledTransactions",
        "paySchedules",
    ] {
        assert!(r.body.get(key).is_some(), "missing {key}");
    }
}

#[tokio::test]
async fn wiping_transactions_returns_each_account_to_its_opening() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 1000.00).await;
    for amount in [10.00, 25.00] {
        call(
            &pool,
            "POST",
            "/transactions",
            Some(json!({ "type": "EXPENSE", "name": "x", "amount": amount,
                         "date": "2026-03-01", "accountId": acct })),
        )
        .await
        .unwrap();
    }
    assert_eq!(balance(&pool, &acct).await, 100_000 - 35_00);

    let r = call(
        &pool,
        "DELETE",
        "/data-management/bulk",
        Some(json!({ "categories": ["all-transactions"] })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["deleted"], json!(2));

    // ADR-028's correction: the baseline is the OPENING balance, not zero.
    // Resetting to zero discards the Starting Balance and breaks the invariant
    // the instant the wipe finishes.
    assert_eq!(balance(&pool, &acct).await, 100_000);
    assert!(invariant_holds(&pool).await);
}

#[tokio::test]
async fn wiping_accounts_removes_the_transactions_that_would_block_it() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 1000.00).await;
    call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({ "type": "EXPENSE", "name": "x", "amount": 10.00,
                     "date": "2026-03-01", "accountId": acct })),
    )
    .await
    .unwrap();

    // `Transaction.accountId` is ON DELETE RESTRICT, so an account with any
    // transaction cannot be removed — this category crashed until the
    // transactions went first.
    let r = call(
        &pool,
        "DELETE",
        "/data-management/bulk",
        Some(json!({ "categories": ["accounts"] })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["deleted"], json!(1));
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "Account""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn wiping_only_imported_transactions_leaves_the_others_balanced() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 1000.00).await;
    let kept = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({ "type": "EXPENSE", "name": "kept", "amount": 10.00,
                     "date": "2026-03-01", "accountId": acct })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();
    let imported = call(
        &pool,
        "POST",
        "/transactions",
        Some(
            json!({ "type": "EXPENSE", "name": "imported", "amount": 25.00,
                     "date": "2026-03-02", "accountId": acct }),
        ),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();
    sqlx::query(r#"UPDATE "Transaction" SET "imported" = 1 WHERE "id" = ?"#)
        .bind(&imported)
        .execute(&pool)
        .await
        .unwrap();

    let r = call(
        &pool,
        "DELETE",
        "/data-management/bulk",
        Some(json!({ "categories": ["imported-transactions"] })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["deleted"], json!(1));

    // The partial delete goes row by row through the gate, so the survivor's
    // effect is intact and the balance reflects exactly it.
    let left: Vec<String> = sqlx::query_scalar(r#"SELECT "id" FROM "Transaction""#)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(left, vec![kept]);
    assert_eq!(balance(&pool, &acct).await, 100_000 - 10_00);
    assert!(invariant_holds(&pool).await);
}

#[tokio::test]
async fn an_unknown_category_is_refused_rather_than_skipped() {
    let pool = db().await;
    // The TypeScript's `default:` arm fell through silently, so a typo reported
    // "deleted 0" and looked like the data was already gone.
    let err = call(
        &pool,
        "DELETE",
        "/data-management/bulk",
        Some(json!({ "categories": ["all-transactionz"] })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);

    let err = call(
        &pool,
        "DELETE",
        "/data-management/bulk",
        Some(json!({ "categories": [] })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn a_wipe_naming_a_bad_category_alongside_a_good_one_deletes_nothing() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 1000.00).await;
    call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({ "type": "EXPENSE", "name": "x", "amount": 10.00,
                     "date": "2026-03-01", "accountId": acct })),
    )
    .await
    .unwrap();

    let err = call(
        &pool,
        "DELETE",
        "/data-management/bulk",
        Some(json!({ "categories": ["all-transactions", "nonsense"] })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);

    // Validated up front, so a bad name cannot half-run a destructive request.
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "Transaction""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
}

// ═══ Transactions: suggest-budget and delete-imported ═══

#[tokio::test]
async fn a_budget_is_suggested_by_how_often_it_was_used_before() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 5000.00).await;
    let groceries = budget(&pool, "Groceries").await;
    let treats = budget(&pool, "Treats").await;

    for (name, b, n) in [("AMAZON", &groceries, 3), ("AMAZON", &treats, 1)] {
        for _ in 0..n {
            call(
                &pool,
                "POST",
                "/transactions",
                Some(json!({ "type": "EXPENSE", "name": name, "amount": 10.00,
                             "date": "2026-03-01", "accountId": acct, "budgetId": b })),
            )
            .await
            .unwrap();
        }
    }

    // Case-insensitively, and ranked by count.
    let r = call(
        &pool,
        "GET",
        "/transactions/suggest-budget?description=amazon",
        None,
    )
    .await
    .unwrap();
    let s = r.body["suggestions"].as_array().unwrap();
    assert_eq!(s.len(), 2);
    assert_eq!(s[0]["budgetId"], json!(groceries));
    assert_eq!(s[0]["budgetName"], json!("Groceries"));
    assert_eq!(s[0]["count"], json!(3));
    assert_eq!(s[1]["count"], json!(1));
}

#[tokio::test]
async fn a_description_nobody_has_used_suggests_nothing() {
    let pool = db().await;
    let r = call(
        &pool,
        "GET",
        "/transactions/suggest-budget?description=nowhere",
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.body["suggestions"], json!([]));

    let err = call(&pool, "GET", "/transactions/suggest-budget", None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn deleting_imported_transactions_needs_confirmation() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 1000.00).await;
    let id = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({ "type": "EXPENSE", "name": "x", "amount": 10.00,
                     "date": "2026-03-01", "accountId": acct })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();
    sqlx::query(r#"UPDATE "Transaction" SET "imported" = 1 WHERE "id" = ?"#)
        .bind(&id)
        .execute(&pool)
        .await
        .unwrap();

    // This endpoint can remove thousands of rows from one click.
    for path in [
        "/transactions/imported",
        "/transactions/imported?confirm=yes",
    ] {
        let err = call(&pool, "DELETE", path, None).await.unwrap_err();
        assert_eq!(err.status, 400, "{path}");
    }
    assert_eq!(balance(&pool, &acct).await, 100_000 - 10_00);

    let r = call(&pool, "DELETE", "/transactions/imported?confirm=true", None)
        .await
        .unwrap();
    assert_eq!(r.body["deleted"], json!(1));
    // Each row went through the gate, so the balance is reversed rather than
    // recomputed by a parallel routine that has to match every hook.
    assert_eq!(balance(&pool, &acct).await, 100_000);
    assert!(invariant_holds(&pool).await);
}

#[tokio::test]
async fn the_static_transaction_routes_are_not_read_as_ids() {
    let pool = db().await;
    // `/transactions/suggest-budget` and `/transactions/imported` both have the
    // shape of `/transactions/{id}`; ordering in the match is what keeps them
    // apart.
    let r = call(
        &pool,
        "GET",
        "/transactions/suggest-budget?description=x",
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.body["suggestions"], json!([]));

    let err = call(&pool, "DELETE", "/transactions/imported", None)
        .await
        .unwrap_err();
    assert_eq!(
        err.status, 400,
        "the confirm guard ran, not a 404 for an id"
    );
}

#[tokio::test]
async fn a_wipe_returns_every_derived_value_to_its_baseline_not_just_the_balance() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 1000.00).await;

    // Four kinds of derived state, none of which a balance reset would touch.
    sqlx::query(
        r#"INSERT INTO "Debt" ("id","name","type","originalBalance","currentBalance","apr",
             "minimumPayment","frequency","startDate","paidOff","escrowEnabled",
             "createdAt","updatedAt")
           VALUES ('d','Car','AUTO',2000000,1500000,500,35000,'MONTHLY',
                   '2024-01-01T00:00:00.000Z',0,0,'2024-01-01T00:00:00.000Z',
                   '2024-01-01T00:00:00.000Z')"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "DebtPayment" ("id","debtId","principalAmount","interestAmount",
             "date","createdAt")
           VALUES ('dp','d',30000,5000,'2026-03-01T00:00:00.000Z','2026-03-01T00:00:00.000Z')"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Wallet" ("id","name","createdAt","updatedAt","custodyType")
           VALUES ('w','Cold','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','NON_CUSTODIAL')"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "InvestmentHolding" ("id","name","type","quantity","costBasis",
             "createdAt","updatedAt","walletId")
           VALUES ('h','BTC','BITCOIN','1.5',3000000,'2026-01-01T00:00:00.000Z',
                   '2026-01-01T00:00:00.000Z','w')"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    // Distinct due dates: `(sourceType, sourceId, dueDate)` is unique, which is
    // what gives an occurrence its identity (ADR-024).
    for (id, status, due) in [
        ("s_paid", "PAID", "2026-03-01T00:00:00.000Z"),
        ("s_skipped", "SKIPPED", "2026-04-01T00:00:00.000Z"),
    ] {
        sqlx::query(
            r#"INSERT INTO "ScheduledTransaction" ("id","sourceType","sourceId","dueDate",
                 "expectedAmount","actualAmount","status","createdAt","updatedAt")
               VALUES (?, 'EXPENSE','e', ?, 5000,5000, ?,
                       '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
        )
        .bind(id)
        .bind(due)
        .bind(status)
        .execute(&pool)
        .await
        .unwrap();
    }
    call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({ "type": "EXPENSE", "name": "x", "amount": 10.00,
                     "date": "2026-03-01", "accountId": acct })),
    )
    .await
    .unwrap();

    call(
        &pool,
        "DELETE",
        "/data-management/bulk",
        Some(json!({ "categories": ["all-transactions"] })),
    )
    .await
    .unwrap();

    let (current, paid_off): (i64, i64) =
        sqlx::query_as(r#"SELECT "currentBalance","paidOff" FROM "Debt" WHERE "id" = 'd'"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        current, 2000000,
        "no payments means the full balance is owed"
    );
    assert_eq!(paid_off, 0);
    let payments: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "DebtPayment""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(payments, 0);

    let qty: String = sqlx::query_scalar(r#"SELECT "quantity" FROM "InvestmentHolding""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(qty, "0", "no trades means no units");
    let stored_basis: Option<i64> =
        sqlx::query_scalar(r#"SELECT "costBasis" FROM "InvestmentHolding""#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_basis, None);

    let statuses: Vec<(String, String)> =
        sqlx::query_as(r#"SELECT "id","status" FROM "ScheduledTransaction" ORDER BY "id""#)
            .fetch_all(&pool)
            .await
            .unwrap();
    // PAID reverts — the transaction that satisfied it is gone. SKIPPED does
    // not: it is a deliberate user action unrelated to any transaction, and
    // that distinction is the whole point of the rule.
    assert_eq!(statuses[0].1, "PENDING");
    assert_eq!(statuses[1].1, "SKIPPED");
}

#[tokio::test]
async fn deleting_imported_transactions_leaves_their_children_to_cascade() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 1000.00).await;
    let b = budget(&pool, "Groceries").await;
    let parent = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({ "type": "EXPENSE", "name": "Shop", "amount": 100.00,
                     "date": "2026-03-01", "accountId": acct })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();
    call(
        &pool,
        "POST",
        &format!("/transactions/{parent}/children"),
        Some(json!({ "preTaxAmount": 40.00, "budgetId": b })),
    )
    .await
    .unwrap();
    // The import marks the whole row, children included.
    sqlx::query(r#"UPDATE "Transaction" SET "imported" = 1"#)
        .execute(&pool)
        .await
        .unwrap();

    let r = call(&pool, "DELETE", "/transactions/imported?confirm=true", None)
        .await
        .unwrap();
    // ONE, not two. Children cascade with their parent, so passing a child to
    // the gate would either double-count or fail on a row already gone.
    assert_eq!(r.body["deleted"], json!(1));

    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "Transaction""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    assert_eq!(balance(&pool, &acct).await, 100_000);
    assert!(invariant_holds(&pool).await);
}
