//! `/expenses` and `/income` through the dispatcher.
//!
//! The lifecycle is the interesting part: four states across two independent
//! nullable timestamps, each with its own effect on the generated schedule.
//! Most of these assert the schedule side effect rather than the record, since
//! that is where the rules actually bite.

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

async fn fixture(pool: &SqlitePool) {
    let now = avoir_api::id::now_iso();
    sqlx::query(r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt") VALUES ('bg1','Bills','#000',?)"#)
        .bind(&now).execute(pool).await.unwrap();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
           VALUES ('bud1','Housing',0,?,'bg1',0)"#,
    )
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
}

async fn make_expense(pool: &SqlitePool, name: &str, amount: f64) -> String {
    let r = call(
        pool,
        "POST",
        "/expenses",
        Some(json!({
            "name": name, "amount": amount, "frequency": "MONTHLY",
            "budgetId": "bud1", "dueDay": 1
        })),
    )
    .await
    .expect("create expense");
    r.body["id"].as_str().unwrap().to_string()
}

/// Seed schedule rows in each status, so a test can prove which ones a
/// lifecycle action touches and — just as importantly — which it leaves.
async fn seed_schedule(pool: &SqlitePool, source_type: &str, source_id: &str) {
    let now = avoir_api::id::now_iso();
    for (i, status) in ["PENDING", "SNOOZED", "PAID", "SKIPPED"].iter().enumerate() {
        sqlx::query(
            r#"INSERT INTO "ScheduledTransaction"
                 ("id","sourceType","sourceId","dueDate","expectedAmount","status","createdAt","updatedAt")
               VALUES (?,?,?,?,10000,?,?,?)"#,
        )
        .bind(format!("sch_{status}_{source_id}"))
        .bind(source_type)
        .bind(source_id)
        .bind(format!("2026-0{}-01T00:00:00.000Z", i + 1))
        .bind(status)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();
    }
}

async fn statuses(pool: &SqlitePool, source_id: &str) -> Vec<String> {
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"SELECT "status" FROM "ScheduledTransaction" WHERE "sourceId" = ? ORDER BY "dueDate""#,
    )
    .bind(source_id)
    .fetch_all(pool)
    .await
    .unwrap();
    rows.into_iter().map(|r| r.0).collect()
}

#[tokio::test]
async fn an_expense_round_trips_with_money_as_cents() {
    let pool = db().await;
    fixture(&pool).await;

    let r = call(
        &pool,
        "POST",
        "/expenses",
        Some(json!({
            "name": "Rent", "amount": 1500.50, "frequency": "MONTHLY",
            "budgetId": "bud1", "dueDay": 1, "isAutomatic": true
        })),
    )
    .await
    .unwrap();

    assert_eq!(r.status, 201);
    assert_eq!(r.body["amount"], json!(1500.50));
    assert_eq!(r.body["isAutomatic"], json!(true), "a real boolean");
    assert_eq!(r.body["dueDay"], json!(1));

    let stored: i64 = sqlx::query_scalar(r#"SELECT "amount" FROM "Expense" WHERE "id" = ?"#)
        .bind(r.body["id"].as_str().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored, 150050, "integer cents");
}

#[tokio::test]
async fn the_list_hides_archived_items_unless_asked() {
    let pool = db().await;
    fixture(&pool).await;
    let keep = make_expense(&pool, "Active", 100.0).await;
    let gone = make_expense(&pool, "Archived", 200.0).await;
    call(&pool, "POST", &format!("/expenses/{gone}/archive"), None)
        .await
        .unwrap();

    let active = call(&pool, "GET", "/expenses", None).await.unwrap();
    let ids: Vec<&str> = active
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec![keep.as_str()], "archived is hidden by default");

    let archived = call(&pool, "GET", "/expenses?archived=true", None)
        .await
        .unwrap();
    let ids: Vec<&str> = archived
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec![gone.as_str()], "and reachable on request");
}

#[tokio::test]
async fn archiving_skips_pending_rows_and_leaves_history_alone() {
    let pool = db().await;
    fixture(&pool).await;
    let id = make_expense(&pool, "Rent", 1500.0).await;
    seed_schedule(&pool, "EXPENSE", &id).await;

    call(&pool, "POST", &format!("/expenses/{id}/archive"), None)
        .await
        .unwrap();

    // PENDING becomes SKIPPED — the occurrence was expected and consciously
    // not paid. PAID is history and SKIPPED was already a deliberate choice;
    // rewriting either would be falsifying the record.
    assert_eq!(
        statuses(&pool, &id).await,
        vec!["SKIPPED", "SNOOZED", "PAID", "SKIPPED"]
    );
}

