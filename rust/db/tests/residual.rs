//! The residual: the app's disagreement with the bank, as one number.

use avoir_core::money::Cents;
use avoir_db::reconciliation::{compute, sums_around};
use sqlx::SqliteConnection;

async fn account(conn: &mut SqliteConnection, id: &str, opening: i64) {
    sqlx::query(
        r#"INSERT INTO "Account" ("id","name","balance","createdAt","updatedAt","type",
             "archived","hasRewards","earnsInterest","interestRate","interestRateType",
             "openingBalance")
           VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','CHECKING',
                   0,0,0,0,'APY', ?)"#,
    )
    .bind(id)
    .bind(id)
    .bind(opening)
    .bind(opening)
    .execute(&mut *conn)
    .await
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
async fn tx(
    conn: &mut SqliteConnection,
    id: &str,
    ty: &str,
    amount: i64,
    date: &str,
    account_id: Option<&str>,
    to_account_id: Option<&str>,
    parent_id: Option<&str>,
) {
    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","type","name","amount","netAmount","date","createdAt",
             "imported","isCashBack","accountId","toAccountId","parentId")
           VALUES (?, ?, 'row', ?, ?, ?, ?, 0, 0, ?, ?, ?)"#,
    )
    .bind(id)
    .bind(ty)
    .bind(amount)
    .bind(amount)
    .bind(date)
    .bind(date)
    .bind(account_id)
    .bind(to_account_id)
    .bind(parent_id)
    .execute(&mut *conn)
    .await
    .unwrap();
}

async fn session(conn: &mut SqliteConnection, id: &str, account_id: &str, ending: i64, end: &str) {
    sqlx::query(
        r#"INSERT INTO "ReconciliationSession" ("id","accountId","periodStart","periodEnd",
             "statementEndingBalance","status","residualAtClose","createdAt","updatedAt")
           VALUES (?, ?, '2026-03-01T00:00:00.000Z', ?, ?, 'DRAFT', 0,
                   '2026-03-01T00:00:00.000Z','2026-03-01T00:00:00.000Z')"#,
    )
    .bind(id)
    .bind(account_id)
    .bind(end)
    .bind(ending)
    .execute(&mut *conn)
    .await
    .unwrap();
}

#[tokio::test]
async fn a_matching_statement_leaves_no_residual_and_needs_no_tolerance() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "acct", 100_000).await;
    tx(
        &mut c,
        "t1",
        "EXPENSE",
        25_00,
        "2026-03-05T00:00:00.000Z",
        Some("acct"),
        None,
        None,
    )
    .await;
    tx(
        &mut c,
        "t2",
        "INCOME",
        50_00,
        "2026-03-10T00:00:00.000Z",
        Some("acct"),
        None,
        None,
    )
    .await;
    session(&mut c, "s", "acct", 102_500, "2026-03-31T00:00:00.000Z").await;

    let r = compute(&mut c, "s").await.unwrap().unwrap();
    assert_eq!(r.transaction_sum, Cents(25_00));
    assert_eq!(r.expected_balance, Cents(102_500));
    // Exact zero. Both sides are i64 sums of the same integers, so there is no
    // tolerance to choose and none to get wrong.
    assert_eq!(r.residual, Cents::ZERO);
    assert!(r.is_balanced);
}

#[tokio::test]
async fn a_half_cent_disagreement_is_not_balanced() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "acct", 100_000).await;
    session(&mut c, "s", "acct", 100_001, "2026-03-31T00:00:00.000Z").await;

    // The TypeScript's 0.005 tolerance would have called this balanced. A
    // tolerance wide enough to absorb float noise is wide enough to hide a real
    // disagreement, which is what a reconciliation exists to surface.
    let r = compute(&mut c, "s").await.unwrap().unwrap();
    assert_eq!(r.residual, Cents(1));
    assert!(!r.is_balanced);
}

#[tokio::test]
async fn every_transaction_type_carries_the_sign_the_bank_would_see() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "acct", 0).await;
    account(&mut c, "other", 0).await;

    let d = "2026-03-05T00:00:00.000Z";
    tx(&mut c, "inc", "INCOME", 100_00, d, Some("acct"), None, None).await;
    tx(&mut c, "ref", "REFUND", 10_00, d, Some("acct"), None, None).await;
    tx(&mut c, "exp", "EXPENSE", 30_00, d, Some("acct"), None, None).await;
    // Out of this account, and into it.
    tx(
        &mut c,
        "out",
        "TRANSFER",
        20_00,
        d,
        Some("acct"),
        Some("other"),
        None,
    )
    .await;
    tx(
        &mut c,
        "in",
        "TRANSFER",
        5_00,
        d,
        Some("other"),
        Some("acct"),
        None,
    )
    .await;

    let (through, _) = sums_around(&mut c, "acct", "2026-03-31T00:00:00.000Z")
        .await
        .unwrap();
    assert_eq!(through, Cents(100_00 + 10_00 - 30_00 - 20_00 + 5_00));
}

