//! Trade-holding tests, focused on the two things this hook can get wrong:
//! decimal quantity arithmetic, and the proportional cost-basis allocation.

use avoir_core::money::Cents;
use avoir_db::holdings::*;
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use sqlx::SqliteConnection;

async fn custodian(conn: &mut SqliteConnection) {
    sqlx::query(
        r#"INSERT INTO "Custodian" ("id","name","createdAt","updatedAt")
           VALUES ('cust','Fidelity','2026-01-01T00:00:00','2026-01-01T00:00:00')"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();
}

async fn wallet(conn: &mut SqliteConnection) {
    sqlx::query(
        r#"INSERT INTO "Wallet" ("id","name","createdAt","updatedAt","custodyType")
           VALUES ('wal','Cold Storage','2026-01-01T00:00:00','2026-01-01T00:00:00','NON_CUSTODIAL')"#,
    ).execute(&mut *conn).await.unwrap();
}

async fn holding(conn: &mut SqliteConnection) -> (String, Option<i64>) {
    sqlx::query_as::<_, (String, Option<i64>)>(
        r#"SELECT "quantity","costBasis" FROM "InvestmentHolding" LIMIT 1"#,
    )
    .fetch_one(&mut *conn)
    .await
    .unwrap()
}

fn stock(direction: Direction, qty: &str) -> Trade {
    Trade {
        direction,
        asset_type: AssetType::Stock,
        ticker: Some("VTSAX".into()),
        quantity: Decimal::from_str(qty).unwrap(),
        bitcoin_unit_is_sats: false,
        custodian_id: Some("cust".into()),
        wallet_id: None,
    }
}

fn btc(direction: Direction, qty: &str, sats: bool) -> Trade {
    Trade {
        direction,
        asset_type: AssetType::Bitcoin,
        ticker: None,
        quantity: Decimal::from_str(qty).unwrap(),
        bitcoin_unit_is_sats: sats,
        custodian_id: None,
        wallet_id: Some("wal".into()),
    }
}

#[tokio::test]
async fn a_buy_creates_then_accumulates_a_holding() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    custodian(&mut c).await;

    apply_trade_to_holding(&mut c, &stock(Direction::Buy, "10.5"), Cents(100_000), 1)
        .await
        .unwrap();
    assert_eq!(holding(&mut c).await, ("10.5".into(), Some(100_000)));

    apply_trade_to_holding(&mut c, &stock(Direction::Buy, "4.25"), Cents(50_000), 1)
        .await
        .unwrap();
    assert_eq!(
        holding(&mut c).await,
        ("14.75".into(), Some(150_000)),
        "quantity adds exactly"
    );
}

/// The decimal representation earning its place: 8-place BTC quantities that
/// integer cents would round to zero, summed without loss.
#[tokio::test]
async fn bitcoin_quantities_keep_eight_decimal_places() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    wallet(&mut c).await;

    apply_trade_to_holding(
        &mut c,
        &btc(Direction::Buy, "0.00000001", false),
        Cents(1),
        1,
    )
    .await
    .unwrap();
    assert_eq!(
        holding(&mut c).await.0,
        "0.00000001",
        "one satoshi survives"
    );

    apply_trade_to_holding(
        &mut c,
        &btc(Direction::Buy, "0.00000002", false),
        Cents(2),
        1,
    )
    .await
    .unwrap();
    assert_eq!(holding(&mut c).await.0, "0.00000003");
}

/// Sats convert to whole BTC exactly — 100,000,000 divides without remainder in
/// Decimal, where it would not in a float.
#[tokio::test]
async fn sats_convert_to_bitcoin_exactly() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    wallet(&mut c).await;

    apply_trade_to_holding(
        &mut c,
        &btc(Direction::Buy, "123456789", true),
        Cents(500_000),
        1,
    )
    .await
    .unwrap();
    assert_eq!(holding(&mut c).await.0, "1.23456789");
}

/// A sell takes cost basis proportionally, and reports what it took.
#[tokio::test]
async fn a_sell_allocates_cost_basis_proportionally() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    custodian(&mut c).await;

    apply_trade_to_holding(&mut c, &stock(Direction::Buy, "100"), Cents(1_000_00), 1)
        .await
        .unwrap();

    // Sell a quarter: a quarter of the $1,000 basis goes with it.
    let allocated = apply_trade_to_holding(&mut c, &stock(Direction::Sell, "25"), Cents(300_00), 1)
        .await
        .unwrap();
    assert_eq!(allocated, Some(Cents(250_00)));
    assert_eq!(holding(&mut c).await, ("75".into(), Some(750_00)));
}

