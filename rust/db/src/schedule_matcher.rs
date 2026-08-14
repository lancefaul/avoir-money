//! Schedule matching — port of
//! `apps/api/src/lib/lifecycle/hooks/schedule-matcher.hook.ts` (priority 15).
//!
//! Links a transaction to the PENDING `ScheduledTransaction` it satisfies,
//! within a ±5-day window, and releases that row again if the transaction is
//! deleted or moves out of range.
//!
//! **Matching uses `occurrenceDate` when present, not `date`** (ADR-001). Those
//! differ whenever a bill is paid late: mark-as-paid records today's date but
//! sets `occurrenceDate` to the original due date. Matching on `date` meant an
//! overdue payment failed to find its own schedule row — the bug that produced
//! the ADR. A June 8th bill paid on June 24th must stay attached to the June
//! 8th row.

use anyhow::Result;
use avoir_core::money::Cents;
use chrono::{Duration, NaiveDate};
use sqlx::SqliteConnection;

/// How far a transaction may sit from a due date and still be its payment.
pub const MATCH_WINDOW_DAYS: i64 = 5;

fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(&s[..10.min(s.len())], "%Y-%m-%d").ok()
}

/// The row a transaction is currently linked to, if any.
async fn linked_row(
    conn: &mut SqliteConnection,
    tx_id: &str,
) -> Result<Option<(String, String, Cents)>> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!: String", "dueDate" AS "due!: String",
                  "expectedAmount" AS "expected!: i64"
           FROM "ScheduledTransaction" WHERE "transactionId" = ?"#,
        tx_id
    )
    .fetch_optional(&mut *conn)
    .await?;
    Ok(r.map(|r| (r.id, r.due, Cents(r.expected))))
}

/// PAID when the payment covers what was expected, PARTIAL when it falls short.
///
/// An overpayment is still PAID — the schedule tracks whether the obligation
/// was met, not whether the figures agree to the cent.
fn status_for(actual: Cents, expected: Cents) -> &'static str {
    if actual >= expected {
        "PAID"
    } else {
        "PARTIAL"
    }
}

/// Attach a transaction to the closest pending schedule row in range.
///
/// Does nothing when the transaction is already linked — mark-as-paid links
/// explicitly before the hook runs, and re-matching would move it.
pub async fn on_created(
    conn: &mut SqliteConnection,
    tx_id: &str,
    expense_id: Option<&str>,
    income_id: Option<&str>,
    amount: Cents,
    date: &str,
    occurrence_date: Option<&str>,
) -> Result<Option<String>> {
    if linked_row(conn, tx_id).await?.is_some() {
        return Ok(None);
    }

    let (source_type, source_id) = match (expense_id, income_id) {
        (Some(e), _) => ("EXPENSE", e),
        (None, Some(i)) => ("INCOME", i),
        (None, None) => return Ok(None),
    };

    // The intended due date, not the day it was actually paid.
    let match_date = match parse_date(occurrence_date.unwrap_or(date)) {
        Some(d) => d,
        None => return Ok(None),
    };
    let start = (match_date - Duration::days(MATCH_WINDOW_DAYS)).to_string();
    let end = (match_date + Duration::days(MATCH_WINDOW_DAYS)).to_string();

    let candidates = sqlx::query!(
        r#"SELECT "id" AS "id!: String", "dueDate" AS "due!: String",
                  "expectedAmount" AS "expected!: i64"
           FROM "ScheduledTransaction"
           WHERE "sourceType" = ? AND "sourceId" = ? AND "status" = 'PENDING'
             AND "dueDate" >= ? AND "dueDate" <= ?"#,
        source_type,
        source_id,
        start,
        end
    )
    .fetch_all(&mut *conn)
    .await?;

    // Closest due date wins. Several pending rows can sit inside one window for
    // a weekly or biweekly source, and picking arbitrarily would mark the wrong
    // occurrence paid.
    let best = candidates
        .into_iter()
        .filter_map(|c| parse_date(&c.due).map(|d| (c.id, d, Cents(c.expected))))
        .min_by_key(|(_, due, _)| (*due - match_date).num_days().abs());

    let Some((id, _, expected)) = best else {
        return Ok(None);
    };
    let status = status_for(amount, expected);

    sqlx::query!(
        r#"UPDATE "ScheduledTransaction"
           SET "transactionId" = ?, "actualAmount" = ?, "status" = ?
           WHERE "id" = ?"#,
        tx_id,
        amount.0,
        status,
        id
    )
    .execute(&mut *conn)
    .await?;

    Ok(Some(id))
}

/// Release the schedule row a deleted transaction was satisfying.
///
/// Back to PENDING with the link and actual amount cleared — the obligation is
/// outstanding again. Leaving it PAID is how a deleted payment silently stays
/// "done" and the bill never resurfaces.
pub async fn on_deleted(conn: &mut SqliteConnection, tx_id: &str) -> Result<bool> {
    let Some((id, _, _)) = linked_row(conn, tx_id).await? else {
        return Ok(false);
    };
    sqlx::query!(
        r#"UPDATE "ScheduledTransaction"
           SET "status" = 'PENDING', "transactionId" = NULL, "actualAmount" = NULL
           WHERE "id" = ?"#,
        id
    )
    .execute(&mut *conn)
    .await?;
    Ok(true)
}

/// Re-evaluate the link after a transaction changes.
///
/// Three outcomes: unlinked rows try to match; a link that has drifted beyond
/// the window is released and re-matched against the new date; a link still in
/// range just has its amount and status refreshed.
pub async fn on_updated(
    conn: &mut SqliteConnection,
    tx_id: &str,
    expense_id: Option<&str>,
    income_id: Option<&str>,
    amount: Cents,
    date: &str,
    occurrence_date: Option<&str>,
) -> Result<()> {
    let Some((id, due, expected)) = linked_row(conn, tx_id).await? else {
        // Not matched yet — a link added after creation lands here.
        if expense_id.is_some() || income_id.is_some() {
            on_created(
                conn,
                tx_id,
                expense_id,
                income_id,
                amount,
                date,
                occurrence_date,
            )
            .await?;
        }
        return Ok(());
    };

    let match_date = parse_date(occurrence_date.unwrap_or(date));
    let due_date = parse_date(&due);
    let drifted = match (match_date, due_date) {
        (Some(m), Some(d)) => (d - m).num_days().abs() > MATCH_WINDOW_DAYS,
        _ => false,
    };

    if drifted {
        on_deleted(conn, tx_id).await?;
        if expense_id.is_some() || income_id.is_some() {
            on_created(
                conn,
                tx_id,
                expense_id,
                income_id,
                amount,
                date,
                occurrence_date,
            )
            .await?;
        }
        return Ok(());
    }

    let status = status_for(amount, expected);
    sqlx::query!(
        r#"UPDATE "ScheduledTransaction" SET "actualAmount" = ?, "status" = ? WHERE "id" = ?"#,
        amount.0,
        status,
        id
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}
