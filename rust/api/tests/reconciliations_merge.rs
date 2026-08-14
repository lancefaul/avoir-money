//! `POST /reconciliations/{id}/merge` — N app rows become one parent + children.

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

async fn ok(pool: &SqlitePool, method: &str, path: &str, body: Option<Value>) -> Value {
    call(pool, method, path, body)
        .await
        .unwrap_or_else(|e| panic!("{method} {path} failed: {e}"))
        .body
}

async fn err(pool: &SqlitePool, method: &str, path: &str, body: Option<Value>) -> ApiError {
    call(pool, method, path, body)
        .await
        .err()
        .unwrap_or_else(|| panic!("{method} {path} unexpectedly succeeded"))
}

fn id_of(v: &Value) -> String {
    v["id"].as_str().expect("id").to_string()
}

async fn account(pool: &SqlitePool, name: &str, opening: f64) -> String {
    id_of(
        &ok(
            pool,
            "POST",
            "/accounts",
            Some(json!({ "name": name, "type": "CHECKING", "openingBalance": opening })),
        )
        .await,
    )
}

async fn budget(pool: &SqlitePool, name: &str) -> String {
    let g = ok(
        pool,
        "POST",
        "/budgets/groups",
        Some(json!({ "name": format!("{name} group"), "color": "#fff" })),
    )
    .await;
    id_of(
        &ok(
            pool,
            "POST",
            "/budgets",
            Some(json!({ "name": name, "groupId": g["id"] })),
        )
        .await,
    )
}

async fn tx(
    pool: &SqlitePool,
    acct: &str,
    name: &str,
    amount: f64,
    ty: &str,
    budget_id: Option<&str>,
) -> String {
    let mut body = json!({
        "name": name, "amount": amount, "date": "2026-03-05",
        "type": ty, "accountId": acct,
    });
    if let Some(b) = budget_id {
        body["budgetId"] = json!(b);
    }
    id_of(&ok(pool, "POST", "/transactions", Some(body)).await)
}

async fn session(pool: &SqlitePool, acct: &str, ending: f64) -> String {
    id_of(
        &ok(
            pool,
            "POST",
            "/reconciliations",
            Some(json!({
                "accountId": acct,
                "periodStart": "2026-03-01",
                "periodEnd": "2026-03-31",
                "statementEndingBalance": ending,
            })),
        )
        .await,
    )
}

/// One statement line for $30.00 on 2026-03-06, imported into a fresh session.
async fn session_with_row(pool: &SqlitePool, acct: &str, ending: f64) -> (String, String) {
    let sid = session(pool, acct, ending).await;
    ok(
        pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": "\
Transaction Date,Post Date,Description,Amount
3/5/2026,3/6/2026,BIG STORE,-30.00
" })),
    )
    .await;
    let d = ok(pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    let row = d["statementRows"][0]["id"].as_str().unwrap().to_string();
    (sid, row)
}

async fn balance(pool: &SqlitePool, acct: &str) -> f64 {
    ok(pool, "GET", &format!("/accounts/{acct}"), None).await["balance"]
        .as_f64()
        .unwrap()
}

// ═══ The happy path ═══

#[tokio::test]
async fn three_rows_become_one_parent_and_two_children_with_no_balance_change() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 100.0).await;
    let food = budget(&pool, "Food").await;
    let home = budget(&pool, "Home").await;

    let a = tx(&pool, &acct, "MILK", 10.0, "EXPENSE", Some(&food)).await;
    let b = tx(&pool, &acct, "SOAP", 12.5, "EXPENSE", Some(&home)).await;
    let c = tx(&pool, &acct, "BREAD", 7.5, "EXPENSE", Some(&food)).await;
    let before = balance(&pool, &acct).await;
    assert_eq!(before, 70.0);

    let (sid, row) = session_with_row(&pool, &acct, 70.0).await;

    let res = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/merge"),
        Some(json!({ "statementRowId": row, "transactionIds": [a, b, c], "name": "BIG STORE" })),
    )
    .await;

    assert_eq!(
        res["childCount"], 2,
        "one original became the parent's own share"
    );
    assert_eq!(res["match"]["matchType"], "MANUAL");
    let parent = res["parentTransactionId"].as_str().unwrap();
    assert_eq!(res["match"]["transactionId"], parent);

    // Balance-neutral: three rows at 30.00 became one row at 30.00.
    assert_eq!(balance(&pool, &acct).await, before);

    // The parent carries the bank's amount and POSTED date, and the chosen name.
    let listed = ok(
        &pool,
        "GET",
        &format!("/transactions?accountId={acct}"),
        None,
    )
    .await;
    let items = listed["transactions"].as_array().unwrap();
    assert_eq!(items.len(), 1, "only the parent is a top-level row now");
    assert_eq!(items[0]["id"], parent);
    assert_eq!(items[0]["name"], "BIG STORE");
    assert_eq!(items[0]["amount"], 30.0);
    assert_eq!(items[0]["date"], "2026-03-06T00:00:00.000Z");

    // The children hold the budgets the originals carried, and their names and
    // dates survive in the notes — a child has neither field of its own.
    let kids = ok(
        &pool,
        "GET",
        &format!("/transactions/{parent}/children"),
        None,
    )
    .await;
    let kids = kids["children"].as_array().unwrap();
    assert_eq!(kids.len(), 2);
    let notes: Vec<&str> = kids.iter().map(|k| k["note"].as_str().unwrap()).collect();
    assert!(notes.iter().all(|n| n.contains("2026-03-05")), "{notes:?}");
}

