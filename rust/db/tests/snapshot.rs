//! Snapshot regeneration: the wallet's BTC quantity, and today's valuation.

use avoir_core::money::Cents;
use avoir_db::snapshot::*;
use chrono::NaiveDate;
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use sqlx::SqliteConnection;

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}
fn dec(s: &str) -> Decimal {
    Decimal::from_str(s).unwrap()
}

async fn setup(conn: &mut SqliteConnection) {
    sqlx::query(
        r#"INSERT INTO "Wallet" ("id","name","createdAt","updatedAt","custodyType")
           VALUES ('wal','Cold','2026-01-01T00:00:00','2026-01-01T00:00:00','NON_CUSTODIAL')"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "InvestmentHolding" ("id","name","type","quantity","costBasis",
             "createdAt","updatedAt","walletId")
           VALUES ('h','Cold','BITCOIN','0',0,'2026-01-01T00:00:00','2026-01-01T00:00:00','wal')"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Account" ("id","name","balance","createdAt","updatedAt","type",
             "archived","hasRewards","earnsInterest","interestRate","interestRateType","openingBalance")
           VALUES ('acct','C',0,'2026-01-01T00:00:00','2026-01-01T00:00:00','CHECKING',0,0,0,0,'APY',0)"#,
    ).execute(&mut *conn).await.unwrap();
}

async fn trade(
    conn: &mut SqliteConnection,
    id: &str,
    date: &str,
    qty: &str,
    dir: &str,
    unit: Option<&str>,
) {
    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","amount","date","createdAt","type","name","imported",
             "netAmount","isCashBack","accountId")
           VALUES (?, 100, ?, ?, 'TRADE','t',0,100,0,'acct')"#,
    )
    .bind(id)
    .bind(date)
    .bind(format!("{date}T00:00:00"))
    .execute(&mut *conn)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "TradeDetail" ("id","transactionId","direction","assetType","quantity",
             "unitPrice","bitcoinUnit","walletId")
           VALUES (?, ?, ?, 'Bitcoin', ?, '1', ?, 'wal')"#,
    )
    .bind(format!("td_{id}"))
    .bind(id)
    .bind(dir)
    .bind(qty)
    .bind(unit)
    .execute(&mut *conn)
    .await
    .unwrap();
}

async fn payment(conn: &mut SqliteConnection, id: &str, date: &str, qty: &str, ty: &str) {
    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","amount","date","createdAt","type","name","imported",
             "netAmount","isCashBack")
           VALUES (?, 100, ?, ?, ?, 'p',0,100,0)"#,
    )
    .bind(id)
    .bind(date)
    .bind(format!("{date}T00:00:00"))
    .bind(ty)
    .execute(&mut *conn)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "BitcoinPaymentDetail" ("id","transactionId","walletId","quantity",
             "unitPrice","bitcoinUnit")
           VALUES (?, ?, 'wal', ?, '1','Bitcoin')"#,
    )
    .bind(format!("bp_{id}"))
    .bind(id)
    .bind(qty)
    .execute(&mut *conn)
    .await
    .unwrap();
}

#[tokio::test]
async fn quantity_sums_trades_and_payments_in_both_directions() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;

    trade(&mut c, "t1", "2026-01-05", "1.5", "BUY", Some("Bitcoin")).await;
    trade(&mut c, "t2", "2026-01-06", "0.25", "SELL", Some("Bitcoin")).await;
    payment(&mut c, "p1", "2026-01-07", "0.1", "INCOME").await; // received
    payment(&mut c, "p2", "2026-01-08", "0.05", "EXPENSE").await; // spent

    let q = wallet_btc_quantity(&mut c, "wal", d("2026-01-31"))
        .await
        .unwrap();
    assert_eq!(q, dec("1.3"), "1.5 - 0.25 + 0.1 - 0.05");
}

#[tokio::test]
async fn sats_are_converted_before_summing() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    trade(&mut c, "t1", "2026-01-05", "150000000", "BUY", Some("Sats")).await;

    let q = wallet_btc_quantity(&mut c, "wal", d("2026-01-31"))
        .await
        .unwrap();
    assert_eq!(q, dec("1.5"));
}

