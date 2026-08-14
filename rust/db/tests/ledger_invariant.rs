//! The ledger invariant, under arbitrary sequences of gate operations.
//!
//! `openingBalance + SUM(signed transactions) == balance`, for every account,
//! after any sequence of creates, amount changes and deletes. This is the Rust
//! counterpart of `apps/api/src/__tests__/ledger-invariant.property.test.ts`,
//! and it is the check that matters most in the whole port: the invariant is
//! the one statement that catches a hook doing half its job.
//!
//! Note what integer cents buy here. The TypeScript version has to tolerate
//! floating-point slop when comparing two independently-derived numbers; this
//! asserts exact equality, because both sides are i64 sums of the same
//! integers. There is no epsilon to choose and therefore no epsilon to get
//! wrong — which matters, since an epsilon wide enough to absorb float noise is
//! also wide enough to hide a genuine sub-cent defect.

use avoir_core::money::Cents;
use avoir_db::balance::{check_amount_matches_net, check_invariant};
use avoir_db::ledger::*;
use proptest::prelude::*;
use sqlx::SqliteConnection;
use tokio::runtime::Runtime;

/// One thing the gate can be asked to do.
#[derive(Debug, Clone)]
enum Op {
    Create {
        account: usize,
        kind: usize,
        amount: i64,
        day: u32,
    },
    Transfer {
        from: usize,
        to: usize,
        amount: i64,
        day: u32,
    },
    UpdateAmount {
        index: usize,
        amount: i64,
    },
    Delete {
        index: usize,
    },
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        4 => (0usize..3, 0usize..3, -500_000i64..500_000, 1u32..28)
            .prop_map(|(account, kind, amount, day)| Op::Create { account, kind, amount, day }),
        2 => (0usize..3, 0usize..3, 1i64..200_000, 1u32..28)
            .prop_map(|(from, to, amount, day)| Op::Transfer { from, to, amount, day }),
        1 => (0usize..20, -500_000i64..500_000)
            .prop_map(|(index, amount)| Op::UpdateAmount { index, amount }),
        1 => (0usize..20).prop_map(|index| Op::Delete { index }),
    ]
}

const KINDS: [&str; 3] = ["EXPENSE", "INCOME", "REFUND"];

async fn seed_accounts(conn: &mut SqliteConnection, openings: [i64; 3]) {
    for (i, opening) in openings.iter().enumerate() {
        sqlx::query(
            r#"INSERT INTO "Account" ("id","name","balance","createdAt","updatedAt","type",
                  "archived","hasRewards","earnsInterest","interestRate","interestRateType",
                  "openingBalance")
               VALUES (?, ?, ?, '2026-01-01T00:00:00','2026-01-01T00:00:00','CHECKING',
                       0,0,0,0,'APY', ?)"#,
        )
        .bind(format!("acct{i}"))
        .bind(format!("Account {i}"))
        .bind(opening)
        .bind(opening)
        .execute(&mut *conn)
        .await
        .unwrap();
    }
}

