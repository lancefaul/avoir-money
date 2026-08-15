//! `/accounts` end to end, through the dispatcher the frontend will call.
//!
//! These go through `dispatch(method, path, body)` rather than calling the
//! handlers directly, because routing is part of what is being ported — a
//! handler that works but is registered at the wrong path is still a broken
//! endpoint, and that is exactly the class of mistake a hand-written match
//! arm invites.

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

async fn make_account(pool: &SqlitePool, name: &str, balance: f64) -> String {
    let r = call(
        pool,
        "POST",
        "/accounts",
        Some(json!({ "name": name, "type": "Checking", "balance": balance })),
    )
    .await
    .expect("create");
    r.body["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn create_seeds_opening_from_the_starting_balance() {
    let pool = db().await;
    let r = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Chase", "type": "Checking", "balance": 1250.55 })),
    )
    .await
    .unwrap();

    assert_eq!(r.status, 201, "create returns 201, not 200");
    // The form's Starting Balance has to land in BOTH columns. If it only
    // reached `balance`, the figure becomes unrecoverable the moment the first
    // transaction moves that column — which is the bug openingBalance exists
    // to prevent.
    assert_eq!(r.body["balance"], json!(1250.55));
    assert_eq!(r.body["openingBalance"], json!(1250.55));
}

#[tokio::test]
async fn money_survives_the_cents_round_trip() {
    let pool = db().await;
    // 0.1 + 0.2 territory: a value that has no exact float representation and
    // would drift if it were ever added as f64 rather than stored as cents.
    let id = make_account(&pool, "Precision", 1234.56).await;
    let r = call(&pool, "GET", &format!("/accounts/{id}"), None)
        .await
        .unwrap();
    assert_eq!(r.body["balance"], json!(1234.56));

    let stored: i64 = sqlx::query_scalar(r#"SELECT "balance" FROM "Account" WHERE "id" = ?"#)
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored, 123456, "stored as integer cents, not a float");
}

#[tokio::test]
async fn interest_rate_is_hundredths_on_disk_and_a_percent_on_the_wire() {
    let pool = db().await;
    let r = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({
            "name": "HYSA", "type": "Savings", "balance": 0,
            "earnsInterest": true, "interestRate": 4.25, "interestRateType": "APY"
        })),
    )
    .await
    .unwrap();

    assert_eq!(r.body["interestRate"], json!(4.25));
    assert_eq!(r.body["earnsInterest"], json!(true), "a real JSON boolean");

    let stored: i64 = sqlx::query_scalar(r#"SELECT "interestRate" FROM "Account" WHERE "id" = ?"#)
        .bind(r.body["id"].as_str().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored, 425, "percentage scaled by 100, like money");
}

#[tokio::test]
async fn booleans_come_back_as_booleans_not_zero_and_one() {
    let pool = db().await;
    let id = make_account(&pool, "Flags", 0.0).await;
    let r = call(&pool, "GET", &format!("/accounts/{id}"), None)
        .await
        .unwrap();

    // SQLite has no boolean type, so these are INTEGER 0/1 on disk. Zod's
    // z.boolean() rejects 0, so leaking the storage type breaks the frontend
    // parse rather than merely looking odd.
    for field in ["archived", "hasRewards", "earnsInterest"] {
        assert!(
            r.body[field].is_boolean(),
            "{field} must serialize as a boolean, got {}",
            r.body[field]
        );
    }
}

#[tokio::test]
async fn the_list_filter_matches_the_three_query_states() {
    let pool = db().await;
    make_account(&pool, "Plain", 0.0).await;
    call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Savings", "type": "Savings", "balance": 0, "earnsInterest": true })),
    )
    .await
    .unwrap();

    let all = call(&pool, "GET", "/accounts", None).await.unwrap();
    assert_eq!(
        all.body.as_array().unwrap().len(),
        2,
        "no filter = every row"
    );

    let yes = call(&pool, "GET", "/accounts?earnsInterest=true", None)
        .await
        .unwrap();
    assert_eq!(yes.body.as_array().unwrap().len(), 1);

    let no = call(&pool, "GET", "/accounts?earnsInterest=false", None)
        .await
        .unwrap();
    assert_eq!(no.body.as_array().unwrap().len(), 1);
    assert_eq!(no.body[0]["name"], json!("Plain"));
}

