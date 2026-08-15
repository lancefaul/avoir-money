//! Debt-payment hook: recording a split, and reversing it exactly.
//!
//! The reversal is the interesting half. `DebtPayment.transactionId` is
//! `ON DELETE SET NULL`, so the payment must be read before the transaction is
//! removed — read it after and the query finds nothing, silently, leaving the
//! debt permanently reduced by a payment that no longer exists.

use avoir_core::money::Cents;
use avoir_db::debt_payment;
use avoir_db::ledger::*;
use sqlx::SqliteConnection;

/// A minimal valid graph: group → budget → expense → debt, plus an account.
///
/// Every column here is NOT NULL in the schema. Written out rather than
/// defaulted so a schema change that adds a required column fails loudly at the
/// fixture instead of silently somewhere downstream.
async fn setup(conn: &mut SqliteConnection, balance: i64, apr: i64) {
    sqlx::query(
        r#"INSERT INTO "Account" ("id","name","balance","createdAt","updatedAt","type",
             "archived","hasRewards","earnsInterest","interestRate","interestRateType","openingBalance")
           VALUES ('acct','Checking',0,'2026-01-01T00:00:00','2026-01-01T00:00:00','CHECKING',0,0,0,0,'APY',0)"#,
    ).execute(&mut *conn).await.unwrap();

    sqlx::query(
        r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt")
           VALUES ('grp','Debts','#000','2026-01-01T00:00:00')"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
           VALUES ('bud','Debt',0,'2026-01-01T00:00:00','grp',0)"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO "Expense" ("id","name","amount","frequency","budgetId","isAutomatic",
             "createdAt","updatedAt","skipWeekend")
           VALUES ('exp','Car Loan',50000,'MONTHLY','bud',0,
                   '2026-01-01T00:00:00','2026-01-01T00:00:00',0)"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO "Debt" ("id","name","type","originalBalance","currentBalance","apr",
             "minimumPayment","frequency","startDate","paidOff","createdAt","updatedAt",
             "escrowEnabled","linkedExpenseId")
           VALUES ('debt','Car Loan','AUTO', ?, ?, ?, 50000,'MONTHLY','2026-01-01',0,
                   '2026-01-01T00:00:00','2026-01-01T00:00:00',0,'exp')"#,
    )
    .bind(balance)
    .bind(balance)
    .bind(apr)
    .execute(&mut *conn)
    .await
    .unwrap();
}

fn payment(id: &str, amount: i64, seq: u32) -> LedgerCreate {
    LedgerCreate {
        id: id.into(),
        name: "Car Loan payment".into(),
        amount: Cents(amount),
        date: "2026-02-01".into(),
        created_at: format!("2026-02-01T00:00:{seq:02}"),
        tx_type: "EXPENSE".into(),
        account_id: Some("acct".into()),
        to_account_id: None,
        parent_id: None,
        budget_id: None,
        expense_id: Some("exp".into()),
        trade: None,
        bitcoin: None,
        occurrence_date: None,
        note: None,
        purchase_group_id: None,
    }
}

async fn debt_state(conn: &mut SqliteConnection) -> (i64, i64) {
    sqlx::query_as::<_, (i64, i64)>(
        r#"SELECT "currentBalance","paidOff" FROM "Debt" WHERE "id"='debt'"#,
    )
    .fetch_one(&mut *conn)
    .await
    .unwrap()
}

#[tokio::test]
async fn a_payment_splits_into_principal_and_interest() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c, 1_000_000, 1_200).await; // $10,000 at 12%

    ledger_create(&mut c, &payment("t1", 50_000, 1))
        .await
        .unwrap();

    // One period of interest on $10,000 at 12% monthly = $100. Principal is the
    // remaining $400 of a $500 payment.
    let row = sqlx::query_as::<_, (i64, i64)>(
        r#"SELECT "principalAmount","interestAmount" FROM "DebtPayment" WHERE "transactionId"='t1'"#,
    ).fetch_one(&mut *c).await.unwrap();
    assert_eq!(row, (40_000, 10_000));

    let (balance, paid_off) = debt_state(&mut c).await;
    assert_eq!(
        balance, 960_000,
        "principal comes off the balance, interest does not"
    );
    assert_eq!(paid_off, 0);
}

/// The reversal must restore the balance exactly — the property ADR-028's
/// baseline rule depends on.
#[tokio::test]
async fn deleting_the_transaction_reverses_the_payment_exactly() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c, 1_000_000, 1_200).await;

    ledger_create(&mut c, &payment("t1", 50_000, 1))
        .await
        .unwrap();
    assert_eq!(debt_state(&mut c).await.0, 960_000);

    ledger_delete(&mut c, "t1").await.unwrap();

    assert_eq!(
        debt_state(&mut c).await.0,
        1_000_000,
        "balance restored exactly"
    );
    let remaining: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "DebtPayment""#)
        .fetch_one(&mut *c)
        .await
        .unwrap();
    assert_eq!(remaining, 0, "the payment row goes with it");
}

