//! `/category-budgets` — allocations, versions, and expense links.

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

/// A year plan, a group, and a budget to allocate against.
async fn fixture(pool: &SqlitePool, status: &str) -> (String, String) {
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "YearPlan" ("id","year","status","createdAt","updatedAt")
                   VALUES ('yp1',2026,?,?,?)"#,
    )
    .bind(status)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt")
                   VALUES ('bg1','Essentials','#000',?)"#,
    )
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
                   VALUES ('bud1','Groceries',1,?,'bg1',0)"#,
    )
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
    ("yp1".into(), "bud1".into())
}

async fn expense(pool: &SqlitePool, id: &str, amount: i64, freq: &str) {
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "Expense" ("id","name","amount","frequency","budgetId","isAutomatic",
                                  "dueDay","skipWeekend","createdAt","updatedAt")
           VALUES (?,?,?,?,'bud1',0,1,0,?,?)"#,
    )
    .bind(id)
    .bind(id)
    .bind(amount)
    .bind(freq)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
}

async fn allocate(pool: &SqlitePool, amount: f64, freq: &str, month: u32) -> String {
    call(
        pool,
        "POST",
        "/category-budgets",
        Some(json!({
            "yearPlanId": "yp1", "budgetId": "bud1",
            "amount": amount, "frequency": freq, "effectiveMonth": month
        })),
    )
    .await
    .expect("allocate")
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn an_allocation_carries_its_category_and_group() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 400.00, "MONTHLY", 1).await;

    let r = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=1"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.body["categoryName"], json!("Groceries"));
    assert_eq!(r.body["categoryGroup"], json!("Essentials"));
    assert_eq!(r.body["version"]["amount"], json!(400.00));
    assert_eq!(r.body["version"]["monthlyEquivalent"], json!(400.00));
    assert_eq!(r.body["doneForYear"], json!(false));
}

#[tokio::test]
async fn the_version_in_force_depends_on_the_month_asked_about() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 400.00, "MONTHLY", 1).await;

    // Raise it from July.
    call(
        &pool,
        "PUT",
        &format!("/category-budgets/{id}"),
        Some(json!({ "amount": 550.00, "effectiveMonth": 7 })),
    )
    .await
    .unwrap();

    let march = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=3"),
        None,
    )
    .await
    .unwrap();
    let august = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=8"),
        None,
    )
    .await
    .unwrap();

    // Raising the budget in July must NOT retroactively make March look
    // on-target — that is the whole reason versions carry an effectiveDate
    // rather than the row carrying one number.
    assert_eq!(march.body["version"]["amount"], json!(400.00));
    assert_eq!(august.body["version"]["amount"], json!(550.00));
}

#[tokio::test]
async fn a_month_before_any_version_resolves_to_nothing() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 400.00, "MONTHLY", 6).await;

    let r = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=2"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        r.body["version"],
        json!(null),
        "no version was in force yet"
    );
}

#[tokio::test]
async fn editing_the_same_month_replaces_rather_than_stacks() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 400.00, "MONTHLY", 1).await;
    call(
        &pool,
        "PUT",
        &format!("/category-budgets/{id}"),
        Some(json!({ "amount": 450.00, "effectiveMonth": 1 })),
    )
    .await
    .unwrap();

    let h = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}/history"),
        None,
    )
    .await
    .unwrap();
    // Two rows on one effectiveDate would leave the tie-break deciding which
    // amount is real.
    //
    // Read through `versions`, not as a bare array: this asserted the array
    // shape until 2026-08-10, which is exactly what let the endpoint ship
    // returning something `BudgetHistoryResponseSchema` rejects. The test agreed
    // with the implementation because both came from the same misreading.
    assert_eq!(h.body["categoryBudgetId"], json!(id));
    let versions = h.body["versions"].as_array().unwrap();
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0]["amount"], json!(450.00));
}

#[tokio::test]
async fn a_later_zero_version_does_not_override_a_new_amount() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 0.0, "MONTHLY", 9).await;
    // Now set a real amount from March. The September zero is a "not tracked
    // from here" placeholder, and leaving it would silently zero the budget
    // again six months later.
    call(
        &pool,
        "PUT",
        &format!("/category-budgets/{id}"),
        Some(json!({ "amount": 300.00, "effectiveMonth": 3 })),
    )
    .await
    .unwrap();

    let dec = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=12"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(dec.body["version"]["amount"], json!(300.00));
}

