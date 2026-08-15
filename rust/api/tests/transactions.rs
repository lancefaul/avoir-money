//! `/transactions` through the dispatcher — the ledger surface.
//!
//! The write endpoints go through the ledger gate, so these assert the gate's
//! guarantees survive the route layer as well as the route's own behaviour.
//! A handler that writes correctly but reports the wrong shape is still broken,
//! because the frontend Zod-parses every response.

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

/// An account plus the budget scaffolding a transaction needs.
async fn fixture(pool: &SqlitePool) -> String {
    let now = avoir_api::id::now_iso();
    sqlx::query(r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt") VALUES ('bg1','Bills','#000',?)"#)
        .bind(&now).execute(pool).await.unwrap();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
           VALUES ('bud1','Groceries',0,?,'bg1',0), ('bud_uncat','Uncategorized',0,?,'bg1',1)"#,
    )
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();

    let r = call(
        pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Checking", "type": "Checking", "balance": 1000.00 })),
    )
    .await
    .unwrap();
    r.body["id"].as_str().unwrap().to_string()
}

async fn add_tx(
    pool: &SqlitePool,
    account: &str,
    name: &str,
    ty: &str,
    amount: f64,
    date: &str,
) -> String {
    let r = call(
        pool,
        "POST",
        "/transactions",
        Some(json!({
            "name": name, "type": ty, "amount": amount,
            "date": date, "accountId": account, "budgetId": "bud1"
        })),
    )
    .await
    .expect("create transaction");
    r.body["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn a_created_expense_moves_the_account_balance_and_keeps_the_invariant() {
    let pool = db().await;
    let acct = fixture(&pool).await;

    let r = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "name": "Groceries", "type": "EXPENSE", "amount": 45.67,
            "date": "2026-03-01T00:00:00.000Z", "accountId": acct, "budgetId": "bud1"
        })),
    )
    .await
    .unwrap();

    assert_eq!(r.status, 201);
    assert_eq!(r.body["amount"], json!(45.67));
    assert_eq!(
        r.body["netAmount"],
        json!(45.67),
        "netAmount follows amount"
    );

    let acc = call(&pool, "GET", &format!("/accounts/{acct}"), None)
        .await
        .unwrap();
    assert_eq!(acc.body["balance"], json!(954.33), "1000.00 − 45.67");

    let mut conn = pool.acquire().await.unwrap();
    assert!(
        avoir_db::balance::check_invariant(&mut conn)
            .await
            .unwrap()
            .is_empty(),
        "openingBalance + SUM(tx) == balance must hold"
    );
}

