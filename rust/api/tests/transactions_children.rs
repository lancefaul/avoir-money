//! `/transactions/:id/children` and `/transactions/:id/link`.

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

async fn account(pool: &SqlitePool, opening: f64) -> String {
    call(
        pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Checking", "type": "CHECKING", "openingBalance": opening })),
    )
    .await
    .unwrap()
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
        Some(json!({ "name": format!("{name} group"), "color": "#fff" })),
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

async fn parent(pool: &SqlitePool, account_id: &str, amount: f64, ty: &str) -> String {
    call(
        pool,
        "POST",
        "/transactions",
        Some(json!({ "type": ty, "name": "Supermarket", "amount": amount,
                     "date": "2026-03-01", "accountId": account_id })),
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

// ═══ Children ═══

#[tokio::test]
async fn a_child_does_not_move_the_account_balance() {
    let pool = db().await;
    let acct = account(&pool, 1000.00).await;
    let b = budget(&pool, "Groceries").await;
    let p = parent(&pool, &acct, 100.00, "EXPENSE").await;
    let after_parent = balance(&pool, &acct).await;

    call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 40.00, "budgetId": b })),
    )
    .await
    .unwrap();

    // The whole reason a child may skip the ledger gate: `parentId` keeps it
    // out of every balance query, so it cannot double-count the parent.
    assert_eq!(balance(&pool, &acct).await, after_parent);
    assert!(
        avoir_db::balance::check_invariant(&mut pool.acquire().await.unwrap())
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn the_children_split_the_parent_and_report_what_is_left() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let p = parent(&pool, &acct, 100.00, "EXPENSE").await;
    let b = budget(&pool, "Groceries").await;

    for amount in [40.00, 25.50] {
        call(
            &pool,
            "POST",
            &format!("/transactions/{p}/children"),
            Some(json!({ "preTaxAmount": amount, "budgetId": b })),
        )
        .await
        .unwrap();
    }

    let r = call(&pool, "GET", &format!("/transactions/{p}/children"), None)
        .await
        .unwrap();
    assert_eq!(r.body["parentAmount"], json!(100.0));
    assert_eq!(r.body["remainingAmount"], json!(34.50));
    assert_eq!(r.body["children"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn a_tax_rate_and_a_tax_amount_reach_the_same_line_total() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let b = budget(&pool, "Groceries").await;
    let p = parent(&pool, &acct, 500.00, "EXPENSE").await;

    let by_rate = call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 100.00, "taxRate": 8.25, "budgetId": b })),
    )
    .await
    .unwrap();
    assert_eq!(by_rate.body["taxAmount"], json!(8.25));
    assert_eq!(by_rate.body["taxRate"], json!(8.25));

    let by_amount = call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 100.00, "taxAmount": 8.25, "budgetId": b })),
    )
    .await
    .unwrap();
    assert_eq!(by_amount.body["taxRate"], Value::Null);

    // The parts sum to the whole in both cases — the total is built from the
    // ROUNDED tax, not the raw product.
    for child in [&by_rate.body, &by_amount.body] {
        let (pre, tax) = (
            child["preTaxAmount"].as_f64().unwrap(),
            child["taxAmount"].as_f64().unwrap(),
        );
        assert_eq!(child["lineTotal"].as_f64().unwrap(), pre + tax);
    }
}

#[tokio::test]
async fn a_tax_amount_and_a_tax_rate_together_are_refused() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let b = budget(&pool, "Groceries").await;
    let p = parent(&pool, &acct, 500.00, "EXPENSE").await;

    // Supplying both invites them to disagree and gives no rule for which wins.
    let err = call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 100.00, "taxAmount": 8.25, "taxRate": 8.25, "budgetId": b })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn the_parts_may_not_exceed_the_whole() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let b = budget(&pool, "Groceries").await;
    let p = parent(&pool, &acct, 100.00, "EXPENSE").await;

    call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 90.00, "budgetId": b })),
    )
    .await
    .unwrap();

    let err = call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 10.01, "budgetId": b })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    assert!(err.error.contains("10"), "{}", err.error);

    // Exactly the remainder is allowed — the boundary is inclusive.
    call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 10.00, "budgetId": b })),
    )
    .await
    .unwrap();
    let r = call(&pool, "GET", &format!("/transactions/{p}/children"), None)
        .await
        .unwrap();
    assert_eq!(r.body["remainingAmount"], json!(0.0));
}

