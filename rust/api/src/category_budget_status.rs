//! The three fields `GET /category-budgets` adds to each allocation.
//!
//! Ported from `apps/api/src/lib/category-budget-status.ts`, which step 4 missed
//! entirely. The route returned every budget in a well-formed array without
//! `actualSpending` or `status`, both required by `BudgetStatusResponseSchema` —
//! so Zod threw in the browser and the Budgets page rendered empty while the
//! endpoint answered 200 and every Rust test passed.
//!
//! # Spending is split-aware, and that is the whole subtlety
//!
//! A split purchase is one parent with N children. Counting both would double
//! it. The rule:
//!
//! - **Unsplit rows and children** count in full, against their own `budgetId`.
//! - **A split parent** counts only its *remainder* — `parent.amount −
//!   SUM(children.amount)` — against the parent's budget. That remainder is the
//!   portion the user kept on the original category rather than reassigning.
//!
//! Refunds subtract, so a returned purchase stops counting as spending.

use avoir_core::budget::{compute_budget_status, is_seasonal_active_in_month};
use avoir_core::money::Cents;
use avoir_core::prediction::{prorate_budget, BudgetPeriod};
use chrono::NaiveDate;
use serde_json::Value;
use sqlx::SqliteConnection;
use std::collections::HashMap;

use crate::ApiError;

/// The window and mode a status list is computed for.
pub(crate) struct Window {
    pub start: String,
    /// Exclusive upper bound, matching the TypeScript's `lt`.
    pub end_exclusive: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
}

/// Net spending per budget for the window.
pub(crate) async fn spending_by_budget(
    conn: &mut SqliteConnection,
    w: &Window,
) -> Result<HashMap<String, Cents>, ApiError> {
    let mut out: HashMap<String, Cents> = HashMap::new();

    // Rows with no children of their own: unsplit purchases and the children
    // themselves. Both count in full.
    let rows = sqlx::query!(
        r#"SELECT t."budgetId" AS "budget_id!", t."type" AS "ty!",
                  SUM(t."amount") AS "total!: i64"
             FROM "Transaction" t
            WHERE t."budgetId" IS NOT NULL
              AND t."type" IN ('EXPENSE', 'REFUND')
              AND t."date" >= ?1 AND t."date" < ?2
              AND NOT EXISTS (SELECT 1 FROM "Transaction" c WHERE c."parentId" = t."id")
            GROUP BY t."budgetId", t."type""#,
        w.start,
        w.end_exclusive
    )
    .fetch_all(&mut *conn)
    .await?;

    for r in rows {
        let slot = out.entry(r.budget_id).or_insert(Cents(0));
        if r.ty == "REFUND" {
            *slot -= Cents(r.total);
        } else {
            *slot += Cents(r.total);
        }
    }

    // Split parents contribute only what was not reassigned to a child.
    let parents = sqlx::query!(
        r#"SELECT t."budgetId" AS "budget_id!", t."amount" AS "amount!: i64",
                  COALESCE((SELECT SUM(c."amount") FROM "Transaction" c
                             WHERE c."parentId" = t."id"), 0) AS "children!: i64"
             FROM "Transaction" t
            WHERE t."budgetId" IS NOT NULL AND t."type" = 'EXPENSE'
              AND t."date" >= ?1 AND t."date" < ?2
              AND EXISTS (SELECT 1 FROM "Transaction" c WHERE c."parentId" = t."id")"#,
        w.start,
        w.end_exclusive
    )
    .fetch_all(&mut *conn)
    .await?;

    for p in parents {
        let remainder = p.amount - p.children;
        // Only a positive remainder counts. A parent whose children exceed it is
        // over-allocated — adding a negative here would credit the category with
        // spending that never happened.
        if remainder > 0 {
            *out.entry(p.budget_id).or_insert(Cents(0)) += Cents(remainder);
        }
    }

    Ok(out)
}

/// Recurring expense totals per budget, from the period's occurrences.
pub(crate) async fn recurring_by_budget(
    conn: &mut SqliteConnection,
    w: &Window,
) -> Result<HashMap<String, Cents>, ApiError> {
    let rows = sqlx::query!(
        r#"SELECT e."budgetId" AS "budget_id!",
                  SUM(s."expectedAmount") AS "total!: i64"
             FROM "ScheduledTransaction" s
             JOIN "Expense" e ON e."id" = s."expenseId"
            WHERE s."sourceType" = 'EXPENSE'
              AND s."dueDate" >= ?1 AND s."dueDate" <= ?2
            GROUP BY e."budgetId""#,
        w.start,
        w.end_exclusive
    )
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| (r.budget_id, Cents(r.total)))
        .collect())
}

