//! `/dashboard` — the trend, the breakdown, and the year to date.
//!
//! Ported from `routes/dashboard.ts` and `lib/dashboard-ytd.ts`. The current
//! period lives in `dashboard_period.rs` and the two projections in
//! `dashboard_predict.rs`, because between them they carry most of the logic and
//! all of the subtlety.
//!
//! Everything here is read-only.

use crate::id::parse_date;
use crate::{ApiError, Path, Response};
use avoir_core::money::Cents;
use chrono::{Datelike, NaiveDate};
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashMap;

pub(crate) const MONTH_NAMES: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// `Mar 6` — the label under a point on the trend charts.
///
/// Built from an explicit table rather than a locale format. `toLocaleDateString`
/// on the TypeScript side was pinned to `timeZone: 'UTC'` for exactly one
/// reason, and reproducing that with a locale-aware formatter would reintroduce
/// the dependency it was pinned to remove.
pub(crate) fn period_label(d: NaiveDate) -> String {
    format!("{} {}", MONTH_NAMES[d.month0() as usize], d.day())
}

pub(crate) fn today_date() -> NaiveDate {
    avoir_core::dates::today()
}

/// The end of a day, for a `<=` bound against stored timestamps.
///
/// Stored dates are midnight, but 703 production rows carry a local-noon time
/// from one 2026-04-11 import. A bound at the day's own midnight would sort
/// those rows out of their own period; this includes them.
pub(crate) fn end_of_day(d: NaiveDate) -> String {
    format!("{}T23:59:59.999Z", d.format("%Y-%m-%d"))
}

// ─── GET /trends ───

/// One point on the income-vs-expenses trend.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrendPointShape {
    period_label: String,
    pay_date: String,
    income: f64,
    expenses: f64,
    net: f64,
}

/// One row of the spending breakdown.
///
/// `percentage` is UNROUNDED, because that is what the reference returns —
/// `dashboard.ts` computes it inline as `(item.total / grandTotal) * 100`.
/// `avoir_core::aggregation::percentage` rounds to one decimal and was the
/// obvious thing to reach for, but that helper has ZERO callers in the
/// TypeScript: it is dead code, and using it here quietly rounded a value the
/// frontend formats itself.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BreakdownRowShape {
    budget_id: String,
    category_name: String,
    group: String,
    color: Option<String>,
    total: f64,
    percentage: f64,
    transaction_count: i64,
}

/// One row of the year-to-date breakdown. Fewer fields than the period one —
/// no colour and no count — so it is a separate type rather than a shared one
/// with two fields left null.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct YtdRowShape {
    budget_id: String,
    category_name: String,
    group: String,
    total: f64,
}

/// The year-to-date envelope.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct YtdShape {
    year: i32,
    start_date: String,
    end_date: String,
    total_income: f64,
    total_expenses: f64,
    net_income: f64,
    by_category: Vec<YtdRowShape>,
}

pub async fn trends(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let schedule_id = p.query("scheduleId").filter(|s| !s.is_empty());
    let date_from = p.query("dateFrom").and_then(parse_date).map(from_midnight);
    let date_to = p.query("dateTo").and_then(parse_date).map(end_of_day);
    // The TypeScript defaulted to 13 (~6 months of biweekly periods) and capped
    // at 52. An out-of-range value is clamped rather than refused, because this
    // is a chart width, not a correctness input.
    let limit: i64 = p
        .query("periods")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(13)
        .clamp(1, 52);

    let periods = sqlx::query!(
        r#"SELECT "id" AS "id!", "payDate" AS "pay_date!"
             FROM "PayPeriod"
            WHERE (?1 IS NULL OR "scheduleId" = ?1)
              AND (?2 IS NULL OR "payDate" >= ?2)
              AND (?3 IS NULL OR "payDate" <= ?3)
            ORDER BY "payDate" DESC
            LIMIT ?4"#,
        schedule_id,
        date_from,
        date_to,
        limit
    )
    .fetch_all(pool)
    .await?;

    let mut points: Vec<(NaiveDate, TrendPointShape)> = Vec::with_capacity(periods.len());
    for period in &periods {
        // Income is gross `amount` — what landed. Spending is `netAmount` —
        // what the account was actually billed.
        let row = sqlx::query!(
            r#"SELECT
                 COALESCE(SUM("amount") FILTER (WHERE "incomeId" IS NOT NULL), 0) AS "income!: i64",
                 COALESCE(SUM("netAmount") FILTER (WHERE "expenseId" IS NOT NULL), 0) AS "expenses!: i64"
               FROM "Transaction" WHERE "payPeriodId" = ?"#,
            period.id
        )
        .fetch_one(pool)
        .await?;

        let pay_date = parse_date(&period.pay_date)
            .ok_or_else(|| ApiError::new(500, "stored payDate is not a date"))?;
        let income = Cents(row.income);
        let expenses = Cents(row.expenses);
        points.push((
            pay_date,
            TrendPointShape {
                period_label: period_label(pay_date),
                pay_date: period.pay_date.clone(),
                income: income.as_dollars_f64(),
                expenses: expenses.as_dollars_f64(),
                net: (income - expenses).as_dollars_f64(),
            },
        ));
    }

    // Fetched newest-first (that is what "the most recent N" means) but drawn
    // oldest-first, so the chart reads left to right.
    points.sort_by_key(|(d, _)| *d);
    Ok(Response::ok(
        points.into_iter().map(|(_, v)| v).collect::<Vec<_>>(),
    ))
}