async fn apply(
    conn: &mut SqliteConnection,
    ops: &[Op],
    openings: [i64; 3],
) -> Vec<(String, Cents)> {
    seed_accounts(conn, openings).await;
    let mut ids: Vec<String> = Vec::new();

    for (n, op) in ops.iter().enumerate() {
        match op {
            Op::Create {
                account,
                kind,
                amount,
                day,
            } => {
                let id = format!("t{n}");
                let data = LedgerCreate {
                    id: id.clone(),
                    name: format!("row {n}"),
                    // Amounts are stored positive; `type` carries the sign, as
                    // the ledger requires.
                    amount: Cents(amount.abs()),
                    date: format!("2026-01-{day:02}"),
                    created_at: format!("2026-01-01T00:00:{n:02}"),
                    tx_type: KINDS[*kind].to_string(),
                    account_id: Some(format!("acct{account}")),
                    to_account_id: None,
                    parent_id: None,
                    budget_id: None,
                    expense_id: None,
                    trade: None,
                    bitcoin: None,
                    occurrence_date: None,
                    note: None,
                    purchase_group_id: None,
                };
                if ledger_create(&mut *conn, &data).await.is_ok() {
                    ids.push(id);
                }
            }
            Op::Transfer {
                from,
                to,
                amount,
                day,
            } => {
                if from == to {
                    continue; // a transfer to itself is not a thing the app allows
                }
                let id = format!("t{n}");
                let data = LedgerCreate {
                    id: id.clone(),
                    name: format!("xfer {n}"),
                    amount: Cents(*amount),
                    date: format!("2026-01-{day:02}"),
                    created_at: format!("2026-01-01T00:00:{n:02}"),
                    tx_type: "TRANSFER".to_string(),
                    account_id: Some(format!("acct{from}")),
                    to_account_id: Some(format!("acct{to}")),
                    parent_id: None,
                    budget_id: None,
                    expense_id: None,
                    trade: None,
                    bitcoin: None,
                    occurrence_date: None,
                    note: None,
                    purchase_group_id: None,
                };
                if ledger_create(&mut *conn, &data).await.is_ok() {
                    ids.push(id);
                }
            }
            Op::UpdateAmount { index, amount } => {
                if let Some(id) = ids.get(*index) {
                    let _ = ledger_update_amount(&mut *conn, id, Cents(amount.abs())).await;
                }
            }
            Op::Delete { index } => {
                if *index < ids.len() {
                    let id = ids.remove(*index);
                    let _ = ledger_delete(&mut *conn, &id).await;
                }
            }
        }
    }

    // BOTH checks. The invariant alone cannot see an amount/netAmount
    // divergence — it sums netAmount and the balance is rebuilt from
    // netAmount, so the error appears on both sides and cancels.
    let mut bad = check_invariant(&mut *conn).await.unwrap();
    for (id, amount, net) in check_amount_matches_net(&mut *conn).await.unwrap() {
        bad.push((
            format!("row {id}: amount {amount} != net {net}"),
            amount - net,
        ));
    }
    bad
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, ..ProptestConfig::default() })]

    /// No sequence of gate operations leaves an account out of balance.
    #[test]
    fn no_sequence_of_ledger_operations_breaks_the_invariant(
        ops in prop::collection::vec(op(), 0..14),
        openings in prop::array::uniform3(-200_000i64..200_000),
    ) {
        let rt = Runtime::new().unwrap();
        let bad = rt.block_on(async {
            let pool = avoir_db::connect_in_memory().await.unwrap();
            let mut conn = pool.acquire().await.unwrap();
            apply(&mut conn, &ops, openings).await
        });
        prop_assert!(bad.is_empty(), "accounts out of balance: {:?}", bad);
    }
}