#[tokio::test]
async fn a_trade_is_signed_by_its_direction() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "acct", 0).await;
    let d = "2026-03-05T00:00:00.000Z";
    tx(&mut c, "buy", "TRADE", 500_00, d, Some("acct"), None, None).await;
    tx(&mut c, "sell", "TRADE", 200_00, d, Some("acct"), None, None).await;
    for (id, dir) in [("buy", "BUY"), ("sell", "SELL")] {
        sqlx::query(
            r#"INSERT INTO "TradeDetail" ("id","transactionId","direction","assetType",
                 "quantity","unitPrice") VALUES (?, ?, ?, 'Stock','1','1')"#,
        )
        .bind(format!("d_{id}"))
        .bind(id)
        .bind(dir)
        .execute(&mut *c)
        .await
        .unwrap();
    }

    // Buying spends cash, selling returns it — the account sees the opposite of
    // what the holding does.
    let (through, _) = sums_around(&mut c, "acct", "2026-03-31T00:00:00.000Z")
        .await
        .unwrap();
    assert_eq!(through, Cents(-500_00 + 200_00));
}

#[tokio::test]
async fn split_children_are_not_counted_against_the_statement() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "acct", 0).await;
    let d = "2026-03-05T00:00:00.000Z";
    tx(
        &mut c,
        "parent",
        "EXPENSE",
        100_00,
        d,
        Some("acct"),
        None,
        None,
    )
    .await;
    // A child carries an account but is invisible to every balance query. The
    // bank saw one charge, not two.
    tx(
        &mut c,
        "child",
        "EXPENSE",
        40_00,
        d,
        Some("acct"),
        None,
        Some("parent"),
    )
    .await;

    let (through, _) = sums_around(&mut c, "acct", "2026-03-31T00:00:00.000Z")
        .await
        .unwrap();
    assert_eq!(through, Cents(-100_00));
}

#[tokio::test]
async fn activity_after_the_period_is_reported_but_never_netted_out() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "acct", 100_000).await;
    tx(
        &mut c,
        "inside",
        "EXPENSE",
        25_00,
        "2026-03-05T00:00:00.000Z",
        Some("acct"),
        None,
        None,
    )
    .await;
    tx(
        &mut c,
        "outside",
        "EXPENSE",
        40_00,
        "2026-04-05T00:00:00.000Z",
        Some("acct"),
        None,
        None,
    )
    .await;
    session(&mut c, "s", "acct", 97_500, "2026-03-31T00:00:00.000Z").await;

    let r = compute(&mut c, "s").await.unwrap().unwrap();
    // The residual sees only what happened through the period end.
    assert_eq!(r.transaction_sum, Cents(-25_00));
    assert_eq!(r.residual, Cents::ZERO);
    assert!(r.is_balanced);
    // The tail is context. Netting it out would let an error inside the period
    // cancel one outside it and both would disappear.
    assert_eq!(r.activity_after_period_end, Cents(-40_00));
}

#[tokio::test]
async fn the_period_end_boundary_is_inclusive() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "acct", 0).await;
    tx(
        &mut c,
        "on",
        "EXPENSE",
        10_00,
        "2026-03-31T00:00:00.000Z",
        Some("acct"),
        None,
        None,
    )
    .await;
    tx(
        &mut c,
        "after",
        "EXPENSE",
        20_00,
        "2026-04-01T00:00:00.000Z",
        Some("acct"),
        None,
        None,
    )
    .await;

    // A statement covering March includes the 31st.
    let (through, after) = sums_around(&mut c, "acct", "2026-03-31T00:00:00.000Z")
        .await
        .unwrap();
    assert_eq!(through, Cents(-10_00));
    assert_eq!(after, Cents(-20_00));
}

#[tokio::test]
async fn another_accounts_rows_do_not_reach_this_statement() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "acct", 0).await;
    account(&mut c, "other", 0).await;
    tx(
        &mut c,
        "mine",
        "EXPENSE",
        10_00,
        "2026-03-05T00:00:00.000Z",
        Some("acct"),
        None,
        None,
    )
    .await;
    tx(
        &mut c,
        "theirs",
        "EXPENSE",
        99_00,
        "2026-03-05T00:00:00.000Z",
        Some("other"),
        None,
        None,
    )
    .await;

    let (through, _) = sums_around(&mut c, "acct", "2026-03-31T00:00:00.000Z")
        .await
        .unwrap();
    assert_eq!(through, Cents(-10_00));
}

#[tokio::test]
async fn an_account_with_no_rows_reads_its_opening_balance() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "acct", 100_000).await;
    session(&mut c, "s", "acct", 100_000, "2026-03-31T00:00:00.000Z").await;

    // COALESCE, not NULL: a fresh account has no transactions and its expected
    // balance is exactly its opening.
    let r = compute(&mut c, "s").await.unwrap().unwrap();
    assert_eq!(r.transaction_sum, Cents::ZERO);
    assert_eq!(r.expected_balance, Cents(100_000));
    assert!(r.is_balanced);
}

#[tokio::test]
async fn a_session_that_does_not_exist_is_none_rather_than_an_error() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    assert!(compute(&mut c, "nope").await.unwrap().is_none());
}