#[tokio::test]
async fn an_amount_edit_carries_net_amount_and_the_balance_with_it() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    let id = add_tx(
        &pool,
        &acct,
        "Groceries",
        "EXPENSE",
        45.67,
        "2026-03-01T00:00:00.000Z",
    )
    .await;

    let r = call(
        &pool,
        "PUT",
        &format!("/transactions/{id}"),
        Some(json!({ "amount": 60.00 })),
    )
    .await
    .unwrap();

    // amount and netAmount disagreeing is the exact defect ADR-013 exists to
    // prevent — it drifted a card by hundreds of dollars before the gate existed.
    assert_eq!(r.body["amount"], json!(60.00));
    assert_eq!(r.body["netAmount"], json!(60.00));

    let acc = call(&pool, "GET", &format!("/accounts/{acct}"), None)
        .await
        .unwrap();
    assert_eq!(acc.body["balance"], json!(940.00), "1000.00 − 60.00");

    let mut conn = pool.acquire().await.unwrap();
    assert!(avoir_db::balance::check_invariant(&mut conn)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn deleting_a_transaction_returns_the_balance() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    let id = add_tx(
        &pool,
        &acct,
        "Groceries",
        "EXPENSE",
        45.67,
        "2026-03-01T00:00:00.000Z",
    )
    .await;

    let r = call(&pool, "DELETE", &format!("/transactions/{id}"), None)
        .await
        .unwrap();
    assert_eq!(r.status, 204);

    let acc = call(&pool, "GET", &format!("/accounts/{acct}"), None)
        .await
        .unwrap();
    assert_eq!(acc.body["balance"], json!(1000.00), "back to the opening");

    let mut conn = pool.acquire().await.unwrap();
    assert!(avoir_db::balance::check_invariant(&mut conn)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn totals_net_refunds_against_spending() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    add_tx(
        &pool,
        &acct,
        "Groceries",
        "EXPENSE",
        100.00,
        "2026-03-01T00:00:00.000Z",
    )
    .await;
    add_tx(
        &pool,
        &acct,
        "Return",
        "REFUND",
        30.00,
        "2026-03-02T00:00:00.000Z",
    )
    .await;
    add_tx(
        &pool,
        &acct,
        "Paycheck",
        "INCOME",
        500.00,
        "2026-03-03T00:00:00.000Z",
    )
    .await;

    let r = call(&pool, "GET", "/transactions", None).await.unwrap();

    // A refund is not income. Counting it as one would inflate both totals at
    // once — earned would read 530 and spent would read 100.
    assert_eq!(
        r.body["totalSpent"],
        json!(70.00),
        "100 spent − 30 refunded"
    );
    assert_eq!(r.body["totalEarned"], json!(500.00));
    assert_eq!(r.body["totalCount"], json!(3));
}

#[tokio::test]
async fn the_list_defaults_to_newest_first_and_can_be_reversed() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    add_tx(
        &pool,
        &acct,
        "First",
        "EXPENSE",
        1.00,
        "2026-01-01T00:00:00.000Z",
    )
    .await;
    add_tx(
        &pool,
        &acct,
        "Second",
        "EXPENSE",
        2.00,
        "2026-02-01T00:00:00.000Z",
    )
    .await;
    add_tx(
        &pool,
        &acct,
        "Third",
        "EXPENSE",
        3.00,
        "2026-03-01T00:00:00.000Z",
    )
    .await;

    let newest = call(&pool, "GET", "/transactions", None).await.unwrap();
    let names: Vec<&str> = newest.body["transactions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["Third", "Second", "First"]);

    let oldest = call(&pool, "GET", "/transactions?sortOrder=oldest", None)
        .await
        .unwrap();
    let names: Vec<&str> = oldest.body["transactions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["First", "Second", "Third"]);
}

#[tokio::test]
async fn the_cursor_walks_the_list_without_repeating_or_skipping() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    for i in 1..=5 {
        add_tx(
            &pool,
            &acct,
            &format!("Tx{i}"),
            "EXPENSE",
            i as f64,
            &format!("2026-03-0{i}T00:00:00.000Z"),
        )
        .await;
    }

    let p1 = call(&pool, "GET", "/transactions?limit=2", None)
        .await
        .unwrap();
    assert_eq!(p1.body["transactions"].as_array().unwrap().len(), 2);
    assert_eq!(p1.body["hasMore"], json!(true));

    let cursor = p1.body["nextCursor"].as_str().unwrap();
    let p2 = call(
        &pool,
        "GET",
        &format!("/transactions?limit=2&cursor={cursor}"),
        None,
    )
    .await
    .unwrap();

    let first: Vec<&str> = p1.body["transactions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["id"].as_str().unwrap())
        .collect();
    let second: Vec<&str> = p2.body["transactions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["id"].as_str().unwrap())
        .collect();
    for id in &second {
        assert!(!first.contains(id), "page 2 repeated a row from page 1");
    }
}

#[tokio::test]
async fn a_stale_cursor_is_a_400_not_an_empty_page() {
    let pool = db().await;
    fixture(&pool).await;
    let err = call(
        &pool,
        "GET",
        "/transactions?cursor=cgonemissing000000000000",
        None,
    )
    .await
    .unwrap_err();

    // ADR-024's lesson: a client holding an id that no longer exists needs to
    // be told so it can refetch. An empty page looks like "no data" and the UI
    // renders nothing forever.
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn search_finds_a_statement_figure_by_amount() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    add_tx(
        &pool,
        &acct,
        "Coffee",
        "EXPENSE",
        963.59,
        "2026-03-01T00:00:00.000Z",
    )
    .await;
    add_tx(
        &pool,
        &acct,
        "Other",
        "EXPENSE",
        12.00,
        "2026-03-02T00:00:00.000Z",
    )
    .await;

    // A whole number is a range: "963" finds 963.00–963.99, because someone
    // reading a statement types what they see.
    let r = call(&pool, "GET", "/transactions?search=963", None)
        .await
        .unwrap();
    assert_eq!(r.body["transactions"].as_array().unwrap().len(), 1);
    assert_eq!(r.body["transactions"][0]["name"], json!("Coffee"));

    // With a decimal point it is exact.
    let r = call(&pool, "GET", "/transactions?search=963.59", None)
        .await
        .unwrap();
    assert_eq!(r.body["transactions"].as_array().unwrap().len(), 1);

    let r = call(&pool, "GET", "/transactions?search=964", None)
        .await
        .unwrap();
    assert_eq!(r.body["transactions"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn search_matches_the_name_too() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    add_tx(
        &pool,
        &acct,
        "Trader Joes",
        "EXPENSE",
        40.00,
        "2026-03-01T00:00:00.000Z",
    )
    .await;
    add_tx(
        &pool,
        &acct,
        "Shell Gas",
        "EXPENSE",
        50.00,
        "2026-03-02T00:00:00.000Z",
    )
    .await;

    let r = call(&pool, "GET", "/transactions?search=Trader", None)
        .await
        .unwrap();
    assert_eq!(r.body["transactions"].as_array().unwrap().len(), 1);
    assert_eq!(r.body["transactions"][0]["name"], json!("Trader Joes"));
}

#[tokio::test]
async fn filters_narrow_the_set_and_the_totals_with_it() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    add_tx(
        &pool,
        &acct,
        "Jan",
        "EXPENSE",
        10.00,
        "2026-01-15T00:00:00.000Z",
    )
    .await;
    add_tx(
        &pool,
        &acct,
        "Feb",
        "EXPENSE",
        20.00,
        "2026-02-15T00:00:00.000Z",
    )
    .await;
    add_tx(
        &pool,
        &acct,
        "Mar",
        "INCOME",
        30.00,
        "2026-03-15T00:00:00.000Z",
    )
    .await;

    let r = call(&pool, "GET", "/transactions?type=EXPENSE", None)
        .await
        .unwrap();
    assert_eq!(r.body["totalCount"], json!(2));
    assert_eq!(r.body["totalSpent"], json!(30.00));
    // `type` is the ONE filter the money totals ignore — see
    // `the_totals_span_every_type_even_when_the_list_is_filtered`, which pins
    // that deliberately. Nothing above contradicts it: `totalSpent` never
    // counted income to begin with, so this pair of assertions holds either way.
    // Every other filter below narrows the totals as the name says.

    let r = call(
        &pool,
        "GET",
        "/transactions?dateFrom=2026-02-01T00:00:00.000Z&dateTo=2026-02-28T00:00:00.000Z",
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.body["totalCount"], json!(1));
    assert_eq!(r.body["transactions"][0]["name"], json!("Feb"));

    let r = call(
        &pool,
        "GET",
        &format!("/transactions?accountId={acct}"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.body["totalCount"], json!(3));
}

#[tokio::test]
async fn a_transaction_inherits_the_budget_of_the_expense_it_pays() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "Expense" ("id","name","amount","frequency","budgetId","accountId",
                                  "isAutomatic","dueDay","skipWeekend","createdAt","updatedAt")
           VALUES ('exp1','Rent',150000,'MONTHLY','bud1',?,0,1,0,?,?)"#,
    )
    .bind(&acct)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let r = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "type": "EXPENSE", "amount": 1500.00,
            "date": "2026-03-01T00:00:00.000Z", "accountId": acct, "expenseId": "exp1"
        })),
    )
    .await
    .unwrap();

    // Neither name nor budget was supplied. Dropping this inheritance drops
    // the row into Uncategorized despite it being unambiguously categorised by
    // what it pays.
    assert_eq!(r.body["budgetId"], json!("bud1"));
    assert_eq!(r.body["name"], json!("Rent"));

    // The response alone cannot prove this. The list query derives budgetId as
    // COALESCE(t.budgetId, e.budgetId, i.budgetId), so it reads "bud1" whether
    // or not the create actually stored it — a mutation removing the
    // inheritance passed the assertion above. What separates the two is the
    // STORED column, which is what budget filters and rollups query.
    let id = r.body["id"].as_str().unwrap();
    let stored: Option<String> =
        sqlx::query_scalar(r#"SELECT "budgetId" FROM "Transaction" WHERE "id" = ?"#)
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        stored.as_deref(),
        Some("bud1"),
        "budget must be stored, not just derived on read"
    );

    // And the consequence that makes it matter: filtering by that budget has
    // to find the row.
    let filtered = call(&pool, "GET", "/transactions?budgetIds=bud1", None)
        .await
        .unwrap();
    assert_eq!(
        filtered.body["totalCount"],
        json!(1),
        "an uninherited row is invisible to its own budget filter"
    );
}