#[tokio::test]
async fn an_archived_year_plan_refuses_every_write() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 400.00, "MONTHLY", 1).await;
    sqlx::query(r#"UPDATE "YearPlan" SET "status" = 'ARCHIVED' WHERE "id" = 'yp1'"#)
        .execute(&pool)
        .await
        .unwrap();

    // A closed year that can still be edited is not closed.
    for (m, path, b) in [
        (
            "PUT",
            format!("/category-budgets/{id}"),
            Some(json!({ "amount": 1.0 })),
        ),
        ("DELETE", format!("/category-budgets/{id}"), None),
        ("POST", format!("/category-budgets/{id}/restore"), None),
    ] {
        let err = call(&pool, m, &path, b).await.unwrap_err();
        assert_eq!(err.status, 400, "{m} {path}");
    }

    let err = call(
        &pool,
        "POST",
        "/category-budgets",
        Some(json!({
            "yearPlanId": "yp1", "budgetId": "bud1", "amount": 1.0, "frequency": "MONTHLY"
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn one_allocation_per_budget_per_year() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    allocate(&pool, 400.00, "MONTHLY", 1).await;

    let err = call(
        &pool,
        "POST",
        "/category-budgets",
        Some(json!({
            // `effectiveMonth` is REQUIRED by `CreateCategoryBudgetSchema`, and
            // this body omitted it. It passed only because the port had the
            // field optional — so the test was asserting the port's own looser
            // validation rather than the reference's, and a valid body is what
            // reaches the duplicate check this test is actually about.
            "yearPlanId": "yp1", "budgetId": "bud1", "amount": 500.0,
            "frequency": "MONTHLY", "effectiveMonth": 1
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 409);
    assert!(
        err.error.contains("2026"),
        "the message names the year: {}",
        err.error
    );
}

#[tokio::test]
async fn removing_is_soft_and_restorable() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 400.00, "MONTHLY", 1).await;

    let r = call(&pool, "DELETE", &format!("/category-budgets/{id}"), None)
        .await
        .unwrap();
    assert!(!r.body["removedAt"].is_null());

    let listed = call(&pool, "GET", "/category-budgets?yearPlanId=yp1", None)
        .await
        .unwrap();
    assert_eq!(
        listed.body.as_array().unwrap().len(),
        0,
        "hidden by default"
    );

    let all = call(
        &pool,
        "GET",
        "/category-budgets?yearPlanId=yp1&includeRemoved=true",
        None,
    )
    .await
    .unwrap();
    assert_eq!(all.body.as_array().unwrap().len(), 1);

    let restored = call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/restore"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(restored.body["removedAt"], json!(null));

    let err = call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/restore"),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400, "restoring twice is refused");
}

#[tokio::test]
async fn linking_expenses_derives_the_budget_from_them() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 100.00, "MONTHLY", 1).await;
    expense(&pool, "e1", 250_00, "MONTHLY").await;
    expense(&pool, "e2", 150_00, "MONTHLY").await;

    call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/links"),
        Some(json!({ "expenseId": "e1" })),
    )
    .await
    .unwrap();
    let r = call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/links"),
        Some(json!({ "expenseId": "e2" })),
    )
    .await
    .unwrap();

    // POST /links answers with the LINK it created, not the budget —
    // `BudgetExpenseLinkResponseSchema`, flat. The budget is read back
    // separately.
    assert_eq!(r.body["expenseId"], json!("e2"));
    assert_eq!(r.body["expenseName"], json!("e2"));
    assert_eq!(r.body["monthlyEquivalent"], json!(150.00));

    let after = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=1"),
        None,
    )
    .await
    .unwrap();
    // Both monthly, so the native sum is exact: 250 + 150 = 400, no
    // conversion round-trip and no cent of drift.
    assert_eq!(after.body["linkedExpenseCount"], json!(2));
    assert_eq!(after.body["version"]["amount"], json!(400.00));
    assert_eq!(after.body["highWaterMark"], json!(400.00));
}

