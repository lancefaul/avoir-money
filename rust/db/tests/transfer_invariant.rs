//! The ledger invariant across investment transfers.
//!
//! A stock transfer's fee is the only place in the investments domain that
//! moves cash, and it is new: the TypeScript wrote that row with
//! `tx.transaction.create` and then decremented `Account.balance` by hand, so
//! there were two writers for one number and the row never got a balance chain.
//! The port routes it through `ledger_create` instead.
//!
//! That claim needs the same check as everything else that touches the ledger.
//! `db/tests/ledger_invariant.rs` covers the gate's own operations; this covers
//! the one caller that reaches it indirectly, alongside bitcoin transfers, which
//! must move BTC while leaving cash entirely alone.

use avoir_core::money::Cents;
use avoir_db::balance::{check_amount_matches_net, check_invariant};
use avoir_db::transfers::*;
use proptest::prelude::*;
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use sqlx::SqliteConnection;
use tokio::runtime::Runtime;

async fn seed(conn: &mut SqliteConnection, opening: i64) {
    sqlx::query(
        r#"INSERT INTO "Account" ("id","name","balance","createdAt","updatedAt","type",
              "archived","hasRewards","earnsInterest","interestRate","interestRateType",
              "openingBalance")
           VALUES ('acct','Brokerage Cash', ?, '2026-01-01T00:00:00','2026-01-01T00:00:00',
                   'CHECKING',0,0,0,0,'APY', ?)"#,
    )
    .bind(opening)
    .bind(opening)
    .execute(&mut *conn)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt")
           VALUES ('grp','Fees','#fff','2026-01-01T00:00:00')"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","groupId","isSystem","isCustom","createdAt")
           VALUES ('bud','Brokerage','grp',0,0,'2026-01-01T00:00:00')"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();

    for (id, name) in [("cus_a", "Fidelity"), ("cus_b", "Schwab")] {
        sqlx::query(
            r#"INSERT INTO "Custodian" ("id","name","createdAt","updatedAt")
               VALUES (?, ?, '2026-01-01T00:00:00','2026-01-01T00:00:00')"#,
        )
        .bind(id)
        .bind(name)
        .execute(&mut *conn)
        .await
        .unwrap();
    }
    for (id, name) in [("wal_a", "Hot"), ("wal_b", "Cold")] {
        sqlx::query(
            r#"INSERT INTO "Wallet" ("id","name","createdAt","updatedAt","custodyType")
               VALUES (?, ?, '2026-01-01T00:00:00','2026-01-01T00:00:00','NON_CUSTODIAL')"#,
        )
        .bind(id)
        .bind(name)
        .execute(&mut *conn)
        .await
        .unwrap();
    }
}