#[tokio::test]
async fn money_survives_the_round_trip_through_a_write() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    let id = add_tx(
        &pool,
        &acct,
        "Odd",
        "EXPENSE",
        0.07,
        "2026-03-01T00:00:00.000Z",
    )
    .await;

    let stored: i64 = sqlx::query_scalar(r#"SELECT "amount" FROM "Transaction" WHERE "id" = ?"#)
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored, 7, "integer cents, not a float");

    let r = call(&pool, "GET", "/transactions", None).await.unwrap();
    assert_eq!(r.body["transactions"][0]["amount"], json!(0.07));
}

#[tokio::test]
async fn a_hundred_small_expenses_sum_exactly() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    for i in 0..100 {
        add_tx(
            &pool,
            &acct,
            "Cent",
            "EXPENSE",
            0.10,
            &format!("2026-03-{:02}T00:00:00.000Z", (i % 28) + 1),
        )
        .await;
    }

    // In float arithmetic 0.1 summed 100 times is 9.999999999999998. Integer
    // cents makes that impossible by construction, which is the whole of
    // ADR-033 in one assertion.
    let r = call(&pool, "GET", "/transactions?limit=200", None)
        .await
        .unwrap();
    assert_eq!(r.body["totalSpent"], json!(10.00));

    let acc = call(&pool, "GET", &format!("/accounts/{acct}"), None)
        .await
        .unwrap();
    assert_eq!(acc.body["balance"], json!(990.00));
}

