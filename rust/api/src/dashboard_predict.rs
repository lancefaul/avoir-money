//! `GET /dashboard/income-trend` and `GET /dashboard/spend-prediction`.
//!
//! Ported from `lib/dashboard-income-trend.ts` and the spend-prediction handler
//! in `routes/dashboard.ts`. The rules are in `avoir_core::trend` and
//! `avoir_core::prediction`; this is the querying.

use crate::dashboard::{end_of_day, period_label, today_date};
use crate::dashboard_period::resolve_context;
use crate::id::{date_at_utc_midnight, parse_date};
use crate::{ApiError, Path, Response};
use avoir_core::money::Cents;
use avoir_core::prediction::{
    compute_spend_prediction, BudgetAllocation, BudgetPeriod, PeriodExpense, PredictionInput,
    SpendTx,
};
use avoir_core::trend::{
    classify_period, compute_current_period_totals, compute_future_period_totals,
    compute_past_period_totals, is_seasonal_budget_active_for_period, periods_per_year,
    prorate_budget_to_period, PeriodKind, TrendScheduled, TrendTx,
};
use chrono::{Datelike, NaiveDate};
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};

/// `activeMonths` is stored as a JSON array of 1-indexed months.
///
/// Returned **0-indexed**, because that is what
/// `is_seasonal_budget_active_for_period` expects. The two conventions live one
/// function apart, and getting it wrong shifts every season by a month — which
/// looks plausible on screen and is wrong all year.
fn active_months_zero_indexed(raw: Option<&str>) -> Vec<u32> {
    raw.and_then(|s| serde_json::from_str::<Vec<i64>>(s).ok())
        .map(|v| {
            v.into_iter()
                .filter(|m| (1..=12).contains(m))
                .map(|m| (m - 1) as u32)
                .collect()
        })
        .unwrap_or_default()
}

/// Which income lands somewhere spendable.
///
/// A dividend reinvested in a brokerage is real income that buys no groceries,
/// so it does not belong on a chart about cash coming in.
fn is_cash_income(account_type: Option<&str>) -> bool {
    matches!(
        account_type,
        None | Some("Checking") | Some("Savings") | Some("Cash")
    )
}

// ─── GET /income-trend ───

/// One period on the income trend.
///
/// `budgetExpenses` and the actual `expenses` are alternatives, not a pair: for
/// a past period the actuals are what happened, and for a current or future one
/// the budget projection REPLACES them so that
/// `net = income - trades - budgetExpenses`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IncomeTrendPointShape {
    period_label: String,
    start_date: String,
    end_date: String,
    income: f64,
    expenses: f64,
    trades: f64,
    budget_expenses: f64,
    projected: bool,
}

/// One day of the spend prediction.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DailyPointShape {
    day_number: i64,
    date: String,
    expected_cumulative: f64,
    actual_cumulative: Option<f64>,
}

/// The spend prediction. Display-only — nothing is written from it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpendPredictionShape {
    expected_period_spend: f64,
    over_under_amount: f64,
    period_start_date: String,
    period_end_date: String,
    current_day_number: i64,
    total_days: i64,
    daily_data: Vec<DailyPointShape>,
}