#[tokio::test]
async fn the_parent_takes_a_budgeted_row_as_its_own_share_not_an_empty_remainder() {
    // Which original becomes the parent is cosmetic — every budget still gets
    // its exact amount — but preferring one that HAS a budget keeps Uncategorized
    // for genuinely un-budgeted rows instead of surfacing it as a $0 remainder.
    let pool = db().await;
    let acct = account(&pool, "Checking", 100.0).await;
    let food = budget(&pool, "Food").await;

    // First row deliberately un-budgeted, so a naive "take originals[0]" would
    // put Uncategorized on the parent.
    let a = tx(&pool, &acct, "MYSTERY", 10.0, "EXPENSE", None).await;
    let b = tx(&pool, &acct, "MILK", 20.0, "EXPENSE", Some(&food)).await;
    let (sid, row) = session_with_row(&pool, &acct, 70.0).await;

    let res = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/merge"),
        Some(json!({ "statementRowId": row, "transactionIds": [a, b], "name": "BIG STORE" })),
    )
    .await;

    let parent = res["parentTransactionId"].as_str().unwrap();
    let listed = ok(
        &pool,
        "GET",
        &format!("/transactions?accountId={acct}"),
        None,
    )
    .await;
    let p = &listed["transactions"][0];
    assert_eq!(p["id"], parent);
    assert_eq!(p["budgetId"], food.as_str(), "the budgeted row led");
}

#[tokio::test]
async fn a_repeated_id_is_counted_and_deleted_once() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 100.0).await;
    let a = tx(&pool, &acct, "MILK", 30.0, "EXPENSE", None).await;
    let (sid, row) = session_with_row(&pool, &acct, 70.0).await;

    let res = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/merge"),
        // The same id three times. Without de-duplication it sums to 90 and the
        // eligibility check rejects a legitimate request.
        Some(json!({ "statementRowId": row, "transactionIds": [&a, &a, &a], "name": "BIG STORE" })),
    )
    .await;
    assert_eq!(res["childCount"], 0);
    assert_eq!(balance(&pool, &acct).await, 70.0);
}

// ═══ Eligibility ═══