#[tokio::test]
async fn a_missing_transaction_is_a_404_on_write_endpoints() {
    let pool = db().await;
    fixture(&pool).await;
    let missing = "cmissingtransaction000000";

    let err = call(
        &pool,
        "PUT",
        &format!("/transactions/{missing}"),
        Some(json!({ "amount": 1.0 })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 404);

    let err = call(&pool, "DELETE", &format!("/transactions/{missing}"), None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 404);
}

#[tokio::test]
async fn child_rows_never_appear_in_the_list() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    let parent = add_tx(
        &pool,
        &acct,
        "Basket",
        "EXPENSE",
        50.00,
        "2026-03-01T00:00:00.000Z",
    )
    .await;

    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","amount","date","createdAt","type","name","imported",
                                      "netAmount","isCashBack","parentId","budgetId")
           VALUES ('child1',2000,'2026-03-01T00:00:00.000Z',?,'EXPENSE','Line item',0,2000,0,?,'bud1')"#,
    ).bind(&now).bind(&parent).execute(&pool).await.unwrap();

    // `parentId IS NULL` is load-bearing: a child is a sub-allocation of its
    // parent's amount, so listing both double-counts the spend.
    let r = call(&pool, "GET", "/transactions", None).await.unwrap();
    assert_eq!(r.body["totalCount"], json!(1));
    assert_eq!(r.body["totalSpent"], json!(50.00));
    assert_eq!(r.body["transactions"][0]["childCount"], json!(1));
}

#[tokio::test]
async fn clearing_a_link_differs_from_not_mentioning_it() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "Expense" ("id","name","amount","frequency","budgetId","accountId",
                                  "isAutomatic","dueDay","skipWeekend","createdAt","updatedAt")
           VALUES ('exp1','Rent',150000,'MONTHLY','bud1',?,0,1,0,?,?)"#,
    )
    .bind(&acct)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let r = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "type": "EXPENSE", "amount": 1500.00, "date": "2026-03-01T00:00:00.000Z",
            "accountId": acct, "expenseId": "exp1", "budgetId": "bud1"
        })),
    )
    .await
    .unwrap();
    let id = r.body["id"].as_str().unwrap().to_string();
    assert_eq!(r.body["expenseId"], json!("exp1"));

    // Omitting the field must leave the link standing.
    let kept = call(
        &pool,
        "PUT",
        &format!("/transactions/{id}"),
        Some(json!({ "name": "Rent (March)" })),
    )
    .await
    .unwrap();
    assert_eq!(
        kept.body["expenseId"],
        json!("exp1"),
        "omitted means leave alone"
    );

    // An explicit null must clear it. A bare Option<Option<T>> CANNOT express
    // this — serde folds a JSON null into the outer None, identically to a
    // missing key, so "unlink this from its recurring item" silently became a
    // no-op until the field got an explicit deserializer.
    let cleared = call(
        &pool,
        "PUT",
        &format!("/transactions/{id}"),
        Some(json!({ "expenseId": null })),
    )
    .await
    .unwrap();
    assert_eq!(
        cleared.body["expenseId"],
        json!(null),
        "explicit null means clear"
    );
}

#[tokio::test]
async fn a_transaction_cannot_be_created_without_a_type() {
    let pool = db().await;
    let acct = fixture(&pool).await;

    // Transaction.type has NO CHECK constraint, so an empty type inserts
    // cleanly — and the balance rule's ELSE 0 branch matches no known type,
    // producing a row that appears in the ledger and moves no balance. A
    // silently weightless transaction is worse than a rejected request.
    let err = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "name": "Ghost", "amount": 50.00,
            "date": "2026-03-01T00:00:00.000Z", "accountId": acct
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);

    let err = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "name": "Undated", "type": "EXPENSE", "amount": 50.00, "accountId": acct
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400, "a missing date is also rejected");

    // Nothing was written, so the balance is untouched.
    let acc = call(&pool, "GET", &format!("/accounts/{acct}"), None)
        .await
        .unwrap();
    assert_eq!(acc.body["balance"], json!(1000.00));
}

