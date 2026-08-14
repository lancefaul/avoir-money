//! `/investments` — holdings, custodians and wallets.

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

async fn make_wallet(pool: &SqlitePool, name: &str) -> String {
    call(
        pool,
        "POST",
        "/investments/wallets",
        Some(json!({ "name": name })),
    )
    .await
    .expect("create wallet")
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn make_custodian(pool: &SqlitePool, name: &str) -> String {
    call(
        pool,
        "POST",
        "/investments/custodians",
        Some(json!({ "name": name })),
    )
    .await
    .expect("create custodian")
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

// ═══ Holdings ═══

#[tokio::test]
async fn a_holding_stores_quantity_exactly_and_cost_basis_in_cents() {
    let pool = db().await;
    let wid = make_wallet(&pool, "Cold Storage").await;

    let r = call(
        &pool,
        "POST",
        "/investments",
        Some(json!({
            "name": "BTC", "type": "BITCOIN",
            "quantity": 0.00000001, "costBasis": 1234.56, "walletId": wid
        })),
    )
    .await
    .unwrap();
    assert_eq!(r.status, 201);
    let id = r.body["id"].as_str().unwrap().to_string();

    // The two representations, read straight out of the columns. One satoshi
    // survives as an exact decimal; cents would have made it zero.
    let (qty, basis): (String, i64) =
        sqlx::query_as(r#"SELECT "quantity", "costBasis" FROM "InvestmentHolding" WHERE "id" = ?"#)
            .bind(&id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(qty, "0.00000001");
    assert_eq!(basis, 123_456, "cents");

    assert_eq!(r.body["quantity"], json!(0.00000001));
    assert_eq!(r.body["costBasis"], json!(1234.56));
}

#[tokio::test]
async fn the_list_hides_spent_positions_but_keeps_dust() {
    let pool = db().await;
    let w1 = make_wallet(&pool, "Held").await;
    let w2 = make_wallet(&pool, "Spent").await;
    let w3 = make_wallet(&pool, "Dust").await;

    for (name, wid, qty) in [
        ("Held", &w1, 1.5),
        ("Spent", &w2, 0.0),
        ("Dust", &w3, 0.00000001),
    ] {
        call(
            &pool,
            "POST",
            "/investments",
            Some(json!({ "name": name, "type": "BITCOIN", "quantity": qty, "walletId": wid })),
        )
        .await
        .unwrap();
    }

    let r = call(&pool, "GET", "/investments", None).await.unwrap();
    let names: Vec<&str> = r
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["name"].as_str().unwrap())
        .collect();
    // One satoshi is still a position. The filter is `> 0`, and doing it in
    // Rust is what makes that true — a SQL comparison against a TEXT column
    // would be answering a different question.
    assert_eq!(names, vec!["Dust", "Held"]);
}

#[tokio::test]
async fn a_negative_quantity_would_pass_a_lexicographic_filter_and_is_rejected() {
    let pool = db().await;
    let wid = make_wallet(&pool, "W").await;

    let err = call(
        &pool,
        "POST",
        "/investments",
        Some(json!({ "name": "Bad", "type": "BITCOIN", "quantity": -1.0, "walletId": wid })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn a_negative_quantity_written_behind_the_route_still_does_not_list() {
    let pool = db().await;
    let wid = make_wallet(&pool, "W").await;
    let id = call(
        &pool,
        "POST",
        "/investments",
        Some(json!({ "name": "Neg", "type": "BITCOIN", "quantity": 1.0, "walletId": wid })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Imported data could hold anything. `'-1' > '0'` is true as strings, so a
    // SQL filter would have shown this row; the parse says otherwise.
    sqlx::query(r#"UPDATE "InvestmentHolding" SET "quantity" = '-1' WHERE "id" = ?"#)
        .bind(&id)
        .execute(&pool)
        .await
        .unwrap();

    let r = call(&pool, "GET", "/investments", None).await.unwrap();
    assert_eq!(r.body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn a_stock_needs_a_custodian_and_may_not_carry_a_wallet() {
    let pool = db().await;
    let wid = make_wallet(&pool, "W").await;

    let err = call(
        &pool,
        "POST",
        "/investments",
        Some(json!({ "name": "AAPL", "type": "STOCK", "quantity": 10.0 })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    assert_eq!(err.details.unwrap()[0]["field"], json!("custodianId"));

    let cid = make_custodian(&pool, "Fidelity").await;
    let err = call(
        &pool,
        "POST",
        "/investments",
        Some(json!({ "name": "AAPL", "type": "STOCK", "quantity": 10.0,
                     "custodianId": cid, "walletId": wid })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    assert_eq!(err.details.unwrap()[0]["field"], json!("walletId"));
}

#[tokio::test]
async fn a_bitcoin_holding_needs_a_wallet_and_may_not_carry_a_custodian() {
    let pool = db().await;
    let cid = make_custodian(&pool, "Fidelity").await;

    let err = call(
        &pool,
        "POST",
        "/investments",
        Some(json!({ "name": "BTC", "type": "BITCOIN", "quantity": 1.0 })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.details.unwrap()[0]["field"], json!("walletId"));

    let wid = make_wallet(&pool, "W").await;
    let err = call(
        &pool,
        "POST",
        "/investments",
        Some(json!({ "name": "BTC", "type": "BITCOIN", "quantity": 1.0,
                     "walletId": wid, "custodianId": cid })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.details.unwrap()[0]["field"], json!("custodianId"));
}

#[tokio::test]
async fn a_missing_owner_is_a_400_naming_the_field_not_a_constraint_error() {
    let pool = db().await;
    let err = call(
        &pool,
        "POST",
        "/investments",
        Some(json!({ "name": "BTC", "type": "BITCOIN", "quantity": 1.0,
                     "walletId": "does-not-exist" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    assert_eq!(err.error, "Wallet not found");
}

#[tokio::test]
async fn moving_a_holding_to_a_wallet_is_judged_against_the_type_it_is_becoming() {
    let pool = db().await;
    let cid = make_custodian(&pool, "Fidelity").await;
    let wid = make_wallet(&pool, "Cold").await;
    let id = call(
        &pool,
        "POST",
        "/investments",
        Some(json!({ "name": "AAPL", "type": "STOCK", "quantity": 10.0, "custodianId": cid })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    // One PUT changes type, drops the custodian and adds the wallet. Checking
    // the pairing against the stored row would reject this as "a stock with a
    // wallet"; checking the merged row accepts it.
    let r = call(
        &pool,
        "PUT",
        &format!("/investments/{id}"),
        Some(json!({ "type": "BITCOIN", "custodianId": null, "walletId": wid })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["type"], json!("BITCOIN"));
    assert_eq!(r.body["custodianId"], Value::Null);
    assert_eq!(r.body["walletId"], json!(wid));
}

#[tokio::test]
async fn clearing_cost_basis_is_not_the_same_as_omitting_it() {
    let pool = db().await;
    let wid = make_wallet(&pool, "W").await;
    let id = call(
        &pool,
        "POST",
        "/investments",
        Some(json!({ "name": "BTC", "type": "BITCOIN", "quantity": 1.0,
                     "costBasis": 500.0, "walletId": wid })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Omitted: untouched.
    let r = call(
        &pool,
        "PUT",
        &format!("/investments/{id}"),
        Some(json!({ "name": "Renamed" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["costBasis"], json!(500.0));

    // Explicit null: cleared. Without the `present` deserializer these two
    // bodies are indistinguishable and the clear is a silent no-op.
    let r = call(
        &pool,
        "PUT",
        &format!("/investments/{id}"),
        Some(json!({ "costBasis": null })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["costBasis"], Value::Null);
}

#[tokio::test]
async fn deleting_a_holding_takes_its_snapshots_with_it() {
    let pool = db().await;
    let wid = make_wallet(&pool, "W").await;
    let id = call(
        &pool,
        "POST",
        "/investments",
        Some(json!({ "name": "BTC", "type": "BITCOIN", "quantity": 1.0, "walletId": wid })),
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
        &format!("/investments/{id}/snapshot"),
        Some(json!({ "date": "2026-08-01", "quantity": 1.0, "value": 60000.0 })),
    )
    .await
    .unwrap();

    let r = call(&pool, "DELETE", &format!("/investments/{id}"), None)
        .await
        .unwrap();
    assert_eq!(r.status, 204);

    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "InvestmentSnapshot""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn a_snapshot_keeps_quantity_exact_and_value_in_cents() {
    let pool = db().await;
    let wid = make_wallet(&pool, "W").await;
    let id = call(
        &pool,
        "POST",
        "/investments",
        Some(json!({ "name": "BTC", "type": "BITCOIN", "quantity": 1.0, "walletId": wid })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    let r = call(
        &pool,
        "POST",
        &format!("/investments/{id}/snapshot"),
        Some(json!({ "date": "2026-08-01T00:00:00.000Z",
                     "quantity": 0.12345678, "value": 7407.41 })),
    )
    .await
    .unwrap();
    assert_eq!(r.status, 201);

    let (qty, value, date): (String, i64, String) = sqlx::query_as(
        r#"SELECT "quantity", "value", "date" FROM "InvestmentSnapshot" WHERE "holdingId" = ?"#,
    )
    .bind(&id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(qty, "0.12345678");
    assert_eq!(value, 740_741);
    assert_eq!(date, "2026-08-01T00:00:00.000Z", "stored at UTC midnight");
}

#[tokio::test]
async fn a_snapshot_for_a_holding_that_is_gone_is_a_404() {
    let pool = db().await;
    let err = call(
        &pool,
        "POST",
        "/investments/nope/snapshot",
        Some(json!({ "date": "2026-08-01", "quantity": 1.0 })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 404);
}

// ═══ Custodians and wallets ═══

#[tokio::test]
async fn a_duplicate_custodian_name_is_a_409() {
    let pool = db().await;
    make_custodian(&pool, "Fidelity").await;
    let err = call(
        &pool,
        "POST",
        "/investments/custodians",
        Some(json!({ "name": "Fidelity" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 409);
}

#[tokio::test]
async fn renaming_a_custodian_to_its_own_name_is_allowed() {
    let pool = db().await;
    let id = make_custodian(&pool, "Fidelity").await;
    // The uniqueness check excludes the row being updated. Without that, every
    // no-op save would 409.
    let r = call(
        &pool,
        "PUT",
        &format!("/investments/custodians/{id}"),
        Some(json!({ "name": "Fidelity", "managementUrl": "https://fidelity.com" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["managementUrl"], json!("https://fidelity.com"));
}

#[tokio::test]
async fn a_blank_management_url_is_stored_as_absent_not_as_an_empty_string() {
    let pool = db().await;
    let r = call(
        &pool,
        "POST",
        "/investments/custodians",
        Some(json!({ "name": "Schwab", "managementUrl": "" })),
    )
    .await
    .unwrap();
    // The frontend sends '' for an untouched optional field, and the schema
    // declares this column a URL. An empty string is not one.
    assert_eq!(r.body["managementUrl"], Value::Null);
}

#[tokio::test]
async fn a_custodian_holding_something_cannot_be_deleted() {
    let pool = db().await;
    let cid = make_custodian(&pool, "Fidelity").await;
    call(
        &pool,
        "POST",
        "/investments",
        Some(json!({ "name": "AAPL", "type": "STOCK", "quantity": 10.0, "custodianId": cid })),
    )
    .await
    .unwrap();

    let err = call(
        &pool,
        "DELETE",
        &format!("/investments/custodians/{cid}"),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 409);
}

#[tokio::test]
async fn a_custodian_whose_positions_are_all_spent_deletes_and_takes_them_with_it() {
    let pool = db().await;
    let cid = make_custodian(&pool, "Fidelity").await;
    call(
        &pool,
        "POST",
        "/investments",
        Some(json!({ "name": "AAPL", "type": "STOCK", "quantity": 0.0, "custodianId": cid })),
    )
    .await
    .unwrap();

    let r = call(
        &pool,
        "DELETE",
        &format!("/investments/custodians/{cid}"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.status, 204);

    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "InvestmentHolding""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0, "a spent position is not a record of anything");
}

#[tokio::test]
async fn a_custodian_a_trade_points_at_cannot_be_deleted() {
    let pool = db().await;
    let cid = make_custodian(&pool, "Fidelity").await;

    // A trade with no holding left — the position is closed but the history
    // is not. ADR-027 made this a real FK, so the guard is a plain query.
    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","type","name","amount","netAmount","date","createdAt","imported","isCashBack")
           VALUES ('t1','TRADE','Sold AAPL',100000,-100000,'2026-01-01T00:00:00.000Z',
                   '2026-01-01T00:00:00.000Z',0,0)"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "TradeDetail" ("id","transactionId","direction","assetType","ticker",
                                      "quantity","unitPrice","custodianId")
           VALUES ('d1','t1','SELL','Stock','AAPL','10','100', ?)"#,
    )
    .bind(&cid)
    .execute(&pool)
    .await
    .unwrap();

    let err = call(
        &pool,
        "DELETE",
        &format!("/investments/custodians/{cid}"),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 409);
    assert!(err.error.contains("trades"), "{}", err.error);
}

#[tokio::test]
async fn a_wallet_a_bitcoin_payment_points_at_cannot_be_deleted() {
    let pool = db().await;
    let wid = make_wallet(&pool, "Cold").await;

    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","type","name","amount","netAmount","date","createdAt","imported","isCashBack")
           VALUES ('t1','EXPENSE','Coffee',500,-500,'2026-01-01T00:00:00.000Z',
                   '2026-01-01T00:00:00.000Z',0,0)"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "BitcoinPaymentDetail" ("id","transactionId","walletId","quantity",
                                               "unitPrice","bitcoinUnit")
           VALUES ('d1','t1', ?, '5000','60000','Sats')"#,
    )
    .bind(&wid)
    .execute(&pool)
    .await
    .unwrap();

    // The JSON-era guard checked trades only and would have let this through,
    // orphaning the payment's wallet reference.
    let err = call(
        &pool,
        "DELETE",
        &format!("/investments/wallets/{wid}"),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 409);
    assert!(err.error.contains("payments"), "{}", err.error);
}

#[tokio::test]
async fn a_custodial_wallet_must_say_where_it_is_stored() {
    let pool = db().await;
    let err = call(
        &pool,
        "POST",
        "/investments/wallets",
        Some(json!({ "name": "Exchange", "custodyType": "CUSTODIAL" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    assert_eq!(err.details.unwrap()[0]["field"], json!("storageType"));
}

#[tokio::test]
async fn a_non_custodial_wallet_may_not_say_where_it_is_stored() {
    let pool = db().await;
    let err = call(
        &pool,
        "POST",
        "/investments/wallets",
        Some(json!({ "name": "Ledger", "custodyType": "NON_CUSTODIAL", "storageType": "COLD" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn a_wallet_defaults_to_non_custodial() {
    let pool = db().await;
    let r = call(
        &pool,
        "POST",
        "/investments/wallets",
        Some(json!({ "name": "Ledger" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["custodyType"], json!("NON_CUSTODIAL"));
    assert_eq!(r.body["storageType"], Value::Null);
}

#[tokio::test]
async fn switching_a_wallet_to_non_custodial_clears_its_storage_type() {
    let pool = db().await;
    let id = call(
        &pool,
        "POST",
        "/investments/wallets",
        Some(json!({ "name": "Exchange", "custodyType": "CUSTODIAL", "storageType": "HOT" })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    // The body says nothing about storageType, so a COALESCE-style update
    // would keep HOT — storing exactly the combination the validator refuses.
    let r = call(
        &pool,
        "PUT",
        &format!("/investments/wallets/{id}"),
        Some(json!({ "custodyType": "NON_CUSTODIAL" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["custodyType"], json!("NON_CUSTODIAL"));
    assert_eq!(r.body["storageType"], Value::Null);
}

#[tokio::test]
async fn renaming_a_custodial_wallet_does_not_re_litigate_its_storage_type() {
    let pool = db().await;
    let id = call(
        &pool,
        "POST",
        "/investments/wallets",
        Some(json!({ "name": "Exchange", "custodyType": "CUSTODIAL", "storageType": "HOT" })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    // custodyType is absent from the patch, so the invariant is not re-checked
    // — the stored pairing is already valid and a rename must not be rejected
    // for it.
    let r = call(
        &pool,
        "PUT",
        &format!("/investments/wallets/{id}"),
        Some(json!({ "name": "Kraken" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["name"], json!("Kraken"));
    assert_eq!(r.body["storageType"], json!("HOT"));
}

#[tokio::test]
async fn the_static_routes_are_not_read_as_holding_ids() {
    let pool = db().await;
    // `/investments/custodians` and `/investments/wallets` both have the shape
    // of `/investments/{id}`. Ordering in the match is what keeps them apart,
    // and a 404 here would mean the holding arm swallowed them.
    for path in ["/investments/custodians", "/investments/wallets"] {
        let r = call(&pool, "GET", path, None).await.unwrap();
        assert_eq!(r.body, json!([]), "{path}");
    }
}
