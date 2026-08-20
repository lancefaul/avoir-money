//! `/data-management` — counts, and the bulk delete behind them.
//!
//! Ported from `routes/data-management.ts`. The reversal machinery is
//! `avoir_db::bulk_delete`, whose module note carries ADR-028's reasoning.
//!
//! # Two strategies, chosen by whether the category is a total wipe
//!
//! Of the twelve categories, exactly one — `imported-transactions` — is a
//! *filtered* delete. Every other is a total wipe whose end state is trivially
//! known, so it bulk-deletes and then resets every derived value to its
//! baseline: `Account.balance` to **`openingBalance`** (not zero — that is
//! ADR-028's correction, and resetting to zero breaks the ledger invariant the
//! instant the wipe finishes), rewards to zero, holdings emptied, debts back to
//! their original balance, PAID schedule rows back to PENDING.
//!
//! The lone partial goes row by row through `ledger_delete`, so each row's side
//! effects are reversed exactly and the transactions that survive are never
//! blanket-reset.

use crate::{ApiError, Response};
use avoir_db::bulk_delete::wipe_all_transactions;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

/// How many rows each bulk-delete category would remove.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CountsShape {
    all_transactions: i64,
    imported_transactions: i64,
    recurring_expenses: i64,
    recurring_income: i64,
    accounts: i64,
    budgets: i64,
    debts: i64,
    utilities: i64,
    healthcare_policies: i64,
    investments: i64,
    scheduled_transactions: i64,
    pay_schedules: i64,
}

/// How many rows a bulk delete removed.
#[derive(Serialize)]
struct DeletedShape {
    deleted: i64,
}

