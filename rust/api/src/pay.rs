//! `/pay-schedules`, `/pay-periods` and `/goals`.
//!
//! Ported from `routes/pay-schedules.ts`, `routes/pay-periods.ts` and
//! `routes/goals.ts`. Three small domains in one module because they are all
//! plain CRUD over one table each, and splitting them would be three files of
//! imports around thirty lines of query.
//!
//! # Generating periods is an upsert, and that is what makes it safe to re-run
//!
//! `(scheduleId, year, periodNum)` is the identity of a pay period, so
//! regenerating a range that already exists updates those rows instead of
//! adding siblings. Transactions point at pay periods by id, so a delete-and-
//! recreate would orphan every one of them — the same reasoning ADR-024 applied
//! to scheduled transactions.
//!
//! # Which schedule is "the" schedule
//!
//! Several endpoints need a default when none is named: the one flagged
//! `isDefault`, and failing that the oldest. Stated once here so the four
//! callers cannot drift, which is how `/dashboard` and `/pay-periods/current`
//! would otherwise end up disagreeing about which period is current.

use crate::id::{cuid, date_at_utc_midnight, now_iso, parse_date};
use crate::{ApiError, Path, Response};
use avoir_core::dates::{generate_pay_periods, GeneratePeriodsInput, PayScheduleType};
use avoir_core::money::Cents;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

// ═══ Pay schedules ═══

fn schedule_type(s: &str) -> Option<PayScheduleType> {
    match s {
        "WEEKLY" => Some(PayScheduleType::Weekly),
        "BIWEEKLY" => Some(PayScheduleType::Biweekly),
        "SEMI_MONTHLY" => Some(PayScheduleType::SemiMonthly),
        "MONTHLY" => Some(PayScheduleType::Monthly),
        _ => None,
    }
}

async fn schedule_json(pool: &SqlitePool, id: &str) -> Result<ScheduleShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "type" AS "ty!",
                  "anchorDate" AS "anchor_date!", "firstPayDay" AS "first: i64",
                  "secondPayDay" AS "second: i64", "isDefault" AS "is_default!: i64",
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "PaySchedule" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Pay schedule"))?;
    Ok(ScheduleShape {
        id: r.id,
        name: r.name,
        kind: r.ty,
        anchor_date: r.anchor_date,
        first_pay_day: r.first,
        second_pay_day: r.second,
        is_default: r.is_default != 0,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

/// A pay schedule. Two sites built this from separate `json!` literals.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleShape {
    id: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
    anchor_date: String,
    first_pay_day: Option<i64>,
    second_pay_day: Option<i64>,
    is_default: bool,
    created_at: String,
    updated_at: String,
}

/// How many periods hang off a schedule — the delete confirmation needs the
/// count to say what it is about to cascade.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleCount {
    pay_periods: i64,
}

/// A schedule plus that count, composed rather than patched in afterwards.
#[derive(Serialize)]
struct ScheduleWithCount {
    #[serde(flatten)]
    schedule: ScheduleShape,
    #[serde(rename = "_count")]
    count: ScheduleCount,
}

pub async fn list_schedules(pool: &SqlitePool) -> Result<Response, ApiError> {
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "type" AS "ty!",
                  "anchorDate" AS "anchor_date!", "firstPayDay" AS "first: i64",
                  "secondPayDay" AS "second: i64", "isDefault" AS "is_default!: i64",
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "PaySchedule" ORDER BY "name" ASC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(Response::ok(
        rows.into_iter()
            .map(|r| ScheduleShape {
                id: r.id,
                name: r.name,
                kind: r.ty,
                anchor_date: r.anchor_date,
                first_pay_day: r.first,
                second_pay_day: r.second,
                is_default: r.is_default != 0,
                created_at: r.created_at,
                updated_at: r.updated_at,
            })
            .collect::<Vec<_>>(),
    ))
}