pub async fn income_trend(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let mut conn = pool.acquire().await?;
    let today = today_date();
    let year = today.year();

    // The context resolves the schedule (and 404s the same two ways). Its
    // *period* is the current one, which this endpoint does not use — it walks
    // the whole year.
    let ctx = resolve_context(&mut conn, p.query("scheduleId")).await?;

    let year_start = date_at_utc_midnight(
        NaiveDate::from_ymd_opt(year, 1, 1).ok_or_else(|| ApiError::new(500, "bad year"))?,
    );
    let year_end = end_of_day(
        NaiveDate::from_ymd_opt(year, 12, 31).ok_or_else(|| ApiError::new(500, "bad year"))?,
    );

    let periods = sqlx::query!(
        r#"SELECT "startDate" AS "start!", "endDate" AS "end!", "payDate" AS "pay!"
             FROM "PayPeriod"
            WHERE "scheduleId" = ?1 AND "startDate" <= ?2 AND "endDate" >= ?3
            ORDER BY "startDate" ASC"#,
        ctx.schedule_id,
        year_end,
        year_start
    )
    .fetch_all(&mut *conn)
    .await?;

    // ── Budgets, once, for the whole year ──
    //
    // The LATEST version of each, not the one effective for a given month: this
    // chart projects forward, and the newest figure is the current intent.
    let per_year = periods_per_year(&ctx.schedule_type);
    let mut all_budgets: Vec<(Cents, Vec<u32>)> = Vec::new();
    let year_i64 = year as i64;
    let plan = sqlx::query_scalar!(r#"SELECT "id" FROM "YearPlan" WHERE "year" = ?"#, year_i64)
        .fetch_optional(&mut *conn)
        .await?;
    if let Some(plan_id) = plan {
        let rows = sqlx::query!(
            r#"SELECT v."monthlyEquivalent" AS "monthly!: i64",
                      v."activeMonths" AS active_months
                 FROM "CategoryBudget" cb
                 JOIN "BudgetVersion" v ON v."id" = (
                      SELECT "id" FROM "BudgetVersion"
                       WHERE "categoryBudgetId" = cb."id"
                       ORDER BY "effectiveDate" DESC LIMIT 1)
                WHERE cb."yearPlanId" = ?1 AND cb."removedAt" IS NULL
                  AND cb."doneForYear" = 0"#,
            plan_id
        )
        .fetch_all(&mut *conn)
        .await?;
        for r in rows {
            all_budgets.push((
                Cents(r.monthly),
                active_months_zero_indexed(r.active_months.as_deref()),
            ));
        }
    }

    // One generate call spanning the whole year rather than one per period: the
    // generator caches per day, so per-period calls after the first are skipped
    // and the later periods come back empty.
    if let (Some(first), Some(last)) = (periods.first(), periods.last()) {
        if let (Some(s), Some(e)) = (parse_date(&first.start), parse_date(&last.end)) {
            avoir_db::schedule_generator::generate(
                &mut conn,
                &avoir_db::schedule_generator::Window {
                    start: s,
                    end: e,
                    source_type: None,
                    source_id: None,
                },
            )
            .await
            .map_err(ApiError::from)?;
        }
    }

    let types = crate::dashboard_period::account_types(&mut conn).await?;
    let mut out: Vec<IncomeTrendPointShape> = Vec::with_capacity(periods.len());

    for period in &periods {
        let (Some(start), Some(end)) = (parse_date(&period.start), parse_date(&period.end)) else {
            continue;
        };
        let end_bound = end_of_day(end);

        let tx_rows = sqlx::query!(
            r#"SELECT "amount" AS "amount!: i64", "netAmount" AS "net!: i64",
                      "type" AS "ty!", "date" AS "date!", "accountId" AS account_id
                 FROM "Transaction"
                WHERE "parentId" IS NULL AND "date" >= ?1 AND "date" <= ?2"#,
            period.start,
            end_bound
        )
        .fetch_all(&mut *conn)
        .await?;

        let st_rows = sqlx::query!(
            r#"SELECT s."expectedAmount" AS "expected!: i64", s."sourceType" AS "source!",
                      s."status" AS "status!", s."dueDate" AS "due!",
                      i."accountId" AS income_account
                 FROM "ScheduledTransaction" s
                 LEFT JOIN "Income" i ON i."id" = s."incomeId"
                WHERE s."dueDate" >= ?1 AND s."dueDate" <= ?2"#,
            period.start,
            end_bound
        )
        .fetch_all(&mut *conn)
        .await?;

        let txs: Vec<TrendTx<'_>> = tx_rows
            .iter()
            .filter(|t| {
                t.ty != "INCOME"
                    || is_cash_income(
                        t.account_id
                            .as_deref()
                            .and_then(|a| types.get(a))
                            .map(String::as_str),
                    )
            })
            .filter_map(|t| {
                parse_date(&t.date).map(|date| TrendTx {
                    amount: Cents(t.amount),
                    net_amount: Cents(t.net),
                    tx_type: t.ty.as_str(),
                    date,
                })
            })
            .collect();

        let scheduled: Vec<TrendScheduled<'_>> = st_rows
            .iter()
            .filter(|s| {
                s.source != "INCOME"
                    || is_cash_income(
                        s.income_account
                            .as_deref()
                            .and_then(|a| types.get(a))
                            .map(String::as_str),
                    )
            })
            .filter_map(|s| {
                parse_date(&s.due).map(|due_date| TrendScheduled {
                    expected_amount: Cents(s.expected),
                    source_type: s.source.as_str(),
                    status: s.status.as_str(),
                    due_date,
                })
            })
            .collect();

        let kind = classify_period(start, end, today);
        let totals = match kind {
            PeriodKind::Past => compute_past_period_totals(&txs, start, end),
            PeriodKind::Current => compute_current_period_totals(&txs, &scheduled, start, end),
            PeriodKind::Future => compute_future_period_totals(&scheduled, start, end),
        };

        // For a settled period the actuals ARE the answer. For anything not yet
        // settled the budget replaces expenses outright rather than adding to
        // them — otherwise a projected period counts the same money twice, once
        // as a scheduled bill and again as the budget that bill comes out of.
        let (expenses, budget_expenses) = if kind == PeriodKind::Past {
            (totals.expenses, Cents(0))
        } else {
            let mut projection = Cents(0);
            for (monthly, months) in &all_budgets {
                if is_seasonal_budget_active_for_period(months, start, end) {
                    projection += prorate_budget_to_period(*monthly, per_year);
                }
            }
            (Cents(0), projection)
        };

        let pay = parse_date(&period.pay).unwrap_or(start);
        out.push(IncomeTrendPointShape {
            period_label: period_label(pay),
            start_date: period.start.clone(),
            end_date: period.end.clone(),
            income: totals.income.as_dollars_f64(),
            expenses: expenses.as_dollars_f64(),
            trades: totals.trades.as_dollars_f64(),
            budget_expenses: budget_expenses.as_dollars_f64(),
            projected: kind.projected(),
        });
    }

    Ok(Response::ok(out))
}

// ─── GET /spend-prediction ───

pub async fn spend_prediction(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let mut conn = pool.acquire().await?;
    let ctx = resolve_context(&mut conn, p.query("scheduleId")).await?;
    let today = today_date();
    let end_bound = end_of_day(ctx.end);

    avoir_db::schedule_generator::generate(
        &mut conn,
        &avoir_db::schedule_generator::Window {
            start: ctx.start,
            end: ctx.end,
            source_type: None,
            source_id: None,
        },
    )
    .await
    .map_err(ApiError::from)?;

    // ── What each budget already owes to recurring bills ──
    let bills = sqlx::query!(
        r#"SELECT s."expectedAmount" AS "expected!: i64", e."budgetId" AS budget_id
             FROM "ScheduledTransaction" s
             JOIN "Expense" e ON e."id" = s."expenseId"
            WHERE s."sourceType" = 'EXPENSE'
              AND s."dueDate" >= ?1 AND s."dueDate" <= ?2"#,
        ctx.start_iso,
        end_bound
    )
    .fetch_all(&mut *conn)
    .await?;
    let period_expenses: Vec<PeriodExpense> = bills
        .iter()
        .map(|b| PeriodExpense {
            budget_id: b.budget_id.clone(),
            amount: Cents(b.expected),
        })
        .collect();

    // ── This month's budget allocations ──
    //
    // The version effective for THIS month, not the newest one: a version dated
    // July must not answer a question about March. (The income trend deliberately
    // takes the newest instead, because it projects forward.)
    let allocations = budget_allocations(&mut conn, today).await?;

    // ── Discretionary spending only ──
    //
    // `expenseId IS NULL` drops recurring payments, which are already deducted
    // from the expected line; counting them here too would show every period as
    // an overspend by exactly the amount of the bills.
    //
    // The purchase-group filter counts a split purchase once, via its Anchor.
    // This query filters by neither account nor budget, so without it a group
    // would be counted once for the Anchor and again for every leg.
    let txs = sqlx::query!(
        r#"SELECT "date" AS "date!", "amount" AS "amount!: i64"
             FROM "Transaction"
            WHERE "type" = 'EXPENSE' AND "expenseId" IS NULL
              AND "date" >= ?1 AND "date" <= ?2
              AND ("purchaseGroupId" IS NULL OR "accountId" IS NULL)"#,
        ctx.start_iso,
        end_bound
    )
    .fetch_all(&mut *conn)
    .await?;
    let transactions: Vec<SpendTx> = txs
        .iter()
        .filter_map(|t| {
            parse_date(&t.date).map(|date| SpendTx {
                date,
                amount: Cents(t.amount),
            })
        })
        .collect();

    let result = compute_spend_prediction(PredictionInput {
        period_start: ctx.start,
        period_end: ctx.end,
        today,
        schedule_type: &ctx.schedule_type,
        period_expenses: &period_expenses,
        budget_allocations: &allocations,
        transactions: &transactions,
    });

    Ok(Response::ok(SpendPredictionShape {
        expected_period_spend: result.expected_period_spend.as_dollars_f64(),
        over_under_amount: result.over_under_amount.as_dollars_f64(),
        period_start_date: date_at_utc_midnight(result.period_start_date),
        period_end_date: date_at_utc_midnight(result.period_end_date),
        current_day_number: result.current_day_number,
        total_days: result.total_days,
        daily_data: result
            .daily_data
            .iter()
            .map(|d| DailyPointShape {
                day_number: d.day_number,
                date: date_at_utc_midnight(d.date),
                expected_cumulative: d.expected_cumulative.as_dollars_f64(),
                actual_cumulative: d.actual_cumulative.map(|c| c.as_dollars_f64()),
            })
            .collect(),
    }))
}

/// This month's budget allocations, with whether each has recurring bills.
async fn budget_allocations(
    conn: &mut SqliteConnection,
    today: NaiveDate,
) -> Result<Vec<BudgetAllocation>, ApiError> {
    let year = today.year() as i64;
    // `effectiveDate <= the first of this month` — the same rule
    // `category_budgets::resolve_version` applies, restated because the shape of
    // the query differs (every budget at once rather than one by id).
    let month_start = format!("{:04}-{:02}-01T00:00:00.000Z", today.year(), today.month());

    let Some(plan_id) =
        sqlx::query_scalar!(r#"SELECT "id" FROM "YearPlan" WHERE "year" = ?"#, year)
            .fetch_optional(&mut *conn)
            .await?
    else {
        return Ok(Vec::new());
    };

    let rows = sqlx::query!(
        r#"SELECT cb."budgetId" AS "budget_id!",
                  v."monthlyEquivalent" AS "monthly!: i64",
                  v."activeMonths" AS active_months,
                  (SELECT count(*) FROM "BudgetExpenseLink" l
                    WHERE l."categoryBudgetId" = cb."id") AS "links!: i64"
             FROM "CategoryBudget" cb
             JOIN "BudgetVersion" v ON v."id" = (
                  SELECT "id" FROM "BudgetVersion"
                   WHERE "categoryBudgetId" = cb."id" AND "effectiveDate" <= ?2
                   ORDER BY "effectiveDate" DESC LIMIT 1)
            WHERE cb."yearPlanId" = ?1 AND cb."removedAt" IS NULL"#,
        plan_id,
        month_start
    )
    .fetch_all(&mut *conn)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        // Stored 1-indexed and consumed 1-indexed by `prorate_budget` — the
        // opposite of the income trend, whose helper wants 0-indexed. Kept as
        // stored here rather than converted, which is why the two differ.
        let months: Vec<u32> = r
            .active_months
            .as_deref()
            .and_then(|s| serde_json::from_str::<Vec<i64>>(s).ok())
            .map(|v| {
                v.into_iter()
                    .filter(|m| (1..=12).contains(m))
                    .map(|m| m as u32)
                    .collect()
            })
            .unwrap_or_default();

        out.push(BudgetAllocation {
            budget_id: r.budget_id,
            amount: Cents(r.monthly),
            // `monthlyEquivalent` is already per month, whatever frequency the
            // user entered — so it is always prorated as MONTHLY.
            period: BudgetPeriod::Monthly,
            active_months: if months.is_empty() {
                None
            } else {
                Some(months)
            },
            has_linked_expenses: r.links > 0,
        });
    }
    Ok(out)
}