/// Reversal restores the holding exactly — the property a delete depends on.
#[tokio::test]
async fn reversing_a_buy_restores_the_previous_state() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    custodian(&mut c).await;

    apply_trade_to_holding(&mut c, &stock(Direction::Buy, "100"), Cents(1_000_00), 1)
        .await
        .unwrap();
    apply_trade_to_holding(&mut c, &stock(Direction::Buy, "10"), Cents(120_00), 1)
        .await
        .unwrap();
    assert_eq!(holding(&mut c).await, ("110".into(), Some(1_120_00)));

    // multiplier -1 makes the BUY behave as a SELL.
    apply_trade_to_holding(&mut c, &stock(Direction::Buy, "10"), Cents(120_00), -1)
        .await
        .unwrap();
    let (qty, basis) = holding(&mut c).await;
    assert_eq!(qty, "100", "quantity restored");
    // Basis returns proportionally: 10/110 of 1,120.00 = 101.82 (rounded).
    assert_eq!(basis, Some(1_120_00 - 101_82));
}

/// A sell with no holding is a no-op rather than an error or a negative
/// holding — validation upstream should prevent it, and if it does not, the
/// safe direction is to do nothing.
#[tokio::test]
async fn selling_something_not_held_does_nothing() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    custodian(&mut c).await;

    let allocated = apply_trade_to_holding(&mut c, &stock(Direction::Sell, "5"), Cents(10_000), 1)
        .await
        .unwrap();
    assert_eq!(allocated, None);
    let n: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "InvestmentHolding""#)
        .fetch_one(&mut *c)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

/// Stock and bitcoin holdings in the same database do not collide: the lookup
/// keys on type plus custodian/wallet plus ticker.
#[tokio::test]
async fn stock_and_bitcoin_holdings_stay_separate() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    custodian(&mut c).await;
    wallet(&mut c).await;

    apply_trade_to_holding(&mut c, &stock(Direction::Buy, "10"), Cents(100_00), 1)
        .await
        .unwrap();
    apply_trade_to_holding(&mut c, &btc(Direction::Buy, "0.5", false), Cents(200_00), 1)
        .await
        .unwrap();

    let rows: Vec<(String, String)> =
        sqlx::query_as(r#"SELECT "type","quantity" FROM "InvestmentHolding" ORDER BY "type""#)
            .fetch_all(&mut *c)
            .await
            .unwrap();
    assert_eq!(
        rows,
        vec![
            ("BITCOIN".into(), "0.5".into()),
            ("STOCK".into(), "10".into())
        ]
    );
}

// ── Through the ledger gate ──────────────────────────────────────────────
//
// The unit tests above exercise `apply_trade_to_holding` directly. These go
// through `ledger_create` / `ledger_delete`, which is where the wiring can be
// wrong even when the logic is right — a hook that never fires, or a reversal
// that reads its detail row after the cascade has removed it.

use avoir_db::ledger::*;

async fn account(conn: &mut SqliteConnection) {
    sqlx::query(
        r#"INSERT INTO "Account" ("id","name","balance","createdAt","updatedAt","type",
             "archived","hasRewards","earnsInterest","interestRate","interestRateType","openingBalance")
           VALUES ('acct','Brokerage',1000000,'2026-01-01T00:00:00','2026-01-01T00:00:00','CHECKING',
                   0,0,0,0,'APY',1000000)"#,
    ).execute(&mut *conn).await.unwrap();
}

fn trade_tx(id: &str, direction: Direction, qty: &str, amount: i64, seq: u32) -> LedgerCreate {
    LedgerCreate {
        id: id.into(),
        name: "Buy VTSAX".into(),
        amount: Cents(amount),
        date: "2026-02-01".into(),
        created_at: format!("2026-02-01T00:00:{seq:02}"),
        tx_type: "TRADE".into(),
        account_id: Some("acct".into()),
        to_account_id: None,
        parent_id: None,
        budget_id: None,
        expense_id: None,
        trade: Some(TradeInput {
            direction,
            asset_type: AssetType::Stock,
            ticker: Some("VTSAX".into()),
            quantity: Decimal::from_str(qty).unwrap(),
            unit_price: Decimal::from_str("100").unwrap(),
            bitcoin_unit_is_sats: false,
            custodian_id: Some("cust".into()),
            wallet_id: None,
        }),
        bitcoin: None,
        occurrence_date: None,
        note: None,
        purchase_group_id: None,
    }
}

#[tokio::test]
async fn creating_a_trade_through_the_gate_updates_the_holding() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    custodian(&mut c).await;
    account(&mut c).await;

    ledger_create(&mut c, &trade_tx("t1", Direction::Buy, "10", 100_000, 1))
        .await
        .unwrap();

    assert_eq!(holding(&mut c).await, ("10".into(), Some(100_000)));
    let detail: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "TradeDetail""#)
        .fetch_one(&mut *c)
        .await
        .unwrap();
    assert_eq!(detail, 1, "the typed detail row is written (ADR-027)");
}

