//! Debt-payment side effects — port of
//! `apps/api/src/lib/lifecycle/hooks/debt-payment.hook.ts` (priority 20).
//!
//! When a transaction is linked to a recurring expense that funds a debt, the
//! payment is split into principal and interest, recorded as a `DebtPayment`,
//! and the debt's balance reduced by the principal.
//!
//! **The delete path has an ordering constraint that is easy to get wrong.**
//! `DebtPayment.transactionId` is `ON DELETE SET NULL`, so once the transaction
//! row is gone the link is gone with it and the payment can no longer be found
//! by transaction. The payment must be read BEFORE the delete. The TypeScript
//! handles this by having the route pre-fetch and pass it through the hook
//! context; here `ledger_delete` reads it first, which keeps the constraint
//! inside the gate rather than relying on every caller to remember.

use anyhow::Result;
use avoir_core::debt::{split_payment, Frequency};
use avoir_core::money::{Cents, Percent};
use sqlx::SqliteConnection;

/// What was reversed, for the caller to assert on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReversedPayment {
    pub debt_id: String,
    pub principal: Cents,
}

/// Record a debt payment for a newly created transaction, if it funds a debt.
///
/// Returns the payment id when one was written. No linked, unpaid debt means
/// no side effect — an ordinary expense that happens to carry an `expenseId`.
pub async fn on_created(
    conn: &mut SqliteConnection,
    tx_id: &str,
    expense_id: &str,
    amount: Cents,
    date: &str,
) -> Result<Option<String>> {
    let debt = sqlx::query!(
        r#"SELECT "id" AS "id!: String", "currentBalance" AS "balance!: i64",
                  "apr" AS "apr!: i64"
           FROM "Debt" WHERE "linkedExpenseId" = ? AND "paidOff" = 0 LIMIT 1"#,
        expense_id
    )
    .fetch_optional(&mut *conn)
    .await?;

    let Some(debt) = debt else { return Ok(None) };

    // The same split the schedule and the debts page use — one definition, so
    // the recorded payment and the displayed schedule cannot disagree.
    let split = split_payment(
        Cents(debt.balance),
        Percent(debt.apr),
        amount,
        Some(Frequency::Monthly),
    );

    // Floored at zero: an overpayment clears the debt rather than driving it
    // negative, which would then read as the lender owing money.
    let new_balance = Cents((debt.balance - split.principal.0).max(0));
    let paid_off = if new_balance.0 <= 0 { 1 } else { 0 };

    let payment_id = format!("dp_{tx_id}");
    sqlx::query!(
        r#"INSERT INTO "DebtPayment"
             ("id","debtId","transactionId","principalAmount","interestAmount","date","createdAt")
           VALUES (?, ?, ?, ?, ?, ?, ?)"#,
        payment_id,
        debt.id,
        tx_id,
        split.principal.0,
        split.interest.0,
        date,
        date,
    )
    .execute(&mut *conn)
    .await?;

    sqlx::query!(
        r#"UPDATE "Debt" SET "currentBalance" = ?, "paidOff" = ? WHERE "id" = ?"#,
        new_balance.0,
        paid_off,
        debt.id
    )
    .execute(&mut *conn)
    .await?;

    Ok(Some(payment_id))
}

/// Read the debt payment attached to a transaction, BEFORE it is deleted.
///
/// Separate from the reversal precisely because of the ordering constraint —
/// calling this after the delete returns nothing, silently, and the debt keeps
/// a balance reduction whose transaction no longer exists.
pub async fn read_for_reversal(
    conn: &mut SqliteConnection,
    tx_id: &str,
) -> Result<Option<(String, String, Cents)>> {
    let row = sqlx::query!(
        r#"SELECT "id" AS "id!: String", "debtId" AS "debt_id!: String",
                  "principalAmount" AS "principal!: i64"
           FROM "DebtPayment" WHERE "transactionId" = ? LIMIT 1"#,
        tx_id
    )
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row.map(|r| (r.id, r.debt_id, Cents(r.principal))))
}

/// Reverse a recorded payment: return the principal to the debt, clear
/// `paidOff`, and remove the payment row.
///
/// `paidOff` is cleared unconditionally rather than recomputed. Reversing a
/// payment necessarily means the debt is not settled by it, and recomputing
/// from the restored balance would re-derive the same answer with more ways to
/// be wrong.
pub async fn reverse(
    conn: &mut SqliteConnection,
    payment: (String, String, Cents),
) -> Result<ReversedPayment> {
    let (payment_id, debt_id, principal) = payment;

    sqlx::query!(
        r#"UPDATE "Debt" SET "currentBalance" = "currentBalance" + ?, "paidOff" = 0
           WHERE "id" = ?"#,
        principal.0,
        debt_id
    )
    .execute(&mut *conn)
    .await?;

    sqlx::query!(r#"DELETE FROM "DebtPayment" WHERE "id" = ?"#, payment_id)
        .execute(&mut *conn)
        .await?;

    Ok(ReversedPayment { debt_id, principal })
}