#[tokio::test]
async fn a_paused_expense_stops_feeding_the_baseline_but_the_mark_holds() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 0.0, "MONTHLY", 1).await;

    // An ACTIVE expense sets the mark at 100.
    expense(&pool, "e1", 100_00, "MONTHLY").await;
    call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/links"),
        Some(json!({ "expenseId": "e1" })),
    )
    .await
    .unwrap();

    // A PAUSED expense worth far more than the mark. This is what makes the
    // exclusion observable: if paused expenses were counted, the mark would
    // jump to 600. Pausing an expense already at or below the mark proves
    // nothing, because the mark holds either way.
    expense(&pool, "e2", 500_00, "MONTHLY").await;
    sqlx::query(
        r#"UPDATE "Expense" SET "pausedUntil" = '2026-12-01T00:00:00.000Z'
                    WHERE "id" = 'e2'"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/links"),
        Some(json!({ "expenseId": "e2" })),
    )
    .await
    .unwrap();

    let r = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=1"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        r.body["highWaterMark"],
        json!(100.00),
        "a paused expense reserves nothing — the money is not going out"
    );
    assert_eq!(
        r.body["linkedExpenseCount"],
        json!(2),
        "but the link still exists"
    );

    // Archived behaves the same way, for the same reason.
    expense(&pool, "e3", 700_00, "MONTHLY").await;
    sqlx::query(
        r#"UPDATE "Expense" SET "archivedAt" = '2026-01-01T00:00:00.000Z'
                    WHERE "id" = 'e3'"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/links"),
        Some(json!({ "expenseId": "e3" })),
    )
    .await
    .unwrap();

    let r = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=1"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        r.body["highWaterMark"],
        json!(100.00),
        "archived reserves nothing either"
    );
}

#[tokio::test]
async fn a_manual_override_is_never_overwritten_by_a_recompute() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 100.00, "MONTHLY", 1).await;
    call(
        &pool,
        "PUT",
        &format!("/category-budgets/{id}"),
        Some(json!({ "amount": 999.00, "effectiveMonth": 1, "manualOverride": true })),
    )
    .await
    .unwrap();
    expense(&pool, "e1", 250_00, "MONTHLY").await;

    call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/links"),
        Some(json!({ "expenseId": "e1" })),
    )
    .await
    .unwrap();

    // Someone typed 999 deliberately. A derivation silently replacing it is
    // the feature working against its user.
    let r = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=1"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.body["version"]["amount"], json!(999.00));
}

#[tokio::test]
async fn unlinking_does_not_lower_the_budget() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 0.0, "MONTHLY", 1).await;
    expense(&pool, "e1", 300_00, "MONTHLY").await;
    call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/links"),
        Some(json!({ "expenseId": "e1" })),
    )
    .await
    .unwrap();

    let links = call(&pool, "GET", &format!("/category-budgets/{id}/links"), None)
        .await
        .unwrap();
    let link_id = links.body[0]["id"].as_str().unwrap().to_string();
    assert_eq!(links.body[0]["expenseName"], json!("e1"));

    let r = call(
        &pool,
        "DELETE",
        &format!("/category-budgets/{id}/links/{link_id}"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.status, 204);

    // Removing a link says "this no longer feeds the target", not "the target
    // was always too high".
    let after = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=1"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(after.body["highWaterMark"], json!(300.00));
    assert_eq!(after.body["linkedExpenseCount"], json!(0));
}

#[tokio::test]
async fn linking_an_already_linked_expense_is_a_409() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 0.0, "MONTHLY", 1).await;
    expense(&pool, "e1", 300_00, "MONTHLY").await;

    call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/links"),
        Some(json!({ "expenseId": "e1" })),
    )
    .await
    .unwrap();
    // An expense belongs to at most one budget anywhere — uniqueness is on
    // `expenseId` alone, not on the (budget, expense) pair. Re-linking is
    // therefore refused rather than quietly ignored, so the caller learns the
    // expense is already committed somewhere.
    let err = call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/links"),
        Some(json!({ "expenseId": "e1" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 409);
    assert_eq!(err.error, "Expense is already linked to another budget");

    // And nothing was double-counted: one link, baseline unmoved.
    let after = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=1"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(after.body["linkedExpenseCount"], json!(1));
    assert_eq!(after.body["highWaterMark"], json!(300.00));
}

#[tokio::test]
async fn a_weekly_budget_fed_by_weekly_expenses_sums_natively() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 0.0, "WEEKLY", 1).await;
    expense(&pool, "e1", 50_00, "WEEKLY").await;
    expense(&pool, "e2", 25_00, "WEEKLY").await;

    call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/links/bulk"),
        Some(json!({ "expenseIds": ["e1", "e2"] })),
    )
    .await
    .unwrap();

    // $75/week exactly. Round-tripping through monthly would give 75.00 ±
    // a cent or two of conversion noise, which is why the same-frequency
    // fast path exists.
    let r = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=1"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.body["version"]["amount"], json!(75.00));
}

