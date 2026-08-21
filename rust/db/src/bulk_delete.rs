//! Bulk deletion of transactions — port of the reset half of
//! `apps/api/src/routes/data-management.ts` (ADR-028).
//!
//! **The hybrid, and why it is not just "call the gate for everything".** A
//! total wipe leaves every derived value at a baseline that is known without
//! replaying anything: no transactions means an account's balance IS its
//! opening balance, a holding is empty, a debt owes its original amount. So a
//! full wipe resets directly. Per-row reversal would be O(n) chain rebuilds to
//! reach a state one UPDATE can express.
//!
//! **A PARTIAL delete cannot use this** and must go through `ledger_delete`
//! row by row, because the surviving transactions still contribute and a
//! blanket reset would erase their effect. That is the whole reason ADR-028 is
//! a hybrid rather than one strategy.
//!
//! **The baseline is `openingBalance`, not zero.** ADR-028's text says zero;
//! the code has said `openingBalance` since that column was added, and the
//! comment there explains why — resetting to zero discards the Starting
//! Balance and breaks `openingBalance + SUM(transactions) == balance` the
//! moment the wipe finishes. The ADR is stale on this point; the invariant is
//! the authority.

use anyhow::Result;
use sqlx::SqliteConnection;

/// Return every transaction-derived value to its no-transactions baseline.
///
/// **Only valid after a FULL wipe.** Calling it while transactions survive
/// silently erases their contribution.
pub async fn reset_derived_state(conn: &mut SqliteConnection) -> Result<()> {
    // Accounts: the baseline is the pre-tracking opening balance.
    sqlx::query!(r#"UPDATE "Account" SET "balance" = "openingBalance""#)
        .execute(&mut *conn)
        .await?;

    // Holdings: no trades means no units and no cost basis.
    sqlx::query!(r#"UPDATE "InvestmentHolding" SET "quantity" = '0', "costBasis" = NULL"#)
        .execute(&mut *conn)
        .await?;

    // Debts: no recorded payments means the full original balance is owed.
    sqlx::query!(r#"DELETE FROM "DebtPayment""#)
        .execute(&mut *conn)
        .await?;
    sqlx::query!(r#"UPDATE "Debt" SET "currentBalance" = "originalBalance", "paidOff" = 0"#)
        .execute(&mut *conn)
        .await?;

    // Occurrences satisfied by a now-deleted transaction are outstanding again.
    // SKIPPED and SNOOZED are deliberate user actions unrelated to any
    // transaction and are left alone — that distinction is the point.
    sqlx::query!(
        r#"UPDATE "ScheduledTransaction"
           SET "status" = 'PENDING', "actualAmount" = NULL, "transactionId" = NULL
           WHERE "status" IN ('PAID', 'PARTIAL')"#
    )
    .execute(&mut *conn)
    .await?;

    Ok(())
}

/// Delete every transaction and reset the derived state.
///
/// Children go first: `Transaction.accountId` is `ON DELETE RESTRICT`, and a
/// self-referencing `parentId` means a blanket delete can hit a parent whose
/// child still points at it. Deleting children first avoids depending on
/// statement order inside one DELETE.
pub async fn wipe_all_transactions(conn: &mut SqliteConnection) -> Result<u64> {
    let children = sqlx::query!(r#"DELETE FROM "Transaction" WHERE "parentId" IS NOT NULL"#)
        .execute(&mut *conn)
        .await?
        .rows_affected();
    let parents = sqlx::query!(r#"DELETE FROM "Transaction""#)
        .execute(&mut *conn)
        .await?
        .rows_affected();

    reset_derived_state(conn).await?;
    Ok(children + parents)
}
