//! Schedule matching, written around ADR-001 — the reason `occurrenceDate`
//! exists at all.

use avoir_core::money::Cents;
use avoir_db::ledger::*;
use avoir_db::schedule_matcher;
use sqlx::SqliteConnection;

async fn setup(conn: &mut SqliteConnection) {
    sqlx::query(
        r#"INSERT INTO "Account" ("id","name","balance","createdAt","updatedAt","type",
             "archived","hasRewards","earnsInterest","interestRate","interestRateType","openingBalance")
           VALUES ('acct','Checking',0,'2026-01-01T00:00:00','2026-01-01T00:00:00','CHECKING',0,0,0,0,'APY',0)"#,
    ).execute(&mut *conn).await.unwrap();
    sqlx::query(
        r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt")
           VALUES ('grp','G','#000','2026-01-01T00:00:00')"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
           VALUES ('bud','Bills',0,'2026-01-01T00:00:00','grp',0)"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Expense" ("id","name","amount","frequency","budgetId","isAutomatic",
             "createdAt","updatedAt","skipWeekend")
           VALUES ('exp','Internet',8000,'MONTHLY','bud',0,
                   '2026-01-01T00:00:00','2026-01-01T00:00:00',0)"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();
}

async fn scheduled(conn: &mut SqliteConnection, id: &str, due: &str, expected: i64) {
    sqlx::query(
        r#"INSERT INTO "ScheduledTransaction" ("id","sourceType","sourceId","dueDate",
             "expectedAmount","status","createdAt","updatedAt")
           VALUES (?, 'EXPENSE','exp', ?, ?, 'PENDING',
                   '2026-01-01T00:00:00','2026-01-01T00:00:00')"#,
    )
    .bind(id)
    .bind(due)
    .bind(expected)
    .execute(&mut *conn)
    .await
    .unwrap();
}

async fn row(conn: &mut SqliteConnection, id: &str) -> (String, Option<String>, Option<i64>) {
    sqlx::query_as(
        r#"SELECT "status","transactionId","actualAmount" FROM "ScheduledTransaction" WHERE "id" = ?"#,
    ).bind(id).fetch_one(&mut *conn).await.unwrap()
}

fn payment(id: &str, amount: i64, date: &str, occurrence: Option<&str>) -> LedgerCreate {
    LedgerCreate {
        id: id.into(),
        name: "Internet".into(),
        amount: Cents(amount),
        date: date.into(),
        created_at: format!("{date}T00:00:00"),
        tx_type: "EXPENSE".into(),
        account_id: Some("acct".into()),
        to_account_id: None,
        parent_id: None,
        budget_id: Some("bud".into()),
        expense_id: Some("exp".into()),
        trade: None,
        bitcoin: None,
        occurrence_date: occurrence.map(String::from),
        note: None,
        purchase_group_id: None,
    }
}

#[tokio::test]
async fn a_payment_marks_its_occurrence_paid() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    scheduled(&mut c, "s1", "2026-06-08", 8000).await;

    ledger_create(&mut c, &payment("t1", 8000, "2026-06-08", None))
        .await
        .unwrap();

    assert_eq!(
        row(&mut c, "s1").await,
        ("PAID".into(), Some("t1".into()), Some(8000))
    );
}

/// ADR-001, the case the whole `occurrenceDate` field exists for: a June 8th
/// bill paid on June 24th. Matching on `date` alone puts it 16 days out and it
/// finds nothing; matching on `occurrenceDate` keeps it attached.
#[tokio::test]
async fn an_overdue_payment_still_finds_its_occurrence() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    scheduled(&mut c, "s1", "2026-06-08", 8000).await;

    // Paid on the 24th, but for the 8th.
    ledger_create(
        &mut c,
        &payment("t1", 8000, "2026-06-24", Some("2026-06-08")),
    )
    .await
    .unwrap();

    assert_eq!(
        row(&mut c, "s1").await.0,
        "PAID",
        "the late payment still matched"
    );

    // And without occurrenceDate it does NOT match — the difference, asserted.
    let pool2 = avoir_db::connect_in_memory().await.unwrap();
    let mut c2 = pool2.acquire().await.unwrap();
    setup(&mut c2).await;
    scheduled(&mut c2, "s1", "2026-06-08", 8000).await;
    ledger_create(&mut c2, &payment("t2", 8000, "2026-06-24", None))
        .await
        .unwrap();
    assert_eq!(
        row(&mut c2, "s1").await.0,
        "PENDING",
        "16 days out is beyond the window"
    );
}