#[tokio::test]
async fn missing_records_are_404() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let missing = "cnope0000000000000000000";

    for (m, path, b) in [
        ("GET", format!("/category-budgets/{missing}"), None),
        (
            "PUT",
            format!("/category-budgets/{missing}"),
            Some(json!({ "amount": 1.0 })),
        ),
        ("DELETE", format!("/category-budgets/{missing}"), None),
        ("GET", format!("/category-budgets/{missing}/history"), None),
        ("GET", format!("/category-budgets/{missing}/links"), None),
    ] {
        let err = call(&pool, m, &path, b)
            .await
            .err()
            .unwrap_or_else(|| panic!("{m} {path}"));
        assert_eq!(err.status, 404, "{m} {path}");
    }
}

#[tokio::test]
async fn editing_a_linked_expense_re_derives_its_budgets() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 0.0, "MONTHLY", 1).await;
    expense(&pool, "e1", 200_00, "MONTHLY").await;
    call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/links"),
        Some(json!({ "expenseId": "e1" })),
    )
    .await
    .unwrap();

    let before = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=1"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(before.body["highWaterMark"], json!(200.00));

    // Raise the expense through its own endpoint. The budget must follow
    // without anyone touching the budget — this is the triggerBudgetRecompute
    // that BACKLOG recorded as missing while budget-linking was unported.
    call(
        &pool,
        "PUT",
        "/expenses/e1",
        Some(json!({ "amount": 350.00 })),
    )
    .await
    .unwrap();

    let after = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=1"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        after.body["highWaterMark"],
        json!(350.00),
        "the budget follows its linked expense upward"
    );
}

#[tokio::test]
async fn archiving_a_linked_expense_leaves_the_mark_standing() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 0.0, "MONTHLY", 1).await;
    expense(&pool, "e1", 200_00, "MONTHLY").await;
    call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/links"),
        Some(json!({ "expenseId": "e1" })),
    )
    .await
    .unwrap();

    call(&pool, "POST", "/expenses/e1/archive", None)
        .await
        .unwrap();

    // Archiving unlinks the expense from its budget (the recurring route
    // deletes BudgetExpenseLink rows), so there is nothing left to derive
    // from — and with no links the recompute leaves the budget alone rather
    // than zeroing it.
    let after = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=1"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(after.body["highWaterMark"], json!(200.00));
    assert_eq!(after.body["linkedExpenseCount"], json!(0));
}

// ═══ Status: actualSpending, status, effectiveExpected ═══
//
// The route returned every budget WITHOUT these three for the whole of step 4.
// `BudgetStatusResponseSchema` requires `actualSpending` and `status`, so Zod
// threw in the browser and the Budgets page rendered empty — while the endpoint
// answered 200 and every test here passed.

/// A budget allocation of `monthly` cents, effective from the start of 2026.
async fn seed_allocation(pool: &SqlitePool, cb_id: &str, monthly: i64, active_months: &str) {
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "CategoryBudget" ("id","yearPlanId","budgetId","highWaterMark",
                                         "doneForYear","createdAt","updatedAt")
           VALUES (?,'yp1','bud1',0,0,?,?)"#,
    )
    .bind(cb_id)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "BudgetVersion" ("id","categoryBudgetId","amount","frequency",
                                        "monthlyEquivalent","activeMonths","manualOverride",
                                        "effectiveDate","createdAt")
           VALUES (?,?,?,'MONTHLY',?,?,0,'2026-01-01T00:00:00.000Z',?)"#,
    )
    .bind(format!("v-{cb_id}"))
    .bind(cb_id)
    .bind(monthly)
    .bind(monthly)
    .bind(active_months)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
}

/// A transaction against `bud1` on the given day of August 2026.
async fn seed_spend(
    pool: &SqlitePool,
    id: &str,
    amount: i64,
    ty: &str,
    day: u32,
    parent: Option<&str>,
) {
    let now = avoir_api::id::now_iso();
    let date = format!("2026-08-{day:02}T00:00:00.000Z");
    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","amount","netAmount","date","createdAt","type","name",
                                      "imported","isCashBack","budgetId","parentId")
           VALUES (?,?,?,?,?,?,?,0,0,'bud1',?)"#,
    )
    .bind(id)
    .bind(amount)
    .bind(amount)
    .bind(&date)
    .bind(&now)
    .bind(ty)
    .bind(id)
    .bind(parent)
    .execute(pool)
    .await
    .unwrap();
}