async fn holding(
    conn: &mut SqliteConnection,
    id: &str,
    ty: &str,
    qty: &str,
    basis: i64,
    custodian: Option<&str>,
    wallet: Option<&str>,
) {
    sqlx::query(
        r#"INSERT INTO "InvestmentHolding"
             ("id","name","ticker","type","quantity","costBasis","custodianId","walletId",
              "createdAt","updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00','2026-01-01T00:00:00')"#,
    )
    .bind(id)
    .bind(id)
    .bind(if ty == "STOCK" { Some("AAPL") } else { None })
    .bind(ty)
    .bind(qty)
    .bind(basis)
    .bind(custodian)
    .bind(wallet)
    .execute(&mut *conn)
    .await
    .unwrap();
}

async fn breaks(conn: &mut SqliteConnection) -> Vec<String> {
    let mut bad: Vec<String> = check_invariant(&mut *conn)
        .await
        .unwrap()
        .into_iter()
        .map(|(name, residual)| format!("{name} is out by {residual}"))
        .collect();
    // The invariant alone cannot see amount/netAmount divergence — both sides
    // are built from netAmount, so the error cancels. The second check is what
    // catches ADR-013's actual defect.
    for (id, amount, net) in check_amount_matches_net(&mut *conn).await.unwrap() {
        bad.push(format!("row {id}: amount {amount} != net {net}"));
    }
    bad
}

fn d(s: &str) -> Decimal {
    Decimal::from_str(s).unwrap()
}

// ═══ Stock transfers, whose fee moves cash ═══

proptest! {
    #![proptest_config(ProptestConfig { cases: 40, ..ProptestConfig::default() })]

    /// A stock transfer's fee leaves the account balanced, whatever it is.
    #[test]
    fn a_stock_transfer_fee_never_breaks_the_invariant(
        opening in -50_000i64..500_000,
        fee in 1i64..250_000,
        moved in 1u32..100,
        held in 100u32..500,
    ) {
        prop_assume!(moved <= held);
        let rt = Runtime::new().unwrap();
        let bad = rt.block_on(async {
            let pool = avoir_db::connect_in_memory().await.unwrap();
            let mut conn = pool.acquire().await.unwrap();
            seed(&mut conn, opening).await;
            holding(&mut conn, "h_src", "STOCK", &held.to_string(), 1_500_00,
                    Some("cus_a"), None).await;

            let input = StockTransfer {
                from_custodian_id: "cus_a".into(),
                to_custodian_id: "cus_b".into(),
                holding_id: "h_src".into(),
                quantity: Some(Decimal::from(moved)),
                fee_amount: Some(Cents(fee)),
                fee_budget_id: Some("bud".into()),
                fee_account_id: Some("acct".into()),
                today: "2026-02-01T00:00:00.000Z".into(),
            };
            execute_stock_transfer(&mut conn, &input).await.unwrap();
            breaks(&mut conn).await
        });
        prop_assert!(bad.is_empty(), "{bad:?}");
    }
}

#[tokio::test]
async fn the_fee_moves_the_balance_by_exactly_its_amount() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut conn = pool.acquire().await.unwrap();
    seed(&mut conn, 100_000).await;
    holding(
        &mut conn,
        "h_src",
        "STOCK",
        "100",
        1_500_00,
        Some("cus_a"),
        None,
    )
    .await;

    let input = StockTransfer {
        from_custodian_id: "cus_a".into(),
        to_custodian_id: "cus_b".into(),
        holding_id: "h_src".into(),
        quantity: None,
        fee_amount: Some(Cents(75_00)),
        fee_budget_id: Some("bud".into()),
        fee_account_id: Some("acct".into()),
        today: "2026-02-01T00:00:00.000Z".into(),
    };
    execute_stock_transfer(&mut conn, &input).await.unwrap();

    let balance: i64 = sqlx::query_scalar(r#"SELECT "balance" FROM "Account" WHERE "id" = 'acct'"#)
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(balance, 100_000 - 75_00);

    // And the row carries a chain, which is what the hand-rolled version could
    // not give it — a NULL here poisons every later row on the account under
    // ADR-014's null-boundary rule.
    let (before, after): (Option<i64>, Option<i64>) = sqlx::query_as(
        r#"SELECT "balanceBefore","balanceAfter" FROM "Transaction" WHERE "type" = 'EXPENSE'"#,
    )
    .fetch_one(&mut *conn)
    .await
    .unwrap();
    assert_eq!(before, Some(100_000));
    assert_eq!(after, Some(100_000 - 75_00));
    assert!(breaks(&mut conn).await.is_empty());
}

#[tokio::test]
async fn reversing_a_stock_transfer_returns_the_account_to_where_it_started() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut conn = pool.acquire().await.unwrap();
    seed(&mut conn, 100_000).await;
    holding(
        &mut conn,
        "h_src",
        "STOCK",
        "100",
        1_500_00,
        Some("cus_a"),
        None,
    )
    .await;

    let input = StockTransfer {
        from_custodian_id: "cus_a".into(),
        to_custodian_id: "cus_b".into(),
        holding_id: "h_src".into(),
        quantity: None,
        fee_amount: Some(Cents(75_00)),
        fee_budget_id: Some("bud".into()),
        fee_account_id: Some("acct".into()),
        today: "2026-02-01T00:00:00.000Z".into(),
    };
    let rec = execute_stock_transfer(&mut conn, &input).await.unwrap();
    reverse_transfer(&mut conn, &rec.id).await.unwrap();

    let balance: i64 = sqlx::query_scalar(r#"SELECT "balance" FROM "Account" WHERE "id" = 'acct'"#)
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    // The TypeScript incremented the balance by hand AND deleted the row, which
    // double-counts the moment the hook it bypassed exists. Going through
    // `ledger_delete` does both halves once.
    assert_eq!(balance, 100_000);
    assert!(breaks(&mut conn).await.is_empty());
}

// ═══ Bitcoin transfers, which must not touch cash at all ═══

proptest! {
    #![proptest_config(ProptestConfig { cases: 40, ..ProptestConfig::default() })]

    /// Moving BTC leaves every cash balance exactly where it was.
    #[test]
    fn a_bitcoin_transfer_never_touches_a_cash_balance(
        opening in -50_000i64..500_000,
        sats_moved in 1i64..50_000_000,
        sats_fee in 0i64..100_000,
    ) {
        let rt = Runtime::new().unwrap();
        let (bad, balance) = rt.block_on(async {
            let pool = avoir_db::connect_in_memory().await.unwrap();
            let mut conn = pool.acquire().await.unwrap();
            seed(&mut conn, opening).await;
            holding(&mut conn, "h_src", "BITCOIN", "1", 30_000_00, None, Some("wal_a")).await;

            let input = BitcoinTransfer {
                from_wallet_id: "wal_a".into(),
                to_wallet_id: "wal_b".into(),
                quantity: Decimal::from(sats_moved),
                unit_is_sats: true,
                bitcoin_price: Some(d("60000")),
                fee_amount: (sats_fee > 0).then(|| Decimal::from(sats_fee)),
                fee_unit: (sats_fee > 0).then_some(FeeUnit::Sats),
            };
            let _ = execute_bitcoin_transfer(&mut conn, &input).await;

            let balance: i64 =
                sqlx::query_scalar(r#"SELECT "balance" FROM "Account" WHERE "id" = 'acct'"#)
                    .fetch_one(&mut *conn)
                    .await
                    .unwrap();
            (breaks(&mut conn).await, balance)
        });
        prop_assert!(bad.is_empty(), "{bad:?}");
        // An on-chain fee is paid to the network, not out of an account. There
        // is no cash movement to record and no Transaction row to create.
        prop_assert_eq!(balance, opening);
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 40, ..ProptestConfig::default() })]

    /// BTC is conserved: what leaves the source arrives, less the fee.
    #[test]
    fn bitcoin_is_conserved_across_a_transfer(
        sats_moved in 1i64..40_000_000,
        sats_fee in 0i64..100_000,
    ) {
        let rt = Runtime::new().unwrap();
        let (src, dest, expected_out) = rt.block_on(async {
            let pool = avoir_db::connect_in_memory().await.unwrap();
            let mut conn = pool.acquire().await.unwrap();
            seed(&mut conn, 0).await;
            holding(&mut conn, "h_src", "BITCOIN", "1", 30_000_00, None, Some("wal_a")).await;

            let sats = Decimal::from(100_000_000);
            let moved = Decimal::from(sats_moved) / sats;
            let fee = Decimal::from(sats_fee) / sats;

            let input = BitcoinTransfer {
                from_wallet_id: "wal_a".into(),
                to_wallet_id: "wal_b".into(),
                quantity: Decimal::from(sats_moved),
                unit_is_sats: true,
                bitcoin_price: Some(d("60000")),
                fee_amount: (sats_fee > 0).then(|| Decimal::from(sats_fee)),
                fee_unit: (sats_fee > 0).then_some(FeeUnit::Sats),
            };
            execute_bitcoin_transfer(&mut conn, &input).await.unwrap();

            let src: String = sqlx::query_scalar(
                r#"SELECT "quantity" FROM "InvestmentHolding" WHERE "id" = 'h_src'"#,
            )
            .fetch_one(&mut *conn)
            .await
            .unwrap();
            let dest: String = sqlx::query_scalar(
                r#"SELECT "quantity" FROM "InvestmentHolding" WHERE "walletId" = 'wal_b'"#,
            )
            .fetch_one(&mut *conn)
            .await
            .unwrap();
            (
                Decimal::from_str(&src).unwrap(),
                Decimal::from_str(&dest).unwrap(),
                (moved, fee),
            )
        });

        let (moved, fee) = expected_out;
        // Exact, not approximate — quantities are `rust_decimal`, so dividing
        // sats by 100,000,000 loses nothing and there is no epsilon to pick.
        prop_assert_eq!(src, Decimal::ONE - moved - fee);
        prop_assert_eq!(dest, moved);
    }
}