#[tokio::test]
async fn the_selection_must_sum_to_the_statement_line_exactly() {
    // The parent carries the bank's amount, so anything else would not be
    // balance-neutral. In cents this is an equality — the TypeScript's 0.005
    // tolerance was wide enough to let a genuine half-cent through.
    let pool = db().await;
    let acct = account(&pool, "Checking", 100.0).await;
    let a = tx(&pool, &acct, "MILK", 10.0, "EXPENSE", None).await;
    let b = tx(&pool, &acct, "SOAP", 19.99, "EXPENSE", None).await;
    let (sid, row) = session_with_row(&pool, &acct, 70.01).await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/merge"),
        Some(json!({ "statementRowId": row, "transactionIds": [a, b], "name": "BIG STORE" })),
    )
    .await;
    assert_eq!(e.status, 400);
    assert!(e.error.contains("29.99"), "says what it got: {}", e.error);
    assert!(e.error.contains("30.00"), "and what it wanted: {}", e.error);

    // Nothing was written — the originals are still there.
    let listed = ok(
        &pool,
        "GET",
        &format!("/transactions?accountId={acct}"),
        None,
    )
    .await;
    assert_eq!(listed["transactions"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn income_and_transfers_cannot_be_merged() {
    // The split model stores each child with the parent's single type, so a
    // mixed set cannot be represented without miscounting one side.
    let pool = db().await;
    let acct = account(&pool, "Checking", 100.0).await;
    let a = tx(&pool, &acct, "PAY", 30.0, "INCOME", None).await;
    let (sid, row) = session_with_row(&pool, &acct, 130.0).await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/merge"),
        Some(json!({ "statementRowId": row, "transactionIds": [a], "name": "BIG STORE" })),
    )
    .await;
    assert_eq!(e.status, 400);
    assert!(e.error.contains("only expense and refund"), "{}", e.error);
}

#[tokio::test]
async fn expenses_and_refunds_cannot_be_mixed() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 100.0).await;
    let a = tx(&pool, &acct, "MILK", 40.0, "EXPENSE", None).await;
    let b = tx(&pool, &acct, "RETURN", 10.0, "REFUND", None).await;
    let (sid, row) = session_with_row(&pool, &acct, 70.0).await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/merge"),
        // Sums to 50 gross, so this must fail on TYPE, not on the sum — check the
        // message so the test cannot pass for the wrong reason.
        Some(json!({ "statementRowId": row, "transactionIds": [a, b], "name": "X" })),
    )
    .await;
    assert_eq!(e.status, 400);
    assert!(
        e.error.contains("all expenses or all refunds"),
        "failed on type, not on the sum: {}",
        e.error
    );
}

#[tokio::test]
async fn a_row_on_another_account_cannot_be_merged_into_this_one() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 100.0).await;
    let other = account(&pool, "Savings", 100.0).await;
    let a = tx(&pool, &acct, "MILK", 10.0, "EXPENSE", None).await;
    let b = tx(&pool, &other, "SOAP", 20.0, "EXPENSE", None).await;
    let (sid, row) = session_with_row(&pool, &acct, 90.0).await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/merge"),
        Some(json!({ "statementRowId": row, "transactionIds": [a, b], "name": "X" })),
    )
    .await;
    assert_eq!(e.status, 400);
    assert!(e.error.contains("not on the account"), "{}", e.error);
}

#[tokio::test]
async fn an_existing_child_allocation_cannot_be_merged() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 100.0).await;
    let food = budget(&pool, "Food").await;
    let parent = tx(&pool, &acct, "BASKET", 30.0, "EXPENSE", None).await;
    let child = ok(
        &pool,
        "POST",
        &format!("/transactions/{parent}/children"),
        Some(json!({ "preTaxAmount": 10.0, "budgetId": food })),
    )
    .await;
    let child_id = id_of(&child);
    let (sid, row) = session_with_row(&pool, &acct, 70.0).await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/merge"),
        Some(json!({ "statementRowId": row, "transactionIds": [child_id], "name": "X" })),
    )
    .await;
    assert_eq!(e.status, 400);
    assert!(e.error.contains("already part of a split"), "{}", e.error);
}

#[tokio::test]
async fn a_missing_transaction_is_a_404() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 100.0).await;
    let (sid, row) = session_with_row(&pool, &acct, 70.0).await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/merge"),
        Some(json!({ "statementRowId": row, "transactionIds": ["ghost"], "name": "X" })),
    )
    .await;
    assert_eq!(e.status, 404);
}