#[tokio::test]
async fn raising_a_child_is_judged_against_its_siblings_not_itself() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let b = budget(&pool, "Groceries").await;
    let p = parent(&pool, &acct, 100.00, "EXPENSE").await;
    let child = call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 90.00, "budgetId": b })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Counting the child against itself makes 91 look like 181 and refuses it.
    let r = call(
        &pool,
        "PUT",
        &format!("/transactions/{p}/children/{child}"),
        Some(json!({ "preTaxAmount": 91.00, "budgetId": b })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["lineTotal"], json!(91.0));

    let err = call(
        &pool,
        "PUT",
        &format!("/transactions/{p}/children/{child}"),
        Some(json!({ "preTaxAmount": 101.00, "budgetId": b })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn editing_a_note_does_not_convert_a_rate_into_a_fixed_amount() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let b = budget(&pool, "Groceries").await;
    let p = parent(&pool, &acct, 500.00, "EXPENSE").await;
    let child = call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 100.00, "taxRate": 8.25, "budgetId": b })),
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
        &format!("/transactions/{p}/children/{child}"),
        Some(json!({ "note": "receipt attached" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["taxRate"], json!(8.25), "still a rate");
    assert_eq!(r.body["note"], json!("receipt attached"));

    // And raising the pre-tax amount re-applies the rate rather than keeping
    // the old cash figure.
    let r = call(
        &pool,
        "PUT",
        &format!("/transactions/{p}/children/{child}"),
        Some(json!({ "preTaxAmount": 200.00, "budgetId": b })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["taxAmount"], json!(16.50));
}

#[tokio::test]
async fn supplying_a_tax_amount_clears_the_rate_it_replaces() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let b = budget(&pool, "Groceries").await;
    let p = parent(&pool, &acct, 500.00, "EXPENSE").await;
    let child = call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 100.00, "taxRate": 8.25, "budgetId": b })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    // The two cannot coexist, so setting one has to remove the other.
    let r = call(
        &pool,
        "PUT",
        &format!("/transactions/{p}/children/{child}"),
        Some(json!({ "taxAmount": 5.00 })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["taxRate"], Value::Null);
    assert_eq!(r.body["taxAmount"], json!(5.0));
    assert_eq!(r.body["lineTotal"], json!(105.0));
}