// ═══ The destination already exists ═══
//
// Every test above starts with an empty destination, so the find-or-create
// lands on *create* every time and the update branch — the one that adds to a
// running quantity — is never executed. Mutation testing found this: crediting
// the destination `transfer + fee` instead of `transfer` passed everything.

proptest! {
    #![proptest_config(ProptestConfig { cases: 40, ..ProptestConfig::default() })]

    /// Adding to a wallet that already holds BTC credits the transfer, not the
    /// fee — the fee went to the network and arrives nowhere.
    #[test]
    fn an_existing_destination_is_credited_the_transfer_only(
        sats_moved in 1i64..40_000_000,
        sats_fee in 1i64..100_000,
        sats_already in 1i64..90_000_000,
    ) {
        let rt = Runtime::new().unwrap();
        let (src, dest, moved, fee, already) = rt.block_on(async {
            let pool = avoir_db::connect_in_memory().await.unwrap();
            let mut conn = pool.acquire().await.unwrap();
            seed(&mut conn, 0).await;

            let sats = Decimal::from(100_000_000);
            let already = Decimal::from(sats_already) / sats;
            holding(&mut conn, "h_src", "BITCOIN", "1", 30_000_00, None, Some("wal_a")).await;
            holding(
                &mut conn,
                "h_dst",
                "BITCOIN",
                &already.normalize().to_string(),
                10_000_00,
                None,
                Some("wal_b"),
            )
            .await;

            let input = BitcoinTransfer {
                from_wallet_id: "wal_a".into(),
                to_wallet_id: "wal_b".into(),
                quantity: Decimal::from(sats_moved),
                unit_is_sats: true,
                bitcoin_price: Some(d("60000")),
                fee_amount: Some(Decimal::from(sats_fee)),
                fee_unit: Some(FeeUnit::Sats),
            };
            execute_bitcoin_transfer(&mut conn, &input).await.unwrap();

            let src: String = sqlx::query_scalar(
                r#"SELECT "quantity" FROM "InvestmentHolding" WHERE "id" = 'h_src'"#,
            )
            .fetch_one(&mut *conn)
            .await
            .unwrap();
            let dest: String = sqlx::query_scalar(
                r#"SELECT "quantity" FROM "InvestmentHolding" WHERE "id" = 'h_dst'"#,
            )
            .fetch_one(&mut *conn)
            .await
            .unwrap();

            let n: i64 = sqlx::query_scalar(
                r#"SELECT count(*) FROM "InvestmentHolding" WHERE "walletId" = 'wal_b'"#,
            )
            .fetch_one(&mut *conn)
            .await
            .unwrap();
            assert_eq!(n, 1, "the existing holding was used, not a second one made");

            (
                Decimal::from_str(&src).unwrap(),
                Decimal::from_str(&dest).unwrap(),
                Decimal::from(sats_moved) / sats,
                Decimal::from(sats_fee) / sats,
                already,
            )
        });

        prop_assert_eq!(src, Decimal::ONE - moved - fee);
        prop_assert_eq!(dest, already + moved);
    }
}

