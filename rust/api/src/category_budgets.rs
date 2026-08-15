//! `/category-budgets` — a budget's allocation inside a year plan, and the
//! versions that record how it changed through the year.
//!
//! Ported from `routes/category-budgets.ts` and `routes/budget-links.ts`.
//!
//! # A budget is not one number, it is a series
//!
//! `CategoryBudget` is the pairing of a budget with a year plan;
//! `BudgetVersion` rows carry the actual amounts, each with an
//! `effectiveDate`. Asking "what is the grocery budget" is meaningless without
//! a month — the answer is the latest version effective on or before it. That
//! is what makes a mid-year change honest: raising the budget in July does not
//! retroactively make January look on-target.
//!
//! # An archived year plan is frozen
//!
//! Every write refuses with 400 once the plan is ARCHIVED. Archiving is how a
//! year is closed out, and a closed year that can still be edited is not
//! closed.

use crate::id::{cuid, now_iso};
use crate::{ApiError, Path, Response};
use avoir_core::budget::{expense_monthly_equivalent, BudgetFrequency, Frequency};
use avoir_core::money::Cents;
use chrono::Datelike;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;

/// `YYYY-MM-01` at UTC midnight — the first of the month a version takes
/// effect. Versions are compared as strings, which works only because the
/// format is fixed-width and zero-padded.
fn effective_date(year: i64, month: u32) -> String {
    format!("{year:04}-{month:02}-01T00:00:00.000Z")
}

/// The monthly equivalent of an amount stated at some frequency.
///
/// The inverse of `convert_monthly_to_frequency`, and the figure every
/// comparison across budgets uses — a weekly budget and an annual one are only
/// comparable once both are monthly.
fn monthly_equivalent(amount: Cents, freq: BudgetFrequency, active_months: Option<usize>) -> Cents {
    match freq {
        BudgetFrequency::Weekly => Cents((amount.0 as i128 * 52 / 12) as i64),
        BudgetFrequency::Biweekly => Cents((amount.0 as i128 * 26 / 12) as i64),
        BudgetFrequency::SemiMonthly => Cents(amount.0 * 2),
        BudgetFrequency::Monthly => amount,
        BudgetFrequency::Quarterly => Cents(amount.0 / 3),
        BudgetFrequency::Biannual => Cents(amount.0 / 6),
        BudgetFrequency::Annual | BudgetFrequency::Yearly => {
            let months = active_months.filter(|n| *n > 0).unwrap_or(12) as i64;
            Cents(amount.0 / months.max(1))
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn version_json(
    id: &str,
    amount: i64,
    frequency: &str,
    monthly: i64,
    active_months: &Option<String>,
    manual: i64,
    effective: &str,
    created: &str,
) -> Value {
    let months: Vec<u32> = active_months
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    json!({
        "id": id,
        "amount": Cents(amount).as_dollars_f64(),
        "frequency": frequency,
        "monthlyEquivalent": Cents(monthly).as_dollars_f64(),
        "activeMonths": months,
        "manualOverride": manual != 0,
        "effectiveDate": effective,
        "createdAt": created,
    })
}

/// The version in force for a given month: the latest one effective on or
/// before it.
///
/// Not simply "the newest version". A version effective in July must not
/// answer a question about March, or every earlier month silently inherits a
/// number that did not exist yet.
async fn resolve_version(
    pool: &SqlitePool,
    category_budget_id: &str,
    year: i64,
    month: u32,
) -> Result<Option<Value>, ApiError> {
    let target = effective_date(year, month);
    let v = sqlx::query!(
        r#"SELECT "id" AS "id!", "amount" AS "amount!: i64", "frequency" AS "frequency!",
                  "monthlyEquivalent" AS "monthly!: i64",
                  "activeMonths" AS "active_months: String",
                  "manualOverride" AS "manual!: i64",
                  "effectiveDate" AS "effective!", "createdAt" AS "created!"
             FROM "BudgetVersion"
            WHERE "categoryBudgetId" = ?1 AND "effectiveDate" <= ?2
            ORDER BY "effectiveDate" DESC LIMIT 1"#,
        category_budget_id,
        target
    )
    .fetch_optional(pool)
    .await?;

    Ok(v.map(|v| {
        version_json(
            &v.id,
            v.amount,
            &v.frequency,
            v.monthly,
            &v.active_months,
            v.manual,
            &v.effective,
            &v.created,
        )
    }))
}

async fn category_budget_json(
    pool: &SqlitePool,
    id: &str,
    month: u32,
) -> Result<AllocationShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT cb."id" AS "id!", cb."yearPlanId" AS "year_plan_id!",
                  cb."budgetId" AS "budget_id!", cb."highWaterMark" AS "hwm!: i64",
                  cb."doneForYear" AS "done!: i64", cb."removedAt" AS "removed: String",
                  cb."createdAt" AS "created!", cb."updatedAt" AS "updated!",
                  b."name" AS "budget_name!", g."name" AS "group_name!",
                  yp."year" AS "year!: i64", yp."status" AS "status!",
                  (SELECT COUNT(*) FROM "BudgetExpenseLink" l
                    WHERE l."categoryBudgetId" = cb."id") AS "links!: i64"
             FROM "CategoryBudget" cb
             JOIN "Budget" b ON b."id" = cb."budgetId"
             JOIN "BudgetGroup" g ON g."id" = b."groupId"
             JOIN "YearPlan" yp ON yp."id" = cb."yearPlanId"
            WHERE cb."id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Category budget"))?;

    let version = resolve_version(pool, id, r.year, month).await?;
    let seasonal = version
        .as_ref()
        .and_then(|v| v["activeMonths"].as_array().map(|a| !a.is_empty()))
        .unwrap_or(false);

    Ok(AllocationShape {
        id: r.id,
        year_plan_id: r.year_plan_id,
        budget_id: r.budget_id,
        category_name: r.budget_name,
        category_group: r.group_name,
        removed_at: r.removed,
        seasonal,
        high_water_mark: Cents(r.hwm).as_dollars_f64(),
        done_for_year: r.done != 0,
        linked_expense_count: r.links,
        version: version.unwrap_or(Value::Null),
        created_at: r.created,
        updated_at: r.updated,
    })
}