/// What one budget is expected to absorb this pay period.
///
/// Only meaningful in period mode; a monthly view compares against the monthly
/// equivalent directly.
///
/// - **With linked recurring expenses**, the floor is the prorated allocation
///   but the bills win when they exceed it: a period holding a £900 rent payment
///   against a £400 prorated share is expected to spend £900, not £400.
/// - **Without them** the budget is discretionary, and the prorated share is the
///   whole story.
pub(crate) fn effective_expected(
    monthly_equivalent: Cents,
    active_months: &[u32],
    has_linked_expenses: bool,
    recurring_total: Cents,
    schedule_type: &str,
    w: &Window,
) -> Cents {
    let prorated = prorate_budget(
        monthly_equivalent,
        BudgetPeriod::Monthly,
        if active_months.is_empty() {
            None
        } else {
            Some(active_months)
        },
        schedule_type,
        w.start_date,
        w.end_date,
    );
    if has_linked_expenses && recurring_total.0 > prorated.0 {
        recurring_total
    } else {
        prorated
    }
}

/// Attach `actualSpending`, `effectiveExpected` and `status` to one serialized
/// allocation, and zero it out when it should not count this month.
///
/// A budget that is done for the year, or seasonal and out of season, compares
/// against **zero** — and its `monthlyEquivalent` is zeroed in the response too,
/// so the page's totals do not include an allocation nobody can spend.
#[allow(clippy::too_many_arguments)]
pub(crate) fn decorate(
    mut serialized: Value,
    actual: Cents,
    monthly_equivalent: Cents,
    active_months: &[u32],
    month: u32,
    done_for_year: bool,
    period_mode: bool,
    expected: Option<Cents>,
    has_version: bool,
    // The ANNUAL view compares a YEAR of spending, so it must compare against a
    // YEAR of budget. Without this the status badge measured months of spending
    // against one month's allocation and read "over" on nearly everything, while
    // the card beside it drew its progress bar against x12 — two numbers on one
    // card disagreeing about what period they described.
    annual: bool,
) -> Value {
    /*
     * Seasonal zeroing is a statement about THIS MONTH, so it has no business in
     * the annual view.
     *
     * A summer-only budget is genuinely zero in December — looking at December,
     * there is nothing to spend. Looking at the YEAR, it had a real allocation
     * and real spending, and reporting it as zero drops it out of the annual
     * totals entirely. The same applies to `doneForYear`: finished is not the
     * same as never budgeted, and the year is exactly the period over which it
     * WAS budgeted.
     */
    let inactive_seasonal =
        !active_months.is_empty() && !is_seasonal_active_in_month(active_months, month);
    let zeroed = !annual && (inactive_seasonal || done_for_year);

    let compare = if zeroed {
        Cents(0)
    } else if period_mode {
        expected.unwrap_or(monthly_equivalent)
    } else if annual {
        /*
         * A YEAR of budget. For an ordinary budget that is x12, matching
         * `convertToFrequency(monthly, 'ANNUAL')` in the web app — the frontend
         * draws the bar and the backend judges the status, and a card showing
         * both is one card.
         *
         * For a SEASONAL budget it is x(active months): a budget that only runs
         * three months of the year has three months of annual allowance, and
         * judging it against twelve would call every seasonal budget wildly
         * under-spent.
         */
        let months = if active_months.is_empty() {
            12
        } else {
            active_months.len() as i64
        };
        Cents(monthly_equivalent.0 * months)
    } else {
        monthly_equivalent
    };

    // No version means no allocation was ever set, which is not the same as an
    // allocation of zero — the first has no status, the second is `None` from
    // `compute_budget_status` anyway.
    let status = if has_version {
        compute_budget_status(actual, compare)
    } else {
        None
    };

    if zeroed {
        if let Some(v) = serialized.get_mut("version") {
            if let Some(obj) = v.as_object_mut() {
                obj.insert("monthlyEquivalent".into(), serde_json::json!(0.0));
            }
        }
    }

    let obj = serialized
        .as_object_mut()
        .expect("a serialized budget is an object");
    obj.insert(
        "actualSpending".into(),
        serde_json::json!(actual.as_dollars_f64()),
    );
    obj.insert(
        "status".into(),
        match status {
            Some(s) => serde_json::json!(s),
            None => Value::Null,
        },
    );
    if period_mode {
        let e = if zeroed {
            Cents(0)
        } else {
            expected.unwrap_or(Cents(0))
        };
        obj.insert(
            "effectiveExpected".into(),
            serde_json::json!(e.as_dollars_f64()),
        );
    }
    serialized
}