#[tokio::test]
async fn archiving_unlinks_the_expense_from_its_budget() {
    let pool = db().await;
    fixture(&pool).await;
    let id = make_expense(&pool, "Rent", 1500.0).await;

    let now = avoir_api::id::now_iso();
    // BudgetExpenseLink → CategoryBudget → YearPlan is a real FK chain, so the
    // link cannot be conjured on its own.
    sqlx::query(
        r#"INSERT INTO "YearPlan" ("id","year","status","createdAt","updatedAt")
                   VALUES ('yp1',2026,'ACTIVE',?,?)"#,
    )
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(r#"INSERT INTO "CategoryBudget"
                     ("id","yearPlanId","budgetId","createdAt","updatedAt","highWaterMark","doneForYear")
                   VALUES ('cb1','yp1','bud1',?,?,0,0)"#)
        .bind(&now).bind(&now).execute(&pool).await.unwrap();
    sqlx::query(
        r#"INSERT INTO "BudgetExpenseLink" ("id","expenseId","categoryBudgetId","createdAt")
           VALUES ('link1',?,'cb1',?)"#,
    )
    .bind(&id)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let before = call(&pool, "GET", &format!("/expenses/{id}"), None)
        .await
        .unwrap();
    assert_eq!(before.body["isLinkedToBudget"], json!(true));

    call(&pool, "POST", &format!("/expenses/{id}/archive"), None)
        .await
        .unwrap();

    // An archived expense must stop shaping the budget baseline. Leaving the
    // link makes an invisible item keep influencing a visible number.
    let after = call(&pool, "GET", &format!("/expenses/{id}"), None)
        .await
        .unwrap();
    assert_eq!(after.body["isLinkedToBudget"], json!(false));
}

#[tokio::test]
async fn an_archived_expense_refuses_deletion_until_restored() {
    let pool = db().await;
    fixture(&pool).await;
    let id = make_expense(&pool, "Rent", 1500.0).await;
    call(&pool, "POST", &format!("/expenses/{id}/archive"), None)
        .await
        .unwrap();

    // ADR-004: the refusal forces the irreversible step to be a separate,
    // deliberate decision from the reversible one.
    let err = call(&pool, "DELETE", &format!("/expenses/{id}"), None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 409);

    call(&pool, "POST", &format!("/expenses/{id}/restore"), None)
        .await
        .unwrap();
    let r = call(&pool, "DELETE", &format!("/expenses/{id}"), None)
        .await
        .unwrap();
    assert_eq!(r.status, 204);
}

#[tokio::test]
async fn archive_and_restore_are_not_idempotent_they_report_state() {
    let pool = db().await;
    fixture(&pool).await;
    let id = make_expense(&pool, "Rent", 1500.0).await;

    // Restoring something that is not archived is a client-state error. A
    // silent success would let a stale UI believe it had changed something.
    let err = call(&pool, "POST", &format!("/expenses/{id}/restore"), None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 409);

    call(&pool, "POST", &format!("/expenses/{id}/archive"), None)
        .await
        .unwrap();
    let err = call(&pool, "POST", &format!("/expenses/{id}/archive"), None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 409, "already archived");
}

#[tokio::test]
async fn pausing_clears_pending_and_snoozed_because_dates_moved() {
    let pool = db().await;
    fixture(&pool).await;
    let id = make_expense(&pool, "Gym", 40.0).await;
    seed_schedule(&pool, "EXPENSE", &id).await;

    call(
        &pool,
        "POST",
        &format!("/expenses/{id}/pause"),
        Some(json!({ "duration": 2, "unit": "months" })),
    )
    .await
    .unwrap();

    // A snooze points at a specific due date. Pausing moves which occurrences
    // exist at all, so a surviving snooze would reference an occurrence that
    // no longer does.
    assert_eq!(statuses(&pool, &id).await, vec!["PAID", "SKIPPED"]);
}

#[tokio::test]
async fn resuming_requires_being_paused() {
    let pool = db().await;
    fixture(&pool).await;
    let id = make_expense(&pool, "Gym", 40.0).await;

    let err = call(
        &pool,
        "POST",
        &format!("/expenses/{id}/resume"),
        Some(json!({})),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);

    call(
        &pool,
        "POST",
        &format!("/expenses/{id}/pause"),
        Some(json!({ "duration": 2, "unit": "months" })),
    )
    .await
    .unwrap();
    let r = call(
        &pool,
        "POST",
        &format!("/expenses/{id}/resume"),
        Some(json!({})),
    )
    .await
    .unwrap();
    assert_eq!(r.body["pausedUntil"], json!(null));
}

#[tokio::test]
async fn resuming_immediately_moves_the_start_date_to_today() {
    let pool = db().await;
    fixture(&pool).await;
    let id = make_expense(&pool, "Gym", 40.0).await;
    call(
        &pool,
        "POST",
        &format!("/expenses/{id}/pause"),
        Some(json!({ "duration": 2, "unit": "months" })),
    )
    .await
    .unwrap();

    let r = call(
        &pool,
        "POST",
        &format!("/expenses/{id}/resume"),
        Some(json!({ "immediately": true })),
    )
    .await
    .unwrap();

    let start = r.body["startDate"].as_str().expect("startDate set");
    assert!(
        start.ends_with("T00:00:00.000Z"),
        "stored at UTC midnight: {start}"
    );
}

#[tokio::test]
async fn an_amount_edit_clears_pending_but_spares_the_snooze() {
    let pool = db().await;
    fixture(&pool).await;
    let id = make_expense(&pool, "Gym", 40.0).await;
    seed_schedule(&pool, "EXPENSE", &id).await;

    call(
        &pool,
        "PUT",
        &format!("/expenses/{id}"),
        Some(json!({ "amount": 55.0 })),
    )
    .await
    .unwrap();

    // The amount changed but the dates did not, so the user's "not now" still
    // refers to a real occurrence and is left standing.
    assert_eq!(
        statuses(&pool, &id).await,
        vec!["SNOOZED", "PAID", "SKIPPED"]
    );
}

#[tokio::test]
async fn a_date_edit_clears_the_snooze_too() {
    let pool = db().await;
    fixture(&pool).await;
    let id = make_expense(&pool, "Gym", 40.0).await;
    seed_schedule(&pool, "EXPENSE", &id).await;

    call(
        &pool,
        "PUT",
        &format!("/expenses/{id}"),
        Some(json!({ "dueDay": 15 })),
    )
    .await
    .unwrap();

    assert_eq!(statuses(&pool, &id).await, vec!["PAID", "SKIPPED"]);
}

#[tokio::test]
async fn an_update_leaves_unmentioned_fields_alone() {
    let pool = db().await;
    fixture(&pool).await;
    let r = call(
        &pool,
        "POST",
        "/expenses",
        Some(json!({
            "name": "Rent", "amount": 1500.0, "frequency": "MONTHLY",
            "budgetId": "bud1", "dueDay": 1, "isAutomatic": true, "note": "keep me"
        })),
    )
    .await
    .unwrap();
    let id = r.body["id"].as_str().unwrap().to_string();

    let up = call(
        &pool,
        "PUT",
        &format!("/expenses/{id}"),
        Some(json!({ "name": "Rent v2" })),
    )
    .await
    .unwrap();

    assert_eq!(up.body["name"], json!("Rent v2"));
    assert_eq!(up.body["amount"], json!(1500.0));
    assert_eq!(up.body["dueDay"], json!(1));
    assert_eq!(up.body["isAutomatic"], json!(true));
    assert_eq!(up.body["note"], json!("keep me"));
}

#[tokio::test]
async fn clearing_a_field_differs_from_omitting_it() {
    let pool = db().await;
    fixture(&pool).await;
    let r = call(
        &pool,
        "POST",
        "/expenses",
        Some(json!({
            "name": "Rent", "amount": 1500.0, "frequency": "MONTHLY",
            "budgetId": "bud1", "dueDay": 1, "note": "original"
        })),
    )
    .await
    .unwrap();
    let id = r.body["id"].as_str().unwrap().to_string();

    // Explicit null means "clear it"; a plain Option could not tell these
    // apart, and removing a note is a real thing a user does.
    let up = call(
        &pool,
        "PUT",
        &format!("/expenses/{id}"),
        Some(json!({ "note": null })),
    )
    .await
    .unwrap();
    assert_eq!(up.body["note"], json!(null));
}

#[tokio::test]
async fn the_debt_link_is_a_reverse_lookup_not_a_column() {
    let pool = db().await;
    fixture(&pool).await;
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "Debt" ("id","name","type","originalBalance","currentBalance","apr",
                               "minimumPayment","frequency","startDate","paidOff",
                               "escrowEnabled","createdAt","updatedAt")
           VALUES ('debt1','Car','AUTO',2000000,1500000,500,35000,'MONTHLY',
                   '2024-01-01T00:00:00.000Z',0,0,?,?)"#,
    )
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let r = call(
        &pool,
        "POST",
        "/expenses",
        Some(json!({
            "name": "Car Payment", "amount": 350.0, "frequency": "MONTHLY",
            "budgetId": "bud1", "dueDay": 5, "linkedDebtId": "debt1"
        })),
    )
    .await
    .unwrap();
    let id = r.body["id"].as_str().unwrap();

    // ADR-010: there is no linkedDebtId column on Expense. The FK lives on
    // Debt and is read back, because a bidirectional FK is a circular
    // dependency with an insert-ordering problem.
    assert_eq!(r.body["linkedDebtId"], json!("debt1"));
    let stored: Option<String> =
        sqlx::query_scalar(r#"SELECT "linkedExpenseId" FROM "Debt" WHERE "id" = 'debt1'"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored.as_deref(), Some(id));
}

#[tokio::test]
async fn income_shares_the_lifecycle() {
    let pool = db().await;
    fixture(&pool).await;

    let r = call(
        &pool,
        "POST",
        "/income",
        Some(json!({
            "name": "Salary", "amount": 5000.00, "frequency": "BIWEEKLY", "budgetId": "bud1"
        })),
    )
    .await
    .unwrap();
    assert_eq!(r.status, 201);
    assert_eq!(r.body["amount"], json!(5000.00));
    let id = r.body["id"].as_str().unwrap().to_string();

    seed_schedule(&pool, "INCOME", &id).await;
    call(&pool, "POST", &format!("/income/{id}/archive"), None)
        .await
        .unwrap();
    assert_eq!(
        statuses(&pool, &id).await,
        vec!["SKIPPED", "SNOOZED", "PAID", "SKIPPED"]
    );

    let err = call(&pool, "DELETE", &format!("/income/{id}"), None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 409, "archived income also refuses deletion");
}

#[tokio::test]
async fn income_requires_a_positive_amount() {
    let pool = db().await;
    fixture(&pool).await;

    // An expense may legitimately be zero; income of zero is not income.
    let err = call(
        &pool,
        "POST",
        "/income",
        Some(json!({ "name": "Nothing", "amount": 0, "frequency": "MONTHLY", "budgetId": "bud1" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);

    let ok = call(
        &pool,
        "POST",
        "/expenses",
        Some(json!({ "name": "Free", "amount": 0, "frequency": "MONTHLY", "budgetId": "bud1" })),
    )
    .await;
    assert!(ok.is_ok(), "a zero expense is allowed");
}

#[tokio::test]
async fn deleting_skips_its_pending_rows_first() {
    let pool = db().await;
    fixture(&pool).await;
    let id = make_expense(&pool, "Gone", 10.0).await;
    seed_schedule(&pool, "EXPENSE", &id).await;

    call(&pool, "DELETE", &format!("/expenses/{id}"), None)
        .await
        .unwrap();

    // The source is gone but its schedule history survives, marked SKIPPED
    // rather than deleted — the occurrences genuinely happened and were not
    // paid.
    assert_eq!(
        statuses(&pool, &id).await,
        vec!["SKIPPED", "SNOOZED", "PAID", "SKIPPED"]
    );
}

#[tokio::test]
async fn missing_records_are_404_across_the_lifecycle() {
    let pool = db().await;
    fixture(&pool).await;
    let missing = "cmissingexpenseid0000000";

    for (method, suffix) in [
        ("GET", ""),
        ("PUT", ""),
        ("DELETE", ""),
        ("POST", "/pause"),
        ("POST", "/resume"),
        ("POST", "/archive"),
        ("POST", "/restore"),
    ] {
        let body = if method == "PUT" {
            Some(json!({ "name": "x" }))
        } else {
            Some(json!({}))
        };
        let err = call(&pool, method, &format!("/expenses/{missing}{suffix}"), body)
            .await
            .err()
            .unwrap_or_else(|| panic!("{method} /expenses/:id{suffix} should 404"));
        assert_eq!(err.status, 404, "{method} {suffix}");
    }
}

#[tokio::test]
async fn a_missing_required_field_is_a_400_not_a_database_error() {
    let pool = db().await;
    fixture(&pool).await;

    // serde(default) turns a missing required field into an empty string
    // rather than a parse error, so without an explicit check these reach
    // SQLite and fail there — a CHECK violation on frequency, an FK violation
    // on budgetId — surfacing as a 500 that blames the server for a bad request.
    for missing in ["frequency", "budgetId"] {
        let mut body = json!({ "name": "Thing", "amount": 10.0,
                               "frequency": "MONTHLY", "budgetId": "bud1" });
        body.as_object_mut().unwrap().remove(missing);

        let err = call(&pool, "POST", "/expenses", Some(body))
            .await
            .unwrap_err();
        assert_eq!(err.status, 400, "missing {missing} should be a 400");
        assert!(err.details.is_some(), "and should name the field");
    }
}
