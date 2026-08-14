//! `/scheduled-transactions` — fulfilling, deferring and dismissing an
//! expected occurrence.

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

/// An account, a budget, a monthly expense, and one PENDING occurrence for it.
async fn fixture(pool: &SqlitePool) -> (String, String) {
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

    let acct = call(
        pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Checking", "type": "Checking", "balance": 5000.00 })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    sqlx::query(
        r#"INSERT INTO "Expense" ("id","name","amount","frequency","budgetId","accountId",
                                  "isAutomatic","dueDay","skipWeekend","createdAt","updatedAt")
           VALUES ('exp1','Rent',150000,'MONTHLY','bud1',?,0,1,0,?,?)"#,
    )
    .bind(&acct)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO "ScheduledTransaction"
             ("id","sourceType","sourceId","dueDate","expectedAmount","status","expenseId",
              "createdAt","updatedAt")
           VALUES ('sch1','EXPENSE','exp1','2026-03-01T00:00:00.000Z',150000,'PENDING','exp1',?,?)"#,
    ).bind(&now).bind(&now).execute(pool).await.unwrap();

    (acct, "sch1".to_string())
}

async fn row(pool: &SqlitePool, id: &str) -> (String, Option<String>, Option<i64>) {
    sqlx::query_as(
        r#"SELECT "status", "transactionId", "actualAmount" FROM "ScheduledTransaction" WHERE "id" = ?"#,
    ).bind(id).fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn paying_creates_the_transaction_and_moves_the_balance() {
    let pool = db().await;
    let (acct, sch) = fixture(&pool).await;

    let r = call(
        &pool,
        "POST",
        &format!("/scheduled-transactions/{sch}/pay"),
        Some(json!({})),
    )
    .await
    .unwrap();

    assert_eq!(r.status, 201);
    assert_eq!(
        r.body["amount"],
        json!(1500.00),
        "defaults to the expected amount"
    );
    assert_eq!(r.body["name"], json!("Rent"), "named from the source");
    assert_eq!(
        r.body["budgetId"],
        json!("bud1"),
        "categorised from the source"
    );
    assert_eq!(
        r.body["accountId"],
        json!(acct),
        "funded from the source's account"
    );

    let (status, tx_id, actual) = row(&pool, &sch).await;
    assert_eq!(status, "PAID");
    assert_eq!(actual, Some(150000));
    assert_eq!(
        tx_id.as_deref(),
        r.body["id"].as_str(),
        "the occurrence points at its transaction"
    );

    let acc = call(&pool, "GET", &format!("/accounts/{acct}"), None)
        .await
        .unwrap();
    assert_eq!(acc.body["balance"], json!(3500.00), "5000 − 1500");

    let mut conn = pool.acquire().await.unwrap();
    assert!(avoir_db::balance::check_invariant(&mut conn)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn a_late_payment_records_the_occurrence_it_satisfies() {
    let pool = db().await;
    let (_, sch) = fixture(&pool).await;

    // Paid on the 9th; the bill was due on the 1st.
    let r = call(
        &pool,
        "POST",
        &format!("/scheduled-transactions/{sch}/pay"),
        Some(json!({ "date": "2026-03-09T00:00:00.000Z" })),
    )
    .await
    .unwrap();
    let id = r.body["id"].as_str().unwrap();

    let (date, occurrence): (String, Option<String>) =
        sqlx::query_as(r#"SELECT "date", "occurrenceDate" FROM "Transaction" WHERE "id" = ?"#)
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();

    // ADR-001. `date` is when money moved; `occurrenceDate` is which expected
    // occurrence it fulfils. Without the second, a payment made after the due
    // date cannot be matched to the bill and mark-as-paid silently fails on
    // anything overdue.
    assert_eq!(date, "2026-03-09T00:00:00.000Z");
    assert_eq!(occurrence.as_deref(), Some("2026-03-01T00:00:00.000Z"));
}

#[tokio::test]
async fn underpaying_marks_partial_not_paid() {
    let pool = db().await;
    let (_, sch) = fixture(&pool).await;

    call(
        &pool,
        "POST",
        &format!("/scheduled-transactions/{sch}/pay"),
        Some(json!({ "amount": 500.00 })),
    )
    .await
    .unwrap();

    // A short payment must stay visible. Closing it as PAID would hide the
    // outstanding remainder behind a satisfied-looking occurrence.
    let (status, _, actual) = row(&pool, &sch).await;
    assert_eq!(status, "PARTIAL");
    assert_eq!(actual, Some(50000));
}

#[tokio::test]
async fn overpaying_still_marks_paid() {
    let pool = db().await;
    let (_, sch) = fixture(&pool).await;

    call(
        &pool,
        "POST",
        &format!("/scheduled-transactions/{sch}/pay"),
        Some(json!({ "amount": 1600.00 })),
    )
    .await
    .unwrap();

    let (status, _, actual) = row(&pool, &sch).await;
    assert_eq!(
        status, "PAID",
        "the threshold is >= expected, not == expected"
    );
    assert_eq!(actual, Some(160000));
}

#[tokio::test]
async fn paying_can_be_funded_from_a_different_account() {
    let pool = db().await;
    let (source, sch) = fixture(&pool).await;
    let other = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Savings", "type": "Savings", "balance": 9000.00 })),
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
        &format!("/scheduled-transactions/{sch}/pay"),
        Some(json!({ "accountId": other })),
    )
    .await
    .unwrap();

    let a = call(&pool, "GET", &format!("/accounts/{source}"), None)
        .await
        .unwrap();
    assert_eq!(
        a.body["balance"],
        json!(5000.00),
        "the default account is untouched"
    );
    let b = call(&pool, "GET", &format!("/accounts/{other}"), None)
        .await
        .unwrap();
    assert_eq!(b.body["balance"], json!(7500.00), "9000 − 1500");
}

#[tokio::test]
async fn a_paid_occurrence_refuses_every_further_action() {
    let pool = db().await;
    let (_, sch) = fixture(&pool).await;
    call(
        &pool,
        "POST",
        &format!("/scheduled-transactions/{sch}/pay"),
        Some(json!({})),
    )
    .await
    .unwrap();

    // Paying twice would create a second transaction and move the balance
    // again, so these are conflicts rather than idempotent no-ops.
    for (suffix, body) in [
        ("pay", Some(json!({}))),
        ("snooze", Some(json!({ "days": 3 }))),
        ("skip", None),
    ] {
        let err = call(
            &pool,
            "POST",
            &format!("/scheduled-transactions/{sch}/{suffix}"),
            body,
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, 409, "{suffix} on a paid occurrence");
    }
}

#[tokio::test]
async fn snoozing_defers_by_whole_days_at_utc_midnight() {
    let pool = db().await;
    let (_, sch) = fixture(&pool).await;

    let r = call(
        &pool,
        "POST",
        &format!("/scheduled-transactions/{sch}/snooze"),
        Some(json!({ "days": 7 })),
    )
    .await
    .unwrap();

    assert_eq!(r.body["status"], json!("SNOOZED"));
    let until = r.body["snoozedUntil"].as_str().expect("snoozedUntil set");
    assert!(until.ends_with("T00:00:00.000Z"), "UTC midnight: {until}");

    let expected = crate_date(7);
    assert_eq!(until, expected, "exactly seven days out");
}

fn crate_date(days: i64) -> String {
    // The handler snoozes from the user's calendar day, so the expectation has
    // to be built from the same one. Against `Utc::now()` this was off by a day
    // for the five hours either side of midnight UTC.
    let d = avoir_core::dates::today() + chrono::Duration::days(days);
    d.format("%Y-%m-%dT00:00:00.000Z").to_string()
}

#[tokio::test]
async fn skipping_leaves_no_transaction_behind() {
    let pool = db().await;
    let (acct, sch) = fixture(&pool).await;

    let r = call(
        &pool,
        "POST",
        &format!("/scheduled-transactions/{sch}/skip"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.body["status"], json!("SKIPPED"));

    let (_, tx_id, actual) = row(&pool, &sch).await;
    assert_eq!(tx_id, None, "skipping is a decision, not a payment");
    assert_eq!(actual, None);

    let acc = call(&pool, "GET", &format!("/accounts/{acct}"), None)
        .await
        .unwrap();
    assert_eq!(acc.body["balance"], json!(5000.00), "balance untouched");
}

#[tokio::test]
async fn income_is_paid_into_the_account_and_linked_back() {
    let pool = db().await;
    let (acct, _) = fixture(&pool).await;
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "Income" ("id","name","amount","frequency","budgetId","accountId",
                                 "createdAt","updatedAt")
           VALUES ('inc1','Salary',300000,'BIWEEKLY','bud1',?,?,?)"#,
    )
    .bind(&acct)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "ScheduledTransaction"
             ("id","sourceType","sourceId","dueDate","expectedAmount","status","incomeId",
              "createdAt","updatedAt")
           VALUES ('sch2','INCOME','inc1','2026-03-15T00:00:00.000Z',300000,'PENDING','inc1',?,?)"#,
    )
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let r = call(
        &pool,
        "POST",
        "/scheduled-transactions/sch2/pay",
        Some(json!({})),
    )
    .await
    .unwrap();

    assert_eq!(r.body["type"], json!("INCOME"));
    assert_eq!(
        r.body["incomeId"],
        json!("inc1"),
        "the row points back at its source"
    );

    // Income ADDS to the balance where an expense subtracts.
    let acc = call(&pool, "GET", &format!("/accounts/{acct}"), None)
        .await
        .unwrap();
    assert_eq!(acc.body["balance"], json!(8000.00), "5000 + 3000");
}

#[tokio::test]
async fn a_missing_occurrence_is_a_404() {
    let pool = db().await;
    fixture(&pool).await;
    let missing = "cmissingscheduled0000000";

    for (suffix, body) in [
        ("pay", Some(json!({}))),
        ("snooze", Some(json!({ "days": 1 }))),
        ("skip", None),
    ] {
        let err = call(
            &pool,
            "POST",
            &format!("/scheduled-transactions/{missing}/{suffix}"),
            body,
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, 404, "{suffix}");
    }
}

// ─── GET / — the lazy generator (ADR-024) ───

async fn schedule(pool: &SqlitePool, from: &str, to: &str) -> Vec<Value> {
    call(
        pool,
        "GET",
        &format!("/scheduled-transactions?periodStart={from}&periodEnd={to}"),
        None,
    )
    .await
    .expect("schedule")
    .body
    .as_array()
    .unwrap()
    .clone()
}

#[tokio::test]
async fn the_schedule_materialises_occurrences_on_read() {
    let pool = db().await;
    fixture(&pool).await;
    // fixture() seeds one PENDING row for March; the generator adds the rest.
    let rows = schedule(&pool, "2026-01-01", "2026-06-30").await;
    assert!(
        rows.len() >= 5,
        "monthly rent across six months, got {}",
        rows.len()
    );
    assert!(rows.iter().all(|r| r["sourceId"] == json!("exp1")));
    assert_eq!(rows[0]["expectedAmount"], json!(1500.00));
}

#[tokio::test]
async fn regenerating_keeps_every_row_id_stable() {
    let pool = db().await;
    fixture(&pool).await;

    let first = schedule(&pool, "2026-01-01", "2026-06-30").await;
    let ids_before: Vec<&str> = first.iter().map(|r| r["id"].as_str().unwrap()).collect();

    let second = schedule(&pool, "2026-01-01", "2026-06-30").await;
    let ids_after: Vec<&str> = second.iter().map(|r| r["id"].as_str().unwrap()).collect();

    // ADR-024. The original deleted and recreated every PENDING row on each
    // GET, so a client holding a rendered row's id got a 404 from
    // mark-as-paid once anything else regenerated the schedule. Churning ids
    // is the bug; identical ids are the fix.
    assert_eq!(ids_before, ids_after, "regeneration must not churn ids");
}

#[tokio::test]
async fn an_id_held_across_a_regeneration_can_still_be_paid() {
    let pool = db().await;
    let (acct, _) = fixture(&pool).await;
    let rows = schedule(&pool, "2026-04-01", "2026-04-30").await;
    let held = rows[0]["id"].as_str().unwrap().to_string();

    // Something else regenerates — exactly the race that produced the 404.
    schedule(&pool, "2026-01-01", "2026-12-31").await;

    let r = call(
        &pool,
        "POST",
        &format!("/scheduled-transactions/{held}/pay"),
        Some(json!({})),
    )
    .await
    .expect("the held id is still payable");
    assert_eq!(r.status, 201);
    let _ = acct;
}

#[tokio::test]
async fn paid_partial_skipped_and_snoozed_all_survive_regeneration() {
    let pool = db().await;
    fixture(&pool).await;
    let now = avoir_api::id::now_iso();
    for (i, status) in ["PAID", "PARTIAL", "SKIPPED", "SNOOZED"].iter().enumerate() {
        sqlx::query(
            r#"INSERT INTO "ScheduledTransaction"
                 ("id","sourceType","sourceId","dueDate","expectedAmount","status",
                  "createdAt","updatedAt")
               VALUES (?,'EXPENSE','exp1',?,150000,?,?,?)"#,
        )
        .bind(format!("keep_{status}"))
        .bind(format!("2026-0{}-01T00:00:00.000Z", i + 6))
        .bind(status)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();
    }

    schedule(&pool, "2026-01-01", "2026-12-31").await;

    // History (PAID/PARTIAL) and deliberate choices (SKIPPED/SNOOZED) are
    // never touched — only PENDING rows are the generator's to manage.
    for status in ["PAID", "PARTIAL", "SKIPPED", "SNOOZED"] {
        let found: i64 =
            sqlx::query_scalar(r#"SELECT COUNT(*) FROM "ScheduledTransaction" WHERE "id" = ?"#)
                .bind(format!("keep_{status}"))
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(found, 1, "{status} row was removed");
    }
}

#[tokio::test]
async fn a_fulfilled_month_does_not_get_a_second_row_when_the_due_date_moves() {
    let pool = db().await;
    fixture(&pool).await;
    let now = avoir_api::id::now_iso();
    // The April bill was paid on the 9th, not the 1st the expense says.
    sqlx::query(
        r#"INSERT INTO "ScheduledTransaction"
             ("id","sourceType","sourceId","dueDate","expectedAmount","status",
              "createdAt","updatedAt")
           VALUES ('paid_apr','EXPENSE','exp1','2026-04-09T00:00:00.000Z',150000,'PAID',?,?)"#,
    )
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let rows = schedule(&pool, "2026-04-01", "2026-04-30").await;

    // Without month-level dedup the 1st would reappear as still owing beside
    // the row that was already paid on the 9th.
    assert_eq!(rows.len(), 1, "one occurrence for April, got {rows:?}");
    assert_eq!(rows[0]["status"], json!("PAID"));
}

#[tokio::test]
async fn a_stale_pending_row_is_pruned_when_the_due_day_moves() {
    let pool = db().await;
    fixture(&pool).await;
    schedule(&pool, "2026-05-01", "2026-05-31").await;
    let before: Vec<(String,)> = sqlx::query_as(
        r#"SELECT "dueDate" FROM "ScheduledTransaction" WHERE "dueDate" LIKE '2026-05%'"#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(before.len(), 1);
    assert!(before[0].0.starts_with("2026-05-01"));

    // Move the bill to the 20th.
    call(
        &pool,
        "PUT",
        "/expenses/exp1",
        Some(json!({ "dueDay": 20 })),
    )
    .await
    .unwrap();
    schedule(&pool, "2026-05-01", "2026-05-31").await;

    let after: Vec<(String,)> = sqlx::query_as(
        r#"SELECT "dueDate" FROM "ScheduledTransaction" WHERE "dueDate" LIKE '2026-05%'"#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    // The old date is gone rather than lingering beside the new one.
    assert_eq!(after.len(), 1, "stale PENDING row not pruned: {after:?}");
    assert!(after[0].0.starts_with("2026-05-20"));
}

#[tokio::test]
async fn a_utility_reading_supplies_both_the_amount_and_the_due_date() {
    let pool = db().await;
    fixture(&pool).await;
    let pid = call(
        &pool,
        "POST",
        "/utilities/providers",
        Some(json!({ "name": "Metro Power" })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();
    let sid = call(
        &pool,
        "POST",
        &format!("/utilities/providers/{pid}/services"),
        Some(json!({ "serviceType": "ELECTRIC", "metering": "METERED" })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();
    call(
        &pool,
        "PUT",
        &format!("/utilities/services/{sid}/link"),
        Some(json!({ "expenseId": "exp1" })),
    )
    .await
    .unwrap();
    call(
        &pool,
        "POST",
        "/utilities/readings",
        Some(json!({
            "serviceId": sid, "billDate": "2026-06-25T00:00:00.000Z",
            "dueDate": "2026-07-07T00:00:00.000Z", "cost": 212.44
        })),
    )
    .await
    .unwrap();

    let rows = schedule(&pool, "2026-07-01", "2026-07-31").await;

    // A metered bill is a different figure and a different date every month,
    // so the reading beats the expense's stored amount and its generic dueDay.
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["expectedAmount"], json!(212.44));
    assert_eq!(rows[0]["dueDate"], json!("2026-07-07T00:00:00.000Z"));
}

#[tokio::test]
async fn a_paused_expense_produces_nothing() {
    let pool = db().await;
    fixture(&pool).await;
    call(
        &pool,
        "POST",
        "/expenses/exp1/pause",
        Some(json!({ "indefinite": true })),
    )
    .await
    .unwrap();

    let rows = schedule(&pool, "2026-05-01", "2026-05-31").await;
    assert!(rows.is_empty(), "a paused item is not due");
}

#[tokio::test]
async fn a_pause_that_has_expired_stops_suppressing() {
    let pool = db().await;
    fixture(&pool).await;

    // A pause is a DURATION. The generator used to suppress on `pausedUntil IS
    // NOT NULL`, which made every pause permanent — "pause for 2 months" hid
    // the item until someone remembered to resume it. Nothing noticed, because
    // pausing was itself a no-op until the differential write harness found it.
    //
    // Written directly rather than through the endpoint because the endpoint
    // only computes dates forward from today, and an already-expired pause is
    // exactly the state under test.
    sqlx::query(
        r#"UPDATE "Expense" SET "pausedUntil" = '2020-01-01T00:00:00.000Z' WHERE "id" = 'exp1'"#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let rows = schedule(&pool, "2026-05-01", "2026-05-31").await;
    assert!(
        !rows.is_empty(),
        "the pause ended in 2020; the item is due again"
    );
}

#[tokio::test]
async fn the_window_is_required() {
    let pool = db().await;
    fixture(&pool).await;
    let err = call(&pool, "GET", "/scheduled-transactions", None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn the_generator_prunes_a_stale_pending_row_it_did_not_create() {
    let pool = db().await;
    fixture(&pool).await;
    let now = avoir_api::id::now_iso();
    // A PENDING row on a date no occurrence computes to. Inserted directly,
    // because editing the expense would clear it via schedule invalidation —
    // which is a DIFFERENT mechanism, and testing through it proves nothing
    // about the prune.
    sqlx::query(
        r#"INSERT INTO "ScheduledTransaction"
             ("id","sourceType","sourceId","dueDate","expectedAmount","status",
              "createdAt","updatedAt")
           VALUES ('ghost','EXPENSE','exp1','2026-05-17T00:00:00.000Z',150000,'PENDING',?,?)"#,
    )
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    schedule(&pool, "2026-05-01", "2026-05-31").await;

    let left: i64 =
        sqlx::query_scalar(r#"SELECT COUNT(*) FROM "ScheduledTransaction" WHERE "id" = 'ghost'"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        left, 0,
        "a PENDING row with no matching occurrence is pruned"
    );

    // And the real occurrence for that month is still there.
    let rows = schedule(&pool, "2026-05-01", "2026-05-31").await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["dueDate"], json!("2026-05-01T00:00:00.000Z"));
}

#[tokio::test]
async fn a_skipped_rows_expected_amount_is_never_rewritten() {
    let pool = db().await;
    fixture(&pool).await;
    let now = avoir_api::id::now_iso();
    // SKIPPED, on a date the generator DOES compute. PAID and PARTIAL months
    // are suppressed by the fulfilled-month dedup and never revisited, so it
    // is the deliberate non-payments — SKIPPED and SNOOZED — that the status
    // check actually protects.
    sqlx::query(
        r#"INSERT INTO "ScheduledTransaction"
             ("id","sourceType","sourceId","dueDate","expectedAmount","status",
              "createdAt","updatedAt")
           VALUES ('skip_may','EXPENSE','exp1','2026-05-01T00:00:00.000Z',150000,'SKIPPED',?,?)"#,
    )
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(r#"UPDATE "Expense" SET "amount" = 180000 WHERE "id" = 'exp1'"#)
        .execute(&pool)
        .await
        .unwrap();
    schedule(&pool, "2026-05-01", "2026-05-31").await;

    let (expected, status): (i64, String) = sqlx::query_as(
        r#"SELECT "expectedAmount", "status" FROM "ScheduledTransaction" WHERE "id" = 'skip_may'"#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    // Restating it would change what the user declined to pay.
    assert_eq!(expected, 150000, "a deliberate skip is not restated");
    assert_eq!(status, "SKIPPED", "and it stays skipped");
}

#[tokio::test]
async fn a_paid_month_is_left_entirely_alone() {
    let pool = db().await;
    fixture(&pool).await;
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "ScheduledTransaction"
             ("id","sourceType","sourceId","dueDate","expectedAmount","status",
              "createdAt","updatedAt")
           VALUES ('paid_may','EXPENSE','exp1','2026-05-01T00:00:00.000Z',150000,'PAID',?,?)"#,
    )
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(r#"UPDATE "Expense" SET "amount" = 180000 WHERE "id" = 'exp1'"#)
        .execute(&pool)
        .await
        .unwrap();
    let rows = schedule(&pool, "2026-05-01", "2026-05-31").await;

    let (expected,): (i64,) = sqlx::query_as(
        r#"SELECT "expectedAmount" FROM "ScheduledTransaction" WHERE "id" = 'paid_may'"#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(expected, 150000, "history is not restated");
    assert_eq!(rows.len(), 1, "and no second row appears beside it");
}

#[tokio::test]
async fn a_pending_rows_amount_is_refreshed_in_place_not_recreated() {
    let pool = db().await;
    fixture(&pool).await;
    let rows = schedule(&pool, "2026-05-01", "2026-05-31").await;
    let id = rows[0]["id"].as_str().unwrap().to_string();
    assert_eq!(rows[0]["expectedAmount"], json!(1500.00));

    // Changed directly, NOT through PUT /expenses. An amount edit through the
    // route invalidates the schedule first — PENDING rows are deleted and
    // regenerated with new ids — which is a different mechanism and would
    // hide whether this one refreshes in place.
    sqlx::query(r#"UPDATE "Expense" SET "amount" = 180000 WHERE "id" = 'exp1'"#)
        .execute(&pool)
        .await
        .unwrap();

    let rows = schedule(&pool, "2026-05-01", "2026-05-31").await;
    assert_eq!(
        rows[0]["expectedAmount"],
        json!(1800.00),
        "the amount follows"
    );
    assert_eq!(
        rows[0]["id"],
        json!(id),
        "refreshed in place — same row, same id"
    );
}

#[tokio::test]
async fn a_zero_amount_occurrence_is_not_materialised() {
    let pool = db().await;
    fixture(&pool).await;
    // An amountSchedule that zeroes one month: nothing is due then. A zero row
    // is noise on the dashboard and cannot be paid.
    call(
        &pool,
        "PUT",
        "/expenses/exp1",
        Some(json!({ "amountSchedule": { "5": 0 } })),
    )
    .await
    .unwrap();

    let may = schedule(&pool, "2026-05-01", "2026-05-31").await;
    assert!(may.is_empty(), "nothing is due in May, got {may:?}");

    let june = schedule(&pool, "2026-06-01", "2026-06-30").await;
    assert_eq!(june.len(), 1, "other months are unaffected");
    assert_eq!(june[0]["expectedAmount"], json!(1500.00));
}
