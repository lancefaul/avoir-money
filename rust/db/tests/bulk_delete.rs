//! ADR-028: a full wipe resets derived state to its baseline, and the baseline
//! is `openingBalance` — not zero.

use avoir_core::money::Cents;
use avoir_db::balance::{check_invariant, rebuild_chain};
use avoir_db::bulk_delete::*;
use avoir_db::ledger::*;
use sqlx::SqliteConnection;

async fn setup(conn: &mut SqliteConnection) {
    sqlx::query(
        r#"INSERT INTO "Account" ("id","name","balance","createdAt","updatedAt","type",
             "archived","hasRewards","earnsInterest","interestRate","interestRateType","openingBalance")
           VALUES ('acct','Checking',250000,'2026-01-01T00:00:00','2026-01-01T00:00:00','CHECKING',
                   0,0,0,0,'APY',250000)"#,
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
           VALUES ('bud','B',0,'2026-01-01T00:00:00','grp',0)"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Expense" ("id","name","amount","frequency","budgetId","isAutomatic",
             "createdAt","updatedAt","skipWeekend")
           VALUES ('exp','Loan',50000,'MONTHLY','bud',0,
                   '2026-01-01T00:00:00','2026-01-01T00:00:00',0)"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Debt" ("id","name","type","originalBalance","currentBalance","apr",
             "minimumPayment","frequency","startDate","paidOff","createdAt","updatedAt",
             "escrowEnabled","linkedExpenseId")
           VALUES ('debt','Loan','AUTO',1000000,1000000,1200,50000,'MONTHLY','2026-01-01',0,
                   '2026-01-01T00:00:00','2026-01-01T00:00:00',0,'exp')"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "ScheduledTransaction" ("id","sourceType","sourceId","dueDate",
             "expectedAmount","status","createdAt","updatedAt")
           VALUES ('s_skip','EXPENSE','exp','2026-02-01',50000,'SKIPPED',
                   '2026-01-01T00:00:00','2026-01-01T00:00:00')"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "ScheduledTransaction" ("id","sourceType","sourceId","dueDate",
             "expectedAmount","status","createdAt","updatedAt")
           VALUES ('s_due','EXPENSE','exp','2026-03-01',50000,'PENDING',
                   '2026-01-01T00:00:00','2026-01-01T00:00:00')"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();
}

fn tx(id: &str, amount: i64, seq: u32) -> LedgerCreate {
    LedgerCreate {
        id: id.into(),
        name: "Loan payment".into(),
        amount: Cents(amount),
        date: "2026-03-01".into(),
        created_at: format!("2026-03-01T00:00:{seq:02}"),
        tx_type: "EXPENSE".into(),
        account_id: Some("acct".into()),
        to_account_id: None,
        parent_id: None,
        budget_id: Some("bud".into()),
        expense_id: Some("exp".into()),
        trade: None,
        bitcoin: None,
        occurrence_date: None,
        note: None,
        purchase_group_id: None,
    }
}