#[tokio::test]
async fn the_list_is_ordered_by_name() {
    let pool = db().await;
    make_account(&pool, "Zebra", 0.0).await;
    make_account(&pool, "Alpha", 0.0).await;
    make_account(&pool, "Mango", 0.0).await;

    let r = call(&pool, "GET", "/accounts", None).await.unwrap();
    let names: Vec<&str> = r
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["Alpha", "Mango", "Zebra"]);
}

#[tokio::test]
async fn a_rewards_account_cannot_be_created_through_the_generic_endpoint() {
    let pool = db().await;
    let err = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Orphan", "type": "Rewards", "balance": 0 })),
    )
    .await
    .unwrap_err();

    // A parentless Rewards account is an orphan the nested-card UI can never
    // render, so the generic create refuses rather than producing one.
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn a_rewards_account_nests_under_its_card() {
    let pool = db().await;
    let card = make_account(&pool, "Prime Visa", 0.0).await;

    let r = call(
        &pool,
        "POST",
        &format!("/accounts/{card}/rewards-account"),
        Some(json!({})),
    )
    .await
    .unwrap();

    assert_eq!(r.status, 201);
    assert_eq!(r.body["type"], json!("Rewards"));
    assert_eq!(r.body["parentAccountId"], json!(card));
    assert_eq!(
        r.body["name"],
        json!("Prime Visa Rewards"),
        "defaulted name"
    );
}

#[tokio::test]
async fn a_card_gets_only_one_rewards_account() {
    let pool = db().await;
    let card = make_account(&pool, "Card", 0.0).await;
    let path = format!("/accounts/{card}/rewards-account");

    call(&pool, "POST", &path, Some(json!({}))).await.unwrap();
    let err = call(&pool, "POST", &path, Some(json!({})))
        .await
        .unwrap_err();

    // parentAccountId is UNIQUE. The second attempt is a conflict, not a
    // silent overwrite and not a 500 from a raw constraint violation.
    assert_eq!(err.status, 409);
}

#[tokio::test]
async fn moving_the_opening_balance_moves_the_balance_with_it() {
    let pool = db().await;
    let id = make_account(&pool, "Card", 500.00).await;

    let r = call(
        &pool,
        "PUT",
        &format!("/accounts/{id}"),
        Some(json!({ "openingBalance": 800.00 })),
    )
    .await
    .unwrap();

    // The invariant is openingBalance + SUM(transactions) == balance. With no
    // transactions the sum is zero, so balance must track the opening exactly.
    // Writing the opening alone would leave balance at 500 and break it.
    assert_eq!(r.body["openingBalance"], json!(800.00));
    assert_eq!(
        r.body["balance"],
        json!(800.00),
        "balance must be re-seeded, and re-read after the rebuild"
    );

    let mut conn = pool.acquire().await.unwrap();
    let drift = avoir_db::balance::check_invariant(&mut conn).await.unwrap();
    assert!(drift.is_empty(), "ledger invariant broken: {drift:?}");
}

#[tokio::test]
async fn an_update_that_does_not_mention_a_field_leaves_it_alone() {
    let pool = db().await;
    let r = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({
            "name": "Original", "type": "Savings", "balance": 100.0,
            "earnsInterest": true, "interestRate": 3.5
        })),
    )
    .await
    .unwrap();
    let id = r.body["id"].as_str().unwrap().to_string();

    let updated = call(
        &pool,
        "PUT",
        &format!("/accounts/{id}"),
        Some(json!({ "name": "Renamed" })),
    )
    .await
    .unwrap();

    assert_eq!(updated.body["name"], json!("Renamed"));
    assert_eq!(updated.body["interestRate"], json!(3.5), "not reset to 0");
    assert_eq!(updated.body["earnsInterest"], json!(true), "not reset");
    assert_eq!(updated.body["type"], json!("Savings"), "not reset");
    assert_eq!(updated.body["balance"], json!(100.0), "not reset");
}

#[tokio::test]
async fn archive_and_unarchive_round_trip() {
    let pool = db().await;
    let id = make_account(&pool, "Old", 0.0).await;

    let a = call(&pool, "POST", &format!("/accounts/{id}/archive"), None)
        .await
        .unwrap();
    assert_eq!(a.body["archived"], json!(true));

    let u = call(&pool, "POST", &format!("/accounts/{id}/unarchive"), None)
        .await
        .unwrap();
    assert_eq!(u.body["archived"], json!(false));
}