async fn statuses(pool: &SqlitePool) -> Vec<Value> {
    call(
        pool,
        "GET",
        "/category-budgets?yearPlanId=yp1&month=8&year=2026&includeSeasonal=true",
        None,
    )
    .await
    .unwrap()
    .body
    .as_array()
    .unwrap()
    .clone()
}

#[tokio::test]
async fn every_allocation_carries_the_fields_the_frontend_requires() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    seed_allocation(&pool, "cb1", 100_00, "[]").await;

    let rows = statuses(&pool).await;
    assert_eq!(rows.len(), 1);
    // Present, not merely correct: Zod rejects the response outright if either
    // key is absent, whatever its value.
    assert!(
        rows[0].get("actualSpending").is_some(),
        "actualSpending missing"
    );
    assert!(rows[0].get("status").is_some(), "status missing");
}

#[tokio::test]
async fn spending_is_net_of_refunds() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    seed_allocation(&pool, "cb1", 100_00, "[]").await;
    seed_spend(&pool, "t1", 60_00, "EXPENSE", 5, None).await;
    seed_spend(&pool, "t2", 20_00, "REFUND", 6, None).await;

    let rows = statuses(&pool).await;
    assert_eq!(
        rows[0]["actualSpending"],
        json!(40.00),
        "60 spent less a 20 refund"
    );
}

#[tokio::test]
async fn a_split_purchase_counts_once_not_twice() {
    // THE subtlety. A split is one parent plus N children; counting both doubles
    // it. The parent contributes only its remainder — what the user kept on the
    // original category — and each child contributes its own amount.
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    seed_allocation(&pool, "cb1", 500_00, "[]").await;
    seed_spend(&pool, "parent", 100_00, "EXPENSE", 5, None).await;
    seed_spend(&pool, "child", 30_00, "EXPENSE", 5, Some("parent")).await;

    let rows = statuses(&pool).await;
    // 70 remainder on the parent + 30 on the child = the 100 actually spent.
    assert_eq!(rows[0]["actualSpending"], json!(100.00));
}

#[tokio::test]
async fn a_parent_whose_children_exceed_it_is_not_credited_with_negative_spending() {
    // An over-allocated split would otherwise subtract from the category.
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    seed_allocation(&pool, "cb1", 500_00, "[]").await;
    seed_spend(&pool, "parent", 50_00, "EXPENSE", 5, None).await;
    seed_spend(&pool, "child", 80_00, "EXPENSE", 5, Some("parent")).await;

    let rows = statuses(&pool).await;
    assert_eq!(rows[0]["actualSpending"], json!(80.00), "the child only");
}

#[tokio::test]
async fn spending_outside_the_month_does_not_count() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    seed_allocation(&pool, "cb1", 100_00, "[]").await;
    seed_spend(&pool, "in", 10_00, "EXPENSE", 15, None).await;

    let now = avoir_api::id::now_iso();
    for (id, date) in [
        ("before", "2026-07-31T00:00:00.000Z"),
        ("after", "2026-09-01T00:00:00.000Z"),
    ] {
        sqlx::query(
            r#"INSERT INTO "Transaction" ("id","amount","netAmount","date","createdAt","type","name",
                                          "imported","isCashBack","budgetId")
               VALUES (?,99900,99900,?,?,'EXPENSE',?,0,0,'bud1')"#,
        )
        .bind(id).bind(date).bind(&now).bind(id)
        .execute(&pool).await.unwrap();
    }

    let rows = statuses(&pool).await;
    assert_eq!(rows[0]["actualSpending"], json!(10.00));
}

#[tokio::test]
async fn the_last_day_of_the_month_is_inside_it() {
    // The upper bound is exclusive on the NEXT day, so the 31st counts. An
    // off-by-one here silently drops a day of spending every month.
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    seed_allocation(&pool, "cb1", 100_00, "[]").await;
    seed_spend(&pool, "last", 42_00, "EXPENSE", 31, None).await;

    let rows = statuses(&pool).await;
    assert_eq!(rows[0]["actualSpending"], json!(42.00));
}