fn from_midnight(d: NaiveDate) -> String {
    crate::id::date_at_utc_midnight(d)
}

// ─── GET /category-breakdown ───

struct CategoryTotal {
    budget_id: String,
    name: String,
    group: String,
    color: Option<String>,
    total: Cents,
    count: i64,
}

pub async fn category_breakdown(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let pay_period_id = p.query("payPeriodId").filter(|s| !s.is_empty());
    // A pay period and a date range are alternatives, not filters that combine:
    // the period already states its own span, so applying both would silently
    // intersect them and report a slice of a period as the whole thing.
    let (date_from, date_to) = if pay_period_id.is_some() {
        (None, None)
    } else {
        (
            p.query("dateFrom").and_then(parse_date).map(from_midnight),
            p.query("dateTo").and_then(parse_date).map(end_of_day),
        )
    };
    let group_filter = p.query("group").filter(|s| !s.is_empty());

    // Only transactions filed against a recurring expense carry a budget through
    // that expense, which is what this breakdown reports. Split children never
    // carry an `expenseId`, so they are excluded here for free rather than by a
    // `parentId` filter — worth knowing, because adding one would change nothing
    // and reading its absence as a bug would be the natural mistake.
    let rows = sqlx::query!(
        r#"SELECT t."netAmount" AS "net!: i64",
                  b."id" AS "budget_id!", b."name" AS "budget_name!",
                  g."name" AS group_name, g."color" AS group_color
             FROM "Transaction" t
             JOIN "Expense" e ON e."id" = t."expenseId"
             JOIN "Budget" b ON b."id" = e."budgetId"
             LEFT JOIN "BudgetGroup" g ON g."id" = b."groupId"
            WHERE t."expenseId" IS NOT NULL
              AND (?1 IS NULL OR t."payPeriodId" = ?1)
              AND (?2 IS NULL OR t."date" >= ?2)
              AND (?3 IS NULL OR t."date" <= ?3)
              AND (?4 IS NULL OR g."name" = ?4)"#,
        pay_period_id,
        date_from,
        date_to,
        group_filter
    )
    .fetch_all(pool)
    .await?;

    let mut by_budget: HashMap<String, CategoryTotal> = HashMap::new();
    for r in rows {
        let entry = by_budget
            .entry(r.budget_id.clone())
            .or_insert_with(|| CategoryTotal {
                budget_id: r.budget_id.clone(),
                name: r.budget_name.clone(),
                group: r.group_name.clone().unwrap_or_else(|| "Unknown".into()),
                color: r.group_color.clone(),
                total: Cents(0),
                count: 0,
            });
        entry.total += Cents(r.net);
        entry.count += 1;
    }

    let mut items: Vec<CategoryTotal> = by_budget.into_values().collect();
    let grand_total: i64 = items.iter().map(|i| i.total.0).sum();
    items.sort_by_key(|i| std::cmp::Reverse(i.total.0));

    let out: Vec<BreakdownRowShape> = items
        .iter()
        .map(|i| BreakdownRowShape {
            budget_id: i.budget_id.clone(),
            category_name: i.name.clone(),
            group: i.group.clone(),
            color: i.color.clone(),
            total: i.total.as_dollars_f64(),
            percentage: if grand_total > 0 {
                (i.total.0 as f64 / grand_total as f64) * 100.0
            } else {
                0.0
            },
            transaction_count: i.count,
        })
        .collect();

    Ok(Response::ok(out))
}

// ─── GET /ytd ───