pub async fn counts(pool: &SqlitePool) -> Result<Response, ApiError> {
    // One query per figure rather than a dozen concurrent ones: the pool holds
    // a single connection, so the TypeScript's `Promise.all` serialised anyway.
    macro_rules! count {
        ($sql:literal) => {
            sqlx::query_scalar!($sql).fetch_one(pool).await?
        };
    }

    let all_transactions = count!(r#"SELECT count(*) FROM "Transaction""#);
    let imported_transactions =
        count!(r#"SELECT count(*) FROM "Transaction" WHERE "imported" = 1"#);
    let recurring_expenses = count!(r#"SELECT count(*) FROM "Expense""#);
    let recurring_income = count!(r#"SELECT count(*) FROM "Income""#);
    let accounts = count!(r#"SELECT count(*) FROM "Account""#);
    // System budgets are excluded: they are created by the seed and cannot be
    // deleted, so offering them in a count of what a wipe would remove would
    // overstate it.
    let budgets = count!(
        r#"SELECT count(*) FROM "CategoryBudget" cb
             JOIN "Budget" b ON b."id" = cb."budgetId" WHERE b."isSystem" = 0"#
    );
    let debts = count!(r#"SELECT count(*) FROM "Debt""#);
    let utilities = count!(r#"SELECT count(*) FROM "UtilityProvider""#);
    let healthcare_policies = count!(r#"SELECT count(*) FROM "InsurancePolicy""#);
    let investments = count!(r#"SELECT count(*) FROM "InvestmentHolding""#);
    let scheduled_transactions = count!(r#"SELECT count(*) FROM "ScheduledTransaction""#);
    let pay_schedules = count!(r#"SELECT count(*) FROM "PaySchedule""#);

    Ok(Response::ok(CountsShape {
        all_transactions,
        imported_transactions,
        recurring_expenses,
        recurring_income,
        accounts,
        budgets,
        debts,
        utilities,
        healthcare_policies,
        investments,
        scheduled_transactions,
        pay_schedules,
    }))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct BulkBody {
    categories: Vec<String>,
}

/// Everything the bulk delete knows how to remove.
///
/// An unknown category is **refused**, not skipped. The TypeScript's `default:`
/// arm fell through silently, so a typo in a category name reported "deleted 0"
/// and looked like the data was already gone.
const CATEGORIES: [&str; 12] = [
    "all-transactions",
    "imported-transactions",
    "recurring-expenses",
    "recurring-income",
    "accounts",
    "budgets",
    "debts",
    "utilities",
    "healthcare-policies",
    "investments",
    "scheduled-transactions",
    "pay-schedules",
];

pub async fn bulk_delete(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: BulkBody = crate::body_of(body)?;
    if b.categories.is_empty() {
        return Err(ApiError::bad_request("at least one category is required"));
    }
    for c in &b.categories {
        if !CATEGORIES.contains(&c.as_str()) {
            return Err(ApiError::bad_request(format!("Unknown category: {c}")));
        }
    }

    let mut deleted: i64 = 0;
    let mut tx = pool.begin().await?;

    for category in &b.categories {
        deleted += match category.as_str() {
            "all-transactions" => wipe_all_transactions(&mut tx)
                .await
                .map_err(ApiError::from)? as i64,

            "imported-transactions" => {
                // The one filtered delete. Top-level rows only — children
                // cascade with their parents, and deleting a child directly
                // would leave the parent's split short.
                let ids = sqlx::query_scalar!(
                    r#"SELECT "id" AS "id!" FROM "Transaction"
                        WHERE "imported" = 1 AND "parentId" IS NULL"#
                )
                .fetch_all(&mut *tx)
                .await?;
                for id in &ids {
                    avoir_db::ledger::ledger_delete(&mut tx, id)
                        .await
                        .map_err(ApiError::from)?;
                }
                ids.len() as i64
            }

            "recurring-expenses" => sqlx::query!(r#"DELETE FROM "Expense""#)
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64,
            "recurring-income" => sqlx::query!(r#"DELETE FROM "Income""#)
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64,

            "accounts" => {
                // `Transaction.accountId` is ON DELETE RESTRICT, not Cascade —
                // the comment in the schema said otherwise and this category
                // crashed with a P2003 whenever an account had transactions.
                // So the transactions go first, which makes this a full wipe
                // and means the derived state must be reset too.
                wipe_all_transactions(&mut tx)
                    .await
                    .map_err(ApiError::from)?;
                sqlx::query!(r#"DELETE FROM "Account""#)
                    .execute(&mut *tx)
                    .await?
                    .rows_affected() as i64
            }

            "budgets" => {
                // Allocations, not the budgets themselves: a system budget must
                // survive, and a non-system one may still be referenced by
                // transactions in a year that is not being wiped.
                sqlx::query!(
                    r#"DELETE FROM "CategoryBudget" WHERE "budgetId" IN
                         (SELECT "id" FROM "Budget" WHERE "isSystem" = 0)"#
                )
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64
            }

            // Escrow records cascade from Debt.
            "debts" => sqlx::query!(r#"DELETE FROM "Debt""#)
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64,
            // Readings cascade from services, services from providers.
            "utilities" => sqlx::query!(r#"DELETE FROM "UtilityProvider""#)
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64,
            "healthcare-policies" => sqlx::query!(r#"DELETE FROM "InsurancePolicy""#)
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64,

            "investments" => {
                // Snapshots and transfers cascade from holdings; custodians and
                // wallets are only reachable once no holding references them.
                let h = sqlx::query!(r#"DELETE FROM "InvestmentHolding""#)
                    .execute(&mut *tx)
                    .await?
                    .rows_affected();
                let c = sqlx::query!(r#"DELETE FROM "Custodian""#)
                    .execute(&mut *tx)
                    .await?
                    .rows_affected();
                let w = sqlx::query!(r#"DELETE FROM "Wallet""#)
                    .execute(&mut *tx)
                    .await?
                    .rows_affected();
                (h + c + w) as i64
            }

            "scheduled-transactions" => sqlx::query!(r#"DELETE FROM "ScheduledTransaction""#)
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64,
            // Pay periods cascade from PaySchedule.
            "pay-schedules" => sqlx::query!(r#"DELETE FROM "PaySchedule""#)
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64,

            _ => unreachable!("categories were validated above"),
        };
    }

    // No reset call here on purpose. `wipe_all_transactions` performs it, and
    // both categories that need one go through it — so an extra call would be
    // dead code, which mutation testing duly proved by deleting it and changing
    // nothing.
    tx.commit().await?;
    Ok(Response::ok(DeletedShape { deleted }))
}
