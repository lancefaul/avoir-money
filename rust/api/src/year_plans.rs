//! `/year-plans` — the annual budget, and carrying one year's shape into the
//! next.
//!
//! Ported from `routes/year-plans.ts`.
//!
//! # DRAFT → ACTIVE → ARCHIVED, and only the first is editable
//!
//! A plan is drafted before its year begins, confirmed once it starts, and
//! archived when it ends. Confirming is refused before January 1 of the plan's
//! year — the plan describes a year that has not happened yet, and making it
//! ACTIVE early would have `resolveEffectiveVersion` reading next year's
//! budgets for this month's spending.
//!
//! # Carry-forward copies the shape, not the history
//!
//! It takes each budget's **latest** version from the source year and writes it
//! as the target year's January 1 version. Not every version — the older ones
//! describe changes made during a year that is over, and replaying them into a
//! new year would recreate a history that did not happen.

use crate::id::{cuid, now_iso};
use crate::{ApiError, Response};
use avoir_core::budget::{budget_monthly_equivalent, BudgetFrequency};
use avoir_core::money::Cents;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

async fn read(pool: &SqlitePool, id: &str) -> Result<YearPlanShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "year" AS "year!: i64", "status" AS "status!",
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "YearPlan" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Year plan"))?;
    Ok(YearPlanShape {
        id: r.id,
        year: r.year,
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

/// A year plan. Two sites built this shape from separate `json!` literals.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct YearPlanShape {
    id: String,
    year: i64,
    status: String,
    created_at: String,
    updated_at: String,
}

pub async fn list(pool: &SqlitePool) -> Result<Response, ApiError> {
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "year" AS "year!: i64", "status" AS "status!",
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "YearPlan" ORDER BY "year" DESC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(Response::ok(
        rows.into_iter()
            .map(|r| YearPlanShape {
                id: r.id,
                year: r.year,
                status: r.status,
                created_at: r.created_at,
                updated_at: r.updated_at,
            })
            .collect::<Vec<_>>(),
    ))
}

pub async fn get(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    Ok(Response::ok(read(pool, id).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct CreateBody {
    year: i64,
}

pub async fn create(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    // "A plan for year 0 is a missing field, not a year" — the comment that used
    // to sit here was right, and the code inferred the omission from the value
    // instead of asking. So an omitted `year` reported "year must be a
    // four-digit year", which is a true sentence that does not say what to do,
    // at the top level where a form cannot mark the input.
    crate::require_present(&body, &["year"])?;
    let b: CreateBody = crate::body_of(body)?;
    if !(1900..=2200).contains(&b.year) {
        return Err(ApiError::invalid_field(
            "year",
            "year must be a four-digit year",
        ));
    }

    let taken = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "YearPlan" WHERE "year" = ?"#,
        b.year
    )
    .fetch_one(pool)
    .await?;
    if taken > 0 {
        return Err(ApiError::conflict(format!(
            "Year plan already exists for {}",
            b.year
        )));
    }

    let id = cuid();
    let now = now_iso();
    sqlx::query!(
        r#"INSERT INTO "YearPlan" ("id","year","status","createdAt","updatedAt")
           VALUES (?,?, 'DRAFT', ?, ?)"#,
        id,
        b.year,
        now,
        now
    )
    .execute(pool)
    .await?;

    // A first plan with no groups has nowhere to put a budget, and the budget
    // screen would open empty with no way forward. One default group is the
    // smallest thing that makes it usable.
    let groups = sqlx::query_scalar!(r#"SELECT count(*) FROM "BudgetGroup""#)
        .fetch_one(pool)
        .await?;
    if groups == 0 {
        let gid = cuid();
        sqlx::query!(
            r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt")
               VALUES (?, 'Mandatory', 'neutral100', ?)"#,
            gid,
            now
        )
        .execute(pool)
        .await?;
    }

    Ok(Response::created(read(pool, &id).await?))
}

/// Move a DRAFT plan to ACTIVE.
pub async fn confirm(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let plan = read(pool, id).await?;
    if plan.status != "DRAFT" {
        return Err(ApiError::bad_request("Only DRAFT plans can be confirmed"));
    }
    let year = plan.year;

    // Refused before the year begins. An ACTIVE plan is what
    // `resolveEffectiveVersion` reads for the current month, so confirming
    // early would budget this month's spending against next year's figures.
    let today = avoir_core::dates::today();
    if (chrono::Datelike::year(&today) as i64) < year {
        return Err(ApiError::bad_request(format!(
            "Cannot confirm plan before January 1 of {year}"
        )));
    }

    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "YearPlan" SET "status" = 'ACTIVE', "updatedAt" = ? WHERE "id" = ?"#,
        now,
        id
    )
    .execute(pool)
    .await?;
    Ok(Response::ok(read(pool, id).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct CarryForwardBody {
    #[serde(rename = "sourceYear")]
    source_year: i64,
}

/// Copy a previous year's budgets into this DRAFT plan.
pub async fn carry_forward(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: CarryForwardBody = crate::body_of(body)?;
    let target = read(pool, id).await?;
    match target.status.as_str() {
        "ARCHIVED" => return Err(ApiError::bad_request("Cannot modify an archived year plan")),
        "DRAFT" => {}
        _ => {
            return Err(ApiError::bad_request(
                "Only DRAFT plans can receive carry-forward",
            ))
        }
    }
    let target_year = target.year;

    let source = sqlx::query_scalar!(
        r#"SELECT "id" FROM "YearPlan" WHERE "year" = ?"#,
        b.source_year
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Source year plan"))?;

    // Only live allocations, and only where the budget still exists. A budget
    // deleted since is not carried into a year it cannot be spent in.
    let rows = sqlx::query!(
        r#"SELECT cb."budgetId" AS "budget_id!"
             FROM "CategoryBudget" cb
             JOIN "Budget" b ON b."id" = cb."budgetId"
            WHERE cb."yearPlanId" = ? AND cb."removedAt" IS NULL"#,
        source
    )
    .fetch_all(pool)
    .await?;

    let effective = format!("{target_year}-01-01T00:00:00.000Z");
    let now = now_iso();
    let mut tx = pool.begin().await?;

    for r in rows {
        // The LATEST version only. The older ones describe changes made during
        // a year that is over; replaying them would recreate a history that
        // did not happen.
        let latest = sqlx::query!(
            r#"SELECT "amount" AS "amount!: i64", "frequency" AS "frequency!",
                      "activeMonths" AS "active_months: String"
                 FROM "BudgetVersion"
                 JOIN "CategoryBudget" cb ON cb."id" = "BudgetVersion"."categoryBudgetId"
                WHERE cb."yearPlanId" = ?1 AND cb."budgetId" = ?2
                ORDER BY "effectiveDate" DESC LIMIT 1"#,
            source,
            r.budget_id
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(latest) = latest else { continue };

        // Already carried, or added by hand. Skipped rather than duplicated —
        // `(yearPlanId, budgetId)` is unique, and re-running a carry-forward
        // is something a user will do.
        let exists = sqlx::query_scalar!(
            r#"SELECT count(*) FROM "CategoryBudget"
                WHERE "yearPlanId" = ?1 AND "budgetId" = ?2"#,
            id,
            r.budget_id
        )
        .fetch_one(&mut *tx)
        .await?;
        if exists > 0 {
            continue;
        }

        let freq =
            BudgetFrequency::from_stored(&latest.frequency).unwrap_or(BudgetFrequency::Monthly);
        let active: Option<usize> = latest
            .active_months
            .as_deref()
            .and_then(|s| serde_json::from_str::<Vec<u32>>(s).ok())
            .map(|v| v.len())
            .filter(|n| *n > 0);
        let monthly = budget_monthly_equivalent(Cents(latest.amount), freq, active);

        let cb_id = cuid();
        let months = latest.active_months.clone().unwrap_or_else(|| "[]".into());
        sqlx::query!(
            r#"INSERT INTO "CategoryBudget"
                 ("id","yearPlanId","budgetId","highWaterMark","doneForYear",
                  "createdAt","updatedAt")
               VALUES (?,?,?,0,0,?,?)"#,
            cb_id,
            id,
            r.budget_id,
            now,
            now
        )
        .execute(&mut *tx)
        .await?;

        let v_id = cuid();
        sqlx::query!(
            r#"INSERT INTO "BudgetVersion"
                 ("id","categoryBudgetId","amount","frequency","monthlyEquivalent",
                  "activeMonths","manualOverride","effectiveDate","createdAt")
               VALUES (?,?,?,?,?,?,0,?,?)"#,
            v_id,
            cb_id,
            latest.amount,
            latest.frequency,
            monthly.0,
            months,
            effective,
            now
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    Ok(Response::ok(read(pool, id).await?))
}