pub async fn ytd(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let year: i32 = p
        .query("year")
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| today_date().year());

    // Pay-period boundaries, not the calendar year, so this agrees with the
    // savings outlook chart beside it. A year that starts mid-period would
    // otherwise report a fortnight of income against a month of bills.
    let cal_start = crate::id::date_at_utc_midnight(
        NaiveDate::from_ymd_opt(year, 1, 1).ok_or_else(|| ApiError::bad_request("bad year"))?,
    );
    let cal_end = crate::id::date_at_utc_midnight(
        NaiveDate::from_ymd_opt(year, 12, 31).ok_or_else(|| ApiError::bad_request("bad year"))?,
    );

    let first = sqlx::query_scalar!(
        r#"SELECT "startDate" FROM "PayPeriod"
            WHERE "startDate" >= ?1 AND "startDate" <= ?2
            ORDER BY "startDate" ASC LIMIT 1"#,
        cal_start,
        cal_end
    )
    .fetch_optional(pool)
    .await?;
    let last = sqlx::query_scalar!(
        r#"SELECT "endDate" FROM "PayPeriod"
            WHERE "startDate" >= ?1 AND "startDate" <= ?2
            ORDER BY "startDate" DESC LIMIT 1"#,
        cal_start,
        cal_end
    )
    .fetch_optional(pool)
    .await?;

    // No periods at all: fall back to the calendar year rather than returning
    // nothing, so a fresh database still shows its transactions.
    let range_start = first.unwrap_or_else(|| cal_start.clone());
    let range_end_date = last
        .as_deref()
        .and_then(parse_date)
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(year, 12, 31).expect("checked above"));
    let range_end = end_of_day(range_end_date);

    // Totals from top-level rows only — a split child would double-count its
    // parent.
    let totals = sqlx::query!(
        r#"SELECT
             COALESCE(SUM("amount") FILTER (WHERE "type" = 'INCOME'), 0) AS "income!: i64",
             COALESCE(SUM("netAmount") FILTER (WHERE "type" = 'EXPENSE'), 0) AS "spend!: i64",
             COALESCE(SUM("netAmount") FILTER (WHERE "type" = 'REFUND'), 0) AS "refund!: i64"
           FROM "Transaction"
          WHERE "parentId" IS NULL AND "date" >= ?1 AND "date" <= ?2"#,
        range_start,
        range_end
    )
    .fetch_one(pool)
    .await?;

    let total_income = Cents(totals.income);
    // A refund reduces spending rather than counting as income.
    let total_expenses = Cents(totals.spend) - Cents(totals.refund);

    let rows = sqlx::query!(
        r#"SELECT t."netAmount" AS "net!: i64",
                  b."id" AS "budget_id!", b."name" AS "budget_name!", g."name" AS group_name
             FROM "Transaction" t
             JOIN "Expense" e ON e."id" = t."expenseId"
             JOIN "Budget" b ON b."id" = e."budgetId"
             LEFT JOIN "BudgetGroup" g ON g."id" = b."groupId"
            WHERE t."parentId" IS NULL AND t."expenseId" IS NOT NULL
              AND t."date" >= ?1 AND t."date" <= ?2"#,
        range_start,
        range_end
    )
    .fetch_all(pool)
    .await?;

    let mut by_budget: HashMap<String, (String, String, Cents)> = HashMap::new();
    for r in rows {
        let entry = by_budget.entry(r.budget_id.clone()).or_insert_with(|| {
            (
                r.budget_name.clone(),
                r.group_name.clone().unwrap_or_else(|| "Unknown".into()),
                Cents(0),
            )
        });
        entry.2 += Cents(r.net);
    }
    let mut by_category: Vec<(String, String, String, Cents)> = by_budget
        .into_iter()
        .map(|(id, (name, group, total))| (id, name, group, total))
        .collect();
    by_category.sort_by_key(|c| std::cmp::Reverse(c.3 .0));

    Ok(Response::ok(YtdShape {
        year,
        start_date: range_start,
        end_date: crate::id::date_at_utc_midnight(range_end_date),
        total_income: total_income.as_dollars_f64(),
        total_expenses: total_expenses.as_dollars_f64(),
        net_income: (total_income - total_expenses).as_dollars_f64(),
        by_category: by_category
            .iter()
            .map(|(id, name, group, total)| YtdRowShape {
                budget_id: (*id).clone(),
                category_name: (*name).clone(),
                group: (*group).clone(),
                total: total.as_dollars_f64(),
            })
            .collect(),
    }))
}
