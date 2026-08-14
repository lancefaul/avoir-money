//! Balance-chain tests, written against the incidents rather than the code.
//!
//! Every case here corresponds to something that actually went wrong and is
//! documented in ADRs or ERRORS.md. A port of this code that passes these has
//! reproduced the hard-won behaviour; one that does not has quietly
//! reintroduced a known ledger bug.

use avoir_core::money::Cents;
use avoir_db::balance::*;
use sqlx::SqliteConnection;

// Everything runs on ONE connection, deliberately. `sqlite::memory:` gives each
// connection its OWN database, so the pool is capped at a single connection —
// which means holding one while also calling through the pool deadlocks until
// the acquire timeout. Threading the connection is also how the real callers
// work, since the ledger gate runs inside a transaction.

async fn account(conn: &mut SqliteConnection, id: &str, name: &str, opening: i64) {
    sqlx::query(
        r#"INSERT INTO "Account" ("id","name","balance","createdAt","updatedAt","type",
              "archived","hasRewards","earnsInterest","interestRate","interestRateType",
              "openingBalance")
           VALUES (?, ?, ?, '2026-01-01T00:00:00','2026-01-01T00:00:00','CHECKING',
                   0,0,0,0,'APY', ?)"#,
    )
    .bind(id)
    .bind(name)
    .bind(opening)
    .bind(opening)
    .execute(&mut *conn)
    .await
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
async fn txn(
    conn: &mut SqliteConnection,
    id: &str,
    account_id: Option<&str>,
    to_account_id: Option<&str>,
    parent_id: Option<&str>,
    ty: &str,
    date: &str,
    seq: u32,
    net: i64,
) {
    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","amount","date","createdAt","type","name",
              "imported","netAmount","isCashBack","accountId","toAccountId","parentId")
           VALUES (?, ?, ?, ?, ?, 'row', 0, ?, 0, ?, ?, ?)"#,
    )
    .bind(id)
    .bind(net)
    .bind(date)
    .bind(format!("2026-01-01T00:00:{seq:02}"))
    .bind(ty)
    .bind(net)
    .bind(account_id)
    .bind(to_account_id)
    .bind(parent_id)
    .execute(&mut *conn)
    .await
    .unwrap();
}

async fn chain_of(conn: &mut SqliteConnection, id: &str) -> (Option<i64>, Option<i64>) {
    let r = sqlx::query_as::<_, (Option<i64>, Option<i64>)>(
        r#"SELECT "balanceBefore", "balanceAfter" FROM "Transaction" WHERE "id" = ?"#,
    )
    .bind(id)
    .fetch_one(&mut *conn)
    .await
    .unwrap();
    (r.0, r.1)
}

async fn to_chain_of(conn: &mut SqliteConnection, id: &str) -> (Option<i64>, Option<i64>) {
    let r = sqlx::query_as::<_, (Option<i64>, Option<i64>)>(
        r#"SELECT "toBalanceBefore", "toBalanceAfter" FROM "Transaction" WHERE "id" = ?"#,
    )
    .bind(id)
    .fetch_one(&mut *conn)
    .await
    .unwrap();
    (r.0, r.1)
}

/// The ordinary case: a chain walks forward from the opening balance.
#[tokio::test]
async fn chain_runs_from_the_opening_balance() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "acct", "Checking", 100_000).await;
    txn(
        &mut c,
        "t1",
        Some("acct"),
        None,
        None,
        "INCOME",
        "2026-01-05",
        1,
        250_000,
    )
    .await;
    txn(
        &mut c,
        "t2",
        Some("acct"),
        None,
        None,
        "EXPENSE",
        "2026-01-06",
        2,
        120_000,
    )
    .await;

    let total = rebuild_chain(&mut c, "acct").await.unwrap();

    assert_eq!(chain_of(&mut c, "t1").await, (Some(100_000), Some(350_000)));
    assert_eq!(chain_of(&mut c, "t2").await, (Some(350_000), Some(230_000)));
    assert_eq!(total, Cents(230_000));
}