#[tokio::test]
async fn a_budget_done_for_the_year_is_zeroed_rather_than_shown_at_full_value() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    seed_allocation(&pool, "cb1", 100_00, "[]").await;
    sqlx::query(r#"UPDATE "CategoryBudget" SET "doneForYear" = 1 WHERE "id" = 'cb1'"#)
        .execute(&pool)
        .await
        .unwrap();

    let rows = statuses(&pool).await;
    assert_eq!(
        rows[0]["version"]["monthlyEquivalent"],
        json!(0.0),
        "so the page's totals do not include an allocation nobody can spend"
    );
}

#[tokio::test]
async fn a_seasonal_budget_out_of_season_is_zeroed_when_asked_for_and_hidden_otherwise() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    // Active in December only; the query asks about August.
    seed_allocation(&pool, "cb1", 100_00, "[12]").await;

    let shown = statuses(&pool).await;
    assert_eq!(shown.len(), 1, "includeSeasonal=true returns it");
    assert_eq!(
        shown[0]["version"]["monthlyEquivalent"],
        json!(0.0),
        "at nil"
    );

    let hidden = call(
        &pool,
        "GET",
        "/category-budgets?yearPlanId=yp1&month=8&year=2026",
        None,
    )
    .await
    .unwrap()
    .body
    .as_array()
    .unwrap()
    .clone();
    assert!(hidden.is_empty(), "hidden without includeSeasonal");
}

#[tokio::test]
async fn status_reflects_spending_against_the_allocation() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    seed_allocation(&pool, "cb1", 100_00, "[]").await;
    seed_spend(&pool, "t1", 95_00, "EXPENSE", 5, None).await;

    let rows = statuses(&pool).await;
    assert_eq!(rows[0]["status"], json!("near"));
}

/// `POST /links/bulk` answers with a per-expense `results` array.
///
/// It used to return `{ linked, budget }` — a shape invented here that matches
/// nothing the client parses. `BulkLinkResultSchema` requires `results`, so
/// creating a budget with linked expenses threw in the browser
/// (`invalid_type … path: ["results"]`) while the endpoint answered 2xx and
/// every Rust test passed.
#[tokio::test]
async fn bulk_linking_reports_a_result_per_expense() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 0.0, "MONTHLY", 1).await;
    expense(&pool, "e1", 100_00, "MONTHLY").await;
    expense(&pool, "e2", 50_00, "MONTHLY").await;

    let r = call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/links/bulk"),
        Some(json!({ "expenseIds": ["e1", "e2"] })),
    )
    .await
    .unwrap();

    assert_eq!(
        r.status, 207,
        "multi-status: rows can succeed and fail together"
    );
    let results = r.body["results"]
        .as_array()
        .expect("the client parses `results` as an array");
    assert_eq!(results.len(), 2);

    // Each success is a full link, flat, as BudgetExpenseLinkResponseSchema
    // requires — not a nested `expense` object.
    for (i, name) in ["e1", "e2"].iter().enumerate() {
        assert_eq!(results[i]["expenseId"], json!(name));
        assert_eq!(results[i]["expenseName"], json!(name));
        assert!(results[i]["monthlyEquivalent"].is_number());
        assert_eq!(results[i]["isPaused"], json!(false));
        assert_eq!(results[i]["isArchived"], json!(false));
        assert!(results[i]["categoryBudgetId"].is_string());
    }
}

/// A bad id fails its own row and leaves the rest alone.
///
/// This is why the response is an array rather than a count: the caller needs
/// to know *which* expense was refused and why.
#[tokio::test]
async fn bulk_linking_reports_failures_beside_successes() {
    let pool = db().await;
    fixture(&pool, "ACTIVE").await;
    let id = allocate(&pool, 0.0, "MONTHLY", 1).await;
    expense(&pool, "e1", 100_00, "MONTHLY").await;

    let r = call(
        &pool,
        "POST",
        &format!("/category-budgets/{id}/links/bulk"),
        Some(json!({ "expenseIds": ["e1", "nope"] })),
    )
    .await
    .unwrap();

    let results = r.body["results"].as_array().unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(
        results[0]["expenseName"],
        json!("e1"),
        "the good one linked"
    );
    assert_eq!(results[1]["expenseId"], json!("nope"));
    assert_eq!(results[1]["error"], json!("Expense not found"));

    // The failure did not abort the run.
    let after = call(
        &pool,
        "GET",
        &format!("/category-budgets/{id}?month=1"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(after.body["linkedExpenseCount"], json!(1));
}

// ═══ The ANNUAL view ═══

/// A transaction against `bud1` on an arbitrary date, for spanning months.
async fn seed_spend_on(pool: &SqlitePool, id: &str, amount: i64, date: &str) {
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","amount","netAmount","date","createdAt","type","name",
                                      "imported","isCashBack","budgetId","parentId")
           VALUES (?,?,?,?,?,'EXPENSE',?,0,0,'bud1',NULL)"#,
    )
    .bind(id)
    .bind(amount)
    .bind(amount)
    .bind(date)
    .bind(&now)
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
}

