//! `/utilities` — providers, services, readings, and the money a reading moves.

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

async fn provider(pool: &SqlitePool, name: &str) -> String {
    call(
        pool,
        "POST",
        "/utilities/providers",
        Some(json!({ "name": name })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn service(pool: &SqlitePool, pid: &str, ty: &str) -> String {
    call(
        pool,
        "POST",
        &format!("/utilities/providers/{pid}/services"),
        Some(json!({ "serviceType": ty, "metering": "METERED" })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn a_provider_round_trips() {
    let pool = db().await;
    let r = call(
        &pool,
        "POST",
        "/utilities/providers",
        Some(json!({ "name": "Metro Power" })),
    )
    .await
    .unwrap();
    assert_eq!(r.status, 201);
    assert_eq!(r.body["name"], json!("Metro Power"));

    let list = call(&pool, "GET", "/utilities/providers", None)
        .await
        .unwrap();
    assert_eq!(list.body.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn a_provider_with_services_refuses_deletion() {
    let pool = db().await;
    let pid = provider(&pool, "Metro Power").await;
    let sid = service(&pool, &pid, "ELECTRIC").await;

    let err = call(
        &pool,
        "DELETE",
        &format!("/utilities/providers/{pid}"),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 409);

    // Removing the obstruction makes it deletable — the guard is about the
    // relationship, not a permanent lock.
    call(&pool, "DELETE", &format!("/utilities/services/{sid}"), None)
        .await
        .unwrap();
    let r = call(
        &pool,
        "DELETE",
        &format!("/utilities/providers/{pid}"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.status, 204);
}

#[tokio::test]
async fn a_service_with_readings_refuses_deletion() {
    let pool = db().await;
    let pid = provider(&pool, "Metro Power").await;
    let sid = service(&pool, &pid, "ELECTRIC").await;
    call(
        &pool,
        "POST",
        "/utilities/readings",
        Some(json!({
            "serviceId": sid, "billDate": "2026-03-01T00:00:00.000Z", "cost": 120.00
        })),
    )
    .await
    .unwrap();

    // Readings are the billing history; deleting the service that produced
    // them would orphan the record of what was actually charged.
    let err = call(&pool, "DELETE", &format!("/utilities/services/{sid}"), None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 409);
}

#[tokio::test]
async fn usage_and_unit_cost_keep_full_precision_while_cost_is_cents() {
    let pool = db().await;
    let pid = provider(&pool, "Metro Power").await;
    let sid = service(&pool, &pid, "ELECTRIC").await;

    let r = call(
        &pool,
        "POST",
        "/utilities/readings",
        Some(json!({
            "serviceId": sid, "billDate": "2026-03-01T00:00:00.000Z",
            "cost": 142.37, "usage": 1234.5678, "unitCost": 0.115342857142857
        })),
    )
    .await
    .unwrap();

    assert_eq!(r.body["cost"], json!(142.37));

    let (usage, unit_cost, cost): (Option<String>, Option<String>, i64) = sqlx::query_as(
        r#"SELECT "usage", "unitCost", "cost" FROM "UtilityReading" WHERE "id" = ?"#,
    )
    .bind(r.body["id"].as_str().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();

    // ADR-033's split, in one row: money is INTEGER cents, but a unit rate is
    // exact decimal TEXT. Cents would flatten 0.1153… to 12.
    assert_eq!(cost, 14237);
    assert_eq!(usage.as_deref(), Some("1234.5678"));
    assert_eq!(unit_cost.as_deref(), Some("0.115342857142857"));
}

#[tokio::test]
async fn a_flat_convenience_fee_is_added_to_the_linked_transaction() {
    let pool = db().await;
    let now = avoir_api::id::now_iso();
    sqlx::query(r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt") VALUES ('bg1','B','#000',?)"#)
        .bind(&now).execute(&pool).await.unwrap();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
                   VALUES ('bud1','Utilities',0,?,'bg1',0)"#,
    )
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();
    let acct = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Checking", "type": "Checking", "balance": 1000.00 })),
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
           VALUES ('exp1','Power',10000,'MONTHLY','bud1',?,0,1,0,?,?)"#,
    )
    .bind(&acct)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let tx = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "type": "EXPENSE", "amount": 100.00, "date": "2026-03-10T00:00:00.000Z",
            "accountId": acct, "expenseId": "exp1", "budgetId": "bud1"
        })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    let pid = provider(&pool, "Metro Power").await;
    let sid = service(&pool, &pid, "ELECTRIC").await;
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
            "serviceId": sid, "billDate": "2026-03-05T00:00:00.000Z",
            "cost": 142.37, "convenienceFee": 1.60, "convenienceFeeType": "dollar",
            "otherFees": 2.75
        })),
    )
    .await
    .unwrap();

    // 142.37 + 1.60 + 2.75 = 146.72, pushed onto that month's transaction.
    let (amount, net): (i64, i64) =
        sqlx::query_as(r#"SELECT "amount", "netAmount" FROM "Transaction" WHERE "id" = ?"#)
            .bind(&tx)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(amount, 14672);
    // Through the ledger gate, so netAmount followed. A direct write is what
    // drifted a card by hundreds of dollars before ADR-013.
    assert_eq!(net, 14672, "netAmount must follow amount");

    let acc = call(&pool, "GET", &format!("/accounts/{acct}"), None)
        .await
        .unwrap();
    assert_eq!(acc.body["balance"], json!(853.28), "1000 − 146.72");

    let mut conn = pool.acquire().await.unwrap();
    assert!(avoir_db::balance::check_invariant(&mut conn)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn the_due_date_decides_which_month_the_bill_belongs_to() {
    let pool = db().await;
    let now = avoir_api::id::now_iso();
    sqlx::query(r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt") VALUES ('bg1','B','#000',?)"#)
        .bind(&now).execute(&pool).await.unwrap();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
                   VALUES ('bud1','Utilities',0,?,'bg1',0)"#,
    )
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();
    let acct = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Checking", "type": "Checking", "balance": 1000.00 })),
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
           VALUES ('exp1','Power',10000,'MONTHLY','bud1',?,0,5,0,?,?)"#,
    )
    .bind(&acct)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    // March's transaction and April's transaction.
    let march = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "type": "EXPENSE", "amount": 100.00, "date": "2026-03-05T00:00:00.000Z",
            "accountId": acct, "expenseId": "exp1", "budgetId": "bud1"
        })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();
    let april = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "type": "EXPENSE", "amount": 100.00, "date": "2026-04-05T00:00:00.000Z",
            "accountId": acct, "expenseId": "exp1", "budgetId": "bud1"
        })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    let pid = provider(&pool, "Metro Power").await;
    let sid = service(&pool, &pid, "ELECTRIC").await;
    call(
        &pool,
        "PUT",
        &format!("/utilities/services/{sid}/link"),
        Some(json!({ "expenseId": "exp1" })),
    )
    .await
    .unwrap();

    // Billed 28 March, DUE 5 April. It belongs to April.
    call(
        &pool,
        "POST",
        "/utilities/readings",
        Some(json!({
            "serviceId": sid, "billDate": "2026-03-28T00:00:00.000Z",
            "dueDate": "2026-04-05T00:00:00.000Z", "cost": 175.00
        })),
    )
    .await
    .unwrap();

    let m: i64 = sqlx::query_scalar(r#"SELECT "amount" FROM "Transaction" WHERE "id" = ?"#)
        .bind(&march)
        .fetch_one(&pool)
        .await
        .unwrap();
    let a: i64 = sqlx::query_scalar(r#"SELECT "amount" FROM "Transaction" WHERE "id" = ?"#)
        .bind(&april)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(m, 10000, "March is untouched");
    assert_eq!(a, 17500, "April got the bill");
}

#[tokio::test]
async fn linking_clears_pending_rows_on_both_the_old_and_new_expense() {
    let pool = db().await;
    let now = avoir_api::id::now_iso();
    sqlx::query(r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt") VALUES ('bg1','B','#000',?)"#)
        .bind(&now).execute(&pool).await.unwrap();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
                   VALUES ('bud1','U',0,?,'bg1',0)"#,
    )
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();
    for e in ["expA", "expB"] {
        sqlx::query(
            r#"INSERT INTO "Expense" ("id","name","amount","frequency","budgetId",
                                      "isAutomatic","dueDay","skipWeekend","createdAt","updatedAt")
               VALUES (?,?,10000,'MONTHLY','bud1',0,1,0,?,?)"#,
        )
        .bind(e)
        .bind(e)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO "ScheduledTransaction"
                 ("id","sourceType","sourceId","dueDate","expectedAmount","status","createdAt","updatedAt")
               VALUES (?,'EXPENSE',?,'2026-03-01T00:00:00.000Z',10000,'PENDING',?,?)"#,
        ).bind(format!("sch_{e}")).bind(e).bind(&now).bind(&now).execute(&pool).await.unwrap();
    }

    let pid = provider(&pool, "Metro Power").await;
    let sid = service(&pool, &pid, "ELECTRIC").await;
    call(
        &pool,
        "PUT",
        &format!("/utilities/services/{sid}/link"),
        Some(json!({ "expenseId": "expA" })),
    )
    .await
    .unwrap();

    // Re-seed expA's pending row. Without this the test proves nothing about
    // the OLD side: the first link already cleared it, so dropping the
    // old-expense invalidation entirely still left a count of zero and the
    // mutation went uncaught.
    sqlx::query(
        r#"INSERT INTO "ScheduledTransaction"
             ("id","sourceType","sourceId","dueDate","expectedAmount","status","createdAt","updatedAt")
           VALUES ('sch_expA_again','EXPENSE','expA','2026-04-01T00:00:00.000Z',10000,'PENDING',?,?)"#,
    ).bind(&now).bind(&now).execute(&pool).await.unwrap();

    // Re-point the link. The OLD expense's pending rows are stale too — it is
    // no longer receiving a utility amount — so both sides are invalidated.
    call(
        &pool,
        "PUT",
        &format!("/utilities/services/{sid}/link"),
        Some(json!({ "expenseId": "expB" })),
    )
    .await
    .unwrap();

    let remaining: Vec<(String,)> = sqlx::query_as(
        r#"SELECT "sourceId" FROM "ScheduledTransaction" WHERE "status" = 'PENDING'"#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(
        remaining.is_empty(),
        "both sides must be invalidated; still pending for: {:?}",
        remaining.iter().map(|r| &r.0).collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn unlinking_leaves_the_service_intact() {
    let pool = db().await;
    let now = avoir_api::id::now_iso();
    sqlx::query(r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt") VALUES ('bg1','B','#000',?)"#)
        .bind(&now).execute(&pool).await.unwrap();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
                   VALUES ('bud1','U',0,?,'bg1',0)"#,
    )
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Expense" ("id","name","amount","frequency","budgetId",
                                  "isAutomatic","dueDay","skipWeekend","createdAt","updatedAt")
           VALUES ('exp1','Power',10000,'MONTHLY','bud1',0,1,0,?,?)"#,
    )
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let pid = provider(&pool, "Metro Power").await;
    let sid = service(&pool, &pid, "ELECTRIC").await;
    call(
        &pool,
        "PUT",
        &format!("/utilities/services/{sid}/link"),
        Some(json!({ "expenseId": "exp1" })),
    )
    .await
    .unwrap();

    let r = call(
        &pool,
        "DELETE",
        &format!("/utilities/services/{sid}/link"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.body["expenseId"], json!(null));
    assert_eq!(
        r.body["serviceType"],
        json!("ELECTRIC"),
        "the service survives"
    );
}

#[tokio::test]
async fn readings_filter_by_service_and_date() {
    let pool = db().await;
    let pid = provider(&pool, "Metro Power").await;
    let a = service(&pool, &pid, "ELECTRIC").await;
    let b = service(&pool, &pid, "WATER").await;

    for (sid, date) in [(&a, "2026-01-15"), (&a, "2026-02-15"), (&b, "2026-01-20")] {
        call(
            &pool,
            "POST",
            "/utilities/readings",
            Some(json!({
                "serviceId": sid, "billDate": format!("{date}T00:00:00.000Z"), "cost": 50.00
            })),
        )
        .await
        .unwrap();
    }

    let all = call(&pool, "GET", "/utilities/readings", None)
        .await
        .unwrap();
    assert_eq!(all.body.as_array().unwrap().len(), 3);

    let by_service = call(
        &pool,
        "GET",
        &format!("/utilities/readings?serviceId={a}"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(by_service.body.as_array().unwrap().len(), 2);

    let by_date = call(
        &pool,
        "GET",
        "/utilities/readings?dateFrom=2026-02-01T00:00:00.000Z",
        None,
    )
    .await
    .unwrap();
    assert_eq!(by_date.body.as_array().unwrap().len(), 1);

    // Newest first.
    assert_eq!(all.body[0]["billDate"], json!("2026-02-15T00:00:00.000Z"));
}

#[tokio::test]
async fn a_reading_against_an_unknown_service_is_a_400_not_a_404() {
    let pool = db().await;
    // The id came from the body, not the path, so it is a bad request rather
    // than a missing resource.
    let err = call(
        &pool,
        "POST",
        "/utilities/readings",
        Some(json!({
            "serviceId": "cnope00000000000000000000", "billDate": "2026-03-01T00:00:00.000Z",
            "cost": 10.0
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn missing_records_are_404() {
    let pool = db().await;
    let missing = "cmissing00000000000000000";
    for (m, p, b) in [
        (
            "PUT",
            format!("/utilities/providers/{missing}"),
            Some(json!({ "name": "x" })),
        ),
        ("DELETE", format!("/utilities/providers/{missing}"), None),
        (
            "PUT",
            format!("/utilities/services/{missing}"),
            Some(json!({})),
        ),
        ("DELETE", format!("/utilities/services/{missing}"), None),
        ("DELETE", format!("/utilities/readings/{missing}"), None),
    ] {
        let err = call(&pool, m, &p, b)
            .await
            .err()
            .unwrap_or_else(|| panic!("{m} {p} should 404"));
        assert_eq!(err.status, 404, "{m} {p}");
    }
}

#[tokio::test]
async fn updating_a_provider_and_a_service_persists() {
    let pool = db().await;
    let pid = provider(&pool, "Metro Power").await;
    let sid = service(&pool, &pid, "ELECTRIC").await;

    let p = call(
        &pool,
        "PUT",
        &format!("/utilities/providers/{pid}"),
        Some(json!({ "name": "Metro Power Regional" })),
    )
    .await
    .unwrap();
    assert_eq!(p.body["name"], json!("Metro Power Regional"));

    let s = call(
        &pool,
        "PUT",
        &format!("/utilities/services/{sid}"),
        Some(json!({ "metering": "UNMETERED" })),
    )
    .await
    .unwrap();
    assert_eq!(s.body["metering"], json!("UNMETERED"));
    assert_eq!(
        s.body["serviceType"],
        json!("ELECTRIC"),
        "unmentioned field kept"
    );

    // Both directions. Sending only `metering` above never exercises whether
    // an omitted `metering` survives, so a mutation dropping its COALESCE went
    // uncaught — the field was supplied in every case the test covered.
    let s = call(
        &pool,
        "PUT",
        &format!("/utilities/services/{sid}"),
        Some(json!({ "serviceType": "GAS" })),
    )
    .await
    .unwrap();
    assert_eq!(s.body["serviceType"], json!("GAS"));
    assert_eq!(
        s.body["metering"],
        json!("UNMETERED"),
        "omitted metering kept"
    );

    // Read back from the database, not just the response.
    let (name,): (String,) =
        sqlx::query_as(r#"SELECT "name" FROM "UtilityProvider" WHERE "id" = ?"#)
            .bind(&pid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(name, "Metro Power Regional");
    let (metering, stype): (String, String) =
        sqlx::query_as(r#"SELECT "metering", "serviceType" FROM "UtilityService" WHERE "id" = ?"#)
            .bind(&sid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(metering, "UNMETERED");
    assert_eq!(stype, "GAS");
}

#[tokio::test]
async fn a_partial_reading_update_leaves_every_unsent_field_alone() {
    let pool = db().await;
    let pid = provider(&pool, "Metro Power").await;
    let sid = service(&pool, &pid, "ELECTRIC").await;

    let created = call(
        &pool,
        "POST",
        "/utilities/readings",
        Some(json!({
            "serviceId": sid, "billDate": "2026-03-01T00:00:00.000Z",
            "cost": 142.37, "usage": 1234.5678, "unitCost": 0.1153,
            "convenienceFee": 1.60, "convenienceFeeType": "dollar", "otherFees": 2.75,
            "dueDate": "2026-03-15T00:00:00.000Z"
        })),
    )
    .await
    .unwrap();
    let rid = created.body["id"].as_str().unwrap().to_string();

    // Send ONLY usage. The Zod schema is CreateUtilityReadingSchema.partial(),
    // so everything else must survive untouched. Reusing the create struct
    // here zeroed the cost and nulled the fees, because serde(default) turns
    // an absent number into 0.0 and the UPDATE wrote every column.
    let r = call(
        &pool,
        "PUT",
        &format!("/utilities/readings/{rid}"),
        Some(json!({ "usage": 2000.0 })),
    )
    .await
    .unwrap();

    assert_eq!(r.body["usage"], json!(2000.0), "the sent field changed");
    assert_eq!(r.body["cost"], json!(142.37), "cost NOT zeroed");
    assert_eq!(r.body["unitCost"], json!(0.1153));
    assert_eq!(r.body["convenienceFee"], json!(1.60));
    assert_eq!(r.body["convenienceFeeType"], json!("dollar"));
    assert_eq!(r.body["otherFees"], json!(2.75));
    assert_eq!(r.body["dueDate"], json!("2026-03-15T00:00:00.000Z"));
    assert_eq!(r.body["billDate"], json!("2026-03-01T00:00:00.000Z"));

    let (cost, fee): (i64, Option<i64>) =
        sqlx::query_as(r#"SELECT "cost", "convenienceFee" FROM "UtilityReading" WHERE "id" = ?"#)
            .bind(&rid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(cost, 14237, "read back from the database");
    assert_eq!(fee, Some(160));
}

#[tokio::test]
async fn a_partial_update_pushes_the_whole_bill_not_just_what_changed() {
    let pool = db().await;
    let now = avoir_api::id::now_iso();
    sqlx::query(r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt") VALUES ('bg1','B','#000',?)"#)
        .bind(&now).execute(&pool).await.unwrap();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
                   VALUES ('bud1','U',0,?,'bg1',0)"#,
    )
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();
    let acct = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Checking", "type": "Checking", "balance": 1000.00 })),
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
           VALUES ('exp1','Power',10000,'MONTHLY','bud1',?,0,1,0,?,?)"#,
    )
    .bind(&acct)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let tx = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "type": "EXPENSE", "amount": 100.00, "date": "2026-03-10T00:00:00.000Z",
            "accountId": acct, "expenseId": "exp1", "budgetId": "bud1"
        })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    let pid = provider(&pool, "Metro Power").await;
    let sid = service(&pool, &pid, "ELECTRIC").await;
    call(
        &pool,
        "PUT",
        &format!("/utilities/services/{sid}/link"),
        Some(json!({ "expenseId": "exp1" })),
    )
    .await
    .unwrap();

    let rid = call(
        &pool,
        "POST",
        "/utilities/readings",
        Some(json!({
            "serviceId": sid, "billDate": "2026-03-05T00:00:00.000Z", "cost": 100.00
        })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Add ONLY a fee. The pushed total must be cost + fee = 105.50, which
    // requires reading the merged row — computing from the request body alone
    // would treat the unsent cost as zero and push 5.50.
    call(
        &pool,
        "PUT",
        &format!("/utilities/readings/{rid}"),
        Some(json!({ "convenienceFee": 5.50, "convenienceFeeType": "dollar" })),
    )
    .await
    .unwrap();

    let (amount, net): (i64, i64) =
        sqlx::query_as(r#"SELECT "amount", "netAmount" FROM "Transaction" WHERE "id" = ?"#)
            .bind(&tx)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(amount, 10550, "the whole bill, not just the delta");
    assert_eq!(net, 10550);

    let mut conn = pool.acquire().await.unwrap();
    assert!(avoir_db::balance::check_invariant(&mut conn)
        .await
        .unwrap()
        .is_empty());
}
