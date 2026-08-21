//! Deriving a budget's amount from the expenses linked to it.
//!
//! Port of `recomputeBudgetFromLinks` from
//! `apps/api/src/lib/budget-linking.ts`. This is the function the ported
//! routes were missing — it is called at nine sites in the TypeScript and was
//! recorded in BACKLOG.md as an open gap because it needed this module.
//!
//! # Three reasons to leave the budget alone
//!
//! It returns early when there are **no linked expenses** (nothing to derive
//! from), when there is **no version** (nothing to write to), and when the
//! latest version is a **manual override** — that last one is the important
//! one. Someone typed a number deliberately, and a derived recompute silently
//! replacing it is the feature actively working against its user.

use anyhow::{Context, Result};
use avoir_core::budget::{
    apply_high_water_mark, convert_monthly_to_frequency, expense_monthly_equivalent,
    BudgetFrequency, Frequency,
};
use avoir_core::money::Cents;
use sqlx::SqliteConnection;

/// One expense feeding a budget.
struct Linked {
    amount: Cents,
    frequency: Frequency,
    schedule: Option<String>,
    active: bool,
}

impl Linked {
    /// The amount for a specific month, honouring `amountSchedule`.
    ///
    /// The schedule is a JSON object keyed by month number; a month with no
    /// entry falls back to the base amount. Stored as decimal dollars (it is
    /// a TEXT column the importer does not scale), so it is converted here.
    fn amount_for(&self, month: u32) -> Cents {
        let Some(raw) = &self.schedule else {
            return self.amount;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
            return self.amount;
        };
        v.get(month.to_string())
            .and_then(|x| x.as_f64())
            .map(Cents::from_dollars_f64)
            .unwrap_or(self.amount)
    }
}

/// Recompute one budget's amount from its linked expenses.
///
/// `month` selects which `amountSchedule` entry applies.
pub async fn recompute_from_links(
    conn: &mut SqliteConnection,
    category_budget_id: &str,
    month: u32,
) -> Result<()> {
    let links = sqlx::query!(
        r#"SELECT e."amount" AS "amount!: i64", e."frequency" AS "frequency!",
                  e."amountSchedule" AS "schedule: String",
                  e."pausedUntil" AS "paused: String", e."archivedAt" AS "archived: String"
             FROM "BudgetExpenseLink" l
             JOIN "Expense" e ON e."id" = l."expenseId"
            WHERE l."categoryBudgetId" = ?"#,
        category_budget_id
    )
    .fetch_all(&mut *conn)
    .await?;

    // Nothing linked means nothing to derive from. Writing a zero here would
    // wipe a hand-entered budget the moment its last link was removed.
    if links.is_empty() {
        return Ok(());
    }

    let linked: Vec<Linked> = links
        .into_iter()
        .map(|r| Linked {
            amount: Cents(r.amount),
            frequency: Frequency::from_stored(&r.frequency).unwrap_or(Frequency::Monthly),
            schedule: r.schedule,
            // Paused and archived expenses contribute nothing: the money is
            // not going out, so the baseline should not reserve it.
            active: r.paused.is_none() && r.archived.is_none(),
        })
        .collect();

    let version = sqlx::query!(
        r#"SELECT "id" AS "id!", "frequency" AS "frequency!",
                  "monthlyEquivalent" AS "monthly!: i64",
                  "activeMonths" AS "active_months: String",
                  "manualOverride" AS "manual!: i64"
             FROM "BudgetVersion"
            WHERE "categoryBudgetId" = ?
            ORDER BY "effectiveDate" DESC LIMIT 1"#,
        category_budget_id
    )
    .fetch_optional(&mut *conn)
    .await?;

    let Some(version) = version else {
        return Ok(());
    };

    // Someone typed this number on purpose. Overwriting it from a derivation
    // is the feature working against its user.
    if version.manual != 0 {
        return Ok(());
    }

    let freq = BudgetFrequency::from_stored(&version.frequency)
        .with_context(|| format!("unknown budget frequency {}", version.frequency))?;
    let active_months: Option<usize> = version
        .active_months
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<u32>>(s).ok())
        .map(|v| v.len())
        .filter(|n| *n > 0);

    let derived = linked
        .iter()
        .filter(|l| l.active)
        .fold(Cents::ZERO, |acc, l| {
            acc + expense_monthly_equivalent(l.amount_for(month), l.frequency)
        });

    let stored_mark = sqlx::query!(
        r#"SELECT "highWaterMark" AS "hwm!: i64" FROM "CategoryBudget" WHERE "id" = ?"#,
        category_budget_id
    )
    .fetch_one(&mut *conn)
    .await?
    .hwm;

    // The budget's CURRENT amount is a floor alongside the stored mark, so
    // linking a small expense to a large hand-set budget cannot drag it down.
    let floor = apply_high_water_mark(Cents(stored_mark), Cents(version.monthly));
    let effective = apply_high_water_mark(derived, floor);

    // When every active expense already repeats on the budget's own frequency,
    // sum the native amounts directly. The round-trip through monthly is lossy
    // in both directions (see `budget.rs`), and this is the common case — a
    // monthly budget fed by monthly bills should show their exact total, not
    // that total plus or minus a few cents of conversion noise.
    let actives: Vec<&Linked> = linked.iter().filter(|l| l.active).collect();
    let all_same = !actives.is_empty() && actives.iter().all(|l| freq.matches(l.frequency));

    let native = if all_same {
        let native_sum = actives
            .iter()
            .fold(Cents::ZERO, |acc, l| acc + l.amount_for(month));
        apply_high_water_mark(
            native_sum,
            convert_monthly_to_frequency(Cents(stored_mark), freq, active_months),
        )
    } else {
        convert_monthly_to_frequency(effective, freq, active_months)
    };

    sqlx::query!(
        r#"UPDATE "CategoryBudget" SET "highWaterMark" = ?1 WHERE "id" = ?2"#,
        effective.0,
        category_budget_id
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        r#"UPDATE "BudgetVersion" SET "amount" = ?1, "monthlyEquivalent" = ?2 WHERE "id" = ?3"#,
        native.0,
        effective.0,
        version.id
    )
    .execute(&mut *conn)
    .await?;

    Ok(())
}

/// Recompute every budget an expense feeds.
///
/// The entry point the routes call after an expense changes — this is the
/// `triggerBudgetRecompute` the TypeScript invokes at nine sites.
pub async fn recompute_for_expense(
    conn: &mut SqliteConnection,
    expense_id: &str,
    month: u32,
) -> Result<()> {
    let ids = sqlx::query!(
        r#"SELECT "categoryBudgetId" AS "id!" FROM "BudgetExpenseLink" WHERE "expenseId" = ?"#,
        expense_id
    )
    .fetch_all(&mut *conn)
    .await?;
    for r in ids {
        recompute_from_links(conn, &r.id, month).await?;
    }
    Ok(())
}