/// The annual view must report the WHOLE supplied range, not one month of it.
///
/// This shipped broken. `viewMode=ANNUAL` was used to reject the supplied
/// window as well as to disable pay-period proration, so the handler fell
/// through to the single-month branch and reported August's spending as the
/// year's. The reference has always kept the two apart:
/// `spendStart = periodStart ?? monthStart`, with `isPeriodMode` computed
/// separately.
#[tokio::test]
async fn annual_view_sums_the_whole_range_not_just_the_current_month() {
    let pool = db().await;
    let (_, _) = fixture(&pool, "ACTIVE").await;
    seed_allocation(&pool, "cb1", 50_00, "[1,2,3,4,5,6,7,8,9,10,11,12]").await;

    // Three months, three different amounts, so a wrong window cannot coincide
    // with the right answer.
    seed_spend_on(&pool, "t_mar", 10_00, "2026-03-15T00:00:00.000Z").await;
    seed_spend_on(&pool, "t_jul", 20_00, "2026-07-15T00:00:00.000Z").await;
    seed_spend_on(&pool, "t_aug", 40_00, "2026-08-15T00:00:00.000Z").await;

    let r = call(
        &pool,
        "GET",
        "/category-budgets?yearPlanId=yp1&month=8&year=2026&includeSeasonal=true\
&periodStart=2026-01-01T00:00:00.000Z&periodEnd=2026-09-01T00:00:00.000Z&viewMode=ANNUAL",
        None,
    )
    .await
    .expect("annual view");
    let rows = r.body.as_array().expect("a list").clone();
    let row = rows
        .iter()
        .find(|r| r["id"] == "cb1")
        .expect("the allocation");

    // 10 + 20 + 40 across the year. Reporting 40 means the window collapsed to
    // August, which is exactly the bug.
    assert_eq!(
        row["actualSpending"],
        json!(70.0),
        "annual view should sum the whole supplied range, not the current month"
    );
}

/// The same request WITHOUT `viewMode=ANNUAL` is a pay-period query and still
/// honours the window — proving the fix did not simply ignore `viewMode`.
#[tokio::test]
async fn a_supplied_window_is_honoured_in_period_mode_too() {
    let pool = db().await;
    let (_, _) = fixture(&pool, "ACTIVE").await;
    seed_allocation(&pool, "cb1", 50_00, "[1,2,3,4,5,6,7,8,9,10,11,12]").await;
    seed_spend_on(&pool, "t_jul", 20_00, "2026-07-15T00:00:00.000Z").await;
    seed_spend_on(&pool, "t_aug", 40_00, "2026-08-15T00:00:00.000Z").await;

    let r = call(
        &pool,
        "GET",
        "/category-budgets?yearPlanId=yp1&month=8&year=2026&includeSeasonal=true\
&periodStart=2026-07-01T00:00:00.000Z&periodEnd=2026-07-31T00:00:00.000Z",
        None,
    )
    .await
    .expect("period view");
    let rows = r.body.as_array().expect("a list").clone();
    let row = rows
        .iter()
        .find(|r| r["id"] == "cb1")
        .expect("the allocation");
    assert_eq!(row["actualSpending"], json!(20.0), "July only");
}

/// The annual view judges a year of spending against a YEAR of budget.
///
/// The card's progress bar has always drawn against `monthlyEquivalent x 12`
/// (`convertToFrequency(monthly, 'ANNUAL')`), while the backend judged status
/// against one month — so a card showed a bar at a third full and a badge
/// reading "over". Two numbers on one card, describing different periods.
#[tokio::test]
async fn annual_status_compares_against_the_year_not_one_month() {
    let pool = db().await;
    let (_, _) = fixture(&pool, "ACTIVE").await;
    // $50/month = $600/year.
    seed_allocation(&pool, "cb1", 50_00, "[1,2,3,4,5,6,7,8,9,10,11,12]").await;
    // $300 spent so far — half the annual budget, but six times a month's.
    seed_spend_on(&pool, "t1", 300_00, "2026-03-15T00:00:00.000Z").await;

    let r = call(
        &pool,
        "GET",
        "/category-budgets?yearPlanId=yp1&month=8&year=2026&includeSeasonal=true\
&periodStart=2026-01-01T00:00:00.000Z&periodEnd=2026-09-01T00:00:00.000Z&viewMode=ANNUAL",
        None,
    )
    .await
    .expect("annual view");
    let rows = r.body.as_array().expect("a list").clone();
    let row = rows
        .iter()
        .find(|r| r["id"] == "cb1")
        .expect("the allocation");

    assert_eq!(row["actualSpending"], json!(300.0));
    // Against $600 this is comfortably under. Against $50 it would be "over",
    // which is what the page used to say.
    assert_eq!(
        row["status"],
        json!("under"),
        "annual status must compare against the annual budget"
    );
}