/// The ordering constraint, asserted directly: reading after the delete finds
/// nothing, which is why `ledger_delete` reads first.
#[tokio::test]
async fn the_payment_is_unfindable_once_the_transaction_is_gone() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c, 1_000_000, 1_200).await;
    ledger_create(&mut c, &payment("t1", 50_000, 1))
        .await
        .unwrap();

    assert!(debt_payment::read_for_reversal(&mut c, "t1")
        .await
        .unwrap()
        .is_some());

    // Delete the transaction directly, bypassing the gate — the FK nullifies
    // the link and the payment becomes unreachable by transaction id.
    sqlx::query(r#"DELETE FROM "Transaction" WHERE "id"='t1'"#)
        .execute(&mut *c)
        .await
        .unwrap();

    assert!(
        debt_payment::read_for_reversal(&mut c, "t1")
            .await
            .unwrap()
            .is_none(),
        "ON DELETE SET NULL orphans the payment — this is why the gate reads first"
    );
    let orphaned: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "DebtPayment""#)
        .fetch_one(&mut *c)
        .await
        .unwrap();
    assert_eq!(orphaned, 1, "and the row survives, still reducing the debt");
}

/// An overpayment clears the debt rather than driving it negative, which would
/// read as the lender owing money.
#[tokio::test]
async fn an_overpayment_settles_the_debt_and_floors_at_zero() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c, 20_000, 0).await; // $200 left, no interest

    ledger_create(&mut c, &payment("t1", 50_000, 1))
        .await
        .unwrap();

    let (balance, paid_off) = debt_state(&mut c).await;
    assert_eq!(balance, 0, "floored, not negative");
    assert_eq!(paid_off, 1, "and marked settled");
}

/// A transaction with no linked debt produces no side effect at all.
#[tokio::test]
async fn an_ordinary_expense_records_no_payment() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c, 1_000_000, 1_200).await;

    let mut p = payment("t1", 50_000, 1);
    p.expense_id = None;
    ledger_create(&mut c, &p).await.unwrap();

    let n: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "DebtPayment""#)
        .fetch_one(&mut *c)
        .await
        .unwrap();
    assert_eq!(n, 0);
    assert_eq!(
        debt_state(&mut c).await.0,
        1_000_000,
        "the debt is untouched"
    );
}

// ── System budget (priority 5) ───────────────────────────────────────────

use avoir_db::system_budget;

async fn system_budgets(conn: &mut SqliteConnection) {
    sqlx::query(
        r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt")
           VALUES ('sys','System','#111','2026-01-01T00:00:00')"#,
    )
    .execute(&mut *conn)
    .await
    .unwrap();
    for (id, name) in [
        ("b_inc", "Income"),
        ("b_trade", "Trade"),
        ("b_xfer", "Transfer"),
    ] {
        sqlx::query(
            r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
               VALUES (?, ?, 0,'2026-01-01T00:00:00','sys',1)"#,
        )
        .bind(id)
        .bind(name)
        .execute(&mut *conn)
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn system_budgets_are_assigned_by_type() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c, 1_000_000, 1_200).await;
    system_budgets(&mut c).await;

    for (ty, expected) in [
        ("INCOME", Some("b_inc")),
        ("TRADE", Some("b_trade")),
        ("TRANSFER", Some("b_xfer")),
        // An EXPENSE belongs to whatever budget the user chose — no override.
        ("EXPENSE", None),
        ("REFUND", None),
    ] {
        let got = system_budget::assign(&mut c, "t-none", ty).await.unwrap();
        assert_eq!(got.as_deref(), expected, "type {ty}");
    }
}

/// A user-created budget sharing a system name must not win. `isSystem DESC`
/// is what guarantees it, and a plain name lookup would not.
#[tokio::test]
async fn a_user_budget_named_income_does_not_beat_the_system_one() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c, 1_000_000, 1_200).await;
    system_budgets(&mut c).await;

    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
           VALUES ('b_user','Income',1,'2027-01-01T00:00:00','sys',0)"#, // newer, but not system
    )
    .execute(&mut *c)
    .await
    .unwrap();

    let got = system_budget::assign(&mut c, "t-none", "INCOME")
        .await
        .unwrap();
    assert_eq!(
        got.as_deref(),
        Some("b_inc"),
        "the system budget wins over a newer namesake"
    );
}

/// ADR-017: the budgets come from an idempotent seed, so they may legitimately
/// be absent. That must be tolerated, not an error.
#[tokio::test]
async fn a_missing_system_budget_is_tolerated() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c, 1_000_000, 1_200).await;
    // No system budgets seeded at all.
    let got = system_budget::assign(&mut c, "t-none", "INCOME")
        .await
        .unwrap();
    assert_eq!(got, None);
}

/// Through the gate: an explicit budget is respected, an absent one is filled.
#[tokio::test]
async fn the_gate_fills_a_missing_budget_but_respects_an_explicit_one() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c, 1_000_000, 1_200).await;
    system_budgets(&mut c).await;

    let mut auto = payment("t1", 10_000, 1);
    auto.tx_type = "INCOME".into();
    auto.expense_id = None;
    auto.budget_id = None;
    ledger_create(&mut c, &auto).await.unwrap();

    let mut explicit = payment("t2", 10_000, 2);
    explicit.tx_type = "INCOME".into();
    explicit.expense_id = None;
    explicit.budget_id = Some("bud".into());
    ledger_create(&mut c, &explicit).await.unwrap();

    let got: Vec<(String, Option<String>)> =
        sqlx::query_as(r#"SELECT "id","budgetId" FROM "Transaction" ORDER BY "id""#)
            .fetch_all(&mut *c)
            .await
            .unwrap();
    assert_eq!(got[0].1.as_deref(), Some("b_inc"), "filled from the type");
    assert_eq!(
        got[1].1.as_deref(),
        Some("bud"),
        "an explicit choice is not overridden"
    );
}