/// The headline: after a wipe the balance is the OPENING balance, not zero.
/// Resetting to zero discards the Starting Balance and breaks the invariant
/// the instant the wipe finishes.
#[tokio::test]
async fn a_wipe_resets_balance_to_opening_not_zero() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;

    ledger_create(&mut c, &tx("t1", 50000, 1)).await.unwrap();
    let after: i64 = sqlx::query_scalar(r#"SELECT "balance" FROM "Account""#)
        .fetch_one(&mut *c)
        .await
        .unwrap();
    assert_eq!(after, 200000, "250,000 opening less a 50,000 payment");

    wipe_all_transactions(&mut c).await.unwrap();

    let reset: i64 = sqlx::query_scalar(r#"SELECT "balance" FROM "Account""#)
        .fetch_one(&mut *c)
        .await
        .unwrap();
    assert_eq!(reset, 250000, "back to openingBalance, NOT zero");
    assert!(
        check_invariant(&mut c).await.unwrap().is_empty(),
        "and the invariant holds"
    );
}

/// A debt with no recorded payments owes its full original balance again.
#[tokio::test]
async fn a_wipe_restores_debts_to_their_original_balance() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;

    ledger_create(&mut c, &tx("t1", 50000, 1)).await.unwrap();
    let mid: i64 = sqlx::query_scalar(r#"SELECT "currentBalance" FROM "Debt""#)
        .fetch_one(&mut *c)
        .await
        .unwrap();
    assert!(mid < 1000000, "the payment reduced it");

    wipe_all_transactions(&mut c).await.unwrap();

    let after: (i64, i64) = sqlx::query_as(r#"SELECT "currentBalance","paidOff" FROM "Debt""#)
        .fetch_one(&mut *c)
        .await
        .unwrap();
    assert_eq!(after, (1000000, 0), "full balance owed, not settled");
    let payments: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "DebtPayment""#)
        .fetch_one(&mut *c)
        .await
        .unwrap();
    assert_eq!(payments, 0);
}

/// PAID/PARTIAL revert; SKIPPED and SNOOZED are deliberate user actions with
/// no transaction behind them and must survive. That distinction is the point
/// of the WHERE clause.
#[tokio::test]
async fn a_wipe_reverts_paid_occurrences_but_leaves_skipped_alone() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;

    ledger_create(&mut c, &tx("t1", 50000, 1)).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            r#"SELECT "status" FROM "ScheduledTransaction" WHERE "id"='s_due'"#
        )
        .fetch_one(&mut *c)
        .await
        .unwrap(),
        "PAID"
    );

    wipe_all_transactions(&mut c).await.unwrap();

    let rows: Vec<(String, String)> =
        sqlx::query_as(r#"SELECT "id","status" FROM "ScheduledTransaction" ORDER BY "id""#)
            .fetch_all(&mut *c)
            .await
            .unwrap();
    assert_eq!(
        rows,
        vec![
            ("s_due".to_string(), "PENDING".to_string()),
            ("s_skip".to_string(), "SKIPPED".to_string()),
        ],
        "the paid one reverts; the skipped one is untouched"
    );
}

/// Children are deleted first — `Transaction.parentId` self-references, so a
/// blanket delete can otherwise hit a parent whose child still points at it.
#[tokio::test]
async fn a_wipe_removes_split_children_too() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;

    ledger_create(&mut c, &tx("parent", 50000, 1))
        .await
        .unwrap();
    let mut child = tx("child", 20000, 2);
    child.parent_id = Some("parent".into());
    child.expense_id = None;
    ledger_create(&mut c, &child).await.unwrap();

    let removed = wipe_all_transactions(&mut c).await.unwrap();
    assert_eq!(removed, 2);
    let left: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "Transaction""#)
        .fetch_one(&mut *c)
        .await
        .unwrap();
    assert_eq!(left, 0);
}

/// Holdings empty out — no trades means no units and no basis.
#[tokio::test]
async fn a_wipe_empties_holdings() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    sqlx::query(
        r#"INSERT INTO "Custodian" ("id","name","createdAt","updatedAt")
           VALUES ('cust','F','2026-01-01T00:00:00','2026-01-01T00:00:00')"#,
    )
    .execute(&mut *c)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "InvestmentHolding" ("id","name","ticker","type","quantity","costBasis",
             "createdAt","updatedAt","custodianId")
           VALUES ('h','F','VTSAX','STOCK','10.5',100000,
                   '2026-01-01T00:00:00','2026-01-01T00:00:00','cust')"#,
    )
    .execute(&mut *c)
    .await
    .unwrap();

    wipe_all_transactions(&mut c).await.unwrap();

    let h: (String, Option<i64>) =
        sqlx::query_as(r#"SELECT "quantity","costBasis" FROM "InvestmentHolding""#)
            .fetch_one(&mut *c)
            .await
            .unwrap();
    assert_eq!(h, ("0".to_string(), None));
}

/// The rebuild after a wipe agrees with the reset — two independent routes to
/// the same baseline, which is what makes the shortcut safe.
#[tokio::test]
async fn the_reset_agrees_with_a_full_rebuild() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c).await;
    ledger_create(&mut c, &tx("t1", 50000, 1)).await.unwrap();

    wipe_all_transactions(&mut c).await.unwrap();
    let from_reset: i64 = sqlx::query_scalar(r#"SELECT "balance" FROM "Account""#)
        .fetch_one(&mut *c)
        .await
        .unwrap();

    let from_rebuild = rebuild_chain(&mut c, "acct").await.unwrap();
    assert_eq!(
        from_rebuild,
        Cents(from_reset),
        "the shortcut lands where the walk does"
    );
}