#[tokio::test]
async fn a_sell_through_the_gate_records_cost_basis_allocated_on_the_row() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    custodian(&mut c).await;
    account(&mut c).await;

    ledger_create(&mut c, &trade_tx("t1", Direction::Buy, "100", 1_000_00, 1))
        .await
        .unwrap();
    ledger_create(&mut c, &trade_tx("t2", Direction::Sell, "25", 300_00, 2))
        .await
        .unwrap();

    let allocated: Option<i64> =
        sqlx::query_scalar(r#"SELECT "costBasisAllocated" FROM "Transaction" WHERE "id"='t2'"#)
            .fetch_one(&mut *c)
            .await
            .unwrap();
    assert_eq!(
        allocated,
        Some(250_00),
        "a quarter of the basis went with the sale"
    );
    assert_eq!(holding(&mut c).await, ("75".into(), Some(750_00)));
}

/// Deleting a trade restores the holding. This is the case the CASCADE makes
/// delicate: `TradeDetail` is removed with the transaction, so the reversal
/// only works because `ledger_delete` reads it first.
#[tokio::test]
async fn deleting_a_trade_through_the_gate_restores_the_holding() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    custodian(&mut c).await;
    account(&mut c).await;

    ledger_create(&mut c, &trade_tx("t1", Direction::Buy, "100", 1_000_00, 1))
        .await
        .unwrap();
    ledger_create(&mut c, &trade_tx("t2", Direction::Buy, "10", 120_00, 2))
        .await
        .unwrap();
    assert_eq!(holding(&mut c).await, ("110".into(), Some(1_120_00)));

    ledger_delete(&mut c, "t2").await.unwrap();

    let (qty, basis) = holding(&mut c).await;
    assert_eq!(qty, "100", "quantity restored");
    assert_eq!(
        basis,
        Some(1_120_00 - 101_82),
        "basis returned proportionally"
    );

    let detail: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "TradeDetail""#)
        .fetch_one(&mut *c)
        .await
        .unwrap();
    assert_eq!(detail, 1, "the deleted row's detail cascaded away");
}

// ── Bitcoin payments ─────────────────────────────────────────────────────

/// The four-way truth table from the doc comment, asserted rather than trusted.
/// Spending maps to a sell and receiving to a buy; the multiplier then inverts
/// each. If that mapping is wrong, a reversal moves the holding the wrong way.
#[tokio::test]
async fn bitcoin_payment_direction_table_holds() {
    let cases: [(&str, i8, &str); 4] = [
        ("EXPENSE", 1, "0.9"),  // spend 0.1 from 1.0
        ("EXPENSE", -1, "1.1"), // reverse a spend
        ("INCOME", 1, "1.1"),   // receive
        ("INCOME", -1, "0.9"),  // reverse a receive
    ];

    for (tx_type, multiplier, expected) in cases {
        let pool = avoir_db::connect_in_memory().await.unwrap();
        let mut c = pool.acquire().await.unwrap();
        wallet(&mut c).await;
        // Start from exactly 1 BTC.
        apply_trade_to_holding(
            &mut c,
            &btc(Direction::Buy, "1", false),
            Cents(50_000_00),
            1,
        )
        .await
        .unwrap();

        apply_bitcoin_payment_to_holding(
            &mut c,
            "wal",
            Decimal::from_str("0.1").unwrap(),
            false,
            tx_type,
            Cents(5_000_00),
            multiplier,
        )
        .await
        .unwrap();

        assert_eq!(
            holding(&mut c).await.0,
            expected,
            "{tx_type} with multiplier {multiplier}"
        );
    }
}

#[tokio::test]
async fn a_bitcoin_payment_in_sats_converts_before_applying() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    wallet(&mut c).await;

    apply_bitcoin_payment_to_holding(
        &mut c,
        "wal",
        Decimal::from_str("50000").unwrap(),
        true, // sats
        "INCOME",
        Cents(30_00),
        1,
    )
    .await
    .unwrap();

    assert_eq!(holding(&mut c).await.0, "0.0005", "50,000 sats");
}

#[tokio::test]
async fn an_unsupported_transaction_type_is_an_error_not_a_silent_noop() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    wallet(&mut c).await;

    let r = apply_bitcoin_payment_to_holding(
        &mut c,
        "wal",
        Decimal::ONE,
        false,
        "TRANSFER",
        Cents(100),
        1,
    )
    .await;
    assert!(
        r.is_err(),
        "a TRANSFER carrying bitcoin metadata is a bug upstream"
    );
}