/// Refuse writes once the year is closed.
async fn refuse_if_archived(pool: &SqlitePool, year_plan_id: &str) -> Result<i64, ApiError> {
    let yp = sqlx::query!(
        r#"SELECT "year" AS "year!: i64", "status" AS "status!" FROM "YearPlan" WHERE "id" = ?"#,
        year_plan_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Year plan"))?;
    if yp.status == "ARCHIVED" {
        return Err(ApiError::bad_request("Cannot modify an archived year plan"));
    }
    Ok(yp.year)
}

// ─── GET / ───

/// A budget allocation within a year plan.
///
/// `version` stays a `Value` — it is resolved by `resolve_version`, which
/// already returns the serialized shape, and threading a type through that is a
/// separate change.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AllocationShape {
    id: String,
    year_plan_id: String,
    budget_id: String,
    category_name: String,
    category_group: String,
    removed_at: Option<String>,
    seasonal: bool,
    high_water_mark: f64,
    done_for_year: bool,
    linked_expense_count: i64,
    version: Value,
    created_at: String,
    updated_at: String,
}

/// The version history of one allocation.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryShape {
    id: String,
    category_budget_id: String,
    versions: Vec<Value>,
}

pub async fn list(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    use crate::category_budget_status as st;

    // Required, matching the reference: `yearPlanId: z.string()` with no
    // `.optional()`. Treating it as optional here meant an unscoped request
    // answered 200 with every allocation across every year plan, where the
    // reference refuses with 400 — a request the client cannot make, answered
    // with data it never asked for.
    let Some(year_plan_id) = p.query("yearPlanId").filter(|s| !s.is_empty()) else {
        return Err(ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{ "field": "yearPlanId", "message": "Required" }])),
        });
    };
    let year_plan_id = Some(year_plan_id);
    let today = avoir_core::dates::today();
    let month: u32 = p
        .query("month")
        .and_then(|m| m.parse().ok())
        .unwrap_or_else(|| today.month());
    let year: i32 = p
        .query("year")
        .and_then(|y| y.parse().ok())
        .unwrap_or_else(|| today.year());
    let include_removed = p.query_bool("includeRemoved").unwrap_or(false) as i64;
    let include_seasonal = p.query_bool("includeSeasonal").unwrap_or(false);

    /*
     * TWO decisions, not one — and collapsing them was a real bug.
     *
     * The WINDOW: a supplied start/end always wins over the calendar month,
     * including for ANNUAL. The frontend sends Jan 1 → the first of next month
     * for the annual view, and that range is the whole point of it.
     *
     * PRORATION (`period_mode`): pay-period behaviour — recurring rollup and
     * per-period expected amounts — is off for ANNUAL, because prorating a
     * year to a fortnight is meaningless.
     *
     * Until 2026-08-13 the ANNUAL flag rejected the WINDOW too, so the annual
     * view fell through to the single-month branch below and reported ONE
     * MONTH of spending as the year. The reference (`category-budget-status.ts`)
     * has always kept these separate: `spendStart = periodStart ?? monthStart`
     * with `isPeriodMode` computed independently.
     */
    let period_start = p.query("periodStart").and_then(crate::id::parse_date);
    let period_end = p.query("periodEnd").and_then(crate::id::parse_date);
    let annual = p.query("viewMode") == Some("ANNUAL");
    let (start_date, end_date, period_mode) = match (period_start, period_end) {
        (Some(s), Some(e)) => (s, e, !annual),
        _ => {
            let s = chrono::NaiveDate::from_ymd_opt(year, month, 1)
                .ok_or_else(|| ApiError::bad_request("bad month or year"))?;
            let e = if month == 12 {
                chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
            } else {
                chrono::NaiveDate::from_ymd_opt(year, month + 1, 1)
            }
            .ok_or_else(|| ApiError::bad_request("bad month or year"))?
            .pred_opt()
            .expect("a month always has a previous day");
            (s, e, false)
        }
    };

    let window = st::Window {
        start: crate::id::date_at_utc_midnight(start_date),
        // Exclusive, matching the TypeScript's `lt`: a period end of the 18th
        // must include everything ON the 18th, and stored rows can carry a
        // time-of-day.
        end_exclusive: crate::id::date_at_utc_midnight(end_date.succ_opt().unwrap_or(end_date)),
        start_date,
        end_date,
    };

    let mut conn = pool.acquire().await?;

    if period_mode {
        avoir_db::schedule_generator::generate(
            &mut conn,
            &avoir_db::schedule_generator::Window {
                start: start_date,
                end: end_date,
                source_type: None,
                source_id: None,
            },
        )
        .await
        .map_err(ApiError::from)?;
    }

    let spending = st::spending_by_budget(&mut conn, &window).await?;
    let recurring = if period_mode {
        st::recurring_by_budget(&mut conn, &window).await?
    } else {
        Default::default()
    };
    let schedule_type = sqlx::query_scalar!(
        r#"SELECT "type" FROM "PaySchedule" ORDER BY "isDefault" DESC, "createdAt" ASC LIMIT 1"#
    )
    .fetch_optional(&mut *conn)
    .await?
    .unwrap_or_else(|| "BIWEEKLY".to_string());

    let rows = sqlx::query!(
        r#"SELECT cb."id" AS "id!", cb."budgetId" AS "budget_id!",
                  cb."doneForYear" AS "done!: i64",
                  (SELECT count(*) FROM "BudgetExpenseLink" l
                    WHERE l."categoryBudgetId" = cb."id") AS "links!: i64"
             FROM "CategoryBudget" cb
            WHERE (?1 IS NULL OR cb."yearPlanId" = ?1)
              AND (?2 = 1 OR cb."removedAt" IS NULL)"#,
        year_plan_id,
        include_removed
    )
    .fetch_all(&mut *conn)
    .await?;
    drop(conn);

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        // `decorate` patches computed fields onto the object, so the typed
        // allocation is converted here rather than there — `category_budget_
        // status.rs` is the last build-then-patch site left, and typing it means
        // typing the status computation too.
        let serialized = crate::to_body(category_budget_json(pool, &r.id, month).await?);
        let version = serialized.get("version").cloned().unwrap_or(Value::Null);
        let has_version = !version.is_null();
        let monthly = Cents::from_dollars_f64(
            version
                .get("monthlyEquivalent")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        );
        let active_months: Vec<u32> = version
            .get("activeMonths")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_u64().map(|n| n as u32))
                    .collect()
            })
            .unwrap_or_default();

        // A seasonal budget out of season is hidden unless asked for. It is
        // still RETURNED when `includeSeasonal` is set, zeroed rather than
        // dropped, so the year view can show it at nil.
        if !include_seasonal
            && has_version
            && !active_months.is_empty()
            && !avoir_core::budget::is_seasonal_active_in_month(&active_months, month)
        {
            continue;
        }

        let expected = if period_mode && has_version {
            Some(st::effective_expected(
                monthly,
                &active_months,
                r.links > 0,
                recurring.get(&r.budget_id).copied().unwrap_or(Cents(0)),
                &schedule_type,
                &window,
            ))
        } else {
            None
        };

        out.push(st::decorate(
            serialized,
            spending.get(&r.budget_id).copied().unwrap_or(Cents(0)),
            monthly,
            &active_months,
            month,
            r.done != 0,
            period_mode,
            expected,
            has_version,
            annual,
        ));
    }

    // Ordered by category name, which is what the UI groups on.
    out.sort_by(|a, b| {
        a["categoryName"]
            .as_str()
            .unwrap_or("")
            .cmp(b["categoryName"].as_str().unwrap_or(""))
    });
    Ok(Response::ok(Value::Array(out)))
}

