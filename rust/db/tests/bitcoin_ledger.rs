//! The bitcoin-payment hook and the BTC wallet ledger it writes.
//!
//! These exist because the hook was ported and then **not wired**:
//! `apply_bitcoin_payment_to_holding` had unit tests, and nothing called it,
//! so spending BTC through the gate moved no holding at all. A unit test on
//! the function could never have caught that — only a test that goes through
//! `ledger_create` can, which is why every case here does.

use avoir_core::money::Cents;
use avoir_db::ledger::{ledger_create, ledger_delete, BitcoinInput, LedgerCreate};
use rust_decimal::Decimal;
use sqlx::SqlitePool;
use std::str::FromStr;

async fn db() -> SqlitePool {
    avoir_db::connect_in_memory().await.expect("test db")
}

fn dec(s: &str) -> Decimal {
    Decimal::from_str(s).expect("decimal")
}

/// A wallet holding 2 BTC.
async fn fixture(pool: &SqlitePool) {
    let now = "2026-03-01T00:00:00.000Z";
    sqlx::query(
        r#"INSERT INTO "Wallet" ("id","name","createdAt","updatedAt","custodyType","storageType")
           VALUES ('w1','Cold Storage',?,?,'NON_CUSTODIAL','COLD')"#,
    )
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "InvestmentHolding"
             ("id","name","type","quantity","walletId","createdAt","updatedAt")
           VALUES ('h1','Bitcoin','BITCOIN','2.0','w1',?,?)"#,
    )
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .unwrap();
}

/// A bitcoin payment created the way a route creates one — detail and all,
/// through the gate, so every hook sees a complete row.
async fn pay_btc(pool: &SqlitePool, id: &str, tx_type: &str, qty: &str, usd: i64) {
    let mut conn = pool.acquire().await.unwrap();
    ledger_create(
        &mut conn,
        &LedgerCreate {
            id: id.into(),
            name: "BTC payment".into(),
            amount: Cents(usd),
            date: "2026-03-05T00:00:00.000Z".into(),
            created_at: "2026-03-05T00:00:00.000Z".into(),
            tx_type: tx_type.into(),
            // A bitcoin payment has NO account. That cross-field rule is what
            // keeps the cash and BTC ledgers from ever colliding.
            account_id: None,
            to_account_id: None,
            parent_id: None,
            budget_id: None,
            expense_id: None,
            trade: None,
            bitcoin: Some(BitcoinInput {
                wallet_id: "w1".into(),
                quantity: dec(qty),
                unit_price: dec("60000"),
                bitcoin_unit_is_sats: false,
                income_type: None,
            }),
            occurrence_date: None,
            note: None,
            purchase_group_id: None,
        },
    )
    .await
    .unwrap();
}