pub async fn get_schedule(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let schedule = schedule_json(pool, id).await?;
    let count = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "PayPeriod" WHERE "scheduleId" = ?"#,
        id
    )
    .fetch_one(pool)
    .await?;
    Ok(Response::ok(ScheduleWithCount {
        schedule,
        count: ScheduleCount { pay_periods: count },
    }))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ScheduleBody {
    name: String,
    #[serde(rename = "type")]
    ty: String,
    #[serde(rename = "anchorDate")]
    anchor_date: String,
    #[serde(rename = "firstPayDay")]
    first_pay_day: Option<i64>,
    #[serde(rename = "secondPayDay")]
    second_pay_day: Option<i64>,
    #[serde(rename = "isDefault")]
    is_default: Option<bool>,
}

pub async fn create_schedule(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: ScheduleBody = crate::body_of(body)?;
    if b.name.trim().is_empty() {
        return Err(crate::recurring::required("name"));
    }
    if schedule_type(&b.ty).is_none() {
        return Err(ApiError::bad_request(format!(
            "Unknown schedule type: {}",
            b.ty
        )));
    }
    let anchor = parse_date(&b.anchor_date)
        .ok_or_else(|| ApiError::bad_request("anchorDate must be a date"))?;

    let id = cuid();
    let now = now_iso();
    let anchor_s = date_at_utc_midnight(anchor);
    let is_default = b.is_default.unwrap_or(false);
    sqlx::query!(
        r#"INSERT INTO "PaySchedule"
             ("id","name","type","anchorDate","firstPayDay","secondPayDay","isDefault",
              "createdAt","updatedAt")
           VALUES (?,?,?,?,?,?,?,?,?)"#,
        id,
        b.name,
        b.ty,
        anchor_s,
        b.first_pay_day,
        b.second_pay_day,
        is_default,
        now,
        now
    )
    .execute(pool)
    .await?;
    Ok(Response::created(schedule_json(pool, &id).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct SchedulePatch {
    name: Option<String>,
    #[serde(rename = "type")]
    ty: Option<String>,
    #[serde(rename = "anchorDate")]
    anchor_date: Option<String>,
    #[serde(rename = "firstPayDay", deserialize_with = "crate::recurring::present")]
    first_pay_day: Option<Option<i64>>,
    #[serde(
        rename = "secondPayDay",
        deserialize_with = "crate::recurring::present"
    )]
    second_pay_day: Option<Option<i64>>,
    #[serde(rename = "isDefault")]
    is_default: Option<bool>,
}

pub async fn update_schedule(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: SchedulePatch = crate::body_of(body)?;
    schedule_json(pool, id).await?;

    if let Some(t) = &b.ty {
        if schedule_type(t).is_none() {
            return Err(ApiError::bad_request(format!("Unknown schedule type: {t}")));
        }
    }
    let anchor = match &b.anchor_date {
        Some(s) => {
            Some(date_at_utc_midnight(parse_date(s).ok_or_else(|| {
                ApiError::bad_request("anchorDate must be a date")
            })?))
        }
        None => None,
    };

    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "PaySchedule"
              SET "name" = COALESCE(?1, "name"),
                  "type" = COALESCE(?2, "type"),
                  "anchorDate" = COALESCE(?3, "anchorDate"),
                  "firstPayDay" = CASE WHEN ?4 THEN ?5 ELSE "firstPayDay" END,
                  "secondPayDay" = CASE WHEN ?6 THEN ?7 ELSE "secondPayDay" END,
                  "isDefault" = COALESCE(?8, "isDefault"),
                  "updatedAt" = ?9
            WHERE "id" = ?10"#,
        b.name,
        b.ty,
        anchor,
        b.first_pay_day.is_some(),
        b.first_pay_day.and_then(|o| o),
        b.second_pay_day.is_some(),
        b.second_pay_day.and_then(|o| o),
        b.is_default,
        now,
        id
    )
    .execute(pool)
    .await?;
    Ok(Response::ok(schedule_json(pool, id).await?))
}