/// The monthly view is unchanged — the annual basis must not leak into it.
#[tokio::test]
async fn monthly_status_still_compares_against_one_month() {
    let pool = db().await;
    let (_, _) = fixture(&pool, "ACTIVE").await;
    seed_allocation(&pool, "cb1", 50_00, "[1,2,3,4,5,6,7,8,9,10,11,12]").await;
    seed_spend_on(&pool, "t1", 300_00, "2026-08-15T00:00:00.000Z").await;

    let r = call(
        &pool,
        "GET",
        "/category-budgets?yearPlanId=yp1&month=8&year=2026&includeSeasonal=true",
        None,
    )
    .await
    .expect("monthly view");
    let rows = r.body.as_array().expect("a list").clone();
    let row = rows
        .iter()
        .find(|r| r["id"] == "cb1")
        .expect("the allocation");
    assert_eq!(
        row["status"],
        json!("over"),
        "$300 against $50 for the month"
    );
}

/// A seasonal budget still shows its allocation in the ANNUAL view.
///
/// Zeroing an out-of-season budget is a statement about THIS MONTH. Applied to
/// the year it dropped real allocations and real spending out of the annual
/// totals — a summer-only budget read as £0 whenever you looked in winter.
#[tokio::test]
async fn annual_view_shows_seasonal_budgets_out_of_season() {
    let pool = db().await;
    let (_, _) = fixture(&pool, "ACTIVE").await;
    // Active June–August only. The request below asks about month 12.
    seed_allocation(&pool, "cb1", 100_00, "[6,7,8]").await;
    // $500 discriminates the two bases: OVER 3 months of allowance ($300), but
    // comfortably UNDER twelve ($1,200). An amount merely "under" both would
    // pass whichever basis the code used.
    seed_spend_on(&pool, "t1", 500_00, "2026-07-15T00:00:00.000Z").await;

    let r = call(
        &pool,
        "GET",
        "/category-budgets?yearPlanId=yp1&month=12&year=2026&includeSeasonal=true\
&periodStart=2026-01-01T00:00:00.000Z&periodEnd=2027-01-01T00:00:00.000Z&viewMode=ANNUAL",
        None,
    )
    .await
    .expect("annual view");
    let rows = r.body.as_array().expect("a list").clone();
    let row = rows
        .iter()
        .find(|r| r["id"] == "cb1")
        .expect("the allocation");

    assert_eq!(
        row["version"]["monthlyEquivalent"],
        json!(100.0),
        "an out-of-season budget must keep its allocation in the annual view"
    );
    assert_eq!(
        row["actualSpending"],
        json!(500.0),
        "July's spending is in the year"
    );
    assert_eq!(
        row["status"],
        json!("over"),
        "judged against 3 active months ($300), not twelve ($1,200)"
    );
}

/// The monthly view still zeroes an out-of-season budget — the annual change
/// must not leak into the month, where "nothing to spend" is the truth.
#[tokio::test]
async fn monthly_view_still_zeroes_out_of_season() {
    let pool = db().await;
    let (_, _) = fixture(&pool, "ACTIVE").await;
    seed_allocation(&pool, "cb1", 100_00, "[6,7,8]").await;

    let r = call(
        &pool,
        "GET",
        "/category-budgets?yearPlanId=yp1&month=12&year=2026&includeSeasonal=true",
        None,
    )
    .await
    .expect("monthly view");
    let rows = r.body.as_array().expect("a list").clone();
    let row = rows
        .iter()
        .find(|r| r["id"] == "cb1")
        .expect("the allocation");
    assert_eq!(
        row["version"]["monthlyEquivalent"],
        json!(0.0),
        "December is out of season: nothing to spend"
    );
}