/// The as-of date is a cutoff, not decoration — a later movement must not leak
/// into an earlier snapshot.
#[tokio::test]
async fn movements_after_the_as_of_date_are_excluded() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    trade(&mut c, "t1", "2026-01-05", "1", "BUY", Some("Bitcoin")).await;
    trade(&mut c, "t2", "2026-06-01", "1", "BUY", Some("Bitcoin")).await;

    assert_eq!(
        wallet_btc_quantity(&mut c, "wal", d("2026-01-31"))
            .await
            .unwrap(),
        dec("1")
    );
    assert_eq!(
        wallet_btc_quantity(&mut c, "wal", d("2026-06-30"))
            .await
            .unwrap(),
        dec("2")
    );
}

#[tokio::test]
async fn a_snapshot_values_the_holding_at_the_supplied_price() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    trade(&mut c, "t1", "2026-01-05", "0.5", "BUY", Some("Bitcoin")).await;

    // $60,000.00 per BTC -> 0.5 BTC is $30,000.00
    let out = regenerate_holding_snapshot(&mut c, "h", Some(Cents(60_000_00)), d("2026-01-31"))
        .await
        .unwrap();
    assert_eq!(
        out,
        SnapshotOutcome::Written {
            quantity: dec("0.5"),
            value: Cents(30_000_00)
        }
    );

    let row: (String, Option<i64>) =
        sqlx::query_as(r#"SELECT "quantity","value" FROM "InvestmentSnapshot""#)
            .fetch_one(&mut *c)
            .await
            .unwrap();
    assert_eq!(row, ("0.5".into(), Some(30_000_00)));
}

/// Regenerating replaces rather than accumulates — one snapshot per holding
/// per day, newest computation wins.
#[tokio::test]
async fn regenerating_replaces_the_days_snapshot() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    trade(&mut c, "t1", "2026-01-05", "0.5", "BUY", Some("Bitcoin")).await;

    regenerate_holding_snapshot(&mut c, "h", Some(Cents(60_000_00)), d("2026-01-31"))
        .await
        .unwrap();
    regenerate_holding_snapshot(&mut c, "h", Some(Cents(70_000_00)), d("2026-01-31"))
        .await
        .unwrap();

    let rows: Vec<(String, Option<i64>)> =
        sqlx::query_as(r#"SELECT "quantity","value" FROM "InvestmentSnapshot""#)
            .fetch_all(&mut *c)
            .await
            .unwrap();
    assert_eq!(rows.len(), 1, "one row per holding per day");
    assert_eq!(rows[0].1, Some(35_000_00), "revalued at the newer price");
}

/// A fully-sold wallet gets no snapshot, so the chart ends rather than drawing
/// a flat line at dust.
#[tokio::test]
async fn a_dust_balance_produces_no_snapshot() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    trade(&mut c, "t1", "2026-01-05", "1", "BUY", Some("Bitcoin")).await;
    trade(&mut c, "t2", "2026-01-06", "1", "SELL", Some("Bitcoin")).await;

    let out = regenerate_holding_snapshot(&mut c, "h", Some(Cents(60_000_00)), d("2026-01-31"))
        .await
        .unwrap();
    assert_eq!(out, SnapshotOutcome::NoQuantity);
    let n: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "InvestmentSnapshot""#)
        .fetch_one(&mut *c)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

/// No price is a REPORTED outcome, not a silent no-op — the caller keeps the
/// best-effort behaviour but can see that it happened.
#[tokio::test]
async fn a_missing_price_is_reported_rather_than_swallowed() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    trade(&mut c, "t1", "2026-01-05", "0.5", "BUY", Some("Bitcoin")).await;

    let out = regenerate_holding_snapshot(&mut c, "h", None, d("2026-01-31"))
        .await
        .unwrap();
    assert_eq!(out, SnapshotOutcome::NoPrice);
}

// ═══ Full-history rebuild ═══

