//! `/investments/history`, `/investments/portfolio-history` and transfers.

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

async fn wallet(pool: &SqlitePool, name: &str) -> String {
    call(
        pool,
        "POST",
        "/investments/wallets",
        Some(json!({ "name": name })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn custodian(pool: &SqlitePool, name: &str) -> String {
    call(
        pool,
        "POST",
        "/investments/custodians",
        Some(json!({ "name": name })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn btc_holding(pool: &SqlitePool, wallet_id: &str, qty: f64, basis: f64) -> String {
    call(
        pool,
        "POST",
        "/investments",
        Some(json!({ "name": "BTC", "type": "BITCOIN", "quantity": qty,
                     "costBasis": basis, "walletId": wallet_id })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn qty_of(pool: &SqlitePool, id: &str) -> String {
    sqlx::query_scalar(r#"SELECT "quantity" FROM "InvestmentHolding" WHERE "id" = ?"#)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn basis_of(pool: &SqlitePool, id: &str) -> i64 {
    sqlx::query_scalar(r#"SELECT "costBasis" FROM "InvestmentHolding" WHERE "id" = ?"#)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

// ═══ Bitcoin transfers ═══

#[tokio::test]
async fn moving_bitcoin_debits_the_source_and_credits_the_destination_exactly() {
    let pool = db().await;
    let from = wallet(&pool, "Hot").await;
    let to = wallet(&pool, "Cold").await;
    let src = btc_holding(&pool, &from, 1.0, 30000.0).await;

    let r = call(
        &pool,
        "POST",
        "/investments/transfers/bitcoin",
        Some(json!({ "fromWalletId": from, "toWalletId": to,
                     "quantity": 0.25, "bitcoinUnit": "Bitcoin" })),
    )
    .await
    .unwrap();
    assert_eq!(r.status, 200);

    assert_eq!(qty_of(&pool, &src).await, "0.75");
    // A quarter of the position takes a quarter of the basis.
    assert_eq!(basis_of(&pool, &src).await, 2_250_000);

    let dest: String =
        sqlx::query_scalar(r#"SELECT "id" FROM "InvestmentHolding" WHERE "walletId" = ?"#)
            .bind(&to)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(qty_of(&pool, &dest).await, "0.25");
    assert_eq!(basis_of(&pool, &dest).await, 750_000);
}

#[tokio::test]
async fn a_sats_fee_leaves_the_source_and_is_recorded_rather_than_rounded_away() {
    let pool = db().await;
    let from = wallet(&pool, "Hot").await;
    let to = wallet(&pool, "Cold").await;
    let src = btc_holding(&pool, &from, 1.0, 0.0).await;

    let r = call(
        &pool,
        "POST",
        "/investments/transfers/bitcoin",
        Some(json!({ "fromWalletId": from, "toWalletId": to,
                     "quantity": 0.5, "bitcoinUnit": "Bitcoin",
                     "feeAmount": 5000, "feeUnit": "Sats" })),
    )
    .await
    .unwrap();

    // 5,000 sats is 0.00005 BTC. Under the old integer-cents column this
    // rounded to zero: the fee vanished and the source kept it.
    assert_eq!(r.body["feeBtc"], json!(0.00005));
    assert_eq!(qty_of(&pool, &src).await, "0.49995");

    let (fee, unit): (String, String) =
        sqlx::query_as(r#"SELECT "feeAmount", "feeUnit" FROM "InvestmentTransfer" LIMIT 1"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(fee, "5000", "stored as entered, in its own unit");
    assert_eq!(unit, "Sats");
}

#[tokio::test]
async fn the_fee_is_part_of_what_the_source_must_have() {
    let pool = db().await;
    let from = wallet(&pool, "Hot").await;
    let to = wallet(&pool, "Cold").await;
    btc_holding(&pool, &from, 0.5, 0.0).await;

    // Exactly enough for the transfer, not enough for transfer + fee.
    let err = call(
        &pool,
        "POST",
        "/investments/transfers/bitcoin",
        Some(json!({ "fromWalletId": from, "toWalletId": to,
                     "quantity": 0.5, "bitcoinUnit": "Bitcoin",
                     "feeAmount": 1000, "feeUnit": "Sats" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    assert!(
        err.error.starts_with("Insufficient balance"),
        "{}",
        err.error
    );
}

#[tokio::test]
async fn a_failed_transfer_leaves_nothing_behind() {
    let pool = db().await;
    let from = wallet(&pool, "Hot").await;
    let to = wallet(&pool, "Cold").await;
    let src = btc_holding(&pool, &from, 0.5, 1000.0).await;

    let _ = call(
        &pool,
        "POST",
        "/investments/transfers/bitcoin",
        Some(json!({ "fromWalletId": from, "toWalletId": to,
                     "quantity": 5.0, "bitcoinUnit": "Bitcoin" })),
    )
    .await
    .unwrap_err();

    // The debit happens before the destination is touched, so a rollback is
    // the only thing standing between a refusal and bitcoin destroyed.
    assert_eq!(qty_of(&pool, &src).await, "0.5");
    assert_eq!(basis_of(&pool, &src).await, 100_000);
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "InvestmentTransfer""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn a_transfer_to_the_same_wallet_is_refused() {
    let pool = db().await;
    let w = wallet(&pool, "Hot").await;
    btc_holding(&pool, &w, 1.0, 0.0).await;

    let err = call(
        &pool,
        "POST",
        "/investments/transfers/bitcoin",
        Some(json!({ "fromWalletId": w, "toWalletId": w,
                     "quantity": 0.1, "bitcoinUnit": "Bitcoin" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn a_wallet_with_no_bitcoin_is_a_404() {
    let pool = db().await;
    let from = wallet(&pool, "Empty").await;
    let to = wallet(&pool, "Cold").await;

    let err = call(
        &pool,
        "POST",
        "/investments/transfers/bitcoin",
        Some(json!({ "fromWalletId": from, "toWalletId": to,
                     "quantity": 0.1, "bitcoinUnit": "Bitcoin" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 404);
}

#[tokio::test]
async fn reversing_a_bitcoin_transfer_returns_the_fee_too() {
    let pool = db().await;
    let from = wallet(&pool, "Hot").await;
    let to = wallet(&pool, "Cold").await;
    let src = btc_holding(&pool, &from, 1.0, 30000.0).await;

    let id = call(
        &pool,
        "POST",
        "/investments/transfers/bitcoin",
        Some(json!({ "fromWalletId": from, "toWalletId": to,
                     "quantity": 0.25, "bitcoinUnit": "Bitcoin",
                     "feeAmount": 5000, "feeUnit": "Sats" })),
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
        &format!("/investments/transfers/{id}"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.status, 204);

    // The fee left the source and never arrived anywhere, so undoing the
    // transfer has to put it back or it is simply gone.
    assert_eq!(qty_of(&pool, &src).await, "1");
    assert_eq!(basis_of(&pool, &src).await, 3_000_000);
}

// ═══ Stock transfers ═══

async fn stock_setup(pool: &SqlitePool) -> (String, String, String) {
    let from = custodian(pool, "Fidelity").await;
    let to = custodian(pool, "Schwab").await;
    let holding = call(
        pool,
        "POST",
        "/investments",
        Some(
            json!({ "name": "Fidelity $AAPL", "ticker": "AAPL", "type": "STOCK",
                     "quantity": 100.0, "costBasis": 15000.0, "custodianId": from }),
        ),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();
    (from, to, holding)
}

#[tokio::test]
async fn a_stock_transfer_with_no_quantity_moves_the_whole_position() {
    let pool = db().await;
    let (from, to, holding) = stock_setup(&pool).await;

    let r = call(
        &pool,
        "POST",
        "/investments/transfers/stock",
        Some(json!({ "fromCustodianId": from, "toCustodianId": to, "holdingId": holding })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["quantity"], json!(100.0));
    assert_eq!(r.body["ticker"], json!("AAPL"));

    assert_eq!(qty_of(&pool, &holding).await, "0");
    assert_eq!(basis_of(&pool, &holding).await, 0);

    let dest: String =
        sqlx::query_scalar(r#"SELECT "id" FROM "InvestmentHolding" WHERE "custodianId" = ?"#)
            .bind(&to)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(basis_of(&pool, &dest).await, 1_500_000);
}

#[tokio::test]
async fn a_stock_transfer_fee_goes_through_the_ledger_and_gets_a_balance_chain() {
    let pool = db().await;
    let (from, to, holding) = stock_setup(&pool).await;

    let account: String = {
        let r = call(
            &pool,
            "POST",
            "/accounts",
            Some(json!({ "name": "Checking", "type": "CHECKING", "openingBalance": 1000.00 })),
        )
        .await
        .unwrap();
        r.body["id"].as_str().unwrap().to_string()
    };
    let budget: String = {
        let g = call(
            &pool,
            "POST",
            "/budgets/groups",
            Some(json!({ "name": "Fees", "color": "#fff" })),
        )
        .await
        .unwrap();
        let r = call(
            &pool,
            "POST",
            "/budgets",
            Some(json!({ "name": "Brokerage", "groupId": g.body["id"] })),
        )
        .await
        .unwrap();
        r.body["id"].as_str().unwrap().to_string()
    };

    let r = call(
        &pool,
        "POST",
        "/investments/transfers/stock",
        Some(
            json!({ "fromCustodianId": from, "toCustodianId": to, "holdingId": holding,
                     "feeAmount": 75.00, "feeBudgetId": budget, "feeAccountId": account }),
        ),
    )
    .await
    .unwrap();
    let fee_tx = r.body["feeTransactionId"].as_str().unwrap().to_string();

    // The TypeScript created this row with `tx.transaction.create` and then
    // decremented the account by hand — no balance hook, so no chain metadata,
    // and the ADR-014 null boundary would stop every later row on the account
    // from getting one either.
    let (before, after): (Option<i64>, Option<i64>) = sqlx::query_as(
        r#"SELECT "balanceBefore", "balanceAfter" FROM "Transaction" WHERE "id" = ?"#,
    )
    .bind(&fee_tx)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(before, Some(100_000), "chain seeded from openingBalance");
    assert_eq!(after, Some(92_500));

    let balance: i64 = sqlx::query_scalar(r#"SELECT "balance" FROM "Account" WHERE "id" = ?"#)
        .bind(&account)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(balance, 92_500, "one writer, not two");
}

#[tokio::test]
async fn reversing_a_stock_transfer_deletes_the_fee_and_restores_the_balance() {
    let pool = db().await;
    let (from, to, holding) = stock_setup(&pool).await;
    let account = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Checking", "type": "CHECKING", "openingBalance": 1000.00 })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();
    let g = call(
        &pool,
        "POST",
        "/budgets/groups",
        Some(json!({ "name": "Fees", "color": "#fff" })),
    )
    .await
    .unwrap();
    let budget = call(
        &pool,
        "POST",
        "/budgets",
        Some(json!({ "name": "Brokerage", "groupId": g.body["id"] })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    let id = call(
        &pool,
        "POST",
        "/investments/transfers/stock",
        Some(
            json!({ "fromCustodianId": from, "toCustodianId": to, "holdingId": holding,
                     "feeAmount": 75.00, "feeBudgetId": budget, "feeAccountId": account }),
        ),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    call(
        &pool,
        "DELETE",
        &format!("/investments/transfers/{id}"),
        None,
    )
    .await
    .unwrap();

    // `ledger_delete` restores the balance as part of removing the row. The
    // TypeScript incremented the balance AND deleted the row, which double-
    // counts the moment the hook it bypassed exists.
    let balance: i64 = sqlx::query_scalar(r#"SELECT "balance" FROM "Account" WHERE "id" = ?"#)
        .bind(&account)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(balance, 100_000);

    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "Transaction""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    assert_eq!(qty_of(&pool, &holding).await, "100");
}

#[tokio::test]
async fn a_fee_without_a_budget_or_account_is_refused_before_anything_moves() {
    let pool = db().await;
    let (from, to, holding) = stock_setup(&pool).await;

    let err = call(
        &pool,
        "POST",
        "/investments/transfers/stock",
        Some(json!({ "fromCustodianId": from, "toCustodianId": to,
                     "holdingId": holding, "feeAmount": 75.00 })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    assert_eq!(qty_of(&pool, &holding).await, "100");
}

#[tokio::test]
async fn a_holding_at_a_different_custodian_is_a_404() {
    let pool = db().await;
    let (_from, to, holding) = stock_setup(&pool).await;
    let other = custodian(&pool, "Vanguard").await;

    let err = call(
        &pool,
        "POST",
        "/investments/transfers/stock",
        Some(json!({ "fromCustodianId": other, "toCustodianId": to, "holdingId": holding })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 404);
}

// ═══ History ═══

async fn seed_history(pool: &SqlitePool) {
    let w = wallet(pool, "Cold").await;
    let a = call(
        pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Cash Wallet", "type": "CHECKING", "openingBalance": 0.0 })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    // A trade, dated earliest.
    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","type","name","amount","netAmount","date","createdAt",
                                      "imported","isCashBack","accountId")
           VALUES ('tr1','TRADE','Buy BTC',-100000,-100000,'2026-01-01T00:00:00.000Z',
                   '2026-01-01T00:00:00.000Z',0,0, ?)"#,
    )
    .bind(&a)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "TradeDetail" ("id","transactionId","direction","assetType",
                                      "quantity","unitPrice","bitcoinUnit","walletId")
           VALUES ('td1','tr1','BUY','Bitcoin','5000000','0.0006','Sats', ?)"#,
    )
    .bind(&w)
    .execute(pool)
    .await
    .unwrap();

    // A second trade, NEWER than the transfer. This is what makes the cursor
    // observable: with only one trade — and that one already the oldest row —
    // an unfiltered trade query returns the same page as a filtered one, so the
    // test would pass against a cursor that does nothing.
    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","type","name","amount","netAmount","date","createdAt",
                                      "imported","isCashBack","accountId")
           VALUES ('tr2','TRADE','Sell BTC',50000,50000,'2026-02-15T00:00:00.000Z',
                   '2026-02-15T00:00:00.000Z',0,0, ?)"#,
    )
    .bind(&a)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "TradeDetail" ("id","transactionId","direction","assetType",
                                      "quantity","unitPrice","bitcoinUnit","walletId")
           VALUES ('td2','tr2','SELL','Bitcoin','0.01','60000','Bitcoin', ?)"#,
    )
    .bind(&w)
    .execute(pool)
    .await
    .unwrap();

    // A bitcoin payment, dated latest.
    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","type","name","amount","netAmount","date","createdAt",
                                      "imported","isCashBack")
           VALUES ('pay1','INCOME','Rewards',500,500,'2026-03-01T00:00:00.000Z',
                   '2026-03-01T00:00:00.000Z',0,0)"#,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "BitcoinPaymentDetail" ("id","transactionId","walletId","quantity",
                                               "unitPrice","bitcoinUnit","incomeType")
           VALUES ('bp1','pay1', ?, '1000','60000','Sats','Rewards')"#,
    )
    .bind(&w)
    .execute(pool)
    .await
    .unwrap();

    // A transfer, dated in between.
    let w2 = wallet(pool, "Hot").await;
    let h1 = btc_holding(pool, &w, 1.0, 0.0).await;
    let h2 = btc_holding(pool, &w2, 0.0, 0.0).await;
    sqlx::query(
        r#"INSERT INTO "InvestmentTransfer" ("id","type","fromHoldingId","toHoldingId",
                                             "quantity","createdAt")
           VALUES ('tf1','BITCOIN', ?, ?, '0.1','2026-02-01T00:00:00.000Z')"#,
    )
    .bind(&h1)
    .bind(&h2)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn history_merges_three_sources_newest_first() {
    let pool = db().await;
    seed_history(&pool).await;

    let r = call(&pool, "GET", "/investments/history", None)
        .await
        .unwrap();
    let ids: Vec<&str> = r.body["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec!["pay1", "tr2", "tf1", "tr1"]);
    assert_eq!(r.body["hasMore"], json!(false));
    assert_eq!(r.body["nextCursor"], Value::Null);
}

#[tokio::test]
async fn filtering_to_payments_returns_only_payments() {
    let pool = db().await;
    seed_history(&pool).await;

    // The TypeScript's three guards are all true for PAYMENT, so this returned
    // the whole history and the filter looked broken to the user.
    let r = call(&pool, "GET", "/investments/history?type=PAYMENT", None)
        .await
        .unwrap();
    let entries = r.body["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["id"], json!("pay1"));
    assert_eq!(entries[0]["entryType"], json!("PAYMENT"));
    assert_eq!(
        entries[0]["description"],
        json!("Earned BTC rewards on Cold")
    );
}

#[tokio::test]
async fn filtering_to_trades_or_transfers_still_works() {
    let pool = db().await;
    seed_history(&pool).await;

    for (filter, expected) in [("TRADE", "tr2"), ("TRANSFER", "tf1")] {
        let r = call(
            &pool,
            "GET",
            &format!("/investments/history?type={filter}"),
            None,
        )
        .await
        .unwrap();
        let entries = r.body["entries"].as_array().unwrap();
        assert_eq!(entries[0]["id"], json!(expected), "{filter}");
        assert!(
            entries.iter().all(|e| e["entryType"] == json!(filter)),
            "{filter} returned something else"
        );
    }
}

#[tokio::test]
async fn a_stock_filter_excludes_bitcoin_payments_entirely() {
    let pool = db().await;
    seed_history(&pool).await;

    let r = call(&pool, "GET", "/investments/history?assetType=STOCK", None)
        .await
        .unwrap();
    // A payment is BTC by definition, so no stock view can contain one.
    let has_payment = r.body["entries"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["entryType"] == json!("PAYMENT"));
    assert!(!has_payment);
}

#[tokio::test]
async fn a_bitcoin_trade_reports_its_quantity_in_btc_not_sats() {
    let pool = db().await;
    seed_history(&pool).await;

    let r = call(&pool, "GET", "/investments/history?type=TRADE", None)
        .await
        .unwrap();
    let e = r.body["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == json!("tr1"))
        .unwrap();
    // 5,000,000 sats stored; the panel always displays BTC.
    assert_eq!(e["quantity"], json!(0.05));
    assert_eq!(e["assetType"], json!("BITCOIN"));
    assert_eq!(e["description"], json!("Bought BTC on Cash Wallet"));
}

#[tokio::test]
async fn a_page_boundary_lands_in_the_same_place_across_all_three_sources() {
    let pool = db().await;
    seed_history(&pool).await;

    let first = call(&pool, "GET", "/investments/history?limit=2", None)
        .await
        .unwrap();
    assert_eq!(first.body["hasMore"], json!(true));
    let cursor = first.body["nextCursor"].as_str().unwrap().to_string();
    let seen: Vec<String> = first.body["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(seen, vec!["pay1", "tr2"]);

    // The cursor is a trade, and page two must exclude everything at or before
    // it in EVERY table — including the other trades. Filtering only the
    // source the cursor came from puts tr2 back on the second page.
    let encoded = urlencode(&cursor);
    let second = call(
        &pool,
        "GET",
        &format!("/investments/history?limit=2&cursor={encoded}"),
        None,
    )
    .await
    .unwrap();
    let rest: Vec<&str> = second.body["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    assert_eq!(rest, vec!["tf1", "tr1"]);
    assert_eq!(second.body["hasMore"], json!(false));
}

/// What `URLSearchParams.toString()` does to a base64 cursor before it reaches
/// the dispatcher.
fn urlencode(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '*' => c.to_string(),
            ' ' => "+".to_string(),
            c => format!("%{:02X}", c as u32),
        })
        .collect()
}

#[tokio::test]
async fn a_percent_encoded_cursor_survives_the_query_string() {
    let pool = db().await;
    seed_history(&pool).await;

    let first = call(&pool, "GET", "/investments/history?limit=1", None)
        .await
        .unwrap();
    let cursor = first.body["nextCursor"].as_str().unwrap().to_string();
    // Whether THIS payload happens to need escaping depends on its length, so
    // the escaping itself is pinned in `Path::parse`'s own tests. What matters
    // here is that a cursor which has been through `URLSearchParams` — as every
    // real one has — still resolves to the same page.
    let r = call(
        &pool,
        "GET",
        &format!("/investments/history?limit=1&cursor={}", urlencode(&cursor)),
        None,
    )
    .await
    .unwrap();
    assert_eq!(r.body["entries"][0]["id"], json!("tr2"));
}

#[tokio::test]
async fn a_malformed_cursor_is_a_400() {
    let pool = db().await;
    let err = call(&pool, "GET", "/investments/history?cursor=%7Bnope%7D", None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 400);
}

// ═══ Portfolio history ═══

#[tokio::test]
async fn portfolio_history_sums_the_day_in_exact_cents() {
    let pool = db().await;
    let w1 = wallet(&pool, "A").await;
    let w2 = wallet(&pool, "B").await;
    let h1 = btc_holding(&pool, &w1, 1.0, 0.0).await;
    let h2 = btc_holding(&pool, &w2, 1.0, 0.0).await;

    for (id, holding, value) in [("s1", &h1, 1000_01_i64), ("s2", &h2, 2000_02)] {
        sqlx::query(
            r#"INSERT INTO "InvestmentSnapshot" ("id","holdingId","date","quantity","value","createdAt")
               VALUES (?, ?, '2026-08-01T00:00:00.000Z','1', ?, '2026-08-01T00:00:00.000Z')"#,
        )
        .bind(id)
        .bind(holding)
        .bind(value)
        .execute(&pool)
        .await
        .unwrap();
    }

    let r = call(&pool, "GET", "/investments/portfolio-history", None)
        .await
        .unwrap();
    let entries = r.body["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 1);
    // Exact because the column is INTEGER cents. A TEXT decimal would come
    // back through SQLite's float coercion as 3000.0299999999997.
    assert_eq!(entries[0]["totalValue"], json!(3000.03));
}

#[tokio::test]
async fn a_period_filter_drops_snapshots_before_its_window() {
    let pool = db().await;
    let w = wallet(&pool, "A").await;
    let h = btc_holding(&pool, &w, 1.0, 0.0).await;

    let old = "2020-01-01T00:00:00.000Z";
    let today = chrono::Utc::now()
        .format("%Y-%m-%dT00:00:00.000Z")
        .to_string();
    for (id, date) in [("s1", old), ("s2", today.as_str())] {
        sqlx::query(
            r#"INSERT INTO "InvestmentSnapshot" ("id","holdingId","date","quantity","value","createdAt")
               VALUES (?, ?, ?, '1', 100, ?)"#,
        )
        .bind(id)
        .bind(&h)
        .bind(date)
        .bind(date)
        .execute(&pool)
        .await
        .unwrap();
    }

    let all = call(
        &pool,
        "GET",
        "/investments/portfolio-history?period=ALL",
        None,
    )
    .await
    .unwrap();
    assert_eq!(all.body["entries"].as_array().unwrap().len(), 2);

    let month = call(
        &pool,
        "GET",
        "/investments/portfolio-history?period=1M",
        None,
    )
    .await
    .unwrap();
    assert_eq!(month.body["entries"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn a_snapshot_with_no_value_is_not_counted_as_zero() {
    let pool = db().await;
    let w = wallet(&pool, "A").await;
    let h = btc_holding(&pool, &w, 1.0, 0.0).await;
    sqlx::query(
        r#"INSERT INTO "InvestmentSnapshot" ("id","holdingId","date","quantity","value","createdAt")
           VALUES ('s1', ?, '2026-08-01T00:00:00.000Z','1', NULL,'2026-08-01T00:00:00.000Z')"#,
    )
    .bind(&h)
    .execute(&pool)
    .await
    .unwrap();

    // A day nobody could price has no total, rather than a total of nothing.
    let r = call(&pool, "GET", "/investments/portfolio-history", None)
        .await
        .unwrap();
    assert_eq!(r.body["entries"].as_array().unwrap().len(), 0);
}