// ─── Payment splits in the list (ADR-030) ───
//
// These three exist because the differential harness found the port collapsing
// purchase groups server-side, and 804 tests did not notice. The reference is
// subtle here in a way that reads like a bug and is not: `excludeLegs` is
// applied to the count and the three aggregates, and pointedly NOT to the
// `findMany` that builds the page.

/// Anchor + two legs, from one purchase.
async fn split_purchase(pool: &SqlitePool, a: &str, b: &str) -> String {
    let r = call(
        pool,
        "POST",
        "/purchases",
        Some(json!({
            "name": "Big shop", "date": "2026-03-01T00:00:00.000Z", "amount": 100.00,
            "budgetId": "bud1",
            "payments": [
                { "accountId": a, "amount": 60.00 },
                { "accountId": b, "amount": 40.00 }
            ]
        })),
    )
    .await
    .expect("create purchase");
    r.body["purchaseGroupId"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn a_split_purchase_lists_its_legs_but_counts_once() {
    let pool = db().await;
    let a = fixture(&pool).await;
    let r = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Card", "type": "Credit Card", "balance": 0.0 })),
    )
    .await
    .unwrap();
    let b = r.body["id"].as_str().unwrap().to_string();

    split_purchase(&pool, &a, &b).await;

    let r = call(&pool, "GET", "/transactions", None).await.unwrap();
    let rows = r.body["transactions"].as_array().unwrap();

    // The legs MUST be in the payload. `collapsePurchaseGroups` in the web app
    // folds them into the Anchor itself and counts them to render "Paid from N
    // accounts"; a server that helpfully removes them deletes the badge's only
    // source and the purchase silently reads as single-account.
    let legs = rows
        .iter()
        .filter(|t| !t["purchaseGroupId"].is_null() && !t["accountId"].is_null())
        .count();
    assert_eq!(legs, 2, "both funding legs are listed");
    assert_eq!(
        rows.iter()
            .filter(|t| !t["purchaseGroupId"].is_null() && t["accountId"].is_null())
            .count(),
        1,
        "and so is the anchor"
    );

    // Counted once, though: the Anchor and each leg all carry the full total,
    // so counting or summing the three would report a $100 purchase as $200.
    assert_eq!(
        r.body["totalCount"],
        json!(1),
        "one purchase, not three rows"
    );
    assert_eq!(r.body["totalSpent"], json!(100.00), "not 200");
}

#[tokio::test]
async fn an_account_filtered_ledger_counts_that_accounts_leg() {
    let pool = db().await;
    let a = fixture(&pool).await;
    let r = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Card", "type": "Credit Card", "balance": 0.0 })),
    )
    .await
    .unwrap();
    let b = r.body["id"].as_str().unwrap().to_string();
    split_purchase(&pool, &a, &b).await;

    // Filtered to one account, the account-less Anchor drops out on its own and
    // the leg IS that account's row — so the exclusion must switch off, or the
    // ledger shows the account a purchase it never counts.
    let r = call(&pool, "GET", &format!("/transactions?accountId={a}"), None)
        .await
        .unwrap();
    assert_eq!(r.body["totalCount"], json!(1));
    assert_eq!(
        r.body["totalSpent"],
        json!(60.00),
        "this account's share, not the whole purchase"
    );
}

#[tokio::test]
async fn editing_a_payment_leg_reports_the_row_it_just_wrote() {
    let pool = db().await;
    let a = fixture(&pool).await;
    let r = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Card", "type": "Credit Card", "balance": 0.0 })),
    )
    .await
    .unwrap();
    let b = r.body["id"].as_str().unwrap().to_string();
    let group = split_purchase(&pool, &a, &b).await;

    let leg: String = sqlx::query_scalar(
        r#"SELECT "id" FROM "Transaction"
            WHERE "purchaseGroupId" = ? AND "accountId" IS NOT NULL LIMIT 1"#,
    )
    .bind(&group)
    .fetch_one(&pool)
    .await
    .unwrap();

    // `fetch_serialized` — the read-back every write path uses to report what it
    // touched — shares its query with the list. While that query excluded legs,
    // the write SUCCEEDED and then 404'd on its own way out: the row was edited
    // and the caller was told it did not exist. The same read is behind
    // mark-as-paid and the children routes.
    let r = call(
        &pool,
        "PUT",
        &format!("/transactions/{leg}"),
        Some(json!({ "note": "split share" })),
    )
    .await
    .expect("a leg is a real transaction and reads back like one");
    assert_eq!(r.body["id"], json!(leg));
    assert_eq!(r.body["note"], json!("split share"));
}