pub async fn delete_schedule(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    schedule_json(pool, id).await?;
    // PayPeriod cascades from PaySchedule; Transaction.payPeriodId is
    // ON DELETE SET NULL, so the transactions survive with no period rather
    // than being taken with it.
    sqlx::query!(r#"DELETE FROM "PaySchedule" WHERE "id" = ?"#, id)
        .execute(pool)
        .await?;
    Ok(Response::no_content())
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct GenerateBody {
    #[serde(rename = "rangeStart")]
    range_start: String,
    #[serde(rename = "rangeEnd")]
    range_end: String,
}

pub async fn generate_periods(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: GenerateBody = crate::body_of(body)?;
    let schedule = sqlx::query!(
        r#"SELECT "type" AS "ty!", "anchorDate" AS "anchor!",
                  "firstPayDay" AS "first: i64", "secondPayDay" AS "second: i64"
             FROM "PaySchedule" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Pay schedule"))?;

    let (Some(start), Some(end)) = (parse_date(&b.range_start), parse_date(&b.range_end)) else {
        return Err(ApiError::bad_request(
            "rangeStart and rangeEnd must be dates",
        ));
    };
    let ty = schedule_type(&schedule.ty)
        .ok_or_else(|| ApiError::bad_request(format!("Unknown schedule type: {}", schedule.ty)))?;

    let generated = generate_pay_periods(&GeneratePeriodsInput {
        schedule_type: ty,
        anchor_date: parse_date(&schedule.anchor),
        first_pay_day: schedule.first.map(|d| d as u32),
        second_pay_day: schedule.second.map(|d| d as u32),
        range_start: start,
        range_end: end,
    })
    .map_err(|e| ApiError::bad_request(format!("{e:?}")))?;

    let mut tx = pool.begin().await?;
    let mut out = Vec::new();
    for p in &generated {
        let new_id = cuid();
        let s = date_at_utc_midnight(p.start_date);
        let e = date_at_utc_midnight(p.end_date);
        let pay = date_at_utc_midnight(p.pay_date);
        let year = p.year as i64;
        let num = p.period_num as i64;
        // Upsert on the period's real identity. The surviving row keeps its
        // original id, which is what every transaction pointing at it needs.
        sqlx::query!(
            r#"INSERT INTO "PayPeriod" ("id","scheduleId","startDate","endDate","payDate",
                                        "year","periodNum")
               VALUES (?1,?2,?3,?4,?5,?6,?7)
               ON CONFLICT("scheduleId","year","periodNum") DO UPDATE SET
                 "startDate" = ?3, "endDate" = ?4, "payDate" = ?5"#,
            new_id,
            id,
            s,
            e,
            pay,
            year,
            num
        )
        .execute(&mut *tx)
        .await?;

        // Re-read rather than reporting `new_id`: on conflict the row keeps the
        // id it already had, and handing back one that does not exist is the
        // defect ADR-032's escrow upsert had to fix.
        let row = sqlx::query!(
            r#"SELECT "id" AS "id!" FROM "PayPeriod"
                WHERE "scheduleId" = ? AND "year" = ? AND "periodNum" = ?"#,
            id,
            year,
            num
        )
        .fetch_one(&mut *tx)
        .await?;
        out.push(period_json(&row.id, id, &s, &e, &pay, year, num));
    }
    tx.commit().await?;
    Ok(Response::ok(out))
}

// ═══ Pay periods ═══

/// A balance snapshot, as the period detail carries it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotShape {
    id: String,
    pay_period_id: String,
    account_id: String,
    opening_balance: f64,
    closing_balance: f64,
    total_income: f64,
    total_expenses: f64,
    created_at: String,
}

/// A period plus its snapshots, composed rather than patched in afterwards.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PeriodDetailShape {
    #[serde(flatten)]
    period: PeriodShape,
    balance_snapshots: Vec<SnapshotShape>,
}

/// One pay period. Two sites built this from separate `json!` literals.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PeriodShape {
    id: String,
    schedule_id: String,
    start_date: String,
    end_date: String,
    pay_date: String,
    year: i64,
    period_num: i64,
}

fn period_json(
    id: &str,
    schedule_id: &str,
    start: &str,
    end: &str,
    pay: &str,
    year: i64,
    num: i64,
) -> PeriodShape {
    PeriodShape {
        id: id.to_string(),
        schedule_id: schedule_id.to_string(),
        start_date: start.to_string(),
        end_date: end.to_string(),
        pay_date: pay.to_string(),
        year,
        period_num: num,
    }
}

