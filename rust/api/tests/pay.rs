//! `/pay-schedules`, `/pay-periods`, `/goals`.

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

async fn make_schedule(pool: &SqlitePool, extra: Value) -> String {
    let mut b = json!({
        "name": "Biweekly", "type": "BIWEEKLY", "anchorDate": "2026-01-02"
    });
    for (k, v) in extra.as_object().unwrap() {
        b[k] = v.clone();
    }
    call(pool, "POST", "/pay-schedules", Some(b))
        .await
        .expect("create schedule")
        .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

// ═══ Pay schedules ═══

#[tokio::test]
async fn a_schedule_round_trips_with_its_anchor_at_utc_midnight() {
    let pool = db().await;
    let id = make_schedule(&pool, json!({ "isDefault": true })).await;

    let r = call(&pool, "GET", &format!("/pay-schedules/{id}"), None)
        .await
        .unwrap();
    assert_eq!(r.body["type"], json!("BIWEEKLY"));
    assert_eq!(r.body["isDefault"], json!(true));
    // The column is TEXT and `ORDER BY` compares it as a string, so one
    // spelling is the whole contract.
    assert_eq!(r.body["anchorDate"], json!("2026-01-02T00:00:00.000Z"));
    assert_eq!(r.body["_count"]["payPeriods"], json!(0));
}

#[tokio::test]
async fn an_unknown_schedule_type_is_refused() {
    let pool = db().await;
    let err = call(
        &pool,
        "POST",
        "/pay-schedules",
        Some(json!({ "name": "X", "type": "FORTNIGHTLY", "anchorDate": "2026-01-02" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn clearing_a_pay_day_is_not_the_same_as_omitting_it() {
    let pool = db().await;
    let id = make_schedule(
        &pool,
        json!({ "type": "SEMI_MONTHLY", "firstPayDay": 1, "secondPayDay": 15 }),
    )
    .await;

    let r = call(
        &pool,
        "PUT",
        &format!("/pay-schedules/{id}"),
        Some(json!({ "name": "Renamed" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["firstPayDay"], json!(1));

    let r = call(
        &pool,
        "PUT",
        &format!("/pay-schedules/{id}"),
        Some(json!({ "secondPayDay": null })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["secondPayDay"], Value::Null);
    assert_eq!(r.body["firstPayDay"], json!(1), "untouched");
}

#[tokio::test]
async fn deleting_a_schedule_takes_its_periods_but_leaves_the_transactions() {
    let pool = db().await;
    let id = make_schedule(&pool, json!({})).await;
    call(
        &pool,
        "POST",
        &format!("/pay-schedules/{id}/generate"),
        Some(json!({ "rangeStart": "2026-01-01", "rangeEnd": "2026-02-28" })),
    )
    .await
    .unwrap();

    let period: String = sqlx::query_scalar(r#"SELECT "id" FROM "PayPeriod" LIMIT 1"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","type","name","amount","netAmount","date","createdAt",
                                      "imported","isCashBack","payPeriodId")
           VALUES ('t1','EXPENSE','X',100,100,'2026-01-05T00:00:00.000Z',
                   '2026-01-05T00:00:00.000Z',0,0, ?)"#,
    )
    .bind(&period)
    .execute(&pool)
    .await
    .unwrap();

    call(&pool, "DELETE", &format!("/pay-schedules/{id}"), None)
        .await
        .unwrap();

    let periods: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "PayPeriod""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(periods, 0, "PayPeriod cascades from PaySchedule");

    // Transaction.payPeriodId is ON DELETE SET NULL: the ledger survives with
    // no period rather than being taken with it.
    let (n, still_set): (i64, i64) =
        sqlx::query_as(r#"SELECT count(*), count("payPeriodId") FROM "Transaction""#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(n, 1);
    assert_eq!(still_set, 0);
}

// ═══ Generation ═══

#[tokio::test]
async fn generating_the_same_range_twice_keeps_every_period_id() {
    let pool = db().await;
    let id = make_schedule(&pool, json!({})).await;
    let body = json!({ "rangeStart": "2026-01-01", "rangeEnd": "2026-03-31" });

    let first = call(
        &pool,
        "POST",
        &format!("/pay-schedules/{id}/generate"),
        Some(body.clone()),
    )
    .await
    .unwrap();
    let ids_before: Vec<String> = first
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap().to_string())
        .collect();
    assert!(!ids_before.is_empty());

    let second = call(
        &pool,
        "POST",
        &format!("/pay-schedules/{id}/generate"),
        Some(body),
    )
    .await
    .unwrap();
    let ids_after: Vec<String> = second
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap().to_string())
        .collect();

    // Transactions point at pay periods by id. Delete-and-recreate would orphan
    // every one of them — the churn ADR-024 fixed for scheduled transactions.
    assert_eq!(ids_before, ids_after);

    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "PayPeriod""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n as usize, ids_before.len(), "no duplicates");
}

#[tokio::test]
async fn a_regenerated_period_reports_the_id_it_kept_not_a_new_one() {
    let pool = db().await;
    let id = make_schedule(&pool, json!({})).await;
    let body = json!({ "rangeStart": "2026-01-01", "rangeEnd": "2026-01-31" });

    call(
        &pool,
        "POST",
        &format!("/pay-schedules/{id}/generate"),
        Some(body.clone()),
    )
    .await
    .unwrap();
    let second = call(
        &pool,
        "POST",
        &format!("/pay-schedules/{id}/generate"),
        Some(body),
    )
    .await
    .unwrap();

    // Handing back the id the INSERT generated would name a row that does not
    // exist — the defect ADR-032's escrow upsert had to fix.
    for p in second.body.as_array().unwrap() {
        let exists: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "PayPeriod" WHERE "id" = ?"#)
            .bind(p["id"].as_str().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(exists, 1, "{}", p["id"]);
    }
}

#[tokio::test]
async fn a_biweekly_schedule_steps_a_fortnight_at_a_time() {
    let pool = db().await;
    let id = make_schedule(&pool, json!({})).await;
    let r = call(
        &pool,
        "POST",
        &format!("/pay-schedules/{id}/generate"),
        Some(json!({ "rangeStart": "2026-01-01", "rangeEnd": "2026-02-15" })),
    )
    .await
    .unwrap();
    let dates: Vec<&str> = r
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["payDate"].as_str().unwrap())
        .collect();
    assert_eq!(
        dates,
        vec![
            "2026-01-02T00:00:00.000Z",
            "2026-01-16T00:00:00.000Z",
            "2026-01-30T00:00:00.000Z",
            "2026-02-13T00:00:00.000Z",
        ]
    );
}

#[tokio::test]
async fn a_reversed_range_generates_nothing_rather_than_looping() {
    let pool = db().await;
    let id = make_schedule(&pool, json!({})).await;
    let r = call(
        &pool,
        "POST",
        &format!("/pay-schedules/{id}/generate"),
        Some(json!({ "rangeStart": "2026-03-01", "rangeEnd": "2026-01-01" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body, json!([]));
}

#[tokio::test]
async fn a_semi_monthly_schedule_without_pay_days_is_a_400_not_a_500() {
    let pool = db().await;
    let id = make_schedule(&pool, json!({ "type": "SEMI_MONTHLY" })).await;
    let err = call(
        &pool,
        "POST",
        &format!("/pay-schedules/{id}/generate"),
        Some(json!({ "rangeStart": "2026-01-01", "rangeEnd": "2026-03-31" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

// ═══ Pay periods ═══

#[tokio::test]
async fn the_current_period_is_the_one_containing_today() {
    let pool = db().await;
    let id = make_schedule(&pool, json!({ "isDefault": true })).await;
    let today = avoir_core::dates::today();
    let start = today - chrono::Duration::days(3);
    let end = today + chrono::Duration::days(3);
    sqlx::query(
        r#"INSERT INTO "PayPeriod" ("id","scheduleId","startDate","endDate","payDate","year","periodNum")
           VALUES ('now', ?, ?, ?, ?, 2026, 1),
                  ('past', ?, '2020-01-01T00:00:00.000Z','2020-01-14T00:00:00.000Z',
                   '2020-01-14T00:00:00.000Z', 2020, 1)"#,
    )
    .bind(&id)
    .bind(start.format("%Y-%m-%dT00:00:00.000Z").to_string())
    .bind(end.format("%Y-%m-%dT00:00:00.000Z").to_string())
    .bind(end.format("%Y-%m-%dT00:00:00.000Z").to_string())
    .bind(&id)
    .execute(&pool)
    .await
    .unwrap();

    let r = call(&pool, "GET", "/pay-periods/current", None)
        .await
        .unwrap();
    assert_eq!(r.body["id"], json!("now"));
}

#[tokio::test]
async fn the_default_schedule_is_preferred_and_the_oldest_is_the_fallback() {
    let pool = db().await;
    let first = make_schedule(&pool, json!({ "name": "Oldest" })).await;
    let flagged = make_schedule(&pool, json!({ "name": "Flagged", "isDefault": true })).await;

    let today = avoir_core::dates::today()
        .format("%Y-%m-%dT00:00:00.000Z")
        .to_string();
    for (pid, sid) in [("a", &first), ("b", &flagged)] {
        sqlx::query(
            r#"INSERT INTO "PayPeriod" ("id","scheduleId","startDate","endDate","payDate","year","periodNum")
               VALUES (?, ?, ?, ?, ?, 2026, 1)"#,
        )
        .bind(pid)
        .bind(sid)
        .bind(&today)
        .bind(&today)
        .bind(&today)
        .execute(&pool)
        .await
        .unwrap();
    }

    let r = call(&pool, "GET", "/pay-periods/current", None)
        .await
        .unwrap();
    assert_eq!(r.body["id"], json!("b"), "the flagged default wins");

    // Un-flag it and the oldest becomes the answer.
    sqlx::query(r#"UPDATE "PaySchedule" SET "isDefault" = 0"#)
        .execute(&pool)
        .await
        .unwrap();
    let r = call(&pool, "GET", "/pay-periods/current", None)
        .await
        .unwrap();
    assert_eq!(r.body["id"], json!("a"));
}

#[tokio::test]
async fn no_current_period_is_a_404() {
    let pool = db().await;
    make_schedule(&pool, json!({})).await;
    let err = call(&pool, "GET", "/pay-periods/current", None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 404);
}

#[tokio::test]
async fn listing_periods_filters_and_pages() {
    let pool = db().await;
    let id = make_schedule(&pool, json!({})).await;
    call(
        &pool,
        "POST",
        &format!("/pay-schedules/{id}/generate"),
        Some(json!({ "rangeStart": "2026-01-01", "rangeEnd": "2026-12-31" })),
    )
    .await
    .unwrap();

    let all = call(&pool, "GET", "/pay-periods?year=2026", None)
        .await
        .unwrap();
    let total = all.body.as_array().unwrap().len();
    assert!(total > 20, "a year of biweekly periods");

    let page = call(&pool, "GET", "/pay-periods?limit=5&offset=2", None)
        .await
        .unwrap();
    assert_eq!(page.body.as_array().unwrap().len(), 5);
    assert_eq!(
        page.body[0]["id"], all.body[2]["id"],
        "offset skips, not filters"
    );

    let none = call(&pool, "GET", "/pay-periods?year=1999", None)
        .await
        .unwrap();
    assert_eq!(none.body, json!([]));
}

#[tokio::test]
async fn a_period_carries_its_balance_snapshots_in_dollars() {
    let pool = db().await;
    let id = make_schedule(&pool, json!({})).await;
    let account = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Checking", "type": "CHECKING", "openingBalance": 0.0 })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    sqlx::query(
        r#"INSERT INTO "PayPeriod" ("id","scheduleId","startDate","endDate","payDate","year","periodNum")
           VALUES ('p', ?, '2026-01-01T00:00:00.000Z','2026-01-14T00:00:00.000Z',
                   '2026-01-14T00:00:00.000Z', 2026, 1)"#,
    )
    .bind(&id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "BalanceSnapshot" ("id","payPeriodId","accountId","openingBalance",
             "closingBalance","totalIncome","totalExpenses","createdAt")
           VALUES ('s','p', ?, 100025, 250050, 200000, 49975,'2026-01-14T00:00:00.000Z')"#,
    )
    .bind(&account)
    .execute(&pool)
    .await
    .unwrap();

    let r = call(&pool, "GET", "/pay-periods/p", None).await.unwrap();
    let s = &r.body["balanceSnapshots"][0];
    assert_eq!(s["openingBalance"], json!(1000.25));
    assert_eq!(s["closingBalance"], json!(2500.50));
    assert_eq!(s["totalExpenses"], json!(499.75));
}

// ═══ Goals ═══

#[tokio::test]
async fn a_goal_round_trips_with_money_as_cents() {
    let pool = db().await;
    let r = call(
        &pool,
        "POST",
        "/goals",
        Some(json!({ "name": "Emergency fund", "type": "SAVINGS",
                     "targetAmount": 10000.00, "currentAmount": 2500.50 })),
    )
    .await
    .unwrap();
    assert_eq!(r.status, 201);
    assert_eq!(r.body["targetAmount"], json!(10000.0));
    assert_eq!(r.body["currentAmount"], json!(2500.50));

    let stored: i64 = sqlx::query_scalar(r#"SELECT "currentAmount" FROM "BudgetGoal""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored, 250_050);
}

#[tokio::test]
async fn an_unknown_goal_type_is_refused() {
    let pool = db().await;
    let err = call(
        &pool,
        "POST",
        "/goals",
        Some(json!({ "name": "X", "type": "VIBES", "targetAmount": 1.0 })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn goal_progress_clamps_at_a_hundred_percent() {
    let pool = db().await;
    call(
        &pool,
        "POST",
        "/goals",
        Some(json!({ "name": "Overshot", "type": "SAVINGS",
                     "targetAmount": 1000.0, "currentAmount": 1400.0 })),
    )
    .await
    .unwrap();

    let r = call(&pool, "GET", "/dashboard/goal-progress", None)
        .await
        .unwrap();
    let g = &r.body[0];
    // A 140% bar and a negative amount left to save are both nonsense to look at.
    assert_eq!(g["percentComplete"], json!(100.0));
    assert_eq!(g["remaining"], json!(0.0));
}

#[tokio::test]
async fn a_goal_with_no_target_reports_no_progress_rather_than_dividing_by_zero() {
    let pool = db().await;
    call(
        &pool,
        "POST",
        "/goals",
        Some(json!({ "name": "Unset", "type": "CUSTOM", "targetAmount": 0.0 })),
    )
    .await
    .unwrap();
    let r = call(&pool, "GET", "/dashboard/goal-progress", None)
        .await
        .unwrap();
    assert_eq!(r.body[0]["percentComplete"], json!(0.0));
}

#[tokio::test]
async fn clearing_a_goal_deadline_is_not_the_same_as_omitting_it() {
    let pool = db().await;
    let id = call(
        &pool,
        "POST",
        "/goals",
        Some(json!({ "name": "Trip", "type": "SAVINGS",
                     "targetAmount": 3000.0, "deadline": "2026-12-01" })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    let r = call(
        &pool,
        "PUT",
        &format!("/goals/{id}"),
        Some(json!({ "name": "Renamed" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["deadline"], json!("2026-12-01T00:00:00.000Z"));

    let r = call(
        &pool,
        "PUT",
        &format!("/goals/{id}"),
        Some(json!({ "deadline": null })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["deadline"], Value::Null);
}

#[tokio::test]
async fn a_missing_record_is_a_404_on_every_route_that_names_one() {
    let pool = db().await;
    for (method, path, body) in [
        ("GET", "/pay-schedules/nope", None),
        ("PUT", "/pay-schedules/nope", Some(json!({}))),
        ("DELETE", "/pay-schedules/nope", None),
        (
            "POST",
            "/pay-schedules/nope/generate",
            Some(json!({ "rangeStart": "2026-01-01", "rangeEnd": "2026-02-01" })),
        ),
        ("GET", "/pay-periods/nope", None),
        ("PUT", "/goals/nope", Some(json!({}))),
        ("DELETE", "/goals/nope", None),
    ] {
        let err = call(&pool, method, path, body).await.unwrap_err();
        assert_eq!(err.status, 404, "{method} {path}");
    }
}

#[tokio::test]
async fn the_static_current_route_is_not_read_as_a_period_id() {
    let pool = db().await;
    // `/pay-periods/current` has the shape of `/pay-periods/{id}`. A 404 with
    // "Pay period not found" would mean the id arm swallowed it — this asserts
    // the ordering by checking the route runs at all.
    let err = call(&pool, "GET", "/pay-periods/current", None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 404);
    // Both arms 404 on an empty database, so the distinguishing evidence is
    // that adding a current period makes THIS path return it.
    let id = make_schedule(&pool, json!({})).await;
    let today = avoir_core::dates::today()
        .format("%Y-%m-%dT00:00:00.000Z")
        .to_string();
    sqlx::query(
        r#"INSERT INTO "PayPeriod" ("id","scheduleId","startDate","endDate","payDate","year","periodNum")
           VALUES ('p', ?, ?, ?, ?, 2026, 1)"#,
    )
    .bind(&id)
    .bind(&today)
    .bind(&today)
    .bind(&today)
    .execute(&pool)
    .await
    .unwrap();
    let r = call(&pool, "GET", "/pay-periods/current", None)
        .await
        .unwrap();
    assert_eq!(r.body["id"], json!("p"));
}

#[tokio::test]
async fn regenerating_after_the_anchor_moves_updates_the_dates_it_kept() {
    let pool = db().await;
    let id = make_schedule(&pool, json!({})).await;
    let range = json!({ "rangeStart": "2026-01-01", "rangeEnd": "2026-03-31" });

    call(
        &pool,
        "POST",
        &format!("/pay-schedules/{id}/generate"),
        Some(range.clone()),
    )
    .await
    .unwrap();
    let before: Vec<(String, String)> =
        sqlx::query_as(r#"SELECT "id", "payDate" FROM "PayPeriod" ORDER BY "periodNum""#)
            .fetch_all(&pool)
            .await
            .unwrap();

    // The anchor was wrong by a day. Regenerating must move the dates on the
    // rows that already exist — `DO NOTHING` would keep the old ones and the
    // schedule would silently stay wrong, which is invisible because the row
    // count and the ids are both unchanged.
    call(
        &pool,
        "PUT",
        &format!("/pay-schedules/{id}"),
        Some(json!({ "anchorDate": "2026-01-03" })),
    )
    .await
    .unwrap();
    call(
        &pool,
        "POST",
        &format!("/pay-schedules/{id}/generate"),
        Some(range),
    )
    .await
    .unwrap();

    let after: Vec<(String, String)> =
        sqlx::query_as(r#"SELECT "id", "payDate" FROM "PayPeriod" ORDER BY "periodNum""#)
            .fetch_all(&pool)
            .await
            .unwrap();

    let ids_before: Vec<&String> = before.iter().map(|(i, _)| i).collect();
    let ids_after: Vec<&String> = after.iter().map(|(i, _)| i).collect();
    assert_eq!(ids_before, ids_after, "the rows are the same rows");
    assert_ne!(
        before.iter().map(|(_, d)| d).collect::<Vec<_>>(),
        after.iter().map(|(_, d)| d).collect::<Vec<_>>(),
        "and their dates moved"
    );
    assert_eq!(after[0].1, "2026-01-03T00:00:00.000Z");
}
