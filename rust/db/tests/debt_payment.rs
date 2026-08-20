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

/// Through the gate: an absent budget is filled, and an explicit one is
/// respected ONLY on a type that has no system budget.
///
/// Rewritten 2026-08-20. It used to assert that an INCOME row kept a
/// caller-supplied budget, which was the rule at the time and was defending a
/// capability nothing uses: the transaction form already forces the Income
/// budget for income, and an income row sitting in a spending budget is the
/// exact distortion this hook exists to prevent. The "explicit wins" half now
/// uses an EXPENSE, which is where that rule still holds and always did.
#[tokio::test]
async fn the_gate_fills_a_missing_budget_and_respects_a_choice_where_one_is_meaningful() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c, 1_000_000, 1_200).await;
    system_budgets(&mut c).await;

    let mut auto = payment("t1", 10_000, 1);
    auto.tx_type = "INCOME".into();
    auto.expense_id = None;
    auto.budget_id = None;
    ledger_create(&mut c, &auto).await.unwrap();

    // An EXPENSE: the user's choice is the only signal there is, so it stands.
    let mut explicit = payment("t2", 10_000, 2);
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

/// A caller-supplied budget must NOT survive on a type whose budget is decided
/// by its type.
///
/// This is the bug three live rows carried (2026-08-16/18/20): the transaction
/// form sends `budgetId: values.budgetId || uncategorizedId` for every type and
/// overrides it for INCOME alone, so TRANSFER and TRADE arrived pre-filled with
/// Uncategorized. The hook's old rule — "an explicit budget wins, this only
/// fills a gap" — then declined, correctly by its own terms and wrongly for the
/// ledger.
///
/// What made it survive is that 80 other transfers, created through paths that
/// sent nothing, were fine. A guarantee that holds only when every caller
/// remembers is not a guarantee, which is why the type now decides.
#[tokio::test]
async fn a_supplied_budget_cannot_override_a_type_that_has_a_system_budget() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c, 1_000_000, 1_200).await;
    system_budgets(&mut c).await;

    // The budget the frontend was wrongly pre-filling.
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
           VALUES ('b_uncat','Uncategorized',0,'2026-01-01T00:00:00','sys',1)"#,
    )
    .execute(&mut *c)
    .await
    .unwrap();

    for (ty, wrong, expected) in [
        ("TRANSFER", "b_uncat", "b_xfer"),
        // The third bad row was a TRANSFER sitting under Income, so the
        // override has to beat another SYSTEM budget, not just Uncategorized.
        ("TRADE", "b_inc", "b_trade"),
        ("INCOME", "b_uncat", "b_inc"),
    ] {
        let id = format!("t_{ty}");
        let mut row = payment(&id, 1_000, 9);
        row.tx_type = ty.into();
        row.expense_id = None;
        row.budget_id = Some(wrong.into()); // what the caller sent
        if ty == "TRANSFER" {
            row.to_account_id = Some("acct".into());
        }
        ledger_create(&mut c, &row).await.unwrap();

        let got: Option<String> =
            sqlx::query_scalar(r#"SELECT "budgetId" FROM "Transaction" WHERE "id" = ?"#)
                .bind(&id)
                .fetch_one(&mut *c)
                .await
                .unwrap();
        assert_eq!(
            got.as_deref(),
            Some(expected),
            "{ty} kept the caller's budget"
        );
    }
}

/// The other half: a type with NO system budget still honours the caller.
///
/// Without this, "the type decides" could be satisfied by a hook that
/// overwrote every budget in the ledger, which would silently discard the one
/// case where the user's choice is the only signal there is.
#[tokio::test]
async fn an_expense_keeps_the_budget_the_user_chose() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    setup(&mut c, 1_000_000, 1_200).await;
    system_budgets(&mut c).await;
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
           VALUES ('b_food','Groceries',0,'2026-01-01T00:00:00','sys',0)"#,
    )
    .execute(&mut *c)
    .await
    .unwrap();

    let mut row = payment("t_exp", 1_000, 9);
    row.expense_id = None;
    row.budget_id = Some("b_food".into());
    ledger_create(&mut c, &row).await.unwrap();

    let got: Option<String> =
        sqlx::query_scalar(r#"SELECT "budgetId" FROM "Transaction" WHERE "id" = 't_exp'"#)
            .fetch_one(&mut *c)
            .await
            .unwrap();
    assert_eq!(got.as_deref(), Some("b_food"));
}
