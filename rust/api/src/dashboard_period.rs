//! `GET /dashboard/current-period` — the summary the app opens on.
//!
//! Ported from `lib/dashboard-current-period.ts` plus the database half of
//! `lib/cash-flow.ts`. The rules those files express live in
//! `avoir_core::cash_flow` and `avoir_core::trend`; what is left here is the
//! queries that feed them.
//!
//! # Why the previous period's balances are recomputed rather than read
//!
//! They used to come from a `BalanceSnapshot` written once — the first time a
//! period's dashboard was ever viewed — from whatever `Account.balance` happened
//! to be at that instant, and never revisited. If the ledger was incomplete
//! then (a late import, a correction still being typed), the wrong figure froze
//! permanently. Recomputing from `openingBalance + SUM(signed transactions
//! through the period end)` means a later correction is picked up on the next
//! load with no manual fix, ever.
//!
//! The cutoff is the period's own `endDate`, never "now", so spending during the
//! *current* period is dated after it and cannot move the figure.

use crate::id::parse_date;
use crate::{ApiError, Path, Response};
use avoir_core::cash_flow::{
    classify_expense, compute_cash_flow_summary, CashFlowItem, ExpenseKind, CASH_EXCLUDED_TYPES,
};
use avoir_core::money::Cents;
use avoir_core::trend::{is_paused, map_schedule_status};
use chrono::{Datelike, NaiveDate};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashMap;

use crate::dashboard::{end_of_day, today_date};

/// The schedule and period a dashboard request is about.
pub(crate) struct Context {
    pub schedule: Value,
    pub schedule_type: String,
    pub schedule_id: String,
    pub period_id: String,
    pub period: Value,
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub start_iso: String,
}

/// Resolve the schedule and its current period, or say which is missing.
///
/// The two 404s are deliberately different sentences. "No pay schedule" means
/// the app has not been set up; "no current period" means it has, and the
/// periods need regenerating — very different next actions for the user.
pub(crate) async fn resolve_context(
    conn: &mut SqliteConnection,
    requested: Option<&str>,
) -> Result<Context, ApiError> {
    // One query, not two: `sqlx::query!` mints a fresh anonymous struct per
    // invocation, so two branches cannot produce the same type. The `?1 IS NULL`
    // form covers both, and the ordering is what makes the no-id case pick the
    // default schedule first and the oldest otherwise.
    let requested = requested.filter(|s| !s.is_empty());
    let schedule = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "type" AS "ty!",
                  "anchorDate" AS anchor_date, "firstPayDay" AS "first: i64",
                  "secondPayDay" AS "second: i64", "isDefault" AS "is_default!: i64",
                  "createdAt" AS "created!", "updatedAt" AS "updated!"
             FROM "PaySchedule"
            WHERE (?1 IS NULL OR "id" = ?1)
            ORDER BY "isDefault" DESC, "createdAt" ASC LIMIT 1"#,
        requested
    )
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| match requested {
        Some(_) => ApiError::not_found("Pay schedule"),
        None => ApiError::new(404, "No pay schedule found"),
    })?;

    let today = crate::id::date_at_utc_midnight(today_date());
    let period = sqlx::query!(
        r#"SELECT "id" AS "id!", "scheduleId" AS "schedule_id!", "startDate" AS "start!",
                  "endDate" AS "end!", "payDate" AS "pay!", "year" AS "year!: i64",
                  "periodNum" AS "num!: i64"
             FROM "PayPeriod"
            WHERE "scheduleId" = ?1 AND "startDate" <= ?2 AND "endDate" >= ?2
            ORDER BY "payDate" ASC LIMIT 1"#,
        schedule.id,
        today
    )
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| ApiError::new(404, "No current pay period found for this schedule"))?;

    let start = parse_date(&period.start)
        .ok_or_else(|| ApiError::new(500, "stored startDate is not a date"))?;
    let end = parse_date(&period.end)
        .ok_or_else(|| ApiError::new(500, "stored endDate is not a date"))?;

    Ok(Context {
        schedule: json!({
            "id": schedule.id,
            "name": schedule.name,
            "type": schedule.ty,
            "anchorDate": schedule.anchor_date,
            "firstPayDay": schedule.first,
            "secondPayDay": schedule.second,
            "isDefault": schedule.is_default != 0,
            "createdAt": schedule.created,
            "updatedAt": schedule.updated,
        }),
        schedule_type: schedule.ty,
        schedule_id: schedule.id,
        period_id: period.id.clone(),
        period: json!({
            "id": period.id,
            "scheduleId": period.schedule_id,
            "startDate": period.start,
            "endDate": period.end,
            "payDate": period.pay,
            "year": period.year,
            "periodNum": period.num,
        }),
        start,
        end,
        start_iso: period.start,
    })
}