#[tokio::test]
async fn the_totals_span_every_type_even_when_the_list_is_filtered() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    add_tx(
        &pool,
        &acct,
        "Groceries",
        "EXPENSE",
        100.00,
        "2026-03-01T00:00:00.000Z",
    )
    .await;
    add_tx(
        &pool,
        &acct,
        "Paycheck",
        "INCOME",
        500.00,
        "2026-03-02T00:00:00.000Z",
    )
    .await;

    let r = call(&pool, "GET", "/transactions?type=EXPENSE", None)
        .await
        .unwrap();

    // The list narrows; the summary above it does not. The two figures describe
    // the PERIOD being looked at, so filtering to expenses must not report that
    // nothing was earned. The reference does this by spreading its `where` and
    // overwriting `type` per aggregate, which is easy to read as a slip.
    assert_eq!(r.body["transactions"].as_array().unwrap().len(), 1);
    assert_eq!(r.body["totalCount"], json!(1));
    assert_eq!(r.body["totalSpent"], json!(100.00));
    assert_eq!(
        r.body["totalEarned"],
        json!(500.00),
        "income is still reported under a type=EXPENSE filter"
    );
}

#[tokio::test]
async fn the_default_page_is_a_hundred_rows() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    for i in 0..105 {
        add_tx(
            &pool,
            &acct,
            &format!("Row {i}"),
            "EXPENSE",
            1.00,
            "2026-03-01T00:00:00.000Z",
        )
        .await;
    }

    // A default page size is part of the contract, not an implementation detail.
    // Under cursor pagination it decides where `nextCursor` points, so a client
    // walking the ledger lands on different boundaries than the reference would
    // have produced — and the port shipped with 50 against the reference's 100
    // with nothing to notice it.
    let r = call(&pool, "GET", "/transactions", None).await.unwrap();
    assert_eq!(r.body["transactions"].as_array().unwrap().len(), 100);
    assert_eq!(r.body["hasMore"], json!(true));
    assert_eq!(r.body["totalCount"], json!(105));

    // And an explicit limit still wins.
    let r = call(&pool, "GET", "/transactions?limit=10", None)
        .await
        .unwrap();
    assert_eq!(r.body["transactions"].as_array().unwrap().len(), 10);
}

// ─── Trades: the feature that was inert ───────────────────────────────────
//
// `POST /transactions` did not deserialize `tradeMetadata` at all. serde
// discards unknown fields by default and `LedgerCreate` was built with a
// hardcoded `trade: None`, so a fully-formed stock purchase returned 201 with a
// real id, wrote NO `TradeDetail`, and updated no holding. Nothing reported a
// problem — not the 834 tests, not either differential harness.
//
// The harnesses could not have caught it, and the reason is worth keeping: the
// read harness reads PRODUCTION, where every trade was written by the
// TypeScript backend and therefore has its detail row, and the write scenario
// had no trade step. A create the fixture never performs is a create nobody
// checks.

async fn custodian(pool: &SqlitePool) -> String {
    let r = call(
        pool,
        "POST",
        "/investments/custodians",
        Some(json!({ "name": "Fidelity" })),
    )
    .await
    .expect("create custodian");
    r.body["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn a_trade_writes_its_detail_row_and_moves_the_holding() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    let cust = custodian(&pool).await;

    let r = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "name": "Buy AAPL", "type": "TRADE", "amount": 1000.00,
            "date": "2026-03-02T00:00:00.000Z", "accountId": acct,
            "tradeMetadata": {
                "direction": "BUY", "assetType": "Stock", "ticker": "AAPL",
                "unitPrice": 100.0, "quantity": 10, "custodianId": cust,
            }
        })),
    )
    .await
    .expect("create trade");

    // The response carries the metadata back. This is the half a shape-only
    // check would catch.
    assert_eq!(r.body["tradeMetadata"]["direction"], json!("BUY"));
    assert_eq!(r.body["tradeMetadata"]["ticker"], json!("AAPL"));
    assert_eq!(r.body["tradeMetadata"]["custodianId"], json!(cust));

    // And the half it would not: the detail row and the holding it drives.
    // The broken version wrote the `Transaction` too, so asserting on that
    // alone proves nothing.
    let detail: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "TradeDetail""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(detail, 1, "a TRADE must write its detail row");

    let (qty, basis): (String, i64) = sqlx::query_as(
        r#"SELECT "quantity", "costBasis" FROM "InvestmentHolding" WHERE "ticker" = 'AAPL'"#,
    )
    .fetch_one(&pool)
    .await
    .expect("the buy must create a holding");
    assert_eq!(qty.parse::<f64>().unwrap(), 10.0);
    assert_eq!(basis, 100_000, "$1,000 basis in cents");

    // A BUY debits the funding account. The balance rule reads the DETAIL row's
    // direction (`CASE d."direction"`), so with no detail row the `ELSE 0` arm
    // matched and a trade moved no money at all.
    let bal: i64 = sqlx::query_scalar(r#"SELECT "balance" FROM "Account" WHERE "id" = ?"#)
        .bind(&acct)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(bal, 0, "1000.00 opening less a 1000.00 buy");
}

