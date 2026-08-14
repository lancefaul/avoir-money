//! Upcoming bills and income, shown above the transactions they will become.
//!
//! Ported from `buildUpcomingAnticipations` in `apps/api/src/lib/transaction-list.ts`,
//! which step 4 missed entirely — so the Transactions page showed real rows and
//! nothing pending. Invisible to the shape validator, because `anticipations` is
//! `.optional()` in `PaginatedTransactionsResponseSchema`: a response without it
//! parses perfectly and is simply missing half the page.
//!
//! # These are not transactions
//!
//! An anticipation is a `ScheduledTransaction` occurrence that has not been paid.
//! It carries the occurrence's id, so marking it paid targets a real row
//! (ADR-024 keeps that id stable across regeneration — the earlier synthetic-id
//! version 404'd on every click).

use crate::id::parse_date;
use crate::ApiError;
use avoir_core::money::Cents;
use avoir_core::trend::map_schedule_status;
use chrono::{Duration, NaiveDate};
use serde::Serialize;
use serde_json::Value;
use sqlx::SqliteConnection;

/// How far ahead a bill appears before it is due.
///
/// A week: long enough to plan around, short enough that the list is still
/// mostly things that have happened.
const LOOKAHEAD_DAYS: i64 = 7;

/// The earliest date occurrences are generated from — the dataset's own epoch.
///
/// See the note at its use: this matches `START` in the TypeScript rather than
/// being derived, because deriving it changes behaviour at a year boundary.
const EPOCH: NaiveDate = match NaiveDate::from_ymd_opt(2026, 1, 1) {
    Some(d) => d,
    None => unreachable!(),
};

/// Every unpaid occurrence due within the lookahead.
///
/// `show_snoozed` is off by default. A snooze is a deliberate "not now", so the
/// page stays quiet — but the rows have to be reachable somehow, or undoing a
/// snooze becomes impossible from the only screen that shows them.
/// An upcoming bill or payday, as the transactions list carries it.
///
/// The `id` is a real `ScheduledTransaction` CUID, never a synthetic key — the
/// pre-history "synthetic ids" decision exists because mark-as-paid took one of
/// these and 404'd on every anticipation.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnticipationShape {
    id: String,
    source_type: &'static str,
    source_id: String,
    name: String,
    amount: f64,
    occurrence_date: String,
    status: String,
    budget_id: Option<String>,
    account_id: Option<String>,
    is_automatic: bool,
    frequency: Option<String>,
}

pub(crate) async fn build(
    conn: &mut SqliteConnection,
    today: NaiveDate,
    show_snoozed: bool,
) -> Result<Vec<Value>, ApiError> {
    let lookahead = today + Duration::days(LOOKAHEAD_DAYS);

    // Generation starts at the dataset's epoch, not at today: an occurrence that
    // came due last month and was never paid still belongs on this list, and a
    // window beginning now cannot produce it.
    //
    // Hardcoded to match the TypeScript's `START`, warts and all. Deriving it
    // from the current year instead would look tidier and silently change
    // behaviour at every New Year — in 2027 it would stop generating unpaid 2026
    // occurrences, and they would disappear from the page rather than stay
    // overdue. If this epoch ever moves it should move in both, deliberately.
    let start = EPOCH;
    // A generation failure must not take the transactions list with it. The page
    // is still useful without its upcoming rows; it is useless if the request
    // 500s.
    if let Err(e) = avoir_db::schedule_generator::generate(
        conn,
        &avoir_db::schedule_generator::Window {
            start,
            end: lookahead,
            source_type: None,
            source_id: None,
        },
    )
    .await
    {
        eprintln!("[anticipations] schedule generation failed, continuing without: {e:#}");
    }

    let bound = crate::dashboard::end_of_day(lookahead);
    let rows = sqlx::query!(
        r#"SELECT s."id" AS "id!", s."sourceType" AS "source_type!", s."sourceId" AS "source_id!",
                  s."dueDate" AS "due!", s."expectedAmount" AS "expected!: i64",
                  s."status" AS "status!", s."snoozedUntil" AS snoozed,
                  e."name" AS expense_name, e."budgetId" AS expense_budget,
                  e."accountId" AS expense_account, e."isAutomatic" AS "expense_auto: i64",
                  e."frequency" AS expense_freq,
                  i."name" AS income_name, i."budgetId" AS income_budget,
                  i."accountId" AS income_account, i."frequency" AS income_freq
             FROM "ScheduledTransaction" s
             LEFT JOIN "Expense" e ON e."id" = s."expenseId"
             LEFT JOIN "Income" i ON i."id" = s."incomeId"
            WHERE s."status" IN ('PENDING', 'SNOOZED', 'PARTIAL')
              AND s."dueDate" <= ?
            -- ASC, and a tie-break, to match what the reference returns. The
            -- reference's `findMany` has **no `orderBy` at all**, so its order
            -- is whatever Postgres gives — in practice insertion order, which
            -- for generated schedule rows is ascending by `dueDate`. This was
            -- DESC and produced the same sixteen rows exactly reversed.
            --
            -- Not user-visible: `sortTransactionLog` re-sorts every entry by
            -- date on the frontend, so nothing rendered was ever wrong. Changed
            -- because an unexplained difference is one somebody re-investigates
            -- later, and matching costs a word.
            --
            -- `id` breaks a tie the reference leaves open: two schedule rows can
            -- share a `dueDate` — an expense and an income on the same day — and
            -- without it their relative order is undefined on both sides, the
            -- same non-total ordering that made the transaction list reshuffle
            -- between renders.
            ORDER BY s."dueDate" ASC, s."id" ASC"#,
        bound
    )
    .fetch_all(&mut *conn)
    .await?;

    let mut out = Vec::new();
    for r in &rows {
        let due = match parse_date(&r.due) {
            Some(d) => d,
            None => continue,
        };
        let status = map_schedule_status(
            &r.status,
            due,
            r.snoozed.as_deref().and_then(parse_date),
            today,
        );

        let visible = matches!(status, "DUE" | "OVERDUE" | "UPCOMING")
            || (show_snoozed && status == "SNOOZED");
        if !visible {
            continue;
        }

        // The source decides which side of the join carries the detail. A row
        // whose source was deleted has neither, and is skipped rather than
        // rendered with empty fields.
        let (name, budget, account, is_automatic, frequency) = match r.source_type.as_str() {
            "EXPENSE" => match &r.expense_name {
                Some(n) => (
                    n,
                    &r.expense_budget,
                    &r.expense_account,
                    r.expense_auto.unwrap_or(0) != 0,
                    &r.expense_freq,
                ),
                None => continue,
            },
            "INCOME" => match &r.income_name {
                Some(n) => (
                    n,
                    &r.income_budget,
                    &r.income_account,
                    // Income is never "automatic" — that flag is about a bill
                    // being paid without the user acting.
                    false,
                    &r.income_freq,
                ),
                None => continue,
            },
            _ => continue,
        };

        out.push(crate::to_body(AnticipationShape {
            id: r.id.clone(),
            source_type: if r.source_type == "EXPENSE" {
                "expense"
            } else {
                "income"
            },
            source_id: r.source_id.clone(),
            name: name.clone(),
            amount: Cents(r.expected).as_dollars_f64(),
            occurrence_date: r.due.clone(),
            status: status.to_string(),
            budget_id: budget.clone(),
            account_id: account.clone(),
            is_automatic,
            frequency: frequency.clone(),
        }));
    }

    Ok(out)
}