/// Every account's type, for the cash/credit classification.
pub(crate) async fn account_types(
    conn: &mut SqliteConnection,
) -> Result<HashMap<String, String>, ApiError> {
    let rows = sqlx::query!(r#"SELECT "id" AS "id!", "type" AS "ty!" FROM "Account""#)
        .fetch_all(&mut *conn)
        .await?;
    Ok(rows.into_iter().map(|r| (r.id, r.ty)).collect())
}

/// The balance of one account as of a date, computed from the ledger.
///
/// Reuses `reconciliation::sums_around`, which is the same signed-sum rule the
/// reconciler trusts for "balance as of a date". Sharing it here is right —
/// there is no independence to preserve between two *readers* of the balance,
/// only between a reader and the writer it is checking.
async fn balance_through(
    conn: &mut SqliteConnection,
    account_id: &str,
    opening: Cents,
    through: &str,
) -> Result<Cents, ApiError> {
    let (sum, _after) = avoir_db::reconciliation::sums_around(conn, account_id, through)
        .await
        .map_err(ApiError::from)?;
    Ok(opening + sum)
}

/// What the period needs in cash, and where it comes from.
///
/// Cash and credit are separated because they land at different times: a credit
/// expense is owed next period, so the cash the user actually needs THIS period
/// is cash expenses plus the payments due on last period's credit.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CashFlowShape {
    cash_expenses: f64,
    credit_expenses: f64,
    previous_period_credit_expenses: f64,
    previous_period_bank_balance: f64,
    previous_period_checking_balance: f64,
    previous_period_savings_balance: f64,
    ad_hoc_cash_spending: f64,
    cash_needed: f64,
    credit_card_payments: f64,
}

/// The current-period dashboard.
///
/// The three item lists stay `Value`: each is built from several queries with
/// per-row branches, and typing them means typing that assembly too. The
/// envelope and the cash-flow summary — the parts with a fixed field set — are
/// declared here.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PeriodShape {
    pay_period: Value,
    schedule: Value,
    total_income: f64,
    total_expenses: f64,
    net_income: f64,
    income_items: Vec<Value>,
    expense_items: Vec<Value>,
    balances: Vec<Value>,
    cash_flow_summary: CashFlowShape,
}