#[tokio::test]
async fn every_endpoint_reports_a_missing_account_as_404() {
    let pool = db().await;
    let missing = "cmissingaccountid00000000";

    let cases: Vec<(&str, String, Option<Value>)> = vec![
        ("GET", format!("/accounts/{missing}"), None),
        (
            "PUT",
            format!("/accounts/{missing}"),
            Some(json!({ "name": "x" })),
        ),
        ("DELETE", format!("/accounts/{missing}"), None),
        ("POST", format!("/accounts/{missing}/archive"), None),
        ("POST", format!("/accounts/{missing}/unarchive"), None),
        (
            "POST",
            format!("/accounts/{missing}/recalculate-balance"),
            None,
        ),
        (
            "POST",
            format!("/accounts/{missing}/rebuild-balance-chain"),
            None,
        ),
        (
            "POST",
            format!("/accounts/{missing}/rewards-account"),
            Some(json!({})),
        ),
    ];

    for (method, path, body) in cases {
        let err = call(&pool, method, &path, body)
            .await
            .unwrap_err_or_panic(&format!("{method} {path} should 404"));
        assert_eq!(err.status, 404, "{method} {path}");
    }
}

#[tokio::test]
async fn delete_unlinks_recurring_items_rather_than_cascading_into_them() {
    let pool = db().await;
    let id = make_account(&pool, "Doomed", 0.0).await;

    let now = avoir_api::id::now_iso();
    sqlx::query(r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt") VALUES ('bg1','Bills','#000',?)"#)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
           VALUES ('bud1','Housing',0,?,'bg1',0)"#,
    )
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Expense" ("id","name","amount","frequency","budgetId","accountId",
                                  "isAutomatic","dueDay","skipWeekend","createdAt","updatedAt")
           VALUES ('exp_keep','Rent',150000,'MONTHLY','bud1',?,0,1,0,?,?)"#,
    )
    .bind(&id)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let r = call(&pool, "DELETE", &format!("/accounts/{id}"), None)
        .await
        .unwrap();
    assert_eq!(r.status, 204, "delete returns 204 with no body");

    // The expense is a real recurring item the user still has. Deleting the
    // account it was paid from must not delete the expense — it detaches.
    let account_id: Option<String> =
        sqlx::query_scalar(r#"SELECT "accountId" FROM "Expense" WHERE "id" = 'exp_keep'"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(account_id, None, "expense survives, detached");
}

#[tokio::test]
async fn an_unknown_route_is_a_404_not_a_panic() {
    let pool = db().await;
    let err = call(&pool, "GET", "/accounts/x/y/z/nonsense", None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 404);

    let err = call(&pool, "PATCH", "/accounts", None).await.unwrap_err();
    assert_eq!(err.status, 404, "an unrouted METHOD is also a 404");
}

#[tokio::test]
async fn a_malformed_body_is_a_400_with_the_error_shape_the_frontend_parses() {
    let pool = db().await;

    // Missing the required `name`.
    let err = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "type": "Checking" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    assert!(err.details.is_some(), "400s carry details");

    // request.ts renders `details` as `field: message` pairs, so the shape is
    // part of the contract, not decoration.
    let d = err.to_json();
    assert!(d["details"][0]["field"].is_string());
    assert!(d["details"][0]["message"].is_string());

    let err = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "", "type": "Checking" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400, "empty name is rejected");

    let err = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "R", "type": "Savings", "interestRate": 250.0 })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400, "interestRate is bounded to 0..100");
}

/// `unwrap_err` with a message, so a failing case names the endpoint.
trait UnwrapErrOrPanic {
    fn unwrap_err_or_panic(self, msg: &str) -> ApiError;
}
impl UnwrapErrOrPanic for Result<Response, ApiError> {
    fn unwrap_err_or_panic(self, msg: &str) -> ApiError {
        match self {
            Ok(r) => panic!("{msg} — got {} instead", r.status),
            Err(e) => e,
        }
    }
}