#[tokio::test]
async fn an_existing_stock_destination_accumulates_quantity_and_basis() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut conn = pool.acquire().await.unwrap();
    seed(&mut conn, 100_000).await;
    holding(
        &mut conn,
        "h_src",
        "STOCK",
        "100",
        2_000_00,
        Some("cus_a"),
        None,
    )
    .await;
    holding(
        &mut conn,
        "h_dst",
        "STOCK",
        "40",
        800_00,
        Some("cus_b"),
        None,
    )
    .await;

    let input = StockTransfer {
        from_custodian_id: "cus_a".into(),
        to_custodian_id: "cus_b".into(),
        holding_id: "h_src".into(),
        quantity: Some(Decimal::from(25)),
        fee_amount: None,
        fee_budget_id: None,
        fee_account_id: None,
        today: "2026-02-01T00:00:00.000Z".into(),
    };
    execute_stock_transfer(&mut conn, &input).await.unwrap();

    let rows: Vec<(String, String, i64)> = sqlx::query_as(
        r#"SELECT "id","quantity","costBasis" FROM "InvestmentHolding" ORDER BY "id""#,
    )
    .fetch_all(&mut *conn)
    .await
    .unwrap();
    assert_eq!(
        rows.len(),
        2,
        "matched on ticker + custodian, no third holding"
    );

    // A quarter of the source's 100 shares takes a quarter of its $2,000 basis.
    assert_eq!(rows[0].0, "h_dst");
    assert_eq!(rows[0].1, "65");
    assert_eq!(rows[0].2, 800_00 + 500_00);
    assert_eq!(rows[1].0, "h_src");
    assert_eq!(rows[1].1, "75");
    assert_eq!(rows[1].2, 2_000_00 - 500_00);

    // Nothing moved cash, so nothing may have moved the balance.
    let balance: i64 = sqlx::query_scalar(r#"SELECT "balance" FROM "Account" WHERE "id" = 'acct'"#)
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(balance, 100_000);
    assert!(breaks(&mut conn).await.is_empty());
}