pub async fn current_period(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let mut conn = pool.acquire().await?;
    let ctx = resolve_context(&mut conn, p.query("scheduleId")).await?;
    let today = today_date();
    let end_bound = end_of_day(ctx.end);

    // Lazily fill in this period's occurrences. Idempotent (ADR-024 keeps ids
    // stable), so a dashboard load never churns what the user is looking at.
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

    let types = account_types(&mut conn).await?;

    // ── Income and expense lines, from the occurrences ──
    let rows = sqlx::query!(
        r#"SELECT s."id" AS "id!", s."sourceType" AS "source_type!", s."dueDate" AS "due!",
                  s."expectedAmount" AS "expected!: i64", s."actualAmount" AS "actual: i64",
                  s."status" AS "status!", s."snoozedUntil" AS snoozed,
                  e."id" AS expense_id, e."name" AS expense_name, e."frequency" AS expense_freq,
                  e."budgetId" AS expense_budget, e."accountId" AS expense_account,
                  e."isAutomatic" AS "expense_auto: i64", e."archivedAt" AS expense_archived,
                  e."pausedUntil" AS expense_paused,
                  i."id" AS income_id, i."name" AS income_name, i."frequency" AS income_freq,
                  i."budgetId" AS income_budget, i."accountId" AS income_account,
                  i."archivedAt" AS income_archived, i."pausedUntil" AS income_paused,
                  t."date" AS paid_date
             FROM "ScheduledTransaction" s
             LEFT JOIN "Expense" e ON e."id" = s."expenseId"
             LEFT JOIN "Income" i ON i."id" = s."incomeId"
             LEFT JOIN "Transaction" t ON t."id" = s."transactionId"
            WHERE s."dueDate" >= ?1 AND s."dueDate" <= ?2
            ORDER BY s."dueDate" ASC"#,
        ctx.start_iso,
        end_bound
    )
    .fetch_all(&mut *conn)
    .await?;

    let mut income_items: Vec<Value> = Vec::new();
    let mut expense_items: Vec<(Option<i64>, Value, ExpenseKind, Cents, bool)> = Vec::new();

    for r in &rows {
        let due = parse_date(&r.due).unwrap_or(today);
        let status = map_schedule_status(
            &r.status,
            due,
            r.snoozed.as_deref().and_then(parse_date),
            today,
        );

        if r.source_type == "INCOME" {
            let Some(id) = &r.income_id else { continue };
            // Archived and paused sources keep their historical occurrences —
            // PAID/PARTIAL/SKIPPED/SNOOZED rows are never pruned (ADR-024) — but
            // must not reappear on the dashboard as things still expected.
            if r.income_archived.is_some()
                || is_paused(r.income_paused.as_deref().and_then(parse_date), today)
            {
                continue;
            }
            // Only income that lands somewhere spendable belongs on the cash
            // cards. A dividend reinvested in a brokerage is real income and
            // still buys no groceries.
            let acct_type = r.income_account.as_deref().and_then(|a| types.get(a));
            let is_cash = matches!(
                acct_type.map(String::as_str),
                None | Some("Checking") | Some("Savings") | Some("Cash")
            );
            if !is_cash {
                continue;
            }
            income_items.push(json!({
                "id": id,
                "name": r.income_name,
                "amount": Cents(r.expected).as_dollars_f64(),
                "frequency": r.income_freq,
                "budgetId": r.income_budget,
                "actualAmount": r.actual.map(|a| Cents(a).as_dollars_f64()),
                "anticipationStatus": status,
                "anticipationId": r.id,
            }));
        } else if r.source_type == "EXPENSE" {
            let Some(id) = &r.expense_id else { continue };
            if r.expense_archived.is_some()
                || is_paused(r.expense_paused.as_deref().and_then(parse_date), today)
            {
                continue;
            }
            let kind = classify_expense(
                r.expense_account
                    .as_deref()
                    .and_then(|a| types.get(a))
                    .map(String::as_str),
            );
            let is_paid = r.status == "PAID";
            // What the cash-flow cards count: the real figure once it is known,
            // the expected one until then.
            let effective = match (is_paid, r.actual) {
                (true, Some(a)) => Cents(a),
                _ => Cents(r.expected),
            };
            expense_items.push((
                Some(due.day() as i64),
                json!({
                    "id": id,
                    "name": r.expense_name,
                    "amount": Cents(r.expected).as_dollars_f64(),
                    "frequency": r.expense_freq,
                    "budgetId": r.expense_budget,
                    "accountId": r.expense_account,
                    "isAutomatic": r.expense_auto.unwrap_or(0) != 0,
                    "dueDay": due.day(),
                    "actualAmount": r.actual.map(|a| Cents(a).as_dollars_f64()),
                    "isPaid": is_paid,
                    "anticipationStatus": status,
                    "anticipationId": r.id,
                    "paidDate": r.paid_date,
                    "expenseType": kind.as_str(),
                }),
                kind,
                effective,
                is_paid,
            ));
        }
    }

    // ── ONE_TIME expenses that actually happened in this period ──
    //
    // They have no recurring occurrence to generate, so they only appear once a
    // transaction exists for them.
    let one_time = sqlx::query!(
        r#"SELECT e."id" AS "id!", e."name" AS "name!", e."frequency" AS "freq!",
                  e."budgetId" AS budget_id, e."accountId" AS account_id,
                  e."isAutomatic" AS "auto!: i64", e."dueDay" AS "due_day: i64",
                  e."amount" AS "amount!: i64",
                  t."netAmount" AS "net!: i64", t."date" AS "tx_date!"
             FROM "Expense" e
             JOIN "Transaction" t ON t."expenseId" = e."id"
            WHERE e."frequency" = 'ONE_TIME'
              AND t."date" >= ?1 AND t."date" <= ?2"#,
        ctx.start_iso,
        end_bound
    )
    .fetch_all(&mut *conn)
    .await?;

    for r in &one_time {
        let kind = classify_expense(
            r.account_id
                .as_deref()
                .and_then(|a| types.get(a))
                .map(String::as_str),
        );
        expense_items.push((
            r.due_day,
            json!({
                "id": r.id,
                "name": r.name,
                "amount": Cents(r.amount).as_dollars_f64(),
                "frequency": r.freq,
                "budgetId": r.budget_id,
                "accountId": r.account_id,
                "isAutomatic": r.auto != 0,
                "dueDay": r.due_day,
                "actualAmount": Cents(r.net).as_dollars_f64(),
                "isPaid": true,
                "anticipationStatus": "PAID",
                "anticipationId": Value::Null,
                "paidDate": r.tx_date,
                "expenseType": kind.as_str(),
            }),
            kind,
            Cents(r.net),
            true,
        ));
    }

    // ── Soonest due first ──
    //
    // `dueDay` is a day-of-month, so it has to be resolved to a real date inside
    // the period before it can be ordered: in a period running 25 Mar – 7 Apr,
    // day 3 falls AFTER day 28. Sorting on the raw number puts next month's
    // bills first.
    expense_items.sort_by_key(|(due_day, _, _, _, _)| resolve_due(*due_day, ctx.start, ctx.end));
    let expense_json: Vec<Value> = expense_items
        .iter()
        .map(|(_, v, _, _, _)| v.clone())
        .collect();

    // ── Balance snapshots for the period ──
    let snapshots = sqlx::query!(
        r#"SELECT b."accountId" AS "account_id!",
                  b."openingBalance" AS "opening!: i64", b."closingBalance" AS "closing!: i64",
                  b."totalIncome" AS "income!: i64", b."totalExpenses" AS "expenses!: i64",
                  a."name" AS account_name
             FROM "BalanceSnapshot" b
             LEFT JOIN "Account" a ON a."id" = b."accountId"
            WHERE b."payPeriodId" = ?"#,
        ctx.period_id
    )
    .fetch_all(&mut *conn)
    .await?;

    let balances: Vec<Value> = snapshots
        .iter()
        .map(|s| {
            json!({
                "accountId": s.account_id,
                "accountName": s.account_name.clone().unwrap_or_else(|| "Unknown".into()),
                "openingBalance": Cents(s.opening).as_dollars_f64(),
                "closingBalance": Cents(s.closing).as_dollars_f64(),
                "totalIncome": Cents(s.income).as_dollars_f64(),
                "totalExpenses": Cents(s.expenses).as_dollars_f64(),
            })
        })
        .collect();

    // ── Totals, from what actually happened ──
    let totals = sqlx::query!(
        r#"SELECT
             COALESCE(SUM("amount") FILTER (WHERE "type" = 'INCOME'), 0) AS "income!: i64",
             COALESCE(SUM("netAmount") FILTER (WHERE "type" = 'EXPENSE'), 0) AS "spend!: i64",
             COALESCE(SUM("netAmount") FILTER (WHERE "type" = 'REFUND'), 0) AS "refund!: i64"
           FROM "Transaction"
          WHERE "parentId" IS NULL AND "date" >= ?1 AND "date" <= ?2"#,
        ctx.start_iso,
        end_bound
    )
    .fetch_one(&mut *conn)
    .await?;
    let total_income = Cents(totals.income);
    let total_expenses = Cents(totals.spend) - Cents(totals.refund);

    // ── Cash flow ──
    let previous_end = sqlx::query_scalar!(
        r#"SELECT "endDate" FROM "PayPeriod"
            WHERE "scheduleId" = ?1 AND "endDate" < ?2
            ORDER BY "endDate" DESC LIMIT 1"#,
        ctx.schedule_id,
        ctx.start_iso
    )
    .fetch_optional(&mut *conn)
    .await?;

    let mut previous_credit = Cents(0);
    let mut previous_checking = Cents(0);
    let mut previous_savings = Cents(0);
    if let Some(prev_end) = &previous_end {
        let accounts = sqlx::query!(
            r#"SELECT "id" AS "id!", "type" AS "ty!", "openingBalance" AS "opening!: i64"
                 FROM "Account" WHERE "type" IN ('Checking', 'Savings', 'Credit Card')"#
        )
        .fetch_all(&mut *conn)
        .await?;
        for a in &accounts {
            let bal = balance_through(&mut conn, &a.id, Cents(a.opening), prev_end).await?;
            match a.ty.as_str() {
                "Checking" => previous_checking += bal,
                "Savings" => previous_savings += bal,
                // A card balance is negative (money owed); the card shows what
                // is left to pay off, so it is reported as a magnitude.
                _ => previous_credit += bal.abs(),
            }
        }
    }

    let card_payments = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM(t."amount"), 0) AS "total!: i64"
             FROM "Transaction" t
             JOIN "Account" a ON a."id" = t."toAccountId"
            WHERE t."type" = 'TRANSFER' AND a."type" = 'Credit Card'
              AND t."date" >= ?1 AND t."date" <= ?2"#,
        ctx.start_iso,
        end_bound
    )
    .fetch_one(&mut *conn)
    .await?;

    let ad_hoc = ad_hoc_cash_spending(&mut conn, &ctx.start_iso, &end_bound, &types).await?;

    let items: Vec<CashFlowItem> = expense_items
        .iter()
        .map(|(_, _, kind, amount, _)| CashFlowItem {
            kind: *kind,
            amount: *amount,
        })
        .collect();
    let summary = compute_cash_flow_summary(
        &items,
        previous_credit,
        previous_checking + previous_savings,
        Cents(card_payments),
    );

    Ok(Response::ok(PeriodShape {
        pay_period: ctx.period,
        schedule: ctx.schedule,
        total_income: total_income.as_dollars_f64(),
        total_expenses: total_expenses.as_dollars_f64(),
        net_income: (total_income - total_expenses).as_dollars_f64(),
        income_items,
        expense_items: expense_json,
        balances,
        cash_flow_summary: CashFlowShape {
            cash_expenses: summary.cash_expenses.as_dollars_f64(),
            credit_expenses: summary.credit_expenses.as_dollars_f64(),
            previous_period_credit_expenses: summary
                .previous_period_credit_expenses
                .as_dollars_f64(),
            previous_period_bank_balance: summary.previous_period_bank_balance.as_dollars_f64(),
            previous_period_checking_balance: previous_checking.as_dollars_f64(),
            previous_period_savings_balance: previous_savings.as_dollars_f64(),
            ad_hoc_cash_spending: ad_hoc.as_dollars_f64(),
            cash_needed: summary.cash_needed.as_dollars_f64(),
            credit_card_payments: summary.credit_card_payments.as_dollars_f64(),
        },
    }))
}