// ─── GET /:id ───

pub async fn get(pool: &SqlitePool, id: &str, p: &Path<'_>) -> Result<Response, ApiError> {
    let month: u32 = p.query("month").and_then(|m| m.parse().ok()).unwrap_or(1);
    Ok(Response::ok(category_budget_json(pool, id, month).await?))
}

// ─── POST / ───

#[derive(Deserialize, Default)]
#[serde(default)]
struct CreateBody {
    #[serde(rename = "yearPlanId")]
    year_plan_id: String,
    #[serde(rename = "budgetId")]
    budget_id: String,
    amount: f64,
    frequency: String,
    #[serde(rename = "effectiveMonth")]
    effective_month: Option<u32>,
    #[serde(rename = "activeMonths")]
    active_months: Option<Vec<u32>>,
}

/// `z.number().int().min(1).max(12)` — a calendar month.
///
/// Out-of-range months were accepted by the port and stored, and nothing
/// downstream range-checks them: `resolveEffectiveVersion` compares numerically,
/// so month 13 silently never matches and month 0 matches everything before
/// January.
fn check_month(v: u32, field: &str) -> Result<(), ApiError> {
    if (1..=12).contains(&v) {
        return Ok(());
    }
    Err(ApiError {
        status: 400,
        error: "Validation failed".into(),
        details: Some(json!([{
            "field": field,
            "message": format!("Number must be between 1 and 12, received {v}")
        }])),
    })
}