/// ADR-018. A transfer INTO this account is part of its chain, and owns the
/// `toBalance*` columns rather than `balance*`.
///
/// Omitting the inbound leg is the bug that left the Prime Visa's ledger
/// tens of thousands out — exactly the sum of its nine inbound card payments — while
/// the account's own total was right, because the total was computed by a
/// second walk that DID include them.
#[tokio::test]
async fn an_inbound_transfer_is_part_of_the_destination_chain() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "src", "Savings", 500_000).await;
    account(&mut c, "dst", "Checking", 100_000).await;

    txn(
        &mut c,
        "t1",
        Some("dst"),
        None,
        None,
        "INCOME",
        "2026-01-05",
        1,
        250_000,
    )
    .await;
    // Outbound for src, inbound for dst.
    txn(
        &mut c,
        "xfer",
        Some("src"),
        Some("dst"),
        None,
        "TRANSFER",
        "2026-01-06",
        2,
        47_147,
    )
    .await;
    txn(
        &mut c,
        "t2",
        Some("dst"),
        None,
        None,
        "EXPENSE",
        "2026-01-07",
        3,
        8_432,
    )
    .await;

    let total = rebuild_chain(&mut c, "dst").await.unwrap();

    assert_eq!(chain_of(&mut c, "t1").await, (Some(100_000), Some(350_000)));
    // The transfer writes the DESTINATION columns, not the source ones.
    assert_eq!(
        to_chain_of(&mut c, "xfer").await,
        (Some(350_000), Some(397_147))
    );
    assert_eq!(
        chain_of(&mut c, "xfer").await,
        (None, None),
        "must not touch the source columns"
    );
    assert_eq!(chain_of(&mut c, "t2").await, (Some(397_147), Some(388_715)));
    assert_eq!(
        total,
        Cents(388_715),
        "the total must include the inbound transfer"
    );
}

/// Child rows carry an accountId but do not move the balance, and are excluded
/// by the load-bearing `parentId IS NULL` filter.
///
/// Including them makes a CORRECT chain look broken — that produced 50 false
/// discontinuities in one investigation before the filter was right.
#[tokio::test]
async fn split_children_are_excluded_from_the_chain() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "acct", "Checking", 100_000).await;
    txn(
        &mut c,
        "parent",
        Some("acct"),
        None,
        None,
        "EXPENSE",
        "2026-01-05",
        1,
        12_000,
    )
    .await;
    txn(
        &mut c,
        "child",
        Some("acct"),
        None,
        Some("parent"),
        "EXPENSE",
        "2026-01-05",
        2,
        5_000,
    )
    .await;

    let total = rebuild_chain(&mut c, "acct").await.unwrap();

    assert_eq!(
        chain_of(&mut c, "parent").await,
        (Some(100_000), Some(88_000))
    );
    assert_eq!(
        chain_of(&mut c, "child").await,
        (None, None),
        "children are not chained"
    );
    assert_eq!(total, Cents(88_000), "the child must not double-count");
}

/// ERRORS.md: one NULL row silently poisons the chain forever.
///
/// A single transient bad row left every later row blank, because the boundary
/// rule that stops propagation at NULL also stops REPAIR at NULL. Healing must
/// write THROUGH the gap.
#[tokio::test]
async fn a_mid_chain_null_heals_rather_than_stopping_repair() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "acct", "Checking", 100_000).await;
    for (i, id) in ["t1", "t2", "t3"].iter().enumerate() {
        txn(
            &mut c,
            id,
            Some("acct"),
            None,
            None,
            "EXPENSE",
            "2026-01-05",
            i as u32 + 1,
            10_000,
        )
        .await;
    }
    // Seed the first row as if written, leaving the rest NULL — the shape a
    // mid-cutover write leaves behind.
    sqlx::query(
        r#"UPDATE "Transaction" SET "balanceBefore"=100000,"balanceAfter"=90000 WHERE "id"='t1'"#,
    )
    .execute(&mut *c)
    .await
    .unwrap();

    // Without healing, the walk stops at the first NULL and t2/t3 stay blank.
    let written = recalculate_chain_forward(
        &mut c,
        "acct",
        "2026-01-05",
        "2026-01-01T00:00:01",
        "t1",
        Cents(90_000),
        false,
    )
    .await
    .unwrap();
    assert_eq!(written, 0, "the NULL boundary stops an ordinary walk");
    assert_eq!(chain_of(&mut c, "t2").await, (None, None));

    // Healing writes through the gap.
    let written = recalculate_chain_forward(
        &mut c,
        "acct",
        "2026-01-05",
        "2026-01-01T00:00:01",
        "t1",
        Cents(90_000),
        true,
    )
    .await
    .unwrap();
    assert_eq!(written, 2);
    assert_eq!(chain_of(&mut c, "t2").await, (Some(90_000), Some(80_000)));
    assert_eq!(chain_of(&mut c, "t3").await, (Some(80_000), Some(70_000)));
}

/// The walk stops once a row already agrees, so an edit deep in history does
/// not rewrite the entire account.
#[tokio::test]
async fn the_walk_stops_on_convergence() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "acct", "Checking", 100_000).await;
    for (i, id) in ["t1", "t2", "t3"].iter().enumerate() {
        txn(
            &mut c,
            id,
            Some("acct"),
            None,
            None,
            "EXPENSE",
            "2026-01-05",
            i as u32 + 1,
            10_000,
        )
        .await;
    }
    rebuild_chain(&mut c, "acct").await.unwrap();

    // Re-running from the same anchor writes nothing: t1 already agrees.
    let written = recalculate_chain_forward(&mut c, "acct", "", "", "", Cents(100_000), false)
        .await
        .unwrap();
    assert_eq!(written, 0, "an already-correct chain is not rewritten");
}