#[tokio::test]
async fn selling_more_than_is_held_is_refused() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    let cust = custodian(&pool).await;

    let sell = |qty: f64| {
        json!({
            "name": "Sell AAPL", "type": "TRADE", "amount": 100.00,
            "date": "2026-03-03T00:00:00.000Z", "accountId": acct,
            "tradeMetadata": {
                "direction": "SELL", "assetType": "Stock", "ticker": "AAPL",
                "unitPrice": 100.0, "quantity": qty, "custodianId": cust,
            }
        })
    };

    // Nothing held yet, so any sale is short.
    let e = call(&pool, "POST", "/transactions", Some(sell(1.0)))
        .await
        .expect_err("selling nothing must fail");
    assert_eq!(e.status, 400);
    assert!(e.error.starts_with("Insufficient holdings"), "{}", e.error);

    // A BUY validates nothing by design — it creates the holding it needs.
    call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "name": "Buy AAPL", "type": "TRADE", "amount": 1000.00,
            "date": "2026-03-02T00:00:00.000Z", "accountId": acct,
            "tradeMetadata": {
                "direction": "BUY", "assetType": "Stock", "ticker": "AAPL",
                "unitPrice": 100.0, "quantity": 10, "custodianId": cust,
            }
        })),
    )
    .await
    .expect("buy");

    call(&pool, "POST", "/transactions", Some(sell(4.0)))
        .await
        .expect("selling within the holding is fine");
    let e = call(&pool, "POST", "/transactions", Some(sell(99.0)))
        .await
        .expect_err("selling beyond it is not");
    assert_eq!(e.status, 400);
}

// ─── The refusals ─────────────────────────────────────────────────────────

#[tokio::test]
async fn an_unknown_transaction_type_is_refused() {
    let pool = db().await;
    let acct = fixture(&pool).await;

    // `Transaction.type` has no CHECK constraint, so an unrecognised type
    // inserts cleanly and then matches no branch of the balance rule's CASE —
    // a row that shows in the ledger and moves no money.
    for bad in ["GIFT", "expense", ""] {
        let e = call(
            &pool,
            "POST",
            "/transactions",
            Some(json!({
                "name": "Wrong", "type": bad, "amount": 10.00,
                "date": "2026-03-01T00:00:00.000Z", "accountId": acct
            })),
        )
        .await
        .unwrap_err();
        assert_eq!(e.status, 400, "type {bad:?} must be refused");
    }

    let n: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "Transaction""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0, "a refused create must write nothing");
}

#[tokio::test]
async fn the_cross_field_rules_are_actually_called() {
    let pool = db().await;
    let acct = fixture(&pool).await;

    // `cross_field_issues` was ported in full, differentially tested against
    // the TypeScript, and called by NOTHING but its own test. The rules existed,
    // were correct, and ran on no request. This asserts they are wired in.
    let e = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "name": "Bare trade", "type": "TRADE", "amount": 100.00,
            "date": "2026-03-01T00:00:00.000Z", "accountId": acct
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(e.status, 400);
    assert_eq!(
        e.details.as_ref().unwrap()[0]["message"],
        json!("Trade metadata is required for TRADE transactions")
    );

    // Cash back is a statement about income; on any other type it is a flag
    // nobody can interpret later.
    let e = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "name": "Rebate", "type": "EXPENSE", "amount": 10.00,
            "date": "2026-03-01T00:00:00.000Z", "accountId": acct,
            "isCashBack": true
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(e.status, 400);
    assert_eq!(
        e.details.as_ref().unwrap()[0]["message"],
        json!("Cash back can only be set on INCOME transactions")
    );
}

#[tokio::test]
async fn a_transfer_needs_a_distinct_destination() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    let base = |extra: Value| {
        let mut b = json!({
            "name": "Move it", "type": "TRANSFER", "amount": 10.00,
            "date": "2026-03-01T00:00:00.000Z", "accountId": acct
        });
        for (k, v) in extra.as_object().unwrap() {
            b[k] = v.clone();
        }
        b
    };

    let e = call(&pool, "POST", "/transactions", Some(base(json!({}))))
        .await
        .unwrap_err();
    assert_eq!(e.error, "Transfers require a toAccountId");

    let e = call(
        &pool,
        "POST",
        "/transactions",
        Some(base(json!({ "toAccountId": acct }))),
    )
    .await
    .unwrap_err();
    assert_eq!(e.error, "From and to accounts must be different");
}