pub async fn create(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    crate::require_present(&body, &["amount"])?;
    let b: CreateBody = crate::body_of(body)?;
    if b.year_plan_id.is_empty() {
        return Err(crate::recurring::required("yearPlanId"));
    }
    if b.budget_id.is_empty() {
        return Err(crate::recurring::required("budgetId"));
    }
    let freq = BudgetFrequency::from_stored(&b.frequency)
        .ok_or_else(|| ApiError::bad_request("Unknown budget frequency"))?;

    // `effectiveMonth: z.number().int().min(1).max(12)` in the reference —
    // REQUIRED, and the port had it optional. It is not a default anyone can
    // guess: it decides which month a version takes effect from, and
    // `resolveEffectiveVersion` picks a version by comparing against it. An
    // allocation created without one is a row no month resolves to.
    let effective_month = b
        .effective_month
        .ok_or_else(|| crate::recurring::required("effectiveMonth"))?;
    check_month(effective_month, "effectiveMonth")?;

    if let Some(months) = &b.active_months {
        for m in months {
            check_month(*m, "activeMonths")?;
        }
        // `activeMonthsRefinement`: a duplicate month would be counted twice by
        // `computeMonthlyEquivalent`, inflating the annual total.
        let mut seen = months.clone();
        seen.sort_unstable();
        seen.dedup();
        if seen.len() != months.len() {
            return Err(ApiError {
                status: 400,
                error: "Validation failed".into(),
                details: Some(json!([{
                    "field": "activeMonths",
                    "message": "activeMonths must not contain duplicate values"
                }])),
            });
        }
    }

    let year = refuse_if_archived(pool, &b.year_plan_id).await?;
    sqlx::query!(r#"SELECT "id" FROM "Budget" WHERE "id" = ?"#, b.budget_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ApiError::not_found("Budget"))?;

    // One allocation per budget per year plan. Enforced up front so the
    // message can name the year rather than surfacing a constraint violation.
    let dup = sqlx::query!(
        r#"SELECT "id" FROM "CategoryBudget" WHERE "yearPlanId" = ?1 AND "budgetId" = ?2"#,
        b.year_plan_id,
        b.budget_id
    )
    .fetch_optional(pool)
    .await?;
    if dup.is_some() {
        return Err(ApiError::conflict(format!(
            "Budget already exists for this category in {year}"
        )));
    }

    let months = b.active_months.unwrap_or_default();
    let amount = Cents::from_dollars_f64(b.amount);
    let monthly = monthly_equivalent(amount, freq, Some(months.len()));
    let effective = effective_date(year, b.effective_month.unwrap_or(1));
    let months_json = serde_json::to_string(&months).unwrap_or_else(|_| "[]".into());

    let id = cuid();
    let vid = cuid();
    let now = now_iso();
    let mut tx = pool.begin().await?;
    sqlx::query!(
        r#"INSERT INTO "CategoryBudget"
             ("id","yearPlanId","budgetId","createdAt","updatedAt","highWaterMark","doneForYear")
           VALUES (?,?,?,?,?,0,0)"#,
        id,
        b.year_plan_id,
        b.budget_id,
        now,
        now
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "BudgetVersion"
             ("id","categoryBudgetId","amount","frequency","monthlyEquivalent",
              "activeMonths","effectiveDate","createdAt","manualOverride")
           VALUES (?,?,?,?,?,?,?,?,0)"#,
        vid,
        id,
        amount.0,
        b.frequency,
        monthly.0,
        months_json,
        effective,
        now
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Response::created(
        category_budget_json(pool, &id, b.effective_month.unwrap_or(1)).await?,
    ))
}

// ─── PUT /:id ───

#[derive(Deserialize, Default)]
#[serde(default)]
struct UpdateBody {
    amount: Option<f64>,
    frequency: Option<String>,
    #[serde(rename = "effectiveMonth")]
    effective_month: Option<u32>,
    #[serde(rename = "activeMonths")]
    active_months: Option<Vec<u32>>,
    #[serde(rename = "manualOverride")]
    manual_override: Option<bool>,
    #[serde(rename = "doneForYear")]
    done_for_year: Option<bool>,
}

pub async fn update(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: UpdateBody = crate::body_of(body)?;
    let cb = sqlx::query!(
        r#"SELECT "yearPlanId" AS "year_plan_id!" FROM "CategoryBudget" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Category budget"))?;
    let year = refuse_if_archived(pool, &cb.year_plan_id).await?;

    if let Some(done) = b.done_for_year {
        let d = done as i64;
        let now = now_iso();
        sqlx::query!(
            r#"UPDATE "CategoryBudget" SET "doneForYear" = ?1, "updatedAt" = ?2 WHERE "id" = ?3"#,
            d,
            now,
            id
        )
        .execute(pool)
        .await?;
    }

    // The newest version supplies defaults for anything the patch omits.
    let latest = sqlx::query!(
        r#"SELECT "amount" AS "amount!: i64", "frequency" AS "frequency!",
                  "activeMonths" AS "active_months: String",
                  "manualOverride" AS "manual!: i64", "effectiveDate" AS "effective!"
             FROM "BudgetVersion" WHERE "categoryBudgetId" = ?
            ORDER BY "effectiveDate" DESC LIMIT 1"#,
        id
    )
    .fetch_optional(pool)
    .await?;

    let amount = b
        .amount
        .map(Cents::from_dollars_f64)
        .or_else(|| latest.as_ref().map(|l| Cents(l.amount)))
        .unwrap_or(Cents::ZERO);
    let frequency = b
        .frequency
        .clone()
        .or_else(|| latest.as_ref().map(|l| l.frequency.clone()))
        .unwrap_or_else(|| "MONTHLY".into());
    let freq = BudgetFrequency::from_stored(&frequency)
        .ok_or_else(|| ApiError::bad_request("Unknown budget frequency"))?;
    let month = b.effective_month.unwrap_or_else(|| {
        latest
            .as_ref()
            .and_then(|l| l.effective.get(5..7).and_then(|m| m.parse().ok()))
            .unwrap_or(1)
    });
    let months = b.active_months.clone().unwrap_or_else(|| {
        latest
            .as_ref()
            .and_then(|l| l.active_months.as_deref())
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default()
    });
    let manual = b
        .manual_override
        .unwrap_or_else(|| latest.as_ref().map(|l| l.manual != 0).unwrap_or(false));

    let effective = effective_date(year, month);
    let monthly = monthly_equivalent(amount, freq, Some(months.len()));
    let months_json = serde_json::to_string(&months).unwrap_or_else(|_| "[]".into());

    let mut tx = pool.begin().await?;
    // A version for this month already exists — replace it rather than
    // stacking two rows on the same effectiveDate, where the tie-break would
    // decide which one wins.
    sqlx::query!(
        r#"DELETE FROM "BudgetVersion" WHERE "categoryBudgetId" = ?1 AND "effectiveDate" = ?2"#,
        id,
        effective
    )
    .execute(&mut *tx)
    .await?;
    // Later zero-amount versions are "not tracked from here" placeholders. A
    // new amount set before one of them would be overridden by it the
    // following month, which is never what setting an amount means.
    sqlx::query!(
        r#"DELETE FROM "BudgetVersion"
            WHERE "categoryBudgetId" = ?1 AND "effectiveDate" > ?2 AND "amount" = 0"#,
        id,
        effective
    )
    .execute(&mut *tx)
    .await?;

    let vid = cuid();
    let now = now_iso();
    let manual_i = manual as i64;
    sqlx::query!(
        r#"INSERT INTO "BudgetVersion"
             ("id","categoryBudgetId","amount","frequency","monthlyEquivalent",
              "activeMonths","effectiveDate","createdAt","manualOverride")
           VALUES (?,?,?,?,?,?,?,?,?)"#,
        vid,
        id,
        amount.0,
        frequency,
        monthly.0,
        months_json,
        effective,
        now,
        manual_i
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Response::ok(category_budget_json(pool, id, month).await?))
}

// ─── DELETE /:id and POST /:id/restore ───

pub async fn remove(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let cb = sqlx::query!(
        r#"SELECT "yearPlanId" AS "year_plan_id!" FROM "CategoryBudget" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Category budget"))?;
    refuse_if_archived(pool, &cb.year_plan_id).await?;

    // Soft. The allocation's history is what makes a mid-year removal legible
    // — deleting it would make the months before it look like it never existed.
    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "CategoryBudget" SET "removedAt" = ?1, "updatedAt" = ?1 WHERE "id" = ?2"#,
        now,
        id
    )
    .execute(pool)
    .await?;
    Ok(Response::ok(category_budget_json(pool, id, 1).await?))
}

pub async fn restore(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let cb = sqlx::query!(
        r#"SELECT "yearPlanId" AS "year_plan_id!", "removedAt" AS "removed: String"
             FROM "CategoryBudget" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Category budget"))?;
    refuse_if_archived(pool, &cb.year_plan_id).await?;
    if cb.removed.is_none() {
        return Err(ApiError::bad_request("Category budget is not removed"));
    }

    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "CategoryBudget" SET "removedAt" = NULL, "updatedAt" = ?1 WHERE "id" = ?2"#,
        now,
        id
    )
    .execute(pool)
    .await?;
    Ok(Response::ok(category_budget_json(pool, id, 1).await?))
}

// ─── GET /:id/history ───

/// Every version of one allocation, oldest first.
///
/// Wrapped in `{ id, categoryBudgetId, versions }` rather than returned as a
/// bare array, because that is what `BudgetHistoryResponseSchema` parses. A raw
/// array is well-formed JSON that the frontend rejects — the History drawer
/// showed nothing at all, with the failure only visible in the console.
pub async fn history(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    category_budget_json(pool, id, 1).await?;
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "amount" AS "amount!: i64", "frequency" AS "frequency!",
                  "monthlyEquivalent" AS "monthly!: i64",
                  "activeMonths" AS "active_months: String",
                  "manualOverride" AS "manual!: i64",
                  "effectiveDate" AS "effective!", "createdAt" AS "created!"
             FROM "BudgetVersion" WHERE "categoryBudgetId" = ?
            ORDER BY "effectiveDate" ASC"#,
        id
    )
    .fetch_all(pool)
    .await?;

    let versions: Vec<Value> = rows
        .into_iter()
        .map(|v| {
            version_json(
                &v.id,
                v.amount,
                &v.frequency,
                v.monthly,
                &v.active_months,
                v.manual,
                &v.effective,
                &v.created,
            )
        })
        .collect();

    Ok(Response::ok(HistoryShape {
        id: id.to_string(),
        category_budget_id: id.to_string(),
        versions,
    }))
}

// ─── Links: POST/GET/DELETE /:id/links ───

#[derive(Deserialize)]
struct LinkBody {
    #[serde(rename = "expenseId")]
    expense_id: String,
}

#[derive(Deserialize)]
struct BulkLinkBody {
    #[serde(rename = "expenseIds")]
    expense_ids: Vec<String>,
}

/// The month a recompute should resolve `amountSchedule` against.
fn current_month() -> u32 {
    use chrono::Datelike;
    avoir_core::dates::today().month()
}

/// One link, in the flat shape `BudgetExpenseLinkResponseSchema` requires.
///
/// The nested `{ expense: { … } }` shape this used to return parses against
/// nothing: every field the client reads — `expenseName`, `monthlyEquivalent`,
/// `isPaused` — is top-level and required, so the whole list threw in the
/// browser while the endpoint answered 200.
#[allow(clippy::too_many_arguments)]
fn serialize_link(
    link_id: &str,
    cb_id: &str,
    expense_id: &str,
    name: &str,
    amount: Cents,
    frequency: &str,
    schedule: Option<&str>,
    paused: bool,
    archived: bool,
    created_at: &str,
) -> Value {
    let freq = Frequency::from_stored(frequency);
    // The monthly equivalent is quoted for the CURRENT month, so an expense
    // with an `amountSchedule` reports what it will actually cost now rather
    // than its base figure.
    let current = resolve_current_amount(amount, schedule, current_month());
    let monthly = freq
        .map(|f| expense_monthly_equivalent(current, f))
        .unwrap_or(current);

    json!({
        "id": link_id,
        "categoryBudgetId": cb_id,
        "expenseId": expense_id,
        "expenseName": name,
        "expenseAmount": amount.as_dollars_f64(),
        "expenseFrequency": frequency,
        "monthlyEquivalent": monthly.as_dollars_f64(),
        "isPaused": paused,
        "isArchived": archived,
        "createdAt": created_at,
    })
}

/// The amount that applies to `month`, honouring `amountSchedule`.
///
/// Mirrors `resolveCurrentAmount`: a month with no entry falls back to the base
/// amount. Values are stored as decimal dollars.
fn resolve_current_amount(base: Cents, schedule: Option<&str>, month: u32) -> Cents {
    let Some(raw) = schedule else { return base };
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return base;
    };
    v.get(month.to_string())
        .and_then(|x| x.as_f64())
        .map(Cents::from_dollars_f64)
        .unwrap_or(base)
}