#[tokio::test]
async fn an_underpayment_is_partial_and_an_overpayment_is_paid() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    scheduled(&mut c, "s1", "2026-06-08", 8000).await;
    scheduled(&mut c, "s2", "2026-07-08", 8000).await;

    ledger_create(&mut c, &payment("t1", 5000, "2026-06-08", None))
        .await
        .unwrap();
    ledger_create(&mut c, &payment("t2", 9000, "2026-07-08", None))
        .await
        .unwrap();

    assert_eq!(row(&mut c, "s1").await.0, "PARTIAL");
    assert_eq!(
        row(&mut c, "s2").await.0,
        "PAID",
        "an overpayment still meets the obligation"
    );
}

/// Several pending rows can sit in one window for a weekly source; the closest
/// due date must win or the wrong occurrence is marked paid.
///
/// **The dates are chosen so the EARLIEST row is not the closest**, which took
/// two attempts to get right. There is a unique index on
/// `(sourceType, sourceId, dueDate)`, so SQLite always scans in due-date order
/// and the first candidate is always the earliest. With the payment before both
/// rows, "take the first" and "take the closest" agree, and a mutation
/// replacing the tiebreak with `.next()` passed. Paying on the 12th, with rows
/// on the 9th and the 13th, makes them disagree: earliest is the 9th, closest
/// is the 13th.
#[tokio::test]
async fn the_closest_due_date_wins() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    scheduled(&mut c, "earliest", "2026-06-09", 8000).await;
    scheduled(&mut c, "closest", "2026-06-13", 8000).await;

    ledger_create(&mut c, &payment("t1", 8000, "2026-06-12", None))
        .await
        .unwrap();

    assert_eq!(row(&mut c, "closest").await.0, "PAID", "one day away wins");
    assert_eq!(
        row(&mut c, "earliest").await.0,
        "PENDING",
        "three days away loses, even though it is scanned first"
    );
}

/// Deleting the payment must put the obligation back. Leaving it PAID is how a
/// deleted payment stays "done" and the bill never resurfaces.
#[tokio::test]
async fn deleting_the_payment_releases_the_occurrence() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    scheduled(&mut c, "s1", "2026-06-08", 8000).await;
    ledger_create(&mut c, &payment("t1", 8000, "2026-06-08", None))
        .await
        .unwrap();
    assert_eq!(row(&mut c, "s1").await.0, "PAID");

    ledger_delete(&mut c, "t1").await.unwrap();

    assert_eq!(
        row(&mut c, "s1").await,
        ("PENDING".into(), None, None),
        "back to outstanding, with the link and amount cleared"
    );
}

#[tokio::test]
async fn a_payment_outside_the_window_matches_nothing() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    scheduled(&mut c, "s1", "2026-06-08", 8000).await;

    ledger_create(&mut c, &payment("t1", 8000, "2026-06-20", None))
        .await
        .unwrap();
    assert_eq!(row(&mut c, "s1").await.0, "PENDING");
}

/// Updating the amount re-evaluates the status without moving the link.
#[tokio::test]
async fn updating_the_amount_refreshes_the_status() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    scheduled(&mut c, "s1", "2026-06-08", 8000).await;
    ledger_create(&mut c, &payment("t1", 5000, "2026-06-08", None))
        .await
        .unwrap();
    assert_eq!(row(&mut c, "s1").await.0, "PARTIAL");

    ledger_update_amount(&mut c, "t1", Cents(8000))
        .await
        .unwrap();

    let after = row(&mut c, "s1").await;
    assert_eq!(after.0, "PAID", "the shortfall was made up");
    assert_eq!(
        after.1.as_deref(),
        Some("t1"),
        "and it stayed on the same row"
    );
}

/// An already-linked transaction is left alone — mark-as-paid links explicitly
/// before the hook runs, and re-matching would move it.
#[tokio::test]
async fn an_already_linked_transaction_is_not_rematched() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    scheduled(&mut c, "s1", "2026-06-08", 8000).await;
    scheduled(&mut c, "s2", "2026-06-09", 8000).await;
    ledger_create(&mut c, &payment("t1", 8000, "2026-06-08", None))
        .await
        .unwrap();

    // s1 took it. Calling the matcher again must not move it to s2.
    let again = schedule_matcher::on_created(
        &mut c,
        "t1",
        Some("exp"),
        None,
        Cents(8000),
        "2026-06-08",
        None,
    )
    .await
    .unwrap();
    assert_eq!(again, None);
    assert_eq!(row(&mut c, "s2").await.0, "PENDING");
}
