//! System budget auto-assignment — port of
//! `apps/api/src/lib/lifecycle/hooks/system-budget.hook.ts` (priority 5).
//!
//! INCOME, TRADE and TRANSFER rows are assigned their system budget so they do
//! not land in Uncategorized and distort spending reports. Only those three:
//! an EXPENSE or REFUND belongs to whatever budget the user chose.
//!
//! **The budgets are created by an idempotent seed, not a migration**
//! (ADR-017). A migration is one-shot and cannot recover from an accidental
//! delete; the seed re-creates them on the next boot. That is why this hook
//! queries by NAME and tolerates finding nothing rather than assuming a fixed
//! id — the row may legitimately not exist yet.

use anyhow::Result;
use sqlx::SqliteConnection;

/// Which transaction types get a system budget, and which one.
///
/// `TRANSFER`'s presence is what keeps transfers out of budget rollups, the
/// same exclusion ADR-030 relies on for payment legs.
fn system_budget_name(tx_type: &str) -> Option<&'static str> {
    match tx_type {
        "INCOME" => Some("Income"),
        "TRADE" => Some("Trade"),
        "TRANSFER" => Some("Transfer"),
        _ => None,
    }
}

/// Assign the system budget for a row's type, if it has one.
///
/// Returns the budget id assigned, or `None` when the type has no system
/// budget or the budget row does not exist.
///
/// Queried fresh every time, preferring `isSystem` and then the newest — the
/// TypeScript's ordering, which matters because a user can create an ordinary
/// budget that happens to be called "Income" and the system one must still win.
pub async fn assign(
    conn: &mut SqliteConnection,
    tx_id: &str,
    tx_type: &str,
) -> Result<Option<String>> {
    let Some(name) = system_budget_name(tx_type) else {
        return Ok(None);
    };

    let budget = sqlx::query!(
        r#"SELECT "id" AS "id!: String" FROM "Budget"
           WHERE "name" = ?
           ORDER BY "isSystem" DESC, "createdAt" DESC
           LIMIT 1"#,
        name
    )
    .fetch_optional(&mut *conn)
    .await?;

    let Some(b) = budget else { return Ok(None) };

    sqlx::query!(
        r#"UPDATE "Transaction" SET "budgetId" = ? WHERE "id" = ?"#,
        b.id,
        tx_id
    )
    .execute(&mut *conn)
    .await?;

    Ok(Some(b.id))
}