/// Where in the period a day-of-month falls.
///
/// A period can straddle a month boundary, so day 3 may mean next month. Tries
/// this month then the next, clamping to the month's length so day 31 in a
/// 30-day month still resolves. Falls back to the raw day number when neither
/// candidate lands inside the period, and `None` sorts last.
fn resolve_due(due_day: Option<i64>, start: NaiveDate, end: NaiveDate) -> i64 {
    let Some(day) = due_day else { return i64::MAX };
    for offset in 0..=1 {
        let (y, m) = add_months(start.year(), start.month(), offset);
        let last = days_in_month(y, m);
        let candidate = NaiveDate::from_ymd_opt(y, m, (day as u32).min(last));
        if let Some(c) = candidate {
            if c >= start && c <= end {
                return c.num_days_from_ce() as i64;
            }
        }
    }
    day
}

fn add_months(year: i32, month: u32, offset: u32) -> (i32, u32) {
    let zero = month - 1 + offset;
    (year + (zero / 12) as i32, zero % 12 + 1)
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (ny, nm) = add_months(year, month, 1);
    NaiveDate::from_ymd_opt(ny, nm, 1)
        .and_then(|d| d.pred_opt())
        .map(|d| d.day())
        .unwrap_or(28)
}

/// Real cash purchases this period that are not one of the bills already listed.
///
/// `expenseId IS NULL` is what prevents double-counting: a paid recurring bill
/// is rendered as its own line, so counting it here too would subtract it twice
/// from the cash left. Parent rows only, and nets refunds off.
pub(crate) async fn ad_hoc_cash_spending(
    conn: &mut SqliteConnection,
    start: &str,
    end: &str,
    types: &HashMap<String, String>,
) -> Result<Cents, ApiError> {
    let cash_accounts: Vec<&str> = types
        .iter()
        .filter(|(_, t)| t.as_str() != "Credit Card" && !CASH_EXCLUDED_TYPES.contains(&t.as_str()))
        .map(|(id, _)| id.as_str())
        .collect();
    if cash_accounts.is_empty() {
        return Ok(Cents(0));
    }

    // Summed per account rather than with an `IN (?)` list, which sqlx's
    // compile-time macros cannot bind. One indexed lookup per cash account, and
    // there are a handful.
    let mut total = Cents(0);
    for id in cash_accounts {
        let row = sqlx::query!(
            r#"SELECT
                 COALESCE(SUM("netAmount") FILTER (WHERE "type" = 'EXPENSE'), 0) AS "spend!: i64",
                 COALESCE(SUM("netAmount") FILTER (WHERE "type" = 'REFUND'), 0) AS "refund!: i64"
               FROM "Transaction"
              WHERE "accountId" = ?1 AND "parentId" IS NULL AND "expenseId" IS NULL
                AND "date" >= ?2 AND "date" <= ?3"#,
            id,
            start,
            end
        )
        .fetch_one(&mut *conn)
        .await?;
        total += Cents(row.spend) - Cents(row.refund);
    }
    Ok(total)
}
