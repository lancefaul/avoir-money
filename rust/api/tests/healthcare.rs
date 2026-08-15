//! `/healthcare` — policies, balances, and the budget they drive.

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

async fn make_policy(pool: &SqlitePool, extra: Value) -> Value {
    // `metadata` is REQUIRED by `CreateInsurancePolicySchema` — a union whose
    // last arm is `z.object({}).passthrough()`, so any object passes but an
    // omitted one does not. Every test here omitted it and passed, because the
    // port had the field optional; the write harness caught the reference
    // returning 400 "Invalid input" for exactly this body. Sixteen tests
    // asserting the port's own looser validation rather than the contract.
    let mut b = json!({
        "type": "MEDICAL", "year": 2026, "employer": "Acme",
        "premium": 250.00, "deductibleLimit": 1500.00, "oopmLimit": 4000.00,
        "metadata": {}
    });
    for (k, v) in extra.as_object().unwrap() {
        b[k] = v.clone();
    }
    call(pool, "POST", "/healthcare/policies", Some(b))
        .await
        .expect("create policy")
        .body
}

/// Spend against a policy's budget, which is the only thing that moves a
/// balance.
async fn spend(pool: &SqlitePool, budget_id: &str, id: &str, date: &str, cents: i64) {
    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","type","name","amount","netAmount","date","createdAt",
                                      "imported","isCashBack","budgetId")
           VALUES (?, 'EXPENSE','Claim', ?, ?, ?, ?, 0, 0, ?)"#,
    )
    .bind(id)
    .bind(cents)
    .bind(cents)
    .bind(date)
    .bind(date)
    .bind(budget_id)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn creating_a_policy_creates_the_budget_that_tracks_it() {
    let pool = db().await;
    let p = make_policy(&pool, json!({ "metadata": { "insurer": "Blue Cross" } })).await;

    let budget_id = p["budgetId"].as_str().unwrap();
    let (name, icon, is_system, group): (String, String, i64, String) = sqlx::query_as(
        r#"SELECT b."name", b."icon", b."isSystem", g."name"
             FROM "Budget" b JOIN "BudgetGroup" g ON g."id" = b."groupId"
            WHERE b."id" = ?"#,
    )
    .bind(budget_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Named for the insurer rather than the employer when both are known —
    // "Blue Cross Medical 2026" is what appears in a budget picker.
    assert_eq!(name, "Blue Cross Medical 2026");
    assert_eq!(icon, "🏥");
    assert_eq!(is_system, 1);
    assert_eq!(group, "INSURANCE");
    assert_eq!(p["status"], json!("ACTIVE"));
}

#[tokio::test]
async fn the_budget_falls_back_to_the_employer_when_no_insurer_is_given() {
    let pool = db().await;
    let p = make_policy(&pool, json!({ "type": "DENTAL" })).await;
    let name: String = sqlx::query_scalar(r#"SELECT "name" FROM "Budget" WHERE "id" = ?"#)
        .bind(p["budgetId"].as_str().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(name, "Acme Dental 2026");
}

#[tokio::test]
async fn every_policy_shares_one_insurance_group() {
    let pool = db().await;
    make_policy(&pool, json!({ "type": "MEDICAL" })).await;
    make_policy(&pool, json!({ "type": "DENTAL" })).await;

    let n: i64 =
        sqlx::query_scalar(r#"SELECT count(*) FROM "BudgetGroup" WHERE "name" = 'INSURANCE'"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(n, 1, "the group is created once, then found");
}

#[tokio::test]
async fn a_balance_is_the_sum_of_the_years_expenses_capped_at_each_limit() {
    let pool = db().await;
    let p = make_policy(&pool, json!({})).await;
    let budget = p["budgetId"].as_str().unwrap().to_string();

    spend(&pool, &budget, "t1", "2026-03-01T00:00:00.000Z", 200_000).await;
    spend(&pool, &budget, "t2", "2026-06-01T00:00:00.000Z", 300_000).await;

    let r = call(
        &pool,
        "GET",
        &format!("/healthcare/policies/{}", p["id"].as_str().unwrap()),
        None,
    )
    .await
    .unwrap();
    let b = &r.body["balance"];
    assert_eq!(b["deductibleRaw"], json!(5000.0));
    assert_eq!(b["deductibleSpent"], json!(1500.0), "capped at the limit");
    assert_eq!(b["oopmSpent"], json!(4000.0));
}

#[tokio::test]
async fn spending_outside_the_policy_year_does_not_count() {
    let pool = db().await;
    let p = make_policy(&pool, json!({})).await;
    let budget = p["budgetId"].as_str().unwrap().to_string();

    spend(&pool, &budget, "t1", "2025-12-31T00:00:00.000Z", 100_000).await;
    spend(&pool, &budget, "t2", "2026-01-01T00:00:00.000Z", 100_00).await;
    spend(&pool, &budget, "t3", "2026-12-31T00:00:00.000Z", 100_00).await;
    spend(&pool, &budget, "t4", "2027-01-01T00:00:00.000Z", 100_000).await;

    let r = call(
        &pool,
        "GET",
        &format!("/healthcare/policies/{}", p["id"].as_str().unwrap()),
        None,
    )
    .await
    .unwrap();
    // Both boundary days are inside; the days either side are not.
    assert_eq!(r.body["balance"]["deductibleRaw"], json!(200.0));
}

#[tokio::test]
async fn a_policy_with_no_limits_reports_no_progress_rather_than_zero() {
    let pool = db().await;
    let p = make_policy(
        &pool,
        json!({ "type": "VISION", "deductibleLimit": null, "oopmLimit": null }),
    )
    .await;
    let budget = p["budgetId"].as_str().unwrap().to_string();
    spend(&pool, &budget, "t1", "2026-03-01T00:00:00.000Z", 150_00).await;

    let r = call(
        &pool,
        "GET",
        &format!("/healthcare/policies/{}", p["id"].as_str().unwrap()),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.body["balance"]["deductibleSpent"], Value::Null);
    assert_eq!(r.body["balance"]["oopmSpent"], Value::Null);
    assert_eq!(r.body["balance"]["deductibleRaw"], json!(150.0));
}

#[tokio::test]
async fn a_covered_deductible_moves_the_oopm_without_moving_the_raw_figure() {
    let pool = db().await;
    let p = make_policy(&pool, json!({})).await;
    let id = p["id"].as_str().unwrap().to_string();
    let budget = p["budgetId"].as_str().unwrap().to_string();
    spend(&pool, &budget, "t1", "2026-03-01T00:00:00.000Z", 500_00).await;

    let r = call(
        &pool,
        "PATCH",
        &format!("/healthcare/policies/{id}/overrides"),
        Some(json!({ "deductibleOverride": true })),
    )
    .await
    .unwrap();

    // $500 spent plus $1,000 of deductible somebody else is paying.
    assert_eq!(r.body["balance"]["oopmSpent"], json!(1500.0));
    assert_eq!(
        r.body["balance"]["oopmRaw"],
        json!(500.0),
        "raw is untouched"
    );
}

#[tokio::test]
async fn an_oopm_below_the_deductible_is_refused_on_create_and_update() {
    let pool = db().await;
    let err = call(
        &pool,
        "POST",
        "/healthcare/policies",
        Some(json!({ "type": "MEDICAL", "year": 2026, "employer": "Acme",
                     "premium": 250.0, "deductibleLimit": 4000.0, "oopmLimit": 1500.0 })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);

    let p = make_policy(&pool, json!({})).await;
    let err = call(
        &pool,
        "PUT",
        &format!("/healthcare/policies/{}", p["id"].as_str().unwrap()),
        Some(json!({ "oopmLimit": 1000.0 })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn raising_both_limits_at_once_is_judged_against_the_new_pair() {
    let pool = db().await;
    let p = make_policy(&pool, json!({})).await;
    // The new deductible ($5,000) exceeds the OLD oopm ($4,000). Checking the
    // patch against the stored row would refuse a request that is internally
    // consistent.
    let r = call(
        &pool,
        "PUT",
        &format!("/healthcare/policies/{}", p["id"].as_str().unwrap()),
        Some(json!({ "deductibleLimit": 5000.0, "oopmLimit": 9000.0 })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["deductibleLimit"], json!(5000.0));
    assert_eq!(r.body["oopmLimit"], json!(9000.0));
}

#[tokio::test]
async fn clearing_a_limit_is_not_the_same_as_omitting_it() {
    let pool = db().await;
    let p = make_policy(&pool, json!({})).await;
    let id = p["id"].as_str().unwrap().to_string();

    let r = call(
        &pool,
        "PUT",
        &format!("/healthcare/policies/{id}"),
        Some(json!({ "employer": "Renamed" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["deductibleLimit"], json!(1500.0), "untouched");

    let r = call(
        &pool,
        "PUT",
        &format!("/healthcare/policies/{id}"),
        Some(json!({ "deductibleLimit": null, "oopmLimit": null })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["deductibleLimit"], Value::Null);
}

#[tokio::test]
async fn coverage_ends_then_closes_and_not_in_the_other_order() {
    let pool = db().await;
    let p = make_policy(&pool, json!({})).await;
    let id = p["id"].as_str().unwrap().to_string();

    // Closing an active policy skips a step that means something.
    let err = call(
        &pool,
        "POST",
        &format!("/healthcare/policies/{id}/close"),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);

    let r = call(
        &pool,
        "POST",
        &format!("/healthcare/policies/{id}/end-coverage"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.body["status"], json!("ENDED"));
    assert!(r.body["endedOn"].is_string());

    // Ending twice is refused rather than silently re-stamping the date.
    let err = call(
        &pool,
        "POST",
        &format!("/healthcare/policies/{id}/end-coverage"),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);

    let r = call(
        &pool,
        "POST",
        &format!("/healthcare/policies/{id}/close"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.body["status"], json!("CLOSED"));
    assert!(r.body["closedOn"].is_string());
}

#[tokio::test]
async fn a_closed_policy_refuses_every_edit() {
    let pool = db().await;
    let p = make_policy(&pool, json!({})).await;
    let id = p["id"].as_str().unwrap().to_string();
    call(
        &pool,
        "POST",
        &format!("/healthcare/policies/{id}/end-coverage"),
        None,
    )
    .await
    .unwrap();
    call(
        &pool,
        "POST",
        &format!("/healthcare/policies/{id}/close"),
        None,
    )
    .await
    .unwrap();

    // Its numbers are the record of what happened.
    for (method, path, body) in [
        (
            "PUT",
            format!("/healthcare/policies/{id}"),
            json!({ "employer": "X" }),
        ),
        (
            "PATCH",
            format!("/healthcare/policies/{id}/overrides"),
            json!({ "oopmOverride": true }),
        ),
    ] {
        let err = call(&pool, method, &path, Some(body)).await.unwrap_err();
        assert_eq!(err.status, 403, "{method} {path}");
    }
}

#[tokio::test]
async fn the_transactions_behind_a_balance_can_be_listed() {
    let pool = db().await;
    let p = make_policy(&pool, json!({})).await;
    let id = p["id"].as_str().unwrap().to_string();
    let budget = p["budgetId"].as_str().unwrap().to_string();
    spend(&pool, &budget, "t1", "2026-03-01T00:00:00.000Z", 120_50).await;
    spend(&pool, &budget, "t2", "2025-03-01T00:00:00.000Z", 999_00).await;

    let r = call(
        &pool,
        "GET",
        &format!("/healthcare/policies/{id}/transactions"),
        None,
    )
    .await
    .unwrap();
    let entries = r.body.as_array().unwrap();
    assert_eq!(entries.len(), 1, "last year's claim belongs to last year");
    assert_eq!(entries[0]["amount"], json!(120.50));
    assert_eq!(entries[0]["category"], json!("Acme Medical 2026"));
}

#[tokio::test]
async fn years_lists_each_year_once_newest_first() {
    let pool = db().await;
    make_policy(&pool, json!({ "year": 2025 })).await;
    make_policy(&pool, json!({ "year": 2026, "type": "DENTAL" })).await;
    make_policy(&pool, json!({ "year": 2026, "type": "VISION" })).await;

    let r = call(&pool, "GET", "/healthcare/years", None).await.unwrap();
    assert_eq!(r.body, json!([2026, 2025]));
}

#[tokio::test]
async fn listing_by_year_needs_a_year() {
    let pool = db().await;
    let err = call(&pool, "GET", "/healthcare/policies", None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn the_summary_counts_the_two_non_insurance_budgets() {
    let pool = db().await;
    let g = call(
        &pool,
        "POST",
        "/budgets/groups",
        Some(json!({ "name": "Health", "color": "#fff" })),
    )
    .await
    .unwrap();
    let mut ids = Vec::new();
    for name in ["Healthcare", "Medicine"] {
        let r = call(
            &pool,
            "POST",
            "/budgets",
            Some(json!({ "name": name, "groupId": g.body["id"] })),
        )
        .await
        .unwrap();
        ids.push(r.body["id"].as_str().unwrap().to_string());
    }
    spend(&pool, &ids[0], "t1", "2026-03-01T00:00:00.000Z", 75_25).await;
    spend(&pool, &ids[1], "t2", "2026-04-01T00:00:00.000Z", 20_00).await;
    spend(&pool, &ids[1], "t3", "2025-04-01T00:00:00.000Z", 500_00).await;

    let r = call(&pool, "GET", "/healthcare/summary?year=2026", None)
        .await
        .unwrap();
    assert_eq!(r.body["healthcareBudgetSpent"], json!(75.25));
    assert_eq!(r.body["medicineBudgetSpent"], json!(20.0));
}

#[tokio::test]
async fn the_summary_reports_zero_for_a_budget_that_does_not_exist() {
    let pool = db().await;
    let r = call(&pool, "GET", "/healthcare/summary?year=2026", None)
        .await
        .unwrap();
    // Neither budget has been created. Zero is the honest answer; a missing
    // key would fail the frontend's schema.
    assert_eq!(r.body["healthcareBudgetSpent"], json!(0.0));
    assert_eq!(r.body["medicineBudgetSpent"], json!(0.0));
}

#[tokio::test]
async fn changing_an_override_rewrites_the_months_budget_version() {
    let pool = db().await;
    let today = chrono::Utc::now().date_naive();
    let year = chrono::Datelike::year(&today) as i64;
    let month = chrono::Datelike::month(&today);

    let p = make_policy(&pool, json!({ "year": year })).await;
    let id = p["id"].as_str().unwrap().to_string();
    let budget = p["budgetId"].as_str().unwrap().to_string();

    sqlx::query(
        r#"INSERT INTO "YearPlan" ("id","year","status","createdAt","updatedAt")
           VALUES ('yp', ?, 'ACTIVE','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .bind(year)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "CategoryBudget" ("id","yearPlanId","budgetId","highWaterMark",
             "doneForYear","createdAt","updatedAt")
           VALUES ('cb','yp', ?, 0, 0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .bind(&budget)
    .execute(&pool)
    .await
    .unwrap();

    call(
        &pool,
        "PATCH",
        &format!("/healthcare/policies/{id}/overrides"),
        Some(json!({ "oopmOverride": false })),
    )
    .await
    .unwrap();

    let effective = format!("{year}-{month:02}-01T00:00:00.000Z");
    let amount: i64 = sqlx::query_scalar(
        r#"SELECT "amount" FROM "BudgetVersion"
            WHERE "categoryBudgetId" = 'cb' AND "effectiveDate" = ?"#,
    )
    .bind(&effective)
    .fetch_one(&pool)
    .await
    .unwrap();
    // $4,000 spread over the months left in the year, including this one.
    let months = 12 - month as i64 + 1;
    assert_eq!(amount, (400_000_f64 / months as f64).round() as i64);

    // Turning the override on means somebody else is paying it, so nothing
    // should be set aside.
    call(
        &pool,
        "PATCH",
        &format!("/healthcare/policies/{id}/overrides"),
        Some(json!({ "oopmOverride": true })),
    )
    .await
    .unwrap();

    let rows: Vec<i64> = sqlx::query_scalar(
        r#"SELECT "amount" FROM "BudgetVersion"
            WHERE "categoryBudgetId" = 'cb' AND "effectiveDate" = ?"#,
    )
    .bind(&effective)
    .fetch_all(&pool)
    .await
    .unwrap();
    // Replaced, not joined — a month must not accumulate siblings the way
    // escrow records did (ADR-032).
    assert_eq!(rows, vec![0]);
}

#[tokio::test]
async fn a_manually_set_budget_is_never_overwritten_by_the_spread() {
    let pool = db().await;
    let today = chrono::Utc::now().date_naive();
    let year = chrono::Datelike::year(&today) as i64;

    let p = make_policy(&pool, json!({ "year": year })).await;
    let id = p["id"].as_str().unwrap().to_string();
    let budget = p["budgetId"].as_str().unwrap().to_string();

    sqlx::query(
        r#"INSERT INTO "YearPlan" ("id","year","status","createdAt","updatedAt")
           VALUES ('yp', ?, 'ACTIVE','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .bind(year)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "CategoryBudget" ("id","yearPlanId","budgetId","highWaterMark",
             "doneForYear","createdAt","updatedAt")
           VALUES ('cb','yp', ?, 0, 0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .bind(&budget)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "BudgetVersion" ("id","categoryBudgetId","amount","frequency",
             "monthlyEquivalent","activeMonths","manualOverride","effectiveDate","createdAt")
           VALUES ('bv','cb', 12345,'MONTHLY',12345,'[]',1,
                   '2099-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"#,
    )
    .execute(&pool)
    .await
    .unwrap();

    call(
        &pool,
        "PATCH",
        &format!("/healthcare/policies/{id}/overrides"),
        Some(json!({ "oopmOverride": false })),
    )
    .await
    .unwrap();

    // Somebody typed this number on purpose. A derived recompute replacing it
    // is the feature working against its user.
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "BudgetVersion""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
    let amount: i64 =
        sqlx::query_scalar(r#"SELECT "amount" FROM "BudgetVersion" WHERE "id" = 'bv'"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(amount, 12345);
}

#[tokio::test]
async fn a_policy_with_no_year_plan_syncs_nothing_rather_than_failing() {
    let pool = db().await;
    let p = make_policy(&pool, json!({})).await;
    let id = p["id"].as_str().unwrap().to_string();

    // There is nowhere to write the spread, which is a normal state early in a
    // year rather than an error.
    let r = call(
        &pool,
        "PATCH",
        &format!("/healthcare/policies/{id}/overrides"),
        Some(json!({ "oopmOverride": true })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["oopmOverride"], json!(true));
}

#[tokio::test]
async fn a_missing_policy_is_a_404_on_every_route_that_names_one() {
    let pool = db().await;
    for (method, path, body) in [
        ("GET", "/healthcare/policies/nope", None),
        ("GET", "/healthcare/policies/nope/transactions", None),
        ("PUT", "/healthcare/policies/nope", Some(json!({}))),
        (
            "PATCH",
            "/healthcare/policies/nope/overrides",
            Some(json!({})),
        ),
        ("POST", "/healthcare/policies/nope/end-coverage", None),
        ("POST", "/healthcare/policies/nope/close", None),
    ] {
        let err = call(&pool, method, path, body).await.unwrap_err();
        assert_eq!(err.status, 404, "{method} {path}");
    }
}