fn prices(days: &[(&str, i64)]) -> std::collections::HashMap<String, Cents> {
    days.iter()
        .map(|(d, c)| ((*d).to_string(), Cents(*c)))
        .collect()
}

/// Set the holding's stored quantity, which the rebuild reconciles against.
async fn set_stored_quantity(conn: &mut SqliteConnection, qty: &str) {
    sqlx::query(r#"UPDATE "InvestmentHolding" SET "quantity" = ? WHERE "id" = 'h'"#)
        .bind(qty)
        .execute(&mut *conn)
        .await
        .unwrap();
}

#[tokio::test]
async fn a_rebuild_carries_the_balance_forward_across_days_with_no_movement() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    trade(&mut c, "t1", "2026-01-01", "0.5", "BUY", Some("Bitcoin")).await;
    set_stored_quantity(&mut c, "0.5").await;
    drop(c);

    let p = prices(&[
        ("2026-01-01", 50_000_00),
        ("2026-01-02", 51_000_00),
        ("2026-01-03", 52_000_00),
    ]);
    let n = regenerate_all(&pool, &p, d("2026-01-03")).await.unwrap();
    assert_eq!(n, 3, "a holding is held on the days between its movements");

    let values: Vec<i64> =
        sqlx::query_scalar(r#"SELECT "value" FROM "InvestmentSnapshot" ORDER BY "date""#)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(values, vec![25_000_00, 25_500_00, 26_000_00]);
}

#[tokio::test]
async fn a_day_with_no_price_gets_no_snapshot_rather_than_a_guess() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    trade(&mut c, "t1", "2026-01-01", "1", "BUY", Some("Bitcoin")).await;
    set_stored_quantity(&mut c, "1").await;
    drop(c);

    // The middle day is missing from the price history — a rate limit, an
    // outage, a gap in the provider's own data.
    let p = prices(&[("2026-01-01", 50_000_00), ("2026-01-03", 52_000_00)]);
    let n = regenerate_all(&pool, &p, d("2026-01-03")).await.unwrap();
    assert_eq!(n, 2);

    let dates: Vec<String> =
        sqlx::query_scalar(r#"SELECT "date" FROM "InvestmentSnapshot" ORDER BY "date""#)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        dates,
        vec!["2026-01-01T00:00:00.000Z", "2026-01-03T00:00:00.000Z"]
    );
}

#[tokio::test]
async fn a_sell_that_empties_the_wallet_ends_the_chart() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    trade(&mut c, "t1", "2026-01-01", "1", "BUY", Some("Bitcoin")).await;
    trade(&mut c, "t2", "2026-01-02", "1", "SELL", Some("Bitcoin")).await;
    set_stored_quantity(&mut c, "0").await;
    drop(c);

    let p = prices(&[("2026-01-01", 50_000_00), ("2026-01-02", 51_000_00)]);
    let n = regenerate_all(&pool, &p, d("2026-01-02")).await.unwrap();
    // A fully-sold wallet draws nothing rather than a flat line at zero.
    assert_eq!(n, 1);
}

#[tokio::test]
async fn an_unrecorded_outflow_is_reconciled_against_what_the_holding_actually_holds() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    trade(&mut c, "t1", "2026-01-01", "1", "BUY", Some("Bitcoin")).await;
    // The events say 1 BTC; the holding says 0.6. The missing 0.4 left through
    // something this rebuild does not read — a BTC expense, a manual edit, an
    // import gap. The chart should end at the truth, not at the sum of what
    // happened to be logged.
    set_stored_quantity(&mut c, "0.6").await;
    drop(c);

    let p = prices(&[("2026-01-01", 50_000_00)]);
    regenerate_all(&pool, &p, d("2026-01-01")).await.unwrap();

    let (qty, value): (String, i64) =
        sqlx::query_as(r#"SELECT "quantity", "value" FROM "InvestmentSnapshot""#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(qty, "0.6");
    assert_eq!(value, 30_000_00);
}