/// Why an expense cannot be linked, in the original's words.
///
/// The messages are user-visible and the bulk endpoint reports them per row, so
/// they are reproduced verbatim rather than paraphrased.
enum LinkRefusal {
    NotFound,
    WrongCategory,
    OneTime,
    AlreadyLinked,
}

impl LinkRefusal {
    fn message(&self) -> &'static str {
        match self {
            LinkRefusal::NotFound => "Expense not found",
            LinkRefusal::WrongCategory => "Expense category does not match budget category",
            LinkRefusal::OneTime => "Cannot link a one-time expense to a budget",
            LinkRefusal::AlreadyLinked => "Expense is already linked to another budget",
        }
    }

    /// The status the single-link endpoint answers with.
    fn status(&self) -> u16 {
        match self {
            LinkRefusal::NotFound => 404,
            LinkRefusal::AlreadyLinked => 409,
            _ => 400,
        }
    }
}

/// Create one link, or explain why not.
///
/// Shared by the single and bulk endpoints so the four rules cannot drift: the
/// bulk route reports a refusal per row, the single route turns it into a
/// status code.
async fn try_add_link(
    pool: &SqlitePool,
    cb_id: &str,
    budget_id: &str,
    expense_id: &str,
) -> Result<Result<Value, LinkRefusal>, ApiError> {
    let Some(e) = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "amount" AS "amount!: i64",
                  "frequency" AS "frequency!", "budgetId" AS "budget_id: String",
                  "amountSchedule" AS "schedule: String",
                  "pausedUntil" AS "paused: String", "archivedAt" AS "archived: String"
             FROM "Expense" WHERE "id" = ?"#,
        expense_id
    )
    .fetch_optional(pool)
    .await?
    else {
        return Ok(Err(LinkRefusal::NotFound));
    };

    if e.budget_id != budget_id {
        return Ok(Err(LinkRefusal::WrongCategory));
    }
    if e.frequency == "ONE_TIME" {
        return Ok(Err(LinkRefusal::OneTime));
    }

    // Uniqueness is on `expenseId` ALONE — an expense belongs to at most one
    // budget anywhere. Checking the (budget, expense) pair instead would let a
    // second link be attempted and fail on the constraint.
    let already = sqlx::query!(
        r#"SELECT "id" FROM "BudgetExpenseLink" WHERE "expenseId" = ?"#,
        expense_id
    )
    .fetch_optional(pool)
    .await?
    .is_some();
    if already {
        return Ok(Err(LinkRefusal::AlreadyLinked));
    }

    let id = cuid();
    let now = now_iso();
    sqlx::query!(
        r#"INSERT INTO "BudgetExpenseLink" ("id","categoryBudgetId","expenseId","createdAt")
           VALUES (?,?,?,?)"#,
        id,
        cb_id,
        expense_id,
        now
    )
    .execute(pool)
    .await?;

    Ok(Ok(serialize_link(
        &id,
        cb_id,
        expense_id,
        &e.name,
        Cents(e.amount),
        &e.frequency,
        e.schedule.as_deref(),
        e.paused.is_some(),
        e.archived.is_some(),
        &now,
    )))
}