/// The invariant, on integers, in SQL. This is the property ADR-033 chose the
/// cents representation to make checkable at all.
#[tokio::test]
async fn the_ledger_invariant_holds_after_a_rebuild() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "a", "Checking", 100_000).await;
    account(&mut c, "b", "Savings", 0).await;
    txn(
        &mut c,
        "t1",
        Some("a"),
        None,
        None,
        "INCOME",
        "2026-01-05",
        1,
        250_000,
    )
    .await;
    txn(
        &mut c,
        "t2",
        Some("a"),
        None,
        None,
        "EXPENSE",
        "2026-01-06",
        2,
        120_000,
    )
    .await;
    txn(
        &mut c,
        "x",
        Some("a"),
        Some("b"),
        None,
        "TRANSFER",
        "2026-01-07",
        3,
        47_147,
    )
    .await;

    rebuild_chain(&mut c, "a").await.unwrap();
    rebuild_chain(&mut c, "b").await.unwrap();

    let bad = check_invariant(&mut c).await.unwrap();
    assert!(bad.is_empty(), "accounts out of balance: {bad:?}");
}

/// A rebuild seeds from `openingBalance`, never from zero.
///
/// Summing from zero is what erased the starting figure before that column
/// existed, and the backward chain rebuild then parked the difference in the
/// earliest row — quietly reclassifying "this balance is wrong" as "this
/// account had history before tracking".
#[tokio::test]
async fn a_rebuild_seeds_from_the_opening_balance() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    account(&mut c, "acct", "Card", -181_140).await;
    txn(
        &mut c,
        "t1",
        Some("acct"),
        None,
        None,
        "EXPENSE",
        "2026-01-05",
        1,
        10_000,
    )
    .await;

    let total = rebuild_chain(&mut c, "acct").await.unwrap();

    assert_eq!(
        chain_of(&mut c, "t1").await,
        (Some(-181_140), Some(-191_140))
    );
    assert_eq!(total, Cents(-191_140));
    assert!(check_invariant(&mut c).await.unwrap().is_empty());
}

/// A full rebuild rewrites every row, including ones past a healthy prefix.
///
/// `recalculate_chain_forward` stops at the first row whose stored
/// `balanceBefore` already matches — that convergence exit is what makes the
/// incremental path affordable (ADR-014). A rebuild inherits the same walk and
/// must NOT take it: the whole point of a repair is to reach the broken row,
/// which is by definition not the first one.
///
/// The real case: a transaction whose date had been stored in the wrong format
/// sorted to the end of its account with NULL chain fields. `rebuild_chain`
/// returned the correct account total and left the row NULL, because it
/// converged on row one and never walked that far.
#[tokio::test]
async fn a_rebuild_reaches_a_broken_row_past_a_healthy_prefix() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();

    account(&mut c, "acct", "A", 100_000).await;

    // Two rows with a CORRECT chain, then a third with NULLs.
    for (id, day, amt, before, after) in [
        ("t1", "01", 10_000i64, Some(100_000i64), Some(90_000i64)),
        ("t2", "02", 5_000, Some(90_000), Some(85_000)),
        ("t3", "03", 2_627, None, None),
    ] {
        sqlx::query(
            r#"INSERT INTO "Transaction"
                 ("id","amount","netAmount","date","createdAt","type","name","imported",
                  "isCashBack","accountId","balanceBefore","balanceAfter")
               VALUES (?,?,?,?,?,'EXPENSE','x',0,0,'acct',?,?)"#,
        )
        .bind(id)
        .bind(amt)
        .bind(amt)
        .bind(format!("2026-02-{day}T00:00:00.000Z"))
        .bind(format!("2026-02-{day}T00:00:00.000Z"))
        .bind(before)
        .bind(after)
        .execute(&mut *c)
        .await
        .unwrap();
    }

    let total = avoir_db::balance::rebuild_chain(&mut c, "acct")
        .await
        .unwrap();
    assert_eq!(total.0, 82_373, "100000 - 10000 - 5000 - 2627");

    let (before, after): (Option<i64>, Option<i64>) = sqlx::query_as(
        r#"SELECT "balanceBefore","balanceAfter" FROM "Transaction" WHERE "id"='t3'"#,
    )
    .fetch_one(&mut *c)
    .await
    .unwrap();
    assert_eq!(
        (before, after),
        (Some(85_000), Some(82_373)),
        "the rebuild must not stop at the healthy prefix"
    );
}