#[tokio::test]
async fn a_line_item_needs_a_budget_and_a_positive_amount() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let p = parent(&pool, &acct, 500.00, "EXPENSE").await;
    let b = budget(&pool, "Groceries").await;

    // Every one of these was refused by Zod on the TypeScript side. A port that
    // accepts what the original refused is a wider API with the same shape.
    for (label, body) in [
        ("no body at all", json!({})),
        ("no budget", json!({ "preTaxAmount": 10.0 })),
        (
            "blank budget",
            json!({ "preTaxAmount": 10.0, "budgetId": "  " }),
        ),
        ("zero amount", json!({ "preTaxAmount": 0.0, "budgetId": b })),
        (
            "negative amount",
            json!({ "preTaxAmount": -10.0, "budgetId": b }),
        ),
        (
            "negative tax",
            json!({ "preTaxAmount": 10.0, "taxAmount": -1.0, "budgetId": b }),
        ),
        (
            "rate over 100",
            json!({ "preTaxAmount": 10.0, "taxRate": 101.0, "budgetId": b }),
        ),
        (
            "negative rate",
            json!({ "preTaxAmount": 10.0, "taxRate": -1.0, "budgetId": b }),
        ),
        (
            "overlong note",
            json!({ "preTaxAmount": 10.0, "budgetId": b, "note": "x".repeat(501) }),
        ),
    ] {
        let err = call(
            &pool,
            "POST",
            &format!("/transactions/{p}/children"),
            Some(body),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, 400, "{label}");
    }

    // A line larger than the schema allows is refused as TOO LARGE, not merely
    // as exceeding its parent — both are 400s, and a test that only checks the
    // status cannot tell which rule fired. `preTaxAmount` becomes i64 cents, so
    // an unbounded f64 overflows the conversion before it looks wrong.
    let err = call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 1_000_000_000.0, "budgetId": b })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    let details = err.details.expect("a bounds failure names its field");
    assert_eq!(details[0]["field"], json!("preTaxAmount"));
    assert!(
        details[0]["message"]
            .as_str()
            .unwrap()
            .contains("too large"),
        "{details}"
    );

    // Nothing was written by any of them.
    let n: i64 =
        sqlx::query_scalar(r#"SELECT count(*) FROM "Transaction" WHERE "parentId" IS NOT NULL"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn an_update_is_bounded_by_the_same_rules() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let p = parent(&pool, &acct, 500.00, "EXPENSE").await;
    let b = budget(&pool, "Groceries").await;
    let child = call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 10.0, "budgetId": b })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    for (label, body) in [
        ("zero amount", json!({ "preTaxAmount": 0.0, "budgetId": b })),
        (
            "negative amount",
            json!({ "preTaxAmount": -5.0, "budgetId": b }),
        ),
        ("rate over 100", json!({ "taxRate": 101.0 })),
        ("blank budget", json!({ "budgetId": "" })),
        ("overlong note", json!({ "note": "x".repeat(501) })),
    ] {
        let err = call(
            &pool,
            "PUT",
            &format!("/transactions/{p}/children/{child}"),
            Some(body),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, 400, "{label}");
    }

    // An edit that touches only the note still works — the bounds are checked
    // against what was SUPPLIED, not against the merged row, so a rule added
    // later cannot make an old row uneditable.
    let r = call(
        &pool,
        "PUT",
        &format!("/transactions/{p}/children/{child}"),
        Some(json!({ "note": "fine" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["lineTotal"], json!(10.0));
}

#[tokio::test]
async fn only_spending_can_be_itemised() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let b = budget(&pool, "Groceries").await;

    for ty in ["INCOME", "TRANSFER"] {
        let mut tx = json!({ "type": ty, "name": "x", "amount": 100.00,
                            "date": "2026-03-01", "accountId": acct });
        if ty == "TRANSFER" {
            let other = call(
                &pool,
                "POST",
                "/accounts",
                Some(json!({ "name": "Savings", "type": "SAVINGS", "openingBalance": 0.0 })),
            )
            .await
            .unwrap();
            tx["toAccountId"] = other.body["id"].clone();
        }
        let id = call(&pool, "POST", "/transactions", Some(tx))
            .await
            .unwrap()
            .body["id"]
            .as_str()
            .unwrap()
            .to_string();

        let err = call(
            &pool,
            "POST",
            &format!("/transactions/{id}/children"),
            Some(json!({ "preTaxAmount": 10.00, "budgetId": b })),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, 400, "{ty}");
    }
}

#[tokio::test]
async fn a_child_cannot_be_split_again() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let b = budget(&pool, "Groceries").await;
    let p = parent(&pool, &acct, 100.00, "EXPENSE").await;
    let child = call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 40.00, "budgetId": b })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    // A child of a child would be invisible to the balance twice over.
    let err = call(
        &pool,
        "POST",
        &format!("/transactions/{child}/children"),
        Some(json!({ "preTaxAmount": 10.00, "budgetId": b })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn a_child_of_a_different_parent_is_not_found() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let b = budget(&pool, "Groceries").await;
    let p1 = parent(&pool, &acct, 100.00, "EXPENSE").await;
    let p2 = parent(&pool, &acct, 100.00, "EXPENSE").await;
    let child = call(
        &pool,
        "POST",
        &format!("/transactions/{p1}/children"),
        Some(json!({ "preTaxAmount": 40.00, "budgetId": b })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Reaching a child through the wrong parent would let one receipt's line
    // items be edited from another's.
    for (method, body) in [
        ("PUT", Some(json!({ "preTaxAmount": 1.0, "budgetId": b }))),
        ("DELETE", None),
    ] {
        let err = call(
            &pool,
            method,
            &format!("/transactions/{p2}/children/{child}"),
            body,
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, 404, "{method}");
    }
}

#[tokio::test]
async fn deleting_a_child_frees_its_share_and_leaves_the_balance_alone() {
    let pool = db().await;
    let acct = account(&pool, 1000.00).await;
    let b = budget(&pool, "Groceries").await;
    let p = parent(&pool, &acct, 100.00, "EXPENSE").await;
    let before = balance(&pool, &acct).await;
    let child = call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 40.00, "budgetId": b })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    let r = call(
        &pool,
        "DELETE",
        &format!("/transactions/{p}/children/{child}"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.status, 204);

    let list = call(&pool, "GET", &format!("/transactions/{p}/children"), None)
        .await
        .unwrap();
    assert_eq!(list.body["remainingAmount"], json!(100.0));
    assert_eq!(balance(&pool, &acct).await, before);
}

// ═══ Linking ═══

async fn expense(pool: &SqlitePool, budget_id: &str, amount: f64) -> String {
    call(
        pool,
        "POST",
        "/expenses",
        Some(
            json!({ "name": "Internet", "amount": amount, "frequency": "MONTHLY",
                     "budgetId": budget_id, "startDate": "2026-01-01", "dayOfMonth": 1 }),
        ),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn linking_adopts_the_sources_budget() {
    let pool = db().await;
    let acct = account(&pool, 1000.00).await;
    let b = budget(&pool, "Utilities").await;
    let e = expense(&pool, &b, 80.00).await;
    let tx = parent(&pool, &acct, 80.00, "EXPENSE").await;

    let r = call(
        &pool,
        "POST",
        &format!("/transactions/{tx}/link"),
        Some(json!({ "expenseId": e })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["expenseId"], json!(e));
    assert_eq!(r.body["budgetId"], json!(b));

    // Through the gate, so the balance is still right afterwards.
    assert!(
        avoir_db::balance::check_invariant(&mut pool.acquire().await.unwrap())
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn one_transaction_per_occurrence() {
    let pool = db().await;
    let acct = account(&pool, 1000.00).await;
    let b = budget(&pool, "Utilities").await;
    let e = expense(&pool, &b, 80.00).await;
    let first = parent(&pool, &acct, 80.00, "EXPENSE").await;
    let second = parent(&pool, &acct, 80.00, "EXPENSE").await;

    call(
        &pool,
        "POST",
        &format!("/transactions/{first}/link"),
        Some(json!({ "expenseId": e })),
    )
    .await
    .unwrap();

    // Two rows claiming the same bill on the same day would show one occurrence
    // paid twice and another unpaid.
    let err = call(
        &pool,
        "POST",
        &format!("/transactions/{second}/link"),
        Some(json!({ "expenseId": e })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 409);

    // Re-linking the SAME row is not a clash — the check excludes itself.
    call(
        &pool,
        "POST",
        &format!("/transactions/{first}/link"),
        Some(json!({ "expenseId": e })),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn a_different_date_is_a_different_occurrence() {
    let pool = db().await;
    let acct = account(&pool, 1000.00).await;
    let b = budget(&pool, "Utilities").await;
    let e = expense(&pool, &b, 80.00).await;

    let mut ids = Vec::new();
    for date in ["2026-03-01", "2026-04-01"] {
        let id = call(
            &pool,
            "POST",
            "/transactions",
            Some(
                json!({ "type": "EXPENSE", "name": "Internet", "amount": 80.00,
                         "date": date, "accountId": acct }),
            ),
        )
        .await
        .unwrap()
        .body["id"]
            .as_str()
            .unwrap()
            .to_string();
        ids.push(id);
    }
    for id in &ids {
        call(
            &pool,
            "POST",
            &format!("/transactions/{id}/link"),
            Some(json!({ "expenseId": e })),
        )
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn unlinking_clears_the_source_but_keeps_the_budget() {
    let pool = db().await;
    let acct = account(&pool, 1000.00).await;
    let b = budget(&pool, "Utilities").await;
    let e = expense(&pool, &b, 80.00).await;
    let tx = parent(&pool, &acct, 80.00, "EXPENSE").await;

    call(
        &pool,
        "POST",
        &format!("/transactions/{tx}/link"),
        Some(json!({ "expenseId": e })),
    )
    .await
    .unwrap();
    let r = call(&pool, "DELETE", &format!("/transactions/{tx}/link"), None)
        .await
        .unwrap();

    assert_eq!(r.body["expenseId"], Value::Null);
    // Unlinking says nothing about where the money should be counted, and the
    // user may have changed the budget since.
    assert_eq!(r.body["budgetId"], json!(b));
    assert!(
        avoir_db::balance::check_invariant(&mut pool.acquire().await.unwrap())
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn unlinking_something_that_was_never_linked_is_refused() {
    let pool = db().await;
    let acct = account(&pool, 1000.00).await;
    let tx = parent(&pool, &acct, 80.00, "EXPENSE").await;

    let err = call(&pool, "DELETE", &format!("/transactions/{tx}/link"), None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn linking_to_a_source_that_does_not_exist_is_a_404() {
    let pool = db().await;
    let acct = account(&pool, 1000.00).await;
    let tx = parent(&pool, &acct, 80.00, "EXPENSE").await;

    for body in [
        json!({ "expenseId": "nope" }),
        json!({ "incomeId": "nope" }),
    ] {
        let err = call(
            &pool,
            "POST",
            &format!("/transactions/{tx}/link"),
            Some(body),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, 404);
    }

    // And naming neither is a 400 rather than a silent no-op.
    let err = call(
        &pool,
        "POST",
        &format!("/transactions/{tx}/link"),
        Some(json!({})),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn a_missing_transaction_is_a_404_on_every_route_that_names_one() {
    let pool = db().await;
    for (method, path, body) in [
        ("GET", "/transactions/nope/children", None),
        (
            "POST",
            "/transactions/nope/children",
            Some(json!({ "preTaxAmount": 1.0, "budgetId": "any" })),
        ),
        (
            "PUT",
            "/transactions/nope/children/x",
            Some(json!({ "preTaxAmount": 1.0, "budgetId": "any" })),
        ),
        ("DELETE", "/transactions/nope/children/x", None),
        (
            "POST",
            "/transactions/nope/link",
            Some(json!({ "expenseId": "x" })),
        ),
        ("DELETE", "/transactions/nope/link", None),
    ] {
        let err = call(&pool, method, path, body).await.unwrap_err();
        assert_eq!(err.status, 404, "{method} {path}");
    }
}

#[tokio::test]
async fn a_child_reports_line_total_not_the_column_name() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let p = parent(&pool, &acct, 100.00, "EXPENSE").await;
    let b = budget(&pool, "Groceries").await;

    let r = call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 20.00, "taxRate": 8.25, "budgetId": b })),
    )
    .await
    .unwrap();

    // `ChildTransactionSchema` requires `lineTotal` and it is NOT optional, so
    // the port emitting the column name `amount` instead made every attempt to
    // split a purchase across budgets throw in the browser:
    //
    //   invalid_type, expected number, received undefined, path ["lineTotal"]
    //
    // The route was already covered by both harnesses. Neither could see it:
    // production has no split transactions, so every response was
    // `children: []`, which satisfies the schema trivially and compares equal
    // to the reference's empty array.
    assert_eq!(r.body["lineTotal"], json!(21.65), "20.00 + 8.25% tax");
    assert!(
        r.body.get("amount").is_none(),
        "`amount` is the column, not the wire name: {}",
        r.body
    );

    // Both are plain numbers in the schema, so a NULL column has to arrive as 0
    // rather than null, or the whole allocation list fails to parse.
    //
    // Written DIRECTLY, because a child created through the API always stores 0
    // rather than NULL. The first version of this posted one and asserted
    // `taxAmount == 0`, which passed whatever the serializer did with a null and
    // proved nothing — mutating the default to -1.0 and watching the test stay
    // green is what exposed that. Imported and pre-port rows are where real
    // NULLs live.
    let orphan = "child_with_null_tax";
    sqlx::query(
        r#"INSERT INTO "Transaction"
             ("id","type","name","amount","netAmount","date","createdAt","imported",
              "isCashBack","parentId","budgetId","preTaxAmount","taxAmount","taxRate")
           VALUES (?, 'EXPENSE', 'Legacy line', 500, 500, '2026-03-01T00:00:00.000Z',
                   '2026-03-01T00:00:00.000Z', 0, 0, ?, ?, NULL, NULL, NULL)"#,
    )
    .bind(orphan)
    .bind(&p)
    .bind(&b)
    .execute(&pool)
    .await
    .unwrap();

    let r = call(&pool, "GET", &format!("/transactions/{p}/children"), None)
        .await
        .unwrap();
    let legacy = r.body["children"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == orphan)
        .expect("the legacy line is listed")
        .clone();
    assert_eq!(
        legacy["taxAmount"],
        json!(0.0),
        "a NULL tax column is zero tax"
    );
    assert_eq!(legacy["preTaxAmount"], json!(0.0));
    assert_eq!(
        legacy["taxRate"],
        json!(null),
        "but no RATE is genuinely null"
    );
}

#[tokio::test]
async fn a_parent_with_line_items_refuses_deletion() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let p = parent(&pool, &acct, 100.00, "EXPENSE").await;
    let b = budget(&pool, "Groceries").await;
    call(
        &pool,
        "POST",
        &format!("/transactions/{p}/children"),
        Some(json!({ "preTaxAmount": 10.00, "budgetId": b })),
    )
    .await
    .unwrap();

    // `Transaction.parentId` is ON DELETE CASCADE, so without the guard the
    // line items go silently — and those are the user's categorisation of a
    // receipt, several deliberate decisions destroyed as a side effect of
    // deleting the parent. Same reasoning as ADR-004 refusing to delete an
    // archived expense: the destructive step is its own decision.
    let err = call(&pool, "DELETE", &format!("/transactions/{p}"), None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 409, "a conflict, not bad input");
    assert!(err.error.contains("Remove children first"), "{}", err.error);

    // And the children are still there.
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "Transaction" WHERE "parentId" = ?"#)
        .bind(&p)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
}