/// The schedule to use when the caller names none: the default, else the
/// oldest. Stated once so every caller agrees.
pub(crate) async fn resolve_schedule_id(
    pool: &SqlitePool,
    requested: Option<&str>,
) -> Result<Option<String>, ApiError> {
    if let Some(id) = requested.filter(|s| !s.is_empty()) {
        return Ok(Some(id.to_string()));
    }
    let by_default = sqlx::query_scalar!(
        r#"SELECT "id" FROM "PaySchedule" WHERE "isDefault" = 1 ORDER BY "createdAt" ASC LIMIT 1"#
    )
    .fetch_optional(pool)
    .await?;
    if by_default.is_some() {
        return Ok(by_default);
    }
    Ok(
        sqlx::query_scalar!(r#"SELECT "id" FROM "PaySchedule" ORDER BY "createdAt" ASC LIMIT 1"#)
            .fetch_optional(pool)
            .await?,
    )
}

pub async fn current_period(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let schedule_id = resolve_schedule_id(pool, p.query("scheduleId")).await?;
    let today = date_at_utc_midnight(avoir_core::dates::today());

    // A NULL schedule filter means "any", which is what the TypeScript's
    // conditional `where` produced when no schedule existed at all.
    let row = sqlx::query!(
        r#"SELECT "id" AS "id!", "scheduleId" AS "schedule_id!", "startDate" AS "start!",
                  "endDate" AS "end!", "payDate" AS "pay!", "year" AS "year!: i64",
                  "periodNum" AS "num!: i64"
             FROM "PayPeriod"
            WHERE "startDate" <= ?1 AND "endDate" >= ?1
              AND (?2 IS NULL OR "scheduleId" = ?2)
            ORDER BY "payDate" ASC LIMIT 1"#,
        today,
        schedule_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Pay period"))?;

    Ok(Response::ok(period_json(
        &row.id,
        &row.schedule_id,
        &row.start,
        &row.end,
        &row.pay,
        row.year,
        row.num,
    )))
}

pub async fn list_periods(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let schedule_id = p.query("scheduleId").filter(|s| !s.is_empty());
    let year: Option<i64> = p.query("year").and_then(|s| s.parse().ok());
    let from = p
        .query("dateFrom")
        .and_then(parse_date)
        .map(date_at_utc_midnight);
    let to = p
        .query("dateTo")
        .and_then(parse_date)
        .map(date_at_utc_midnight);
    // 50/100, not the 100/500 the other list endpoints use: `ListPayPeriodsQuerySchema`
    // is the odd one out and the harness caught it returning a page twice the
    // reference's size. A default page size is part of the contract, not a detail —
    // a caller that omits `limit` is asking for whatever the API considers a page.
    let limit: i64 = p
        .query("limit")
        .and_then(|s| s.parse().ok())
        .unwrap_or(50)
        .clamp(1, 100);
    let offset: i64 = p
        .query("offset")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
        .max(0);

    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "scheduleId" AS "schedule_id!", "startDate" AS "start!",
                  "endDate" AS "end!", "payDate" AS "pay!", "year" AS "year!: i64",
                  "periodNum" AS "num!: i64"
             FROM "PayPeriod"
            WHERE (?1 IS NULL OR "scheduleId" = ?1)
              AND (?2 IS NULL OR "year" = ?2)
              AND (?3 IS NULL OR "payDate" >= ?3)
              AND (?4 IS NULL OR "payDate" <= ?4)
            ORDER BY "payDate" ASC
            LIMIT ?5 OFFSET ?6"#,
        schedule_id,
        year,
        from,
        to,
        limit,
        offset
    )
    .fetch_all(pool)
    .await?;

    Ok(Response::ok(
        rows.into_iter()
            .map(|r| {
                period_json(
                    &r.id,
                    &r.schedule_id,
                    &r.start,
                    &r.end,
                    &r.pay,
                    r.year,
                    r.num,
                )
            })
            .collect::<Vec<_>>(),
    ))
}

pub async fn get_period(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "scheduleId" AS "schedule_id!", "startDate" AS "start!",
                  "endDate" AS "end!", "payDate" AS "pay!", "year" AS "year!: i64",
                  "periodNum" AS "num!: i64"
             FROM "PayPeriod" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Pay period"))?;

    let snaps = sqlx::query!(
        r#"SELECT "id" AS "id!", "payPeriodId" AS "period_id!", "accountId" AS "account_id!",
                  "openingBalance" AS "opening!: i64", "closingBalance" AS "closing!: i64",
                  "totalIncome" AS "income!: i64", "totalExpenses" AS "expenses!: i64",
                  "createdAt" AS "created_at!"
             FROM "BalanceSnapshot" WHERE "payPeriodId" = ?"#,
        id
    )
    .fetch_all(pool)
    .await?;

    Ok(Response::ok(PeriodDetailShape {
        period: period_json(
            &r.id,
            &r.schedule_id,
            &r.start,
            &r.end,
            &r.pay,
            r.year,
            r.num,
        ),
        balance_snapshots: snaps
            .into_iter()
            .map(|s| SnapshotShape {
                id: s.id,
                pay_period_id: s.period_id,
                account_id: s.account_id,
                opening_balance: Cents(s.opening).as_dollars_f64(),
                closing_balance: Cents(s.closing).as_dollars_f64(),
                total_income: Cents(s.income).as_dollars_f64(),
                total_expenses: Cents(s.expenses).as_dollars_f64(),
                created_at: s.created_at,
            })
            .collect(),
    }))
}

// ═══ Goals ═══

const GOAL_TYPES: [&str; 5] = [
    "SAVINGS",
    "DEBT_PAYOFF",
    "INVESTMENT",
    "SPENDING_LIMIT",
    "CUSTOM",
];

/// A savings goal. Two sites built this from separate `json!` literals.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GoalShape {
    id: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
    target_amount: f64,
    current_amount: f64,
    budget_id: Option<String>,
    deadline: Option<String>,
    created_at: String,
    updated_at: String,
}