#[tokio::test]
async fn a_merge_needs_a_name() {
    // Asked for explicitly rather than inherited from an arbitrary row, so the
    // merged transaction is named by a decision instead of by accident.
    let pool = db().await;
    let acct = account(&pool, "Checking", 100.0).await;
    let a = tx(&pool, &acct, "MILK", 30.0, "EXPENSE", None).await;
    let (sid, row) = session_with_row(&pool, &acct, 70.0).await;

    for bad in ["", "   "] {
        let e = err(
            &pool,
            "POST",
            &format!("/reconciliations/{sid}/merge"),
            Some(json!({ "statementRowId": row, "transactionIds": [&a], "name": bad })),
        )
        .await;
        assert_eq!(e.status, 400);
    }
}

#[tokio::test]
async fn a_closed_session_cannot_merge() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 100.0).await;
    let a = tx(&pool, &acct, "MILK", 30.0, "EXPENSE", None).await;
    let (sid, row) = session_with_row(&pool, &acct, 70.0).await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/close"),
        None,
    )
    .await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/merge"),
        Some(json!({ "statementRowId": row, "transactionIds": [a], "name": "X" })),
    )
    .await;
    assert_eq!(e.status, 409);
}

#[tokio::test]
async fn a_statement_row_from_another_session_is_refused() {
    let pool = db().await;
    let acct = account(&pool, "Checking", 100.0).await;
    let other = account(&pool, "Savings", 0.0).await;
    let a = tx(&pool, &acct, "MILK", 30.0, "EXPENSE", None).await;
    let (sid, _) = session_with_row(&pool, &acct, 70.0).await;
    let (_, foreign_row) = session_with_row(&pool, &other, -30.0).await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/merge"),
        Some(json!({ "statementRowId": foreign_row, "transactionIds": [a], "name": "X" })),
    )
    .await;
    assert_eq!(e.status, 404);
}

// ═══ Atomicity ═══

#[tokio::test]
async fn a_merge_that_fails_part_way_leaves_the_ledger_exactly_as_it_was() {
    // A half-completed merge counts both the originals and the parent — the
    // precise discrepancy the reconciler exists to surface. Forced here by
    // pointing at a transaction that does not exist, after two that do.
    let pool = db().await;
    let acct = account(&pool, "Checking", 100.0).await;
    let a = tx(&pool, &acct, "MILK", 10.0, "EXPENSE", None).await;
    let b = tx(&pool, &acct, "SOAP", 20.0, "EXPENSE", None).await;
    let before = balance(&pool, &acct).await;
    let (sid, row) = session_with_row(&pool, &acct, 70.0).await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/merge"),
        Some(json!({ "statementRowId": row, "transactionIds": [&a, &b, "ghost"], "name": "X" })),
    )
    .await;
    assert_eq!(e.status, 404);

    assert_eq!(balance(&pool, &acct).await, before);
    let listed = ok(
        &pool,
        "GET",
        &format!("/transactions?accountId={acct}"),
        None,
    )
    .await;
    assert_eq!(listed["transactions"].as_array().unwrap().len(), 2);
    let matches: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "ReconciliationMatch""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(matches, 0);
}

#[tokio::test]
async fn merging_leaves_the_session_balanced_so_it_can_close() {
    // End to end: the merge is balance-neutral, so a session that balanced
    // before still balances after — and now closes.
    let pool = db().await;
    let acct = account(&pool, "Checking", 100.0).await;
    let a = tx(&pool, &acct, "MILK", 10.0, "EXPENSE", None).await;
    let b = tx(&pool, &acct, "SOAP", 20.0, "EXPENSE", None).await;
    let (sid, row) = session_with_row(&pool, &acct, 70.0).await;

    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/merge"),
        Some(json!({ "statementRowId": row, "transactionIds": [a, b], "name": "BIG STORE" })),
    )
    .await;

    let res = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/close"),
        None,
    )
    .await;
    assert_eq!(res["session"]["status"], "RECONCILED");
    assert_eq!(res["residual"]["isBalanced"], true);
    assert_eq!(res["clearedTransactions"], 1, "the merged parent");
}
