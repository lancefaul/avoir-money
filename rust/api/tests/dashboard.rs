//! `/dashboard` — the six aggregations, against a real database.

use avoir_api::{dispatch, ApiError, Response};
use serde_json::{json, Value};
use sqlx::SqlitePool;

async fn db() -> SqlitePool {
    avoir_db::connect_in_memory().await.expect("test db")
}

async fn call(
    pool: &SqlitePool,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    dispatch(pool, method, path, body).await
}

async fn ok(pool: &SqlitePool, method: &str, path: &str, body: Option<Value>) -> Value {
    call(pool, method, path, body)
        .await
        .unwrap_or_else(|e| panic!("{method} {path} failed: {e}"))
        .body
}

async fn err(pool: &SqlitePool, method: &str, path: &str, body: Option<Value>) -> ApiError {
    call(pool, method, path, body)
        .await
        .err()
        .unwrap_or_else(|| panic!("{method} {path} unexpectedly succeeded"))
}

fn id_of(v: &Value) -> String {
    v["id"].as_str().expect("id").to_string()
}

/// Today, so periods built around it really are "current".
fn today() -> chrono::NaiveDate {
    // The SAME notion of today the handlers use. While this said `Utc::now()`
    // the suite passed for the wrong reason: fixture and code were consistently
    // wrong together, so a UTC-vs-local defect could not be expressed. It only
    // failed once the handlers were corrected — after 19:00 local, the seeded
    // rows landed on a different day than the window being computed.
    avoir_core::dates::today()
}

fn iso(d: chrono::NaiveDate) -> String {
    d.format("%Y-%m-%dT00:00:00.000Z").to_string()
}