#[tokio::test]
async fn recalculate_balance_reports_and_repairs_drift() {
    let pool = db().await;
    let id = make_account(&pool, "Drifted", 1000.00).await;

    // Corrupt the stored total directly, simulating the drift this endpoint
    // exists to repair (ADR-013's hundreds of dollars card).
    sqlx::query(r#"UPDATE "Account" SET "balance" = 999999 WHERE "id" = ?"#)
        .bind(&id)
        .execute(&pool)
        .await
        .unwrap();

    let r = call(
        &pool,
        "POST",
        &format!("/accounts/{id}/recalculate-balance"),
        None,
    )
    .await
    .unwrap();

    assert_eq!(r.body["oldBalance"], json!(9999.99));
    // Seeded from openingBalance, NOT from zero. Summing from zero is what
    // silently discarded the Starting Balance and moved real balances by
    // thousands.
    assert_eq!(r.body["newBalance"], json!(1000.00));
    assert_eq!(r.body["difference"], json!(-8999.99));

    let stored: i64 = sqlx::query_scalar(r#"SELECT "balance" FROM "Account" WHERE "id" = ?"#)
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored, 100000, "the repair is persisted, not just reported");

    let mut conn = pool.acquire().await.unwrap();
    assert!(avoir_db::balance::check_invariant(&mut conn)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn rebuild_balance_chain_rewrites_the_per_row_chain() {
    let pool = db().await;
    let id = make_account(&pool, "Chained", 1000.00).await;
    let now = avoir_api::id::now_iso();
    sqlx::query(r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt") VALUES ('bg1','B','#000',?)"#)
        .bind(&now).execute(&pool).await.unwrap();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
                   VALUES ('bud1','G',0,?,'bg1',0)"#,
    )
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    for (i, amt) in [10.00_f64, 20.00, 30.00].iter().enumerate() {
        call(
            &pool,
            "POST",
            "/transactions",
            Some(json!({
                "name": format!("Tx{i}"), "type": "EXPENSE", "amount": amt,
                "date": format!("2026-03-0{}T00:00:00.000Z", i + 1),
                "accountId": id, "budgetId": "bud1"
            })),
        )
        .await
        .unwrap();
    }

    // Blank the chain metadata, then rebuild it.
    sqlx::query(r#"UPDATE "Transaction" SET "balanceBefore" = NULL, "balanceAfter" = NULL"#)
        .execute(&pool)
        .await
        .unwrap();

    let r = call(
        &pool,
        "POST",
        &format!("/accounts/{id}/rebuild-balance-chain"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.body["updatedTransactions"], json!(3));
    assert_eq!(r.body["finalBalance"], json!(940.00), "1000 − 10 − 20 − 30");

    // Each row's balanceBefore must be the previous row's balanceAfter, seeded
    // from openingBalance — that continuity IS the chain.
    let chain: Vec<(i64, i64)> = sqlx::query_as(
        r#"SELECT "balanceBefore", "balanceAfter" FROM "Transaction"
            WHERE "accountId" = ? ORDER BY "date", "createdAt", "id""#,
    )
    .bind(&id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(chain, vec![(100000, 99000), (99000, 97000), (97000, 94000)]);
}

#[tokio::test]
async fn a_new_account_satisfies_the_invariant_however_its_start_is_given() {
    // `balance` is what the form sends and `openingBalance` is what the schema
    // also permits. With no transactions the two are equal by definition, so
    // either field alone has to seed both — otherwise the account violates
    // `openingBalance + SUM(tx) == balance` from birth and stays wrong until
    // something happens to rebuild it.
    for body in [
        json!({ "name": "A", "type": "CHECKING", "balance": 1000.00 }),
        json!({ "name": "B", "type": "CHECKING", "openingBalance": 1000.00 }),
        json!({ "name": "C", "type": "CHECKING", "balance": 1000.00, "openingBalance": 1000.00 }),
    ] {
        let name = body["name"].as_str().unwrap().to_string();
        let r = call(
            &pool_for(&name).await,
            "POST",
            "/accounts",
            Some(body.clone()),
        )
        .await
        .unwrap();
        assert_eq!(r.body["balance"], json!(1000.0), "{name}");
        assert_eq!(r.body["openingBalance"], json!(1000.0), "{name}");
    }
}

/// A fresh database per case, so one account's state cannot mask another's.
async fn pool_for(_label: &str) -> sqlx::SqlitePool {
    avoir_db::connect_in_memory().await.expect("test db")
}

#[tokio::test]
async fn a_new_account_holds_the_invariant_before_any_transaction() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Checking", "type": "CHECKING", "openingBalance": 1000.00 })),
    )
    .await
    .unwrap();
    let bad = avoir_db::balance::check_invariant(&mut pool.acquire().await.unwrap())
        .await
        .unwrap();
    assert!(bad.is_empty(), "out of balance at birth: {bad:?}");
}