#[tokio::test]
async fn an_existing_bitcoin_destination_accumulates_cost_basis_too() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut conn = pool.acquire().await.unwrap();
    seed(&mut conn, 0).await;
    holding(
        &mut conn,
        "h_src",
        "BITCOIN",
        "1",
        30_000_00,
        None,
        Some("wal_a"),
    )
    .await;
    holding(
        &mut conn,
        "h_dst",
        "BITCOIN",
        "0.5",
        10_000_00,
        None,
        Some("wal_b"),
    )
    .await;

    let input = BitcoinTransfer {
        from_wallet_id: "wal_a".into(),
        to_wallet_id: "wal_b".into(),
        quantity: d("0.25"),
        unit_is_sats: false,
        bitcoin_price: Some(d("60000")),
        fee_amount: Some(d("5000")),
        fee_unit: Some(FeeUnit::Sats),
    };
    execute_bitcoin_transfer(&mut conn, &input).await.unwrap();

    let rows: Vec<(String, String, i64)> = sqlx::query_as(
        r#"SELECT "id","quantity","costBasis" FROM "InvestmentHolding" ORDER BY "id""#,
    )
    .fetch_all(&mut *conn)
    .await
    .unwrap();

    // A quarter of a coin, so a quarter of the $30,000 basis moves. The fee is
    // excluded from the apportionment deliberately: it is paid to the network,
    // so it has no basis to carry anywhere.
    assert_eq!(rows[0].0, "h_dst");
    assert_eq!(rows[0].1, "0.75");
    assert_eq!(rows[0].2, 10_000_00 + 7_500_00);

    assert_eq!(rows[1].0, "h_src");
    assert_eq!(
        rows[1].1, "0.74995",
        "0.25 transferred plus 5,000 sats of fee"
    );
    assert_eq!(rows[1].2, 30_000_00 - 7_500_00);

    // The pair still sums to what it did — the rounding remainder stays with
    // the source rather than being invented or lost.
    assert_eq!(rows[0].2 + rows[1].2, 10_000_00 + 30_000_00);
    assert!(breaks(&mut conn).await.is_empty());
}