async fn holding_qty(pool: &SqlitePool) -> Decimal {
    let (q,): (String,) =
        sqlx::query_as(r#"SELECT "quantity" FROM "InvestmentHolding" WHERE "id" = 'h1'"#)
            .fetch_one(pool)
            .await
            .unwrap();
    dec(&q)
}

async fn btc_chain(pool: &SqlitePool, id: &str) -> (Option<String>, Option<String>) {
    sqlx::query_as(
        r#"SELECT "btcBalanceBefore", "btcBalanceAfter" FROM "Transaction" WHERE "id" = ?"#,
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn spending_bitcoin_reduces_the_wallet_holding() {
    let pool = db().await;
    fixture(&pool).await;
    assert_eq!(holding_qty(&pool).await, dec("2.0"));

    pay_btc(&pool, "tx1", "EXPENSE", "0.5", 30_000_00).await;

    // The whole point. Before this hook was wired, spending BTC through the
    // gate left the holding untouched — the function existed and nothing
    // called it.
    assert_eq!(holding_qty(&pool).await, dec("1.5"));
}

#[tokio::test]
async fn receiving_bitcoin_increases_it() {
    let pool = db().await;
    fixture(&pool).await;

    pay_btc(&pool, "tx1", "INCOME", "0.25", 15_000_00).await;
    assert_eq!(holding_qty(&pool).await, dec("2.25"));
}

#[tokio::test]
async fn the_wallet_ledger_brackets_the_movement() {
    let pool = db().await;
    fixture(&pool).await;

    pay_btc(&pool, "tx1", "EXPENSE", "0.5", 30_000_00).await;

    let (before, after) = btc_chain(&pool, "tx1").await;
    let before = dec(&before.expect("btcBalanceBefore written"));
    let after = dec(&after.expect("btcBalanceAfter written"));

    assert_eq!(before, dec("2.0"), "the wallet before this row");
    assert_eq!(after, dec("1.5"), "and after it");
    assert_eq!(before - after, dec("0.5"), "the movement itself");
}

#[tokio::test]
async fn the_btc_ledger_never_touches_the_cents_columns() {
    let pool = db().await;
    fixture(&pool).await;

    pay_btc(&pool, "tx1", "EXPENSE", "0.5", 30_000_00).await;

    let (cash_before, cash_after): (Option<i64>, Option<i64>) = sqlx::query_as(
        r#"SELECT "balanceBefore", "balanceAfter" FROM "Transaction" WHERE "id" = 'tx1'"#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    // balanceBefore/balanceAfter are INTEGER cents under ADR-033. Writing a
    // BTC quantity there is what this whole change exists to stop: 0.00000001
    // BTC would store as 0. The TypeScript writes them, which is harmless only
    // because that code has never executed.
    assert_eq!(cash_before, None, "cash columns untouched on a bitcoin row");
    assert_eq!(cash_after, None);
}

#[tokio::test]
async fn a_single_satoshi_survives_the_round_trip() {
    let pool = db().await;
    fixture(&pool).await;

    // One satoshi. In a cents column this rounds to zero and the movement
    // vanishes entirely.
    pay_btc(&pool, "tx1", "EXPENSE", "0.00000001", 1).await;

    assert_eq!(holding_qty(&pool).await, dec("1.99999999"));

    let (before, after) = btc_chain(&pool, "tx1").await;
    assert_eq!(dec(&before.unwrap()), dec("2.0"));
    let after = dec(&after.unwrap());
    assert_eq!(after, dec("1.99999999"), "the eighth decimal survives");
    assert_eq!(dec("2.0") - after, dec("0.00000001"), "exactly one satoshi");
}

#[tokio::test]
async fn sats_are_converted_to_btc_before_they_reach_the_holding() {
    let pool = db().await;
    fixture(&pool).await;

    let mut conn = pool.acquire().await.unwrap();
    ledger_create(
        &mut conn,
        &LedgerCreate {
            id: "tx1".into(),
            name: "Sats spend".into(),
            amount: Cents(6_00),
            date: "2026-03-05T00:00:00.000Z".into(),
            created_at: "2026-03-05T00:00:00.000Z".into(),
            tx_type: "EXPENSE".into(),
            account_id: None,
            to_account_id: None,
            parent_id: None,
            budget_id: None,
            expense_id: None,
            trade: None,
            bitcoin: Some(BitcoinInput {
                wallet_id: "w1".into(),
                // 1,000,000 sats = 0.01 BTC. Treating the figure as whole
                // coins would take a million BTC out of a 2-coin wallet.
                quantity: dec("1000000"),
                unit_price: dec("0.0006"),
                bitcoin_unit_is_sats: true,
                income_type: None,
            }),
            occurrence_date: None,
            note: None,
            purchase_group_id: None,
        },
    )
    .await
    .unwrap();
    drop(conn);

    assert_eq!(holding_qty(&pool).await, dec("1.99"));
}

#[tokio::test]
async fn deleting_a_bitcoin_payment_gives_the_coin_back() {
    let pool = db().await;
    fixture(&pool).await;
    pay_btc(&pool, "tx1", "EXPENSE", "0.5", 30_000_00).await;
    assert_eq!(holding_qty(&pool).await, dec("1.5"));

    let mut conn = pool.acquire().await.unwrap();
    ledger_delete(&mut conn, "tx1").await.unwrap();
    drop(conn);

    // Deleting a BTC spend must RESTORE the coin, not take more away. The
    // detail row is ON DELETE CASCADE, so the reversal has to read it before
    // the transaction goes — the same reason a trade is read up front.
    assert_eq!(holding_qty(&pool).await, dec("2.0"));
}

#[tokio::test]
async fn deleting_received_bitcoin_takes_it_back_out() {
    let pool = db().await;
    fixture(&pool).await;
    pay_btc(&pool, "tx1", "INCOME", "0.25", 15_000_00).await;
    assert_eq!(holding_qty(&pool).await, dec("2.25"));

    let mut conn = pool.acquire().await.unwrap();
    ledger_delete(&mut conn, "tx1").await.unwrap();
    drop(conn);

    assert_eq!(
        holding_qty(&pool).await,
        dec("2.0"),
        "reversal is symmetric"
    );
}

#[tokio::test]
async fn an_ordinary_cash_transaction_gets_no_btc_ledger() {
    let pool = db().await;
    fixture(&pool).await;
    sqlx::query(
        r#"INSERT INTO "Account" ("id","name","type","balance","openingBalance","archived",
                                  "hasRewards","earnsInterest","interestRate","interestRateType",
                                  "createdAt","updatedAt")
           VALUES ('a1','Checking','Checking',100000,100000,0,0,0,0,'APY',
                   '2026-03-01T00:00:00.000Z','2026-03-01T00:00:00.000Z')"#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let mut conn = pool.acquire().await.unwrap();
    ledger_create(
        &mut conn,
        &LedgerCreate {
            id: "tx1".into(),
            name: "Groceries".into(),
            amount: Cents(45_67),
            date: "2026-03-05T00:00:00.000Z".into(),
            created_at: "2026-03-05T00:00:00.000Z".into(),
            tx_type: "EXPENSE".into(),
            account_id: Some("a1".into()),
            to_account_id: None,
            parent_id: None,
            budget_id: None,
            expense_id: None,
            trade: None,
            bitcoin: None,
            occurrence_date: None,
            note: None,
            purchase_group_id: None,
        },
    )
    .await
    .unwrap();
    drop(conn);

    let (btc_before, btc_after) = btc_chain(&pool, "tx1").await;
    assert_eq!(btc_before, None, "a cash row has no BTC ledger");
    assert_eq!(btc_after, None);

    // And its cash chain is written as normal — the two are independent.
    let (cash_before, cash_after): (Option<i64>, Option<i64>) = sqlx::query_as(
        r#"SELECT "balanceBefore", "balanceAfter" FROM "Transaction" WHERE "id" = 'tx1'"#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cash_before, Some(100000));
    assert_eq!(cash_after, Some(100000 - 4567));
}

#[tokio::test]
async fn a_corrupt_quantity_fails_loudly_instead_of_moving_nothing() {
    let pool = db().await;
    fixture(&pool).await;

    sqlx::query(
        r#"INSERT INTO "Transaction"
             ("id","amount","date","createdAt","type","name","imported","netAmount","isCashBack")
           VALUES ('tx1',1,'2026-03-05T00:00:00.000Z','2026-03-05T00:00:00.000Z',
                   'EXPENSE','bad',0,1,0)"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    // quantity is TEXT, so nothing at the database level stops this.
    sqlx::query(
        r#"INSERT INTO "BitcoinPaymentDetail"
             ("id","transactionId","walletId","quantity","unitPrice","bitcoinUnit")
           VALUES ('bpd1','tx1','w1','not-a-number','60000','Bitcoin')"#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let mut conn = pool.acquire().await.unwrap();
    let result = avoir_db::ledger::ledger_update(
        &mut conn,
        "tx1",
        &avoir_db::ledger::LedgerUpdate {
            name: Some("bad".into()),
            ..Default::default()
        },
    )
    .await;
    drop(conn);

    // Defaulting to zero here would apply a no-op movement and leave the
    // holding quietly wrong, with nothing anywhere to indicate it happened.
    let err = result.expect_err("a corrupt quantity must surface");
    assert!(
        format!("{err:#}").contains("unparseable"),
        "the error should name the problem: {err:#}"
    );

    assert_eq!(holding_qty(&pool).await, dec("2.0"), "holding untouched");
}