#[tokio::test]
async fn a_rebuild_replaces_everything_that_was_there_before() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    sqlx::query(
        r#"INSERT INTO "InvestmentSnapshot" ("id","holdingId","date","quantity","value","createdAt")
           VALUES ('stale','h','1999-01-01T00:00:00.000Z','99',99,'1999-01-01T00:00:00.000Z')"#,
    )
    .execute(&mut *c)
    .await
    .unwrap();
    trade(&mut c, "t1", "2026-01-01", "1", "BUY", Some("Bitcoin")).await;
    set_stored_quantity(&mut c, "1").await;
    drop(c);

    let p = prices(&[("2026-01-01", 50_000_00)]);
    regenerate_all(&pool, &p, d("2026-01-01")).await.unwrap();

    let ids: Vec<String> = sqlx::query_scalar(r#"SELECT "id" FROM "InvestmentSnapshot""#)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(ids.len(), 1);
    assert!(!ids.contains(&"stale".to_string()));
}

#[tokio::test]
async fn a_rebuild_with_no_movements_clears_the_chart_and_reports_zero() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    sqlx::query(
        r#"INSERT INTO "InvestmentSnapshot" ("id","holdingId","date","quantity","value","createdAt")
           VALUES ('stale','h','1999-01-01T00:00:00.000Z','99',99,'1999-01-01T00:00:00.000Z')"#,
    )
    .execute(&mut *c)
    .await
    .unwrap();
    drop(c);

    let n = regenerate_all(&pool, &prices(&[]), d("2026-01-01"))
        .await
        .unwrap();
    assert_eq!(n, 0);
    let left: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "InvestmentSnapshot""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0);
}

#[tokio::test]
async fn sats_and_whole_bitcoin_are_summed_in_one_unit() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    trade(&mut c, "t1", "2026-01-01", "0.5", "BUY", Some("Bitcoin")).await;
    trade(&mut c, "t2", "2026-01-01", "50000000", "BUY", Some("Sats")).await;
    set_stored_quantity(&mut c, "1").await;
    drop(c);

    let p = prices(&[("2026-01-01", 50_000_00)]);
    regenerate_all(&pool, &p, d("2026-01-01")).await.unwrap();

    let qty: String = sqlx::query_scalar(r#"SELECT "quantity" FROM "InvestmentSnapshot""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(qty, "1", "0.5 BTC + 50,000,000 sats is exactly one coin");
}

/// The hazard the API-layer guard exists for.
///
/// `regenerate_all` DELETES every snapshot before it writes. That is correct
/// here — a rebuild is a rebuild — but it means an empty price map is not "a
/// gap in the chart", it is the erasure of the whole history. `bitcoin_history`
/// used to return an empty map on ANY failure, so a CoinGecko rate limit wiped
/// the table and the app reported "Snapshots regenerated". That is how the
/// production database reached zero rows on 2026-08-13, after which the
/// portfolio had no recorded figure to fall back to and showed a near-total loss.
///
/// The fix lives in `investments_history::regenerate_snapshots`, which refuses
/// to call this at all when the fetch failed. This test is here so that anyone
/// reading THIS function can see why that guard is load-bearing rather than
/// defensive: the destruction is real, and it is unconditional.
#[tokio::test]
async fn a_rebuild_with_no_prices_destroys_the_history_it_cannot_rebuild() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    trade(&mut c, "t1", "2026-01-01", "1", "BUY", Some("Bitcoin")).await;
    set_stored_quantity(&mut c, "1").await;
    drop(c);

    // A year of history, built when the price service was answering.
    let good = prices(&[("2026-01-01", 50_000_00), ("2026-01-02", 51_000_00)]);
    assert_eq!(
        regenerate_all(&pool, &good, d("2026-01-02")).await.unwrap(),
        2
    );

    // The same call with prices the caller could not obtain.
    let n = regenerate_all(&pool, &prices(&[]), d("2026-01-02"))
        .await
        .unwrap();
    assert_eq!(n, 0);

    let left: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "InvestmentSnapshot""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        left, 0,
        "the previous history is gone — this is why the caller must not reach \
         here with an empty map it did not mean to have"
    );
}