/// A goal with how far along it is.
///
/// The percentage is **clamped to 100** and `remaining` floored at zero, so
/// overshooting a savings target shows a full bar rather than a 140% one and a
/// negative amount left to save.
///
/// It is computed from the goal's own fields. It used to be computed from the
/// SERIALIZED body of `list_goals` — `g["targetAmount"].as_f64().unwrap_or(0.0)`
/// — so a renamed key would have silently made every target zero, and with it
/// every percentage and every remaining amount. That is the same defect class
/// as the soft-delete handler reading `deletedAt` off its own response, applied
/// to arithmetic the user reads as a progress bar.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GoalProgressShape {
    #[serde(flatten)]
    goal: GoalShape,
    percent_complete: f64,
    remaining: f64,
}

async fn goal_json(pool: &SqlitePool, id: &str) -> Result<GoalShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "type" AS "ty!",
                  "targetAmount" AS "target!: i64", "currentAmount" AS "current!: i64",
                  "budgetId" AS budget_id, "deadline",
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "BudgetGoal" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Budget goal"))?;
    Ok(GoalShape {
        id: r.id,
        name: r.name,
        kind: r.ty,
        target_amount: Cents(r.target).as_dollars_f64(),
        current_amount: Cents(r.current).as_dollars_f64(),
        budget_id: r.budget_id,
        deadline: r.deadline,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

async fn all_goals(pool: &SqlitePool) -> Result<Vec<GoalShape>, ApiError> {
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "type" AS "ty!",
                  "targetAmount" AS "target!: i64", "currentAmount" AS "current!: i64",
                  "budgetId" AS budget_id, "deadline",
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "BudgetGoal" ORDER BY "createdAt" DESC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| GoalShape {
            id: r.id,
            name: r.name,
            kind: r.ty,
            target_amount: Cents(r.target).as_dollars_f64(),
            current_amount: Cents(r.current).as_dollars_f64(),
            budget_id: r.budget_id,
            deadline: r.deadline,
            created_at: r.created_at,
            updated_at: r.updated_at,
        })
        .collect())
}

pub async fn list_goals(pool: &SqlitePool) -> Result<Response, ApiError> {
    Ok(Response::ok(all_goals(pool).await?))
}