#[tokio::test]
async fn an_unparseable_date_is_a_bad_request_not_a_crash() {
    let pool = db().await;
    let acct = fixture(&pool).await;

    // The ledger gate DOES catch this ("transaction date is not a date") but as
    // an internal error, so the caller got a 500 and "Internal server error"
    // where the reference names the field. The gate's check stays as a
    // backstop: reaching it means a route forgot to validate, which is a
    // programming error rather than a bad request.
    let e = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "name": "X", "type": "EXPENSE", "amount": 10.00,
            "date": "the third of never", "accountId": acct
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(e.status, 400);
    assert_eq!(e.details.as_ref().unwrap()[0]["field"], json!("date"));
}

#[tokio::test]
async fn the_page_size_is_bounded() {
    let pool = db().await;
    let _ = fixture(&pool).await;

    // `-1` is the one that matters. It PARSES, so the old
    // `parse().ok().unwrap_or(100)` accepted it — and SQLite reads a negative
    // LIMIT as no limit at all, making `?limit=-1` a request for the entire
    // ledger.
    for bad in ["-1", "0", "1000000", "lots", "1.5"] {
        let e = call(&pool, "GET", &format!("/transactions?limit={bad}"), None)
            .await
            .unwrap_err();
        assert_eq!(e.status, 400, "limit={bad} must be refused");
        assert_eq!(e.details.as_ref().unwrap()[0]["field"], json!("limit"));
    }

    for (q, field) in [("sortOrder=sideways", "sortOrder"), ("type=GIFT", "type")] {
        let e = call(&pool, "GET", &format!("/transactions?{q}"), None)
            .await
            .unwrap_err();
        assert_eq!(e.status, 400, "{q} must be refused");
        assert_eq!(e.details.as_ref().unwrap()[0]["field"], json!(field));
    }
}

#[tokio::test]
async fn a_validation_error_names_the_field_it_belongs_to() {
    let pool = db().await;

    // Every route module had its own `body_of` and all of them reported
    // `field: "body"`. The frontend renders that name against the input the
    // user has to fix, so a mistyped balance pointed at the form as a whole.
    let e = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "X", "type": "Checking", "balance": "100" })),
    )
    .await
    .unwrap_err();
    assert_eq!(e.details.as_ref().unwrap()[0]["field"], json!("balance"));

    // A MISSING field is a struct-level error with an empty path, so the name
    // has to come out of the message. That is most required-field failures in
    // the API, and every one of them used to land on "body".
    let e = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "type": "Checking", "balance": 0 })),
    )
    .await
    .unwrap_err();
    assert_eq!(e.details.as_ref().unwrap()[0]["field"], json!("name"));

    // And serde's ` at line 1 column 31` is dropped: it points into a buffer
    // this process created by re-serializing an already-parsed value, so it
    // describes text the caller never sent.
    let msg = e.details.as_ref().unwrap()[0]["message"].as_str().unwrap();
    assert!(
        !msg.contains("at line"),
        "position leaked into the message: {msg}"
    );
}

#[tokio::test]
async fn a_trade_quantity_and_price_must_be_positive_and_in_range() {
    let pool = db().await;
    let acct = fixture(&pool).await;
    let cust = custodian(&pool).await;

    // Found by the edge-case checklist rather than by the harness, because the
    // frontend form never sends any of these. `unitPrice` carried a
    // `#[serde(default)]`, so a missing one defaulted to zero and wrote a
    // holding with no cost basis; nothing checked either field for positivity,
    // and the reference has both as `z.number().positive()`.
    //
    // The out-of-range case is the one that was silently wrong: `Decimal` has a
    // far smaller range than `f64`, and the first version used
    // `unwrap_or_default()`, turning 1e30 into a holding quantity of ZERO.
    let bad = |q: Value, p: Value| {
        json!({
            "name": "Buy", "type": "TRADE", "amount": 100.00,
            "date": "2026-03-02T00:00:00.000Z", "accountId": acct,
            "tradeMetadata": {
                "direction": "BUY", "assetType": "Stock", "ticker": "AAPL",
                "unitPrice": p, "quantity": q, "custodianId": cust,
            }
        })
    };

    for (q, p, why) in [
        (json!(0), json!(100.0), "zero quantity"),
        (json!(-5), json!(100.0), "negative quantity"),
        (json!(10), json!(0), "zero unit price"),
        (json!(10), json!(-1.0), "negative unit price"),
        (json!(1e30), json!(100.0), "quantity beyond Decimal's range"),
    ] {
        let e = match call(&pool, "POST", "/transactions", Some(bad(q, p))).await {
            Err(e) => e,
            Ok(r) => panic!("{why} must be refused, got {}", r.body),
        };
        assert_eq!(e.status, 400, "{why}");
    }

    let n: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "InvestmentHolding""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0, "no refused trade may leave a holding behind");
}