/// A transfer moves money between two accounts and both chains must reflect it.
/// Asserted on its own because it is the case ADR-018 exists for, and a
/// property test can pass while never generating one.
#[tokio::test]
async fn a_transfer_leaves_both_accounts_balanced() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    seed_accounts(&mut c, [100_000, 0, 0]).await;

    ledger_create(
        &mut c,
        &LedgerCreate {
            id: "x".into(),
            name: "transfer".into(),
            amount: Cents(25_000),
            date: "2026-01-05".into(),
            created_at: "2026-01-01T00:00:01".into(),
            tx_type: "TRANSFER".into(),
            account_id: Some("acct0".into()),
            to_account_id: Some("acct1".into()),
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

    assert!(check_invariant(&mut c).await.unwrap().is_empty());

    let balances: Vec<(String, i64)> =
        sqlx::query_as(r#"SELECT "id","balance" FROM "Account" ORDER BY "id""#)
            .fetch_all(&mut *c)
            .await
            .unwrap();
    assert_eq!(balances[0].1, 75_000, "source debited");
    assert_eq!(balances[1].1, 25_000, "destination credited");
}

/// Deleting a transaction reverses it exactly — the balance returns to what it
/// was, rather than to zero or to a frozen figure (ADR-028's baseline rule).
#[tokio::test]
async fn deleting_a_transaction_restores_the_previous_balance() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    seed_accounts(&mut c, [100_000, 0, 0]).await;

    let mk = |id: &str, n: u32| LedgerCreate {
        id: id.into(),
        name: "row".into(),
        amount: Cents(10_000),
        date: "2026-01-05".into(),
        created_at: format!("2026-01-01T00:00:{n:02}"),
        tx_type: "EXPENSE".into(),
        account_id: Some("acct0".into()),
        to_account_id: None,
        parent_id: None,
        budget_id: None,
        expense_id: None,
        trade: None,
        bitcoin: None,
        occurrence_date: None,
        note: None,
        purchase_group_id: None,
    };
    ledger_create(&mut c, &mk("a", 1)).await.unwrap();
    ledger_create(&mut c, &mk("b", 2)).await.unwrap();

    let after_two: i64 =
        sqlx::query_scalar(r#"SELECT "balance" FROM "Account" WHERE "id"='acct0'"#)
            .fetch_one(&mut *c)
            .await
            .unwrap();
    assert_eq!(after_two, 80_000);

    ledger_delete(&mut c, "b").await.unwrap();
    let after_delete: i64 =
        sqlx::query_scalar(r#"SELECT "balance" FROM "Account" WHERE "id"='acct0'"#)
            .fetch_one(&mut *c)
            .await
            .unwrap();
    assert_eq!(after_delete, 90_000, "the delete reverses exactly one row");
    assert!(check_invariant(&mut c).await.unwrap().is_empty());
}

// ── The full update patch ────────────────────────────────────────────────

use avoir_db::ledger::LedgerUpdate;

async fn one_account_with_a_row(conn: &mut SqliteConnection) {
    seed_accounts(conn, [100_000, 50_000, 0]).await;
    ledger_create(
        conn,
        &LedgerCreate {
            id: "t1".into(),
            name: "original".into(),
            amount: Cents(10_000),
            date: "2026-01-05".into(),
            created_at: "2026-01-05T00:00:00".into(),
            tx_type: "EXPENSE".into(),
            account_id: Some("acct0".into()),
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
}

/// A patch changes only what it names.
#[tokio::test]
async fn an_update_leaves_unnamed_fields_alone() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    one_account_with_a_row(&mut c).await;

    ledger_update(
        &mut c,
        "t1",
        &LedgerUpdate {
            name: Some("renamed".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let row: (String, i64, String) =
        sqlx::query_as(r#"SELECT "name","amount","date" FROM "Transaction" WHERE "id"='t1'"#)
            .fetch_one(&mut *c)
            .await
            .unwrap();
    // The date is unchanged by this update, but it is stored canonically —
    // `ledger_create` normalised the bare `2026-01-05` the fixture supplied, so
    // it sorts beside every other row instead of below them.
    assert_eq!(
        row,
        ("renamed".into(), 10_000, "2026-01-05T00:00:00.000Z".into())
    );
}

/// Some(None) CLEARS a nullable field; None leaves it. A plain Option cannot
/// express both, and unlinking a transaction from its expense is a real
/// operation.
#[tokio::test]
async fn clearing_a_nullable_field_differs_from_not_supplying_it() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    one_account_with_a_row(&mut c).await;
    ledger_update(
        &mut c,
        "t1",
        &LedgerUpdate {
            note: Some(Some("a note".into())),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // Not supplied — the note survives.
    ledger_update(
        &mut c,
        "t1",
        &LedgerUpdate {
            name: Some("x".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let note: Option<String> =
        sqlx::query_scalar(r#"SELECT "note" FROM "Transaction" WHERE "id"='t1'"#)
            .fetch_one(&mut *c)
            .await
            .unwrap();
    assert_eq!(note.as_deref(), Some("a note"));

    // Explicitly cleared.
    ledger_update(
        &mut c,
        "t1",
        &LedgerUpdate {
            note: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let note: Option<String> =
        sqlx::query_scalar(r#"SELECT "note" FROM "Transaction" WHERE "id"='t1'"#)
            .fetch_one(&mut *c)
            .await
            .unwrap();
    assert_eq!(note, None);
}

/// netAmount follows amount and is never accepted from the caller — the
/// invariant ADR-013 exists to protect.
#[tokio::test]
async fn an_amount_change_carries_net_amount_with_it() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    one_account_with_a_row(&mut c).await;

    ledger_update(
        &mut c,
        "t1",
        &LedgerUpdate {
            amount: Some(Cents(25_000)),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let row: (i64, i64) =
        sqlx::query_as(r#"SELECT "amount","netAmount" FROM "Transaction" WHERE "id"='t1'"#)
            .fetch_one(&mut *c)
            .await
            .unwrap();
    assert_eq!(row, (25_000, 25_000));
    assert!(check_amount_matches_net(&mut c).await.unwrap().is_empty());
}

/// Moving a transaction between accounts must rebuild BOTH — the old account's
/// chain otherwise still describes a row it no longer contains.
#[tokio::test]
async fn moving_a_transaction_rebuilds_the_account_it_left() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    one_account_with_a_row(&mut c).await;

    let before: Vec<(String, i64)> =
        sqlx::query_as(r#"SELECT "id","balance" FROM "Account" ORDER BY "id""#)
            .fetch_all(&mut *c)
            .await
            .unwrap();
    assert_eq!(
        before[0].1, 90_000,
        "acct0 opened at 100,000 less the 10,000 expense"
    );
    assert_eq!(before[1].1, 50_000, "acct1 untouched");

    ledger_update(
        &mut c,
        "t1",
        &LedgerUpdate {
            account_id: Some(Some("acct1".into())),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let after: Vec<(String, i64)> =
        sqlx::query_as(r#"SELECT "id","balance" FROM "Account" ORDER BY "id""#)
            .fetch_all(&mut *c)
            .await
            .unwrap();
    assert_eq!(
        after[0].1, 100_000,
        "the account it left is back to its opening balance"
    );
    assert_eq!(after[1].1, 40_000, "and the new one carries the expense");
    assert!(check_invariant(&mut c).await.unwrap().is_empty());
}

/// A date entered as a bare `YYYY-MM-DD` must be stored in the same format as
/// everything else.
///
/// TEXT comparison is lexicographic, so `'2026-08-10'` is a prefix of
/// `'2026-08-10T00:00:00.000Z'` and sorts BELOW it. A transaction created
/// through the form landed at the bottom of the list for exactly that reason.
/// The list is the mild symptom — the balance chain orders by
/// `(date, createdAt, id)`, so a mis-sorted row chains off the wrong neighbour.
#[tokio::test]
async fn a_bare_date_is_stored_canonically() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut conn = pool.acquire().await.unwrap();

    let id = avoir_db::ledger::ledger_create(
        &mut conn,
        &avoir_db::ledger::LedgerCreate {
            id: "tx_bare".into(),
            name: "Amazon".into(),
            amount: avoir_core::money::Cents(-4599),
            date: "2026-08-10".into(),
            created_at: "2026-08-10T18:00:00.000Z".into(),
            tx_type: "EXPENSE".into(),
            account_id: None,
            to_account_id: None,
            parent_id: None,
            budget_id: None,
            expense_id: None,
            note: None,
            trade: None,
            bitcoin: None,
            occurrence_date: Some("2026-08-10".into()),
            purchase_group_id: None,
        },
    )
    .await
    .unwrap();
    drop(conn);

    let (date, occ): (String, Option<String>) =
        sqlx::query_as(r#"SELECT "date", "occurrenceDate" FROM "Transaction" WHERE "id" = ?"#)
            .bind(&id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(date, "2026-08-10T00:00:00.000Z");
    assert_eq!(occ.as_deref(), Some("2026-08-10T00:00:00.000Z"));
    assert_eq!(date.len(), 24, "must match the format every other row uses");
}