pub async fn goal_progress(pool: &SqlitePool) -> Result<Response, ApiError> {
    let out: Vec<GoalProgressShape> = all_goals(pool)
        .await?
        .into_iter()
        .map(|goal| {
            let percent_complete = if goal.target_amount > 0.0 {
                (goal.current_amount / goal.target_amount * 100.0).min(100.0)
            } else {
                0.0
            };
            let remaining = (goal.target_amount - goal.current_amount).max(0.0);
            GoalProgressShape {
                goal,
                percent_complete,
                remaining,
            }
        })
        .collect();
    Ok(Response::ok(out))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct GoalBody {
    name: String,
    #[serde(rename = "type")]
    ty: String,
    #[serde(rename = "targetAmount")]
    target_amount: f64,
    #[serde(rename = "currentAmount")]
    current_amount: Option<f64>,
    #[serde(rename = "budgetId")]
    budget_id: Option<String>,
    deadline: Option<String>,
}

pub async fn create_goal(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    crate::require_present(&body, &["targetAmount"])?;
    let b: GoalBody = crate::body_of(body)?;
    if b.name.trim().is_empty() {
        return Err(crate::recurring::required("name"));
    }
    if !GOAL_TYPES.contains(&b.ty.as_str()) {
        return Err(ApiError::bad_request(format!(
            "Unknown goal type: {}",
            b.ty
        )));
    }
    let deadline = match &b.deadline {
        Some(s) if !s.is_empty() => {
            Some(date_at_utc_midnight(parse_date(s).ok_or_else(|| {
                ApiError::bad_request("deadline must be a date")
            })?))
        }
        _ => None,
    };

    let id = cuid();
    let now = now_iso();
    let target = Cents::from_dollars_f64(b.target_amount).0;
    let current = Cents::from_dollars_f64(b.current_amount.unwrap_or(0.0)).0;
    sqlx::query!(
        r#"INSERT INTO "BudgetGoal"
             ("id","name","type","targetAmount","currentAmount","budgetId","deadline",
              "createdAt","updatedAt")
           VALUES (?,?,?,?,?,?,?,?,?)"#,
        id,
        b.name,
        b.ty,
        target,
        current,
        b.budget_id,
        deadline,
        now,
        now
    )
    .execute(pool)
    .await?;
    Ok(Response::created(goal_json(pool, &id).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct GoalPatch {
    name: Option<String>,
    #[serde(rename = "type")]
    ty: Option<String>,
    #[serde(rename = "targetAmount")]
    target_amount: Option<f64>,
    #[serde(rename = "currentAmount")]
    current_amount: Option<f64>,
    #[serde(rename = "budgetId", deserialize_with = "crate::recurring::present")]
    budget_id: Option<Option<String>>,
    #[serde(deserialize_with = "crate::recurring::present")]
    deadline: Option<Option<String>>,
}

pub async fn update_goal(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: GoalPatch = crate::body_of(body)?;
    goal_json(pool, id).await?;
    if let Some(t) = &b.ty {
        if !GOAL_TYPES.contains(&t.as_str()) {
            return Err(ApiError::bad_request(format!("Unknown goal type: {t}")));
        }
    }
    let deadline = match &b.deadline {
        Some(Some(s)) if !s.is_empty() => Some(Some(date_at_utc_midnight(
            parse_date(s).ok_or_else(|| ApiError::bad_request("deadline must be a date"))?,
        ))),
        Some(_) => Some(None),
        None => None,
    };

    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "BudgetGoal"
              SET "name" = COALESCE(?1, "name"),
                  "type" = COALESCE(?2, "type"),
                  "targetAmount" = COALESCE(?3, "targetAmount"),
                  "currentAmount" = COALESCE(?4, "currentAmount"),
                  "budgetId" = CASE WHEN ?5 THEN ?6 ELSE "budgetId" END,
                  "deadline" = CASE WHEN ?7 THEN ?8 ELSE "deadline" END,
                  "updatedAt" = ?9
            WHERE "id" = ?10"#,
        b.name,
        b.ty,
        b.target_amount.map(|v| Cents::from_dollars_f64(v).0),
        b.current_amount.map(|v| Cents::from_dollars_f64(v).0),
        b.budget_id.is_some(),
        b.budget_id.and_then(|o| o),
        deadline.is_some(),
        deadline.and_then(|o| o),
        now,
        id
    )
    .execute(pool)
    .await?;
    Ok(Response::ok(goal_json(pool, id).await?))
}

pub async fn delete_goal(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    goal_json(pool, id).await?;
    sqlx::query!(r#"DELETE FROM "BudgetGoal" WHERE "id" = ?"#, id)
        .execute(pool)
        .await?;
    Ok(Response::no_content())
}