/// The budget's own category, which a linked expense must match.
async fn budget_category_of(pool: &SqlitePool, cb_id: &str) -> Result<String, ApiError> {
    let row = sqlx::query!(
        r#"SELECT "budgetId" AS "budget_id!" FROM "CategoryBudget" WHERE "id" = ?"#,
        cb_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Category budget"))?;
    Ok(row.budget_id)
}

pub async fn create_link(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: LinkBody = crate::body_of(body)?;
    let budget_id = budget_category_of(pool, id).await?;

    let link = match try_add_link(pool, id, &budget_id, &b.expense_id).await? {
        Ok(v) => v,
        Err(r) => return Err(ApiError::new(r.status(), r.message())),
    };

    // Linking changes what the budget derives from, so the amount is
    // recomputed immediately rather than waiting for something else to notice.
    let mut conn = pool.acquire().await?;
    avoir_db::budget_links::recompute_from_links(&mut conn, id, current_month()).await?;
    drop(conn);

    Ok(Response::created(link))
}

/// Link several expenses, reporting each one's outcome.
///
/// Every entry succeeds or fails on its own — one bad id does not abort the
/// rest — which is why the response is a `results` array rather than a count.
/// This previously returned `{ linked, budget }`, a shape invented here that
/// matches nothing the client parses, so creating a budget with linked expenses
/// failed validation in the browser.
pub async fn create_links_bulk(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: BulkLinkBody = crate::body_of(body)?;
    let budget_id = budget_category_of(pool, id).await?;

    let mut results: Vec<Value> = Vec::new();
    for expense_id in &b.expense_ids {
        match try_add_link(pool, id, &budget_id, expense_id).await? {
            Ok(link) => results.push(link),
            Err(r) => results.push(json!({
                "expenseId": expense_id,
                "error": r.message(),
            })),
        }
    }

    let mut conn = pool.acquire().await?;
    avoir_db::budget_links::recompute_from_links(&mut conn, id, current_month()).await?;
    drop(conn);

    // 207 Multi-Status: the original's code, and honest — the array can hold
    // successes and failures together.
    Ok(Response {
        status: 207,
        body: json!({ "results": results }),
    })
}

pub async fn list_links(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    category_budget_json(pool, id, 1).await?;
    let rows = sqlx::query!(
        r#"SELECT l."id" AS "id!", l."expenseId" AS "expense_id!", l."createdAt" AS "created!",
                  l."categoryBudgetId" AS "cb_id!",
                  e."name" AS "name!", e."amount" AS "amount!: i64",
                  e."frequency" AS "frequency!", e."amountSchedule" AS "schedule: String",
                  e."pausedUntil" AS "paused: String", e."archivedAt" AS "archived: String"
             FROM "BudgetExpenseLink" l
             JOIN "Expense" e ON e."id" = l."expenseId"
            WHERE l."categoryBudgetId" = ?
            ORDER BY e."name" ASC"#,
        id
    )
    .fetch_all(pool)
    .await?;

    Ok(Response::ok(Value::Array(
        rows.into_iter()
            .map(|r| {
                serialize_link(
                    &r.id,
                    &r.cb_id,
                    &r.expense_id,
                    &r.name,
                    Cents(r.amount),
                    &r.frequency,
                    r.schedule.as_deref(),
                    r.paused.is_some(),
                    r.archived.is_some(),
                    &r.created,
                )
            })
            .collect(),
    )))
}

pub async fn delete_link(pool: &SqlitePool, id: &str, link_id: &str) -> Result<Response, ApiError> {
    let n = sqlx::query!(
        r#"DELETE FROM "BudgetExpenseLink" WHERE "id" = ?1 AND "categoryBudgetId" = ?2"#,
        link_id,
        id
    )
    .execute(pool)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(ApiError::not_found("Link"));
    }

    // Unlinking does NOT lower the budget: the high-water mark holds. Removing
    // a link says "this expense no longer feeds the target", not "the target
    // was always too high".
    let mut conn = pool.acquire().await?;
    avoir_db::budget_links::recompute_from_links(&mut conn, id, current_month()).await?;
    drop(conn);

    Ok(Response::no_content())
}

/// Re-derive every budget an expense feeds — the `triggerBudgetRecompute` the
/// recurring routes call after a change.
pub async fn recompute_for_expense(pool: &SqlitePool, expense_id: &str) -> Result<(), ApiError> {
    let mut conn = pool.acquire().await?;
    avoir_db::budget_links::recompute_for_expense(&mut conn, expense_id, current_month()).await?;
    Ok(())
}