fn day(d: chrono::NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

async fn account(pool: &SqlitePool, name: &str, ty: &str, opening: f64) -> String {
    id_of(
        &ok(
            pool,
            "POST",
            "/accounts",
            Some(json!({ "name": name, "type": ty, "openingBalance": opening })),
        )
        .await,
    )
}

async fn budget(pool: &SqlitePool, name: &str) -> String {
    let g = ok(
        pool,
        "POST",
        "/budgets/groups",
        Some(json!({ "name": format!("{name} grp"), "color": "#fff" })),
    )
    .await;
    id_of(
        &ok(
            pool,
            "POST",
            "/budgets",
            Some(json!({ "name": name, "groupId": g["id"] })),
        )
        .await,
    )
}

/// A schedule plus one pay period bracketing today, written directly.
///
/// The generator's own period maths is tested elsewhere; here the point is to
/// pin the period so the assertions are not a function of when the suite runs.
async fn schedule_with_current_period(pool: &SqlitePool) -> (String, String) {
    let sid = "sched-1";
    let pid = "period-1";
    let start = today() - chrono::Duration::days(6);
    let end = today() + chrono::Duration::days(7);
    let now = iso(today());

    sqlx::query(
        r#"INSERT INTO "PaySchedule" ("id","name","type","anchorDate","isDefault","createdAt","updatedAt")
           VALUES (?, 'Main', 'BIWEEKLY', ?, 1, ?, ?)"#,
    )
    .bind(sid).bind(&now).bind(&now).bind(&now)
    .execute(pool).await.unwrap();

    sqlx::query(
        r#"INSERT INTO "PayPeriod"
             ("id","scheduleId","startDate","endDate","payDate","year","periodNum")
           VALUES (?, ?, ?, ?, ?, ?, 1)"#,
    )
    .bind(pid)
    .bind(sid)
    .bind(iso(start))
    .bind(iso(end))
    .bind(iso(start))
    .bind(start.format("%Y").to_string().parse::<i64>().unwrap())
    .execute(pool)
    .await
    .unwrap();

    (sid.to_string(), pid.to_string())
}

async fn tx(
    pool: &SqlitePool,
    acct: &str,
    name: &str,
    amount: f64,
    ty: &str,
    date: chrono::NaiveDate,
) -> String {
    id_of(
        &ok(
            pool,
            "POST",
            "/transactions",
            Some(json!({
                "name": name, "amount": amount, "date": day(date),
                "type": ty, "accountId": acct,
            })),
        )
        .await,
    )
}

// ═══ Trends ═══

#[tokio::test]
async fn trends_reports_one_point_per_period_oldest_first() {
    let pool = db().await;
    let (sid, pid) = schedule_with_current_period(&pool).await;
    let acct = account(&pool, "Checking", "Checking", 0.0).await;

    // A second, earlier period so the ordering is observable.
    sqlx::query(
        r#"INSERT INTO "PayPeriod"
             ("id","scheduleId","startDate","endDate","payDate","year","periodNum")
           VALUES ('period-0', ?, '2026-01-01T00:00:00.000Z', '2026-01-14T00:00:00.000Z',
                   '2026-01-06T00:00:00.000Z', 2026, 0)"#,
    )
    .bind(&sid)
    .execute(&pool)
    .await
    .unwrap();

    // Income and an expense, both attributed to the current period.
    let pay = budget(&pool, "Pay").await;
    let income_src = id_of(
        &ok(
            &pool,
            "POST",
            "/income",
            Some(json!({
                "name": "Salary", "amount": 2000.0, "frequency": "BIWEEKLY",
                "accountId": acct, "budgetId": pay, "startDate": day(today()),
            })),
        )
        .await,
    );
    let expense_src = id_of(
        &ok(
            &pool,
            "POST",
            "/expenses",
            Some(json!({
                "name": "Rent", "amount": 500.0, "frequency": "MONTHLY",
                "accountId": acct, "budgetId": pay, "dueDay": 1,
            })),
        )
        .await,
    );
    let a = tx(&pool, &acct, "Salary", 2000.0, "INCOME", today()).await;
    let b = tx(&pool, &acct, "Rent", 500.0, "EXPENSE", today()).await;
    // Written out rather than built with a format!: sqlx refuses a dynamic SQL
    // string at the type level, so injection has to be a deliberate act.
    sqlx::query(r#"UPDATE "Transaction" SET "payPeriodId" = ?, "incomeId" = ? WHERE "id" = ?"#)
        .bind(&pid)
        .bind(&income_src)
        .bind(&a)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(r#"UPDATE "Transaction" SET "payPeriodId" = ?, "expenseId" = ? WHERE "id" = ?"#)
        .bind(&pid)
        .bind(&expense_src)
        .bind(&b)
        .execute(&pool)
        .await
        .unwrap();

    let out = ok(&pool, "GET", "/dashboard/trends", None).await;
    let points = out.as_array().unwrap();
    assert_eq!(points.len(), 2);
    // Fetched newest-first, drawn oldest-first.
    assert_eq!(points[0]["periodLabel"], "Jan 6");
    assert_eq!(points[1]["income"], 2000.0);
    assert_eq!(points[1]["expenses"], 500.0);
    assert_eq!(points[1]["net"], 1500.0);
}

#[tokio::test]
async fn trends_honours_the_period_limit() {
    let pool = db().await;
    let (sid, _) = schedule_with_current_period(&pool).await;
    for i in 0..4 {
        sqlx::query(
            r#"INSERT INTO "PayPeriod"
                 ("id","scheduleId","startDate","endDate","payDate","year","periodNum")
               VALUES (?, ?, ?, ?, ?, 2026, ?)"#,
        )
        .bind(format!("p{i}"))
        .bind(&sid)
        .bind(format!("2026-0{}-01T00:00:00.000Z", i + 1))
        .bind(format!("2026-0{}-14T00:00:00.000Z", i + 1))
        .bind(format!("2026-0{}-06T00:00:00.000Z", i + 1))
        .bind(10 + i as i64)
        .execute(&pool)
        .await
        .unwrap();
    }

    let out = ok(&pool, "GET", "/dashboard/trends?periods=2", None).await;
    assert_eq!(out.as_array().unwrap().len(), 2);
    // An absurd value is clamped rather than refused — this is a chart width.
    let wide = ok(&pool, "GET", "/dashboard/trends?periods=9999", None).await;
    assert_eq!(wide.as_array().unwrap().len(), 5);
}

// ═══ Category breakdown ═══

#[tokio::test]
async fn the_breakdown_groups_by_budget_and_percentages_sum_to_a_hundred() {
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let acct = account(&pool, "Checking", "Checking", 0.0).await;
    let food = budget(&pool, "Food").await;
    let home = budget(&pool, "Home").await;

    for (name, amount, b) in [("Groceries", 75.0, &food), ("Rent", 225.0, &home)] {
        let src = id_of(
            &ok(
                &pool,
                "POST",
                "/expenses",
                Some(json!({
                    "name": name, "amount": amount, "frequency": "MONTHLY",
                    "accountId": acct, "budgetId": b, "dueDay": 1,
                })),
            )
            .await,
        );
        let t = tx(&pool, &acct, name, amount, "EXPENSE", today()).await;
        sqlx::query(r#"UPDATE "Transaction" SET "expenseId" = ? WHERE "id" = ?"#)
            .bind(&src)
            .bind(&t)
            .execute(&pool)
            .await
            .unwrap();
    }

    let out = ok(&pool, "GET", "/dashboard/category-breakdown", None).await;
    let items = out.as_array().unwrap();
    assert_eq!(items.len(), 2);
    // Largest first.
    assert_eq!(items[0]["categoryName"], "Home");
    assert_eq!(items[0]["total"], 225.0);
    assert_eq!(items[0]["percentage"], 75.0);
    assert_eq!(items[1]["percentage"], 25.0);
    assert_eq!(items[0]["transactionCount"], 1);
}

#[tokio::test]
async fn a_pay_period_and_a_date_range_are_alternatives_not_combined_filters() {
    // The period already states its own span. Intersecting it with a range would
    // report a slice of a period as though it were the whole thing — a quiet
    // undercount that looks like a real drop in spending.
    let pool = db().await;
    let (_, pid) = schedule_with_current_period(&pool).await;
    let acct = account(&pool, "Checking", "Checking", 0.0).await;
    let food = budget(&pool, "Food").await;
    let src = id_of(
        &ok(
            &pool,
            "POST",
            "/expenses",
            Some(json!({
                "name": "Groceries", "amount": 90.0, "frequency": "MONTHLY",
                "accountId": acct, "budgetId": food, "dueDay": 1,
            })),
        )
        .await,
    );
    let t = tx(&pool, &acct, "Groceries", 90.0, "EXPENSE", today()).await;
    sqlx::query(r#"UPDATE "Transaction" SET "expenseId" = ?, "payPeriodId" = ? WHERE "id" = ?"#)
        .bind(&src)
        .bind(&pid)
        .bind(&t)
        .execute(&pool)
        .await
        .unwrap();

    // A date range that excludes the transaction entirely. Because a period was
    // named, the range must be ignored rather than intersected.
    let out = ok(
        &pool,
        "GET",
        &format!(
            "/dashboard/category-breakdown?payPeriodId={pid}&dateFrom=1990-01-01&dateTo=1990-12-31"
        ),
        None,
    )
    .await;
    let items = out.as_array().unwrap();
    assert_eq!(items.len(), 1, "the period won: {items:#?}");
    assert_eq!(items[0]["total"], 90.0);
}

#[tokio::test]
async fn an_empty_breakdown_reports_no_percentages_rather_than_dividing_by_zero() {
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let out = ok(&pool, "GET", "/dashboard/category-breakdown", None).await;
    assert!(out.as_array().unwrap().is_empty());
}

// ═══ YTD ═══

#[tokio::test]
async fn ytd_nets_refunds_off_spending_rather_than_counting_them_as_income() {
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let acct = account(&pool, "Checking", "Checking", 0.0).await;

    tx(&pool, &acct, "Salary", 2000.0, "INCOME", today()).await;
    tx(&pool, &acct, "Shopping", 300.0, "EXPENSE", today()).await;
    tx(&pool, &acct, "Returned", 50.0, "REFUND", today()).await;

    let year = today().format("%Y").to_string();
    let out = ok(&pool, "GET", &format!("/dashboard/ytd?year={year}"), None).await;

    assert_eq!(out["totalIncome"], 2000.0);
    assert_eq!(out["totalExpenses"], 250.0, "300 spent less a 50 refund");
    assert_eq!(out["netIncome"], 1750.0);
}

#[tokio::test]
async fn ytd_falls_back_to_the_calendar_year_when_no_periods_exist() {
    // A fresh database still has to show its transactions.
    let pool = db().await;
    let acct = account(&pool, "Checking", "Checking", 0.0).await;
    tx(&pool, &acct, "Salary", 100.0, "INCOME", today()).await;

    let year = today().format("%Y").to_string();
    let out = ok(&pool, "GET", &format!("/dashboard/ytd?year={year}"), None).await;
    assert_eq!(out["totalIncome"], 100.0);
    assert_eq!(out["startDate"], format!("{year}-01-01T00:00:00.000Z"));
    assert_eq!(out["endDate"], format!("{year}-12-31T00:00:00.000Z"));
}

#[tokio::test]
async fn a_split_child_does_not_double_count_its_parent_in_ytd() {
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let acct = account(&pool, "Checking", "Checking", 0.0).await;
    let b = budget(&pool, "Food").await;
    let parent = tx(&pool, &acct, "Basket", 100.0, "EXPENSE", today()).await;
    ok(
        &pool,
        "POST",
        &format!("/transactions/{parent}/children"),
        Some(json!({ "preTaxAmount": 40.0, "budgetId": b })),
    )
    .await;

    let year = today().format("%Y").to_string();
    let out = ok(&pool, "GET", &format!("/dashboard/ytd?year={year}"), None).await;
    assert_eq!(out["totalExpenses"], 100.0, "the parent only");
}

// ═══ Current period ═══

#[tokio::test]
async fn the_current_period_reports_its_schedule_period_and_totals() {
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let acct = account(&pool, "Checking", "Checking", 500.0).await;
    tx(&pool, &acct, "Salary", 2000.0, "INCOME", today()).await;
    tx(&pool, &acct, "Shopping", 300.0, "EXPENSE", today()).await;

    let out = ok(&pool, "GET", "/dashboard/current-period", None).await;
    assert_eq!(out["schedule"]["name"], "Main");
    assert_eq!(out["payPeriod"]["id"], "period-1");
    assert_eq!(out["totalIncome"], 2000.0);
    assert_eq!(out["totalExpenses"], 300.0);
    assert_eq!(out["netIncome"], 1700.0);
}

#[tokio::test]
async fn with_no_schedule_at_all_the_message_says_so() {
    // Different from "no current period": one means the app is unconfigured, the
    // other means the periods need regenerating. Different next actions.
    let pool = db().await;
    let e = err(&pool, "GET", "/dashboard/current-period", None).await;
    assert_eq!(e.status, 404);
    assert!(e.error.contains("No pay schedule"), "{}", e.error);
}

#[tokio::test]
async fn a_schedule_with_no_period_covering_today_says_that_instead() {
    let pool = db().await;
    let now = iso(today());
    sqlx::query(
        r#"INSERT INTO "PaySchedule" ("id","name","type","anchorDate","isDefault","createdAt","updatedAt")
           VALUES ('s', 'Main', 'BIWEEKLY', ?, 1, ?, ?)"#,
    )
    .bind(&now).bind(&now).bind(&now)
    .execute(&pool).await.unwrap();

    let e = err(&pool, "GET", "/dashboard/current-period", None).await;
    assert_eq!(e.status, 404);
    assert!(e.error.contains("No current pay period"), "{}", e.error);
}

#[tokio::test]
async fn an_unknown_schedule_id_is_a_404() {
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let e = err(
        &pool,
        "GET",
        "/dashboard/current-period?scheduleId=ghost",
        None,
    )
    .await;
    assert_eq!(e.status, 404);
}

#[tokio::test]
async fn a_credit_card_bill_lands_on_the_credit_card_not_the_cash_one() {
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let card = account(&pool, "Visa", "Credit Card", 0.0).await;
    let checking = account(&pool, "Checking", "Checking", 0.0).await;

    let b = budget(&pool, "Bills").await;
    for (name, amount, acct) in [("Card bill", 100.0, &card), ("Cash bill", 40.0, &checking)] {
        ok(
            &pool,
            "POST",
            "/expenses",
            Some(json!({
                "name": name, "amount": amount, "frequency": "MONTHLY",
                "accountId": acct, "budgetId": b,
                "dueDay": today().format("%d").to_string().parse::<i64>().unwrap(),
            })),
        )
        .await;
    }

    let out = ok(&pool, "GET", "/dashboard/current-period", None).await;
    let cf = &out["cashFlowSummary"];
    assert_eq!(cf["creditExpenses"], 100.0);
    assert_eq!(cf["cashExpenses"], 40.0);
    // This period's card spending is NOT part of this period's cash need — it is
    // paid next period, and folding it in would double-count it then.
    assert_eq!(cf["cashNeeded"], 40.0);
}

#[tokio::test]
async fn an_hsa_bill_falls_on_neither_cash_flow_card() {
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let hsa = account(&pool, "HSA", "HSA", 0.0).await;

    ok(
        &pool,
        "POST",
        "/expenses",
        Some(json!({
            "name": "Prescription", "amount": 60.0, "frequency": "MONTHLY",
            "accountId": hsa, "budgetId": budget(&pool, "Health").await,
            "dueDay": today().format("%d").to_string().parse::<i64>().unwrap(),
        })),
    )
    .await;

    let out = ok(&pool, "GET", "/dashboard/current-period", None).await;
    let cf = &out["cashFlowSummary"];
    assert_eq!(cf["cashExpenses"], 0.0);
    assert_eq!(cf["creditExpenses"], 0.0);
    let item = out["expenseItems"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["name"] == "Prescription")
        .expect("still listed as a bill");
    assert_eq!(item["expenseType"], "excluded");
}

#[tokio::test]
async fn income_that_lands_somewhere_unspendable_is_not_on_the_cash_cards() {
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let brokerage = account(&pool, "Brokerage", "Brokerage", 0.0).await;

    ok(
        &pool,
        "POST",
        "/income",
        Some(json!({
            "name": "Dividend", "amount": 25.0, "frequency": "BIWEEKLY",
            "accountId": brokerage, "budgetId": budget(&pool, "Pay").await,
            "startDate": day(today()),
        })),
    )
    .await;

    let out = ok(&pool, "GET", "/dashboard/current-period", None).await;
    assert!(
        out["incomeItems"].as_array().unwrap().is_empty(),
        "a reinvested dividend buys no groceries: {:#?}",
        out["incomeItems"]
    );
}

#[tokio::test]
async fn an_archived_expense_stops_appearing_as_something_still_expected() {
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let acct = account(&pool, "Checking", "Checking", 0.0).await;
    let due = today().format("%d").to_string().parse::<i64>().unwrap();
    let e = id_of(
        &ok(
            &pool,
            "POST",
            "/expenses",
            Some(json!({
                "name": "Gym", "amount": 30.0, "frequency": "MONTHLY",
                "accountId": acct, "budgetId": budget(&pool, "Fitness").await, "dueDay": due,
            })),
        )
        .await,
    );

    let before = ok(&pool, "GET", "/dashboard/current-period", None).await;
    assert_eq!(before["expenseItems"].as_array().unwrap().len(), 1);

    ok(&pool, "POST", &format!("/expenses/{e}/archive"), None).await;

    // Its historical occurrences survive (ADR-024 never prunes them) — it just
    // stops being shown as still expected.
    let after = ok(&pool, "GET", "/dashboard/current-period", None).await;
    assert!(after["expenseItems"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn the_previous_periods_card_balance_is_what_this_period_must_cover() {
    let pool = db().await;
    let (sid, _) = schedule_with_current_period(&pool).await;
    let prev_end = today() - chrono::Duration::days(7);
    sqlx::query(
        r#"INSERT INTO "PayPeriod"
             ("id","scheduleId","startDate","endDate","payDate","year","periodNum")
           VALUES ('prev', ?, ?, ?, ?, 2026, 0)"#,
    )
    .bind(&sid)
    .bind(iso(prev_end - chrono::Duration::days(13)))
    .bind(iso(prev_end))
    .bind(iso(prev_end))
    .execute(&pool)
    .await
    .unwrap();

    let card = account(&pool, "Visa", "Credit Card", 0.0).await;

    // Spent inside the previous period, so it counts.
    tx(
        &pool,
        &card,
        "Old charge",
        250.0,
        "EXPENSE",
        prev_end - chrono::Duration::days(2),
    )
    .await;
    // Spent during THIS period, so it must not move the previous figure — the
    // cutoff is the period's own end, never "now".
    tx(&pool, &card, "New charge", 999.0, "EXPENSE", today()).await;

    let out = ok(&pool, "GET", "/dashboard/current-period", None).await;
    let cf = &out["cashFlowSummary"];
    assert_eq!(cf["previousPeriodCreditExpenses"], 250.0);
    assert_eq!(cf["cashNeeded"], 250.0);
}

#[tokio::test]
async fn ad_hoc_cash_spending_excludes_bills_already_shown_as_their_own_lines() {
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let acct = account(&pool, "Checking", "Checking", 0.0).await;
    let due = today().format("%d").to_string().parse::<i64>().unwrap();
    let bill = id_of(
        &ok(
            &pool,
            "POST",
            "/expenses",
            Some(json!({
                "name": "Internet", "amount": 60.0, "frequency": "MONTHLY",
                "accountId": acct, "budgetId": budget(&pool, "Utils").await, "dueDay": due,
            })),
        )
        .await,
    );
    // A paid bill carries an expenseId and is rendered as its own line.
    let paid = tx(&pool, &acct, "Internet", 60.0, "EXPENSE", today()).await;
    sqlx::query(r#"UPDATE "Transaction" SET "expenseId" = ? WHERE "id" = ?"#)
        .bind(&bill)
        .bind(&paid)
        .execute(&pool)
        .await
        .unwrap();
    // An ordinary purchase is not.
    tx(&pool, &acct, "Coffee", 5.0, "EXPENSE", today()).await;

    let out = ok(&pool, "GET", "/dashboard/current-period", None).await;
    assert_eq!(
        out["cashFlowSummary"]["adHocCashSpending"], 5.0,
        "the bill is counted once, as its own line"
    );
}

// ═══ Income trend ═══

#[tokio::test]
async fn the_income_trend_returns_a_point_per_period_of_the_year() {
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let acct = account(&pool, "Checking", "Checking", 0.0).await;
    tx(&pool, &acct, "Salary", 2000.0, "INCOME", today()).await;
    // Real spending in the period, so "the budget REPLACES expenses" is
    // distinguishable from "the budget is added to a zero".
    tx(&pool, &acct, "Shopping", 250.0, "EXPENSE", today()).await;

    let out = ok(&pool, "GET", "/dashboard/income-trend", None).await;
    let points = out.as_array().unwrap();
    assert_eq!(points.len(), 1);
    assert_eq!(points[0]["income"], 2000.0);
    // The current period is a projection, not a record.
    assert_eq!(points[0]["projected"], true);
    // For anything unsettled the budget REPLACES expenses, so the same money is
    // not counted once as a bill and again as the budget it comes out of.
    assert_eq!(points[0]["expenses"], 0.0);
}

#[tokio::test]
async fn a_settled_period_reports_actuals_and_no_budget_projection() {
    let pool = db().await;
    let (sid, _) = schedule_with_current_period(&pool).await;
    let acct = account(&pool, "Checking", "Checking", 0.0).await;
    let past_end = today() - chrono::Duration::days(20);
    sqlx::query(
        r#"INSERT INTO "PayPeriod"
             ("id","scheduleId","startDate","endDate","payDate","year","periodNum")
           VALUES ('past', ?, ?, ?, ?, 2026, 0)"#,
    )
    .bind(&sid)
    .bind(iso(past_end - chrono::Duration::days(13)))
    .bind(iso(past_end))
    .bind(iso(past_end))
    .execute(&pool)
    .await
    .unwrap();

    tx(&pool, &acct, "Old spend", 120.0, "EXPENSE", past_end).await;

    let out = ok(&pool, "GET", "/dashboard/income-trend", None).await;
    let past = out
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["projected"] == false)
        .expect("the settled period");
    assert_eq!(past["expenses"], 120.0, "actuals stand");
    assert_eq!(past["budgetExpenses"], 0.0, "nothing to project");
}

// ═══ Spend prediction ═══

#[tokio::test]
async fn the_prediction_covers_every_day_of_the_period() {
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let out = ok(&pool, "GET", "/dashboard/spend-prediction", None).await;

    assert_eq!(out["totalDays"], 14);
    assert_eq!(out["dailyData"].as_array().unwrap().len(), 14);
    assert_eq!(out["currentDayNumber"], 7);
}

#[tokio::test]
async fn recurring_payments_are_left_out_of_the_actual_line() {
    // They are already deducted from the expected line. Counting them again
    // would show every period as an overspend by exactly the amount of the bills.
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let acct = account(&pool, "Checking", "Checking", 0.0).await;
    let bill = id_of(
        &ok(
            &pool,
            "POST",
            "/expenses",
            Some(json!({
                "name": "Rent", "amount": 900.0, "frequency": "MONTHLY",
                "accountId": acct, "budgetId": budget(&pool, "Housing").await, "dueDay": 1,
            })),
        )
        .await,
    );
    let paid = tx(&pool, &acct, "Rent", 900.0, "EXPENSE", today()).await;
    sqlx::query(r#"UPDATE "Transaction" SET "expenseId" = ? WHERE "id" = ?"#)
        .bind(&bill)
        .bind(&paid)
        .execute(&pool)
        .await
        .unwrap();
    tx(&pool, &acct, "Coffee", 12.0, "EXPENSE", today()).await;

    let out = ok(&pool, "GET", "/dashboard/spend-prediction", None).await;
    let today_point = &out["dailyData"][6];
    assert_eq!(
        today_point["actualCumulative"], 12.0,
        "the coffee, not the rent"
    );
}

#[tokio::test]
async fn a_split_purchase_is_counted_once_via_its_anchor() {
    // The query filters by neither account nor budget, so without the
    // purchase-group filter a group is counted once for the Anchor and again for
    // every leg.
    let pool = db().await;
    schedule_with_current_period(&pool).await;
    let a = account(&pool, "Checking", "Checking", 1000.0).await;
    let b = account(&pool, "Savings", "Savings", 1000.0).await;

    ok(
        &pool,
        "POST",
        "/purchases",
        Some(json!({
            "name": "Sofa", "amount": 300.0, "date": day(today()),
            "payments": [
                { "accountId": a, "amount": 200.0 },
                { "accountId": b, "amount": 100.0 },
            ],
        })),
    )
    .await;

    let out = ok(&pool, "GET", "/dashboard/spend-prediction", None).await;
    assert_eq!(
        out["dailyData"][6]["actualCumulative"], 300.0,
        "the purchase once, not 600"
    );
}

#[tokio::test]
async fn the_prediction_needs_a_current_period() {
    let pool = db().await;
    let e = err(&pool, "GET", "/dashboard/spend-prediction", None).await;
    assert_eq!(e.status, 404);
}
